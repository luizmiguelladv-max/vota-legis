# ===========================================================================
# DOCKERFILE - Base (copiada do ponto-eletronico) para usar no vota-legis
# ===========================================================================

FROM node:20-alpine AS base

# curl is required because Coolify's generated healthcheck uses curl/wget.
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    curl

WORKDIR /app

# ---------------------------------------------------------------------------
# STAGE 2: Dependencies
# ---------------------------------------------------------------------------
FROM base AS dependencies

COPY package.json package-lock.json ./

# Coolify exports NODE_ENV=production at build time. Force dev deps so `node ace build` works.
RUN npm ci --include=dev --ignore-scripts

# ---------------------------------------------------------------------------
# STAGE 3: Build
# ---------------------------------------------------------------------------
FROM base AS build

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules

COPY . .

# The ponto-eletronico repo builds with ignore-ts-errors. Keep this behavior.
RUN npm run build -- --ignore-ts-errors

# ---------------------------------------------------------------------------
# STAGE 4: Production Dependencies
# ---------------------------------------------------------------------------
FROM base AS prod-dependencies

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# STAGE 5: Production
# ---------------------------------------------------------------------------
FROM base AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=prod-dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/build ./build
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json

COPY --chown=nodejs:nodejs start.sh ./start.sh
RUN chmod +x ./start.sh

RUN mkdir -p /app/public/downloads /app/public/assets && \
    chown -R nodejs:nodejs /app/public

USER nodejs

EXPOSE 3333

CMD ["./start.sh"]
