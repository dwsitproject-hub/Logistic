#!/bin/sh
set -e
echo "[klip-backend] Ensuring upload directories exist..."
mkdir -p uploads/claim-mutu uploads/documents \
  "uploads/SAP Data/Original" "uploads/SAP Data/Success" "uploads/SAP Data/Failed"
echo "[klip-backend] Running database migrations..."
node dist/database/migrate.js
echo "[klip-backend] Seeding default users (admin, trading, etc.)..."
node dist/database/seed.js
echo "[klip-backend] Migrations and seed done. Starting server..."
exec node dist/server.js
