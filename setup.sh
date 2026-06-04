#!/bin/bash

# KLIP Setup Script for Linux/Mac
# This script automates the installation and setup process

echo "========================================"
echo "  KLIP Installation Script"
echo "  KPN Logistics Intelligence Platform"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js found: $NODE_VERSION${NC}"
else
    echo -e "${RED}✗ Node.js not found. Please install Node.js 18+ from https://nodejs.org${NC}"
    exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✓ npm found: v$NPM_VERSION${NC}"
else
    echo -e "${RED}✗ npm not found. Please install npm${NC}"
    exit 1
fi

# Check PostgreSQL
if command -v psql &> /dev/null; then
    PSQL_VERSION=$(psql --version)
    echo -e "${GREEN}✓ PostgreSQL found: $PSQL_VERSION${NC}"
else
    echo -e "${YELLOW}⚠ PostgreSQL not found. Please install PostgreSQL 14+${NC}"
    echo -e "${YELLOW}  Download from: https://www.postgresql.org/download/${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "========================================"
echo "  Step 1: Installing Dependencies"
echo "========================================"
echo ""

# Install root dependencies
echo -e "${YELLOW}Installing root dependencies...${NC}"
npm install

# Install frontend dependencies
echo -e "${YELLOW}Installing frontend dependencies...${NC}"
cd frontend && npm install && cd ..

# Install backend dependencies
echo -e "${YELLOW}Installing backend dependencies...${NC}"
cd backend && npm install && cd ..

echo -e "${GREEN}✓ All dependencies installed successfully!${NC}"
echo ""

# Setup environment files
echo "========================================"
echo "  Step 2: Setting Up Environment"
echo "========================================"
echo ""

# Backend .env
if [ -f "backend/.env" ]; then
    echo -e "${YELLOW}⚠ backend/.env already exists, skipping...${NC}"
else
    echo -e "${YELLOW}Creating backend/.env file...${NC}"
    
    read -p "Enter PostgreSQL password (default: postgres): " DB_PASSWORD
    DB_PASSWORD=${DB_PASSWORD:-postgres}
    
    JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)
    
    cat > backend/.env << EOF
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@localhost:5432/klip_db
DB_HOST=localhost
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=${DB_PASSWORD}

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760

# SAP Integration (for future use)
SAP_API_URL=http://sap-server/odata/v2
SAP_USERNAME=
SAP_PASSWORD=

# Email (for alerts)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@klip.com

# Cron Job
DAILY_SYNC_CRON=0 7 * * *
EOF
    
    echo -e "${GREEN}✓ backend/.env created!${NC}"
fi

# Frontend .env.local
if [ -f "frontend/.env.local" ]; then
    echo -e "${YELLOW}⚠ frontend/.env.local already exists, skipping...${NC}"
else
    echo -e "${YELLOW}Creating frontend/.env.local file...${NC}"
    echo "NEXT_PUBLIC_API_URL=http://localhost:5000/api" > frontend/.env.local
    echo -e "${GREEN}✓ frontend/.env.local created!${NC}"
fi

echo ""

# Database setup
echo "========================================"
echo "  Step 3: Database Setup"
echo "========================================"
echo ""

echo -e "${YELLOW}Please create the PostgreSQL database manually:${NC}"
echo ""
echo -e "${CYAN}1. Open PostgreSQL command line:${NC}"
echo "   psql -U postgres"
echo ""
echo -e "${CYAN}2. Create the database:${NC}"
echo "   CREATE DATABASE klip_db;"
echo ""
echo -e "${CYAN}3. Exit psql:${NC}"
echo "   \\q"
echo ""

read -p "Have you created the database? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Running database migration...${NC}"
    cd backend && npm run db:migrate
    
    echo ""
    echo -e "${YELLOW}Seeding database with test users...${NC}"
    npm run db:seed
    cd ..
    
    echo -e "${GREEN}✓ Database setup complete!${NC}"
else
    echo -e "${YELLOW}⚠ Skipping database setup. Run 'npm run db:migrate' and 'npm run db:seed' later.${NC}"
fi

echo ""
echo "========================================"
echo "  Setup Complete!"
echo "========================================"
echo ""
echo -e "${GREEN}To start the application, run:${NC}"
echo -e "  ${CYAN}npm run dev${NC}"
echo ""
echo -e "${GREEN}Then access:${NC}"
echo -e "  ${CYAN}Frontend: http://localhost:3001${NC}"
echo -e "  ${CYAN}API Docs: http://localhost:5001/api-docs${NC}"
echo ""
echo -e "${GREEN}Demo Login Credentials:${NC}"
echo -e "  ${CYAN}Username: admin     Password: admin123${NC}"
echo -e "  ${CYAN}Username: trading   Password: trading123${NC}"
echo -e "  ${CYAN}Username: logistics Password: logistics123${NC}"
echo ""
echo -e "${GREEN}For more information, see:${NC}"
echo -e "  ${CYAN}- QUICKSTART.md for quick start guide${NC}"
echo -e "  ${CYAN}- INSTALLATION.md for detailed setup${NC}"
echo -e "  ${CYAN}- PROJECT_SUMMARY.md for project overview${NC}"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"

