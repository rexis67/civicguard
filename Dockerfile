# --- Build the React frontend -------------------------------------------------
FROM node:22-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html vite.config.js postcss.config.cjs tailwind.config.cjs ./
COPY src ./src
RUN npm run build

# --- Runtime image ------------------------------------------------------------
FROM node:22-bookworm

ENV NODE_ENV=production \
    PORT=5000 \
    SERVE_STATIC=true \
    CIVICGUARD_DB_PATH=/data/civicguard.sqlite \
    CIVICGUARD_REPORTS_PATH=/data/reports.json \
    UPLOAD_DIR=/data/uploads

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev --no-audit --no-fund

COPY backend ./backend
COPY --from=build /app/dist ./dist

RUN mkdir -p /data/uploads

VOLUME ["/data"]
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]
