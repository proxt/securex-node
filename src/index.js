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

if (!CONTROL_URL) throw new Error("CONTROL_URL is required");
if (!NODE_SECRET) throw new Error("NODE_SECRET is required");
if (!NODE_ID) throw new Error("NODE_ID is required");
if (!PUBLIC_IP) throw new Error("PUBLIC_IP is required");
if (!Number.isFinite(PROXY_PORT) || PROXY_PORT <= 0 || PROXY_PORT > 65535) throw new Error("Bad PROXY_PORT");

const headers = {
    "Content-Type": "application/json",
    "X-Node-Secret": NODE_SECRET,
};

async function apiPost(path, body) {
    const res = await fetch(`${CONTROL_URL}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.ok === false) throw new Error(`${path} failed: ${res.status}`);
    return j;
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
            mem_free: memFree
        }
    };

    await apiPost("/node/heartbeat", payload);
}

async function main() {
    await register();
    console.log(`[node] registered: ${NODE_ID} -> ${CONTROL_URL}`);

    // heartbeat loop
    setInterval(() => {
        heartbeat().catch((e) => console.error("[node] heartbeat error:", e.message || e));
    }, HEARTBEAT_SEC * 1000);

    // first heartbeat immediately
    heartbeat().catch(() => {});
}

main().catch((e) => {
    console.error("[node] fatal:", e.message || e);
    process.exit(1);
});
