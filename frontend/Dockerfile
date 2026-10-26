# Multi-stage build for production
FROM node:18-alpine AS builder

WORKDIR /app

# Build-time API URL (browser uses this; use /api when Nginx proxies to backend)
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Optional: backend base URL for Next.js rewrites when Docker serves host :80 without Nginx (e.g. http://172.28.92.57:5001)
ARG BACKEND_INTERNAL_URL=
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}

# Jetty Planning System columns on the Shipments table. NEXT_PUBLIC_* is read by Next.js at BUILD
# time, so this has to be an ARG here and not only an entry in docker-compose: an arg the Dockerfile
# does not declare is dropped silently, which also leaves the build cache valid and makes a rebuild
# look like it worked while the old value stays baked in.
ARG NEXT_PUBLIC_JPS_ENABLED=false
ENV NEXT_PUBLIC_JPS_ENABLED=${NEXT_PUBLIC_JPS_ENABLED}

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Downstream Hub SDK (usage analytics, JS errors, "Report a bug"). Off unless BOTH the URL and
# the key are set; then the root layout loads the SDK and the CSP admits its origin. All three
# are NEXT_PUBLIC_*, so they are read at BUILD time - see the note on NEXT_PUBLIC_JPS_ENABLED.
#
# Declared AFTER `npm ci` on purpose. An ARG in scope at a RUN step is part of that step's cache
# key, and NEXT_PUBLIC_GIT_SHA changes on every commit: declared above, it would throw away the
# dependency layer and reinstall node_modules on every single build.
#
#   NEXT_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD) docker compose -f docker-compose.frontend.yml up -d --build
#
# (.git is outside this build context, so the SHA cannot be read in here; pass it in.)
ARG NEXT_PUBLIC_HUB_SDK_URL=
ARG NEXT_PUBLIC_HUB_SDK_KEY=
ARG NEXT_PUBLIC_HUB_SDK_DEBUG=false
ARG NEXT_PUBLIC_GIT_SHA=
ENV NEXT_PUBLIC_HUB_SDK_URL=${NEXT_PUBLIC_HUB_SDK_URL}
ENV NEXT_PUBLIC_HUB_SDK_KEY=${NEXT_PUBLIC_HUB_SDK_KEY}
ENV NEXT_PUBLIC_HUB_SDK_DEBUG=${NEXT_PUBLIC_HUB_SDK_DEBUG}
ENV NEXT_PUBLIC_GIT_SHA=${NEXT_PUBLIC_GIT_SHA}

# Commercial Documents go-live switch: the new app's public origin (e.g. http://172.28.92.56:8081). Set, KLIP drops the two
# Commercial menus and sends document-only users there (src/lib/commercialDocsApp.ts). Empty = unchanged. Build-time, like
# every NEXT_PUBLIC_* - see the note on NEXT_PUBLIC_JPS_ENABLED.
ARG NEXT_PUBLIC_COMMERCIAL_DOCS_URL=
ENV NEXT_PUBLIC_COMMERCIAL_DOCS_URL=${NEXT_PUBLIC_COMMERCIAL_DOCS_URL}

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
ENV HOST=0.0.0.0
ENV HOSTNAME=0.0.0.0
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check: use 127.0.0.1 (avoid IPv6 localhost quirks); accept 2xx/3xx (Next may redirect /).
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/login',(r)=>{r.on('end',()=>process.exit(r.statusCode>=200&&r.statusCode<400?0:1));r.resume();}).on('error',()=>process.exit(1))"

# Start the application
CMD ["node", "server.js"]
