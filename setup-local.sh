#!/bin/bash
# =============================================================================
# KLIP - Local Setup Script (Linux / macOS)
# Jalankan: bash setup-local.sh
# =============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "============================================="
echo "   KLIP - Local Setup"
echo "============================================="
echo ""

# -----------------------------------------------------------------------------
# 1. Check Node.js
# -----------------------------------------------------------------------------
info "Mengecek Node.js..."
if ! command -v node &>/dev/null; then
  error "Node.js tidak ditemukan. Install dari https://nodejs.org (v18+)"
fi
NODE_VER=$(node --version)
info "Node.js: $NODE_VER"

# -----------------------------------------------------------------------------
# 2. Check PostgreSQL
# -----------------------------------------------------------------------------
info "Mengecek PostgreSQL..."
if ! command -v psql &>/dev/null; then
  warn "psql tidak ditemukan di PATH."
  echo ""
  echo "  Install PostgreSQL:"
  echo "  - Mac:   brew install postgresql@16 && brew services start postgresql@16"
  echo "  - Ubuntu: sudo apt install postgresql && sudo service postgresql start"
  echo ""
  read -p "Sudah install PostgreSQL dan ingin lanjut? (y/N): " CONT
  [[ "$CONT" =~ ^[Yy]$ ]] || error "Setup dibatalkan. Install PostgreSQL dulu."
fi

# -----------------------------------------------------------------------------
# 3. Setup .env backend
# -----------------------------------------------------------------------------
info "Setup file backend/.env ..."
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  info "File backend/.env dibuat dari .env.example"
  echo ""
  warn "Pastikan kredensial database di backend/.env sudah benar sebelum lanjut."
  echo "  Default: DB_USER=klip  DB_PASSWORD=klip123  DB_NAME=klip_db"
  echo ""
  read -p "Tekan Enter setelah edit backend/.env (atau Enter untuk pakai default)..."
else
  info "backend/.env sudah ada, dilewati."
fi

# -----------------------------------------------------------------------------
# 4. Setup .env frontend
# -----------------------------------------------------------------------------
info "Setup file frontend/.env.local ..."
if [ ! -f frontend/.env.local ]; then
  echo "NEXT_PUBLIC_API_URL=http://localhost:5001/api" > frontend/.env.local
  info "File frontend/.env.local dibuat."
else
  info "frontend/.env.local sudah ada, dilewati."
fi

# -----------------------------------------------------------------------------
# 5. Buat database & user (opsional, skip jika sudah ada)
# -----------------------------------------------------------------------------
info "Mencoba membuat PostgreSQL user & database..."

# Detect postgres superuser
PG_USER="postgres"
if command -v pg_lsclusters &>/dev/null; then
  # Ubuntu / Debian
  PSQL_CMD="sudo -u postgres psql"
else
  # Mac (Homebrew) — user saat ini biasanya sudah superuser
  PSQL_CMD="psql postgres"
fi

DB_USER=$(grep DB_USER backend/.env | cut -d '=' -f2 | tr -d ' ')
DB_PASS=$(grep DB_PASSWORD backend/.env | cut -d '=' -f2 | tr -d ' ')
DB_NAME=$(grep DB_NAME backend/.env | cut -d '=' -f2 | tr -d ' ')

$PSQL_CMD -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}' CREATEDB;" 2>/dev/null \
  && info "User '${DB_USER}' dibuat." \
  || warn "User '${DB_USER}' mungkin sudah ada, dilanjutkan."

$PSQL_CMD -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null \
  && info "Database '${DB_NAME}' dibuat." \
  || warn "Database '${DB_NAME}' mungkin sudah ada, dilanjutkan."

# -----------------------------------------------------------------------------
# 6. Install backend dependencies
# -----------------------------------------------------------------------------
info "Install backend dependencies..."
cd backend
npm install
cd ..

# -----------------------------------------------------------------------------
# 7. Migrasi & Seed database
# -----------------------------------------------------------------------------
info "Menjalankan migrasi database..."
cd backend
npm run db:migrate
info "Menjalankan seed data..."
npm run db:seed
cd ..

# -----------------------------------------------------------------------------
# 8. Install frontend dependencies
# -----------------------------------------------------------------------------
info "Install frontend dependencies..."
cd frontend
npm install
cd ..

# -----------------------------------------------------------------------------
# 9. Jalankan backend & frontend
# -----------------------------------------------------------------------------
echo ""
echo "============================================="
info "Setup selesai! Menjalankan KLIP..."
echo "============================================="
echo ""
echo "  Frontend : http://localhost:3001"
echo "  Backend  : http://localhost:5001"
echo "  API Docs : http://localhost:5001/api-docs"
echo ""
echo "  Login    : admin / admin123"
echo ""
echo "  Tekan Ctrl+C untuk menghentikan."
echo ""

# Jalankan backend di background, frontend di foreground
cd backend && npm run dev &
BACKEND_PID=$!

sleep 3

cd ../frontend && npm run dev &
FRONTEND_PID=$!

# Tunggu kedua proses
wait $BACKEND_PID $FRONTEND_PID
