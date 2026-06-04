#!/bin/bash

# KLIP Production Deployment Script

set -e

echo "🚀 Starting KLIP Production Deployment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your production values before continuing."
    echo "   Especially important: JWT_SECRET, DB_PASSWORD"
    exit 1
fi

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose down

# Build images
echo "🔨 Building Docker images..."
docker-compose build --no-cache

# Start services
echo "🚀 Starting services..."
docker-compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to start..."
sleep 30

# Check service health
echo "🏥 Checking service health..."
if curl -f http://localhost:5001/health > /dev/null 2>&1; then
    echo "✅ Backend is healthy"
else
    echo "⚠️  Backend health check failed"
fi

# Initialize database (first time only)
read -p "Run database migrations? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "📊 Running database migrations..."
    docker exec klip-backend npm run db:migrate || echo "⚠️  Migrations may have already run"
    
    read -p "Seed database with initial data? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🌱 Seeding database..."
        docker exec klip-backend npm run db:seed || echo "⚠️  Database may already be seeded"
    fi
fi

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📍 Access the application:"
echo "   Frontend: http://localhost:3001"
echo "   Backend:  http://localhost:5001"
echo "   API Docs: http://localhost:5001/api-docs"
echo ""
echo "📋 View logs: docker-compose logs -f"
echo "🛑 Stop:     docker-compose down"

