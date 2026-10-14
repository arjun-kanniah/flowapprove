# syntax=docker/dockerfile:1
# Two images from one file:
#   app     - the API, serving the built web app (production dependencies only)
#   migrate - applies database migrations with the Prisma CLI, run by each deploy

# 1. Install everything and build the API and the web app
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci
COPY api/ api/
COPY web/ web/
RUN cd api && npx prisma generate && npm run build
RUN cd web && npm run build

# 2. Production dependencies of the API only. The Prisma CLI is an optional peer of the client
#    and is left out: the app never runs it (the migrate image does).
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --omit=dev --omit=peer --omit=optional --workspace api

# 3. Migrations: the Prisma CLI and the migration files, nothing else
FROM node:24-slim AS migrate
WORKDIR /app
RUN npm install --no-save --no-audit --no-fund prisma@7.10.0
COPY api/prisma ./prisma
COPY api/prisma.config.ts ./
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# 4. The app: non-root, no build tools
FROM node:24-slim AS app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/web/dist \
    DEMO_QUOTES_DIR=/app/demo/quotes
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/package.json ./api/
COPY --from=build /app/web/dist ./web/dist
COPY demo/quotes ./demo/quotes
USER node
EXPOSE 8080
WORKDIR /app/api
CMD ["node", "dist/main.js"]
