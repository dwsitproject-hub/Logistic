# Multi-stage build for production
FROM node:18-alpine AS builder

WORKDIR /app

# Build-time API URL (browser uses this; use /api when Nginx proxies to backend)
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Optional: backend base URL for Next.js rewrites when Docker serves host :80 without Nginx (e.g. http://172.28.92.57:5001)
ARG BACKEND_INTERNAL_URL=
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Ensure public exists (Next.js optional; COPY in production stage requires it)
RUN mkdir -p public

# Build Next.js application
RUN npm run build

# Production image
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application and public files
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 && \
    chown -R nextjs:nodejs /app

USER nextjs

# Listen on all interfaces so the app is reachable from outside the container (Docker port mapping)
ENV HOSTNAME=0.0.0.0
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check (Next.js app root)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "server.js"]
