# ===========================================================================
# DOCKERFILE - VotaLegis (otimizado para build rápido)
# ===========================================================================

FROM node:20-alpine AS base

RUN apk add --no-cache \
    postgresql-client \
    curl

WORKDIR /app

# ---------------------------------------------------------------------------
# STAGE 2: Build (instala deps + compila TypeScript numa etapa só)
# ---------------------------------------------------------------------------
FROM base AS build

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts

COPY . .
RUN npm run build -- --ignore-ts-errors

# ---------------------------------------------------------------------------
# STAGE 3: Production
# ---------------------------------------------------------------------------
FROM base AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Instalar deps de produção no stage final (evita copiar node_modules entre stages)
COPY --chown=nodejs:nodejs package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build --chown=nodejs:nodejs /app/build ./build
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json

COPY --chown=nodejs:nodejs start.sh ./start.sh
RUN chmod +x ./start.sh

RUN mkdir -p /app/public/downloads /app/public/assets && \
    chown -R nodejs:nodejs /app/public

USER nodejs

EXPOSE 3333

CMD ["./start.sh"]
