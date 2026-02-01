FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm i --omit=dev || npm i --production --omit=dev
COPY src ./src
CMD ["npm","start"]