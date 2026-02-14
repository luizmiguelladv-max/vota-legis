# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install ALL dependencies (including devDependencies)
COPY package*.json ./
RUN npm ci --include=dev

# Copy source code
COPY . .

# Build the application
RUN node ace build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init for proper process handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S adonisjs -u 1001

# Copy built application
COPY --from=builder /app/build ./
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --production && npm cache clean --force

# Copy start script
COPY start.sh ./
RUN chmod +x start.sh

# Set ownership
RUN chown -R adonisjs:nodejs /app

USER adonisjs

# Expose port
EXPOSE 3333

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3333/api/health || exit 1

# Start application
ENTRYPOINT ["dumb-init", "--"]
CMD ["./start.sh"]
