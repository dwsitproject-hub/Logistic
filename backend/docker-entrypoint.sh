#!/bin/sh
set -e
echo "[klip-backend] Running database migrations..."
node dist/database/migrate.js
echo "[klip-backend] Seeding default users (admin, trading, etc.)..."
node dist/database/seed.js
echo "[klip-backend] Migrations and seed done. Starting server..."
exec node dist/server.js
