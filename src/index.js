import fetch from "node-fetch";
import os from "os";

const CONTROL_URL = String(process.env.CONTROL_URL || "").replace(/\/+$/, "");
const NODE_SECRET = String(process.env.NODE_SECRET || "");
const NODE_ID = String(process.env.NODE_ID || "").trim();
const NODE_NAME = String(process.env.NODE_NAME || NODE_ID).trim();
const PUBLIC_IP = String(process.env.PUBLIC_IP || "").trim();
const PROXY_PORT = Number(process.env.PROXY_PORT || 1080);
const NODE_REGION = String(process.env.NODE_REGION || "—").trim();
const NODE_TYPE = String(process.env.NODE_TYPE || "SOCKS5").trim().toUpperCase();
const TLS = String(process.env.TLS_MODE || "off").toLowerCase() === "on";
const HEARTBEAT_SEC = Math.max(5, Number(process.env.HEARTBEAT_SEC || 20));
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.REQUEST_TIMEOUT_MS || 8000));
const REGISTER_RETRY_BASE_MS = Math.max(500, Number(process.env.REGISTER_RETRY_BASE_MS || 1000));
const REGISTER_RETRY_MAX_MS = Math.max(REGISTER_RETRY_BASE_MS, Number(process.env.REGISTER_RETRY_MAX_MS || 30000));
const REGISTER_MAX_ATTEMPTS = Math.max(0, Number(process.env.REGISTER_MAX_ATTEMPTS || 0));

if (!CONTROL_URL) throw new Error("CONTROL_URL is required");
if (!NODE_SECRET) throw new Error("NODE_SECRET is required");
if (!NODE_ID) throw new Error("NODE_ID is required");
if (!PUBLIC_IP) throw new Error("PUBLIC_IP is required");
if (!Number.isFinite(PROXY_PORT) || PROXY_PORT <= 0 || PROXY_PORT > 65535) throw new Error("Bad PROXY_PORT");

const headers = {
    "Content-Type": "application/json",
    "X-Node-Secret": NODE_SECRET,
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiPost(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const res = await fetch(`${CONTROL_URL}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        const j = await res.json().catch(() => null);
        if (!res.ok || !j || j.ok === false) throw new Error(`${path} failed: ${res.status}`);
        return j;
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(`${path} timeout after ${REQUEST_TIMEOUT_MS}ms`);
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function register() {
    const payload = {
        node_id: NODE_ID,
        name: NODE_NAME,
        ip: PUBLIC_IP,
        port: PROXY_PORT,
        type: NODE_TYPE,
        region: NODE_REGION,
        tls: TLS,
        version: "1.0.0",
    };
    await apiPost("/node/register", payload);
}

async function registerWithRetry() {
    let attempt = 0;

    while (true) {
        attempt += 1;

        try {
            await register();
            return;
        } catch (error) {
            const message = error?.message || String(error);
            const reachedLimit = REGISTER_MAX_ATTEMPTS > 0 && attempt >= REGISTER_MAX_ATTEMPTS;

            if (reachedLimit) {
                throw new Error(`register failed after ${attempt} attempts: ${message}`);
            }

            const backoffMs = Math.min(REGISTER_RETRY_BASE_MS * (2 ** (attempt - 1)), REGISTER_RETRY_MAX_MS);
            console.error(`[node] register attempt ${attempt} failed: ${message}; retry in ${backoffMs}ms`);
            await sleep(backoffMs);
        }
    }
}

async function heartbeat() {
    const load = os.loadavg?.() || [0, 0, 0];
    const memTotal = os.totalmem?.() || 0;
    const memFree = os.freemem?.() || 0;

    const payload = {
        node_id: NODE_ID,
        ts: Date.now(),
        metrics: {
            load1: load[0],
            mem_total: memTotal,
            mem_free: memFree,
        },
    };

    await apiPost("/node/heartbeat", payload);
}

async function main() {
    await registerWithRetry();
    console.log(`[node] registered: ${NODE_ID} -> ${CONTROL_URL}`);

    let heartbeatInFlight = false;

    const runHeartbeat = async () => {
        if (heartbeatInFlight) return;

        heartbeatInFlight = true;
        try {
            await heartbeat();
        } catch (error) {
            console.error("[node] heartbeat error:", error?.message || error);
        } finally {
            heartbeatInFlight = false;
        }
    };

    setInterval(runHeartbeat, HEARTBEAT_SEC * 1000);

    await runHeartbeat();
}

main().catch((e) => {
    console.error("[node] fatal:", e.message || e);
    process.exit(1);
});
