# Commercial Documents front end. Same pattern as frontend/Dockerfile: build, then a small standalone image.
FROM node:18-alpine AS builder
WORKDIR /app

# Only needed when no Nginx fronts this app: Next then proxies /api and /auth here (e.g. http://172.28.92.57:5001).
# Rewrites are fixed at build time, so this must be a build ARG.
ARG BACKEND_INTERNAL_URL=
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci

# Where "Open KLIP" in the sidebar points. NEXT_PUBLIC_* is read at BUILD time - an ARG the Dockerfile does not declare is
# dropped silently and the old value stays baked in. Declared after `npm ci` so changing it keeps the dependency layer.
ARG NEXT_PUBLIC_KLIP_URL=
ENV NEXT_PUBLIC_KLIP_URL=${NEXT_PUBLIC_KLIP_URL}

# Downstream Hub SDK (usage analytics, JS errors, "Report a bug"). Off unless BOTH the URL and the key are set; then the root layout loads the SDK and the CSP
# admits its origin. Build-time like every NEXT_PUBLIC_*. Declared after `npm ci` for the same reason: NEXT_PUBLIC_GIT_SHA changes on every commit and would
# otherwise throw away the dependency layer. .git is outside the build context, so the deploy script passes the SHA in.
ARG NEXT_PUBLIC_HUB_SDK_URL=
ARG NEXT_PUBLIC_HUB_SDK_KEY=
ARG NEXT_PUBLIC_HUB_SDK_DEBUG=false
ARG NEXT_PUBLIC_GIT_SHA=
ENV NEXT_PUBLIC_HUB_SDK_URL=${NEXT_PUBLIC_HUB_SDK_URL}
ENV NEXT_PUBLIC_HUB_SDK_KEY=${NEXT_PUBLIC_HUB_SDK_KEY}
ENV NEXT_PUBLIC_HUB_SDK_DEBUG=${NEXT_PUBLIC_HUB_SDK_DEBUG}
ENV NEXT_PUBLIC_GIT_SHA=${NEXT_PUBLIC_GIT_SHA}

COPY . .
RUN mkdir -p public && npm run build

FROM node:18-alpine AS production
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOST=0.0.0.0 HOSTNAME=0.0.0.0 PORT=3002

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 && chown -R nextjs:nodejs /app
USER nextjs
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3002/login',(r)=>{r.on('end',()=>process.exit(r.statusCode>=200&&r.statusCode<400?0:1));r.resume();}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
