FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY web web
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10443 LOCAL_HTTPS=1 TLS_CERT_PATH=/app/certs/localhost.pem TLS_KEY_PATH=/app/certs/localhost-key.pem DB_PATH=/app/data/erp.sqlite FILES_PATH=/app/data/files
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev && mkdir -p /app/data && chown -R node:node /app/data
COPY --chown=node:node server/src server/src
COPY --from=build /app/web/dist web/dist
USER node
WORKDIR /app/server
EXPOSE 10443
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s CMD node src/healthcheck.js
CMD ["node", "src/main.js"]
