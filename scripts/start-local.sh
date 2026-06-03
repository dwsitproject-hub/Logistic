#!/usr/bin/env bash
# Start KLIP for local access (native Postgres + npm dev).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> KLIP local startup"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v18+)." >&2
  exit 1
fi

# PostgreSQL
if command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready -q 2>/dev/null; then
    echo "Starting PostgreSQL..."
    sudo service postgresql start 2>/dev/null || sudo pg_ctlcluster 16 main start 2>/dev/null || true
  fi
fi

# Env files
if [[ ! -f backend/.env ]]; then
  cat > backend/.env <<'EOF'
PORT=5001
NODE_ENV=development
HOST=0.0.0.0
JWT_SECRET=dev-secret-change-in-production
JWT_EXPIRES_IN=7d
DB_HOST=localhost
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=postgres123
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
EOF
  echo "Created backend/.env (edit DB_PASSWORD if needed)."
fi

if [[ ! -f frontend/.env.local ]]; then
  echo 'NEXT_PUBLIC_API_URL=/api' > frontend/.env.local
  echo "Created frontend/.env.local"
fi

if [[ ! -d node_modules ]] || [[ ! -d backend/node_modules ]] || [[ ! -d frontend/node_modules ]]; then
  echo "==> Installing dependencies..."
  npm run install:all
fi

echo "==> Database migrate + seed..."
(cd backend && npm run db:migrate && npm run db:seed)

echo ""
echo "==> Starting frontend (:3001) and backend (:5001)..."
echo "    Open in a normal browser tab (not embedded preview):"
echo "      http://127.0.0.1:3001"
echo "    Login: admin / admin123"
echo ""

exec npm run dev
