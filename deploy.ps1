# KLIP Production Deployment Script for PowerShell

Write-Host "🚀 Starting KLIP Production Deployment..." -ForegroundColor Green

# Check if Docker is running
$dockerRunning = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker is not running. Please start Docker and try again." -ForegroundColor Red
    exit 1
}

# Check if .env exists
if (!(Test-Path .env)) {
    Write-Host "📝 Creating .env file from .env.example..." -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "⚠️  Please edit .env file with your production values before continuing." -ForegroundColor Yellow
    Write-Host "   Especially important: JWT_SECRET, DB_PASSWORD" -ForegroundColor Yellow
    exit 1
}

# Stop existing containers
Write-Host "🛑 Stopping existing containers..." -ForegroundColor Yellow
docker-compose down

# Build images
Write-Host "🔨 Building Docker images..." -ForegroundColor Cyan
docker-compose build --no-cache

# Start services
Write-Host "🚀 Starting services..." -ForegroundColor Green
docker-compose up -d

# Wait for services to be healthy
Write-Host "⏳ Waiting for services to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# Check service health
Write-Host "🏥 Checking service health..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri http://localhost:5001/health -UseBasicParsing -TimeoutSec 5
    Write-Host "✅ Backend is healthy" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Backend health check failed" -ForegroundColor Yellow
}

# Ask about database initialization
$runMigrations = Read-Host "Run database migrations? (y/n)"
if ($runMigrations -eq 'y' -or $runMigrations -eq 'Y') {
    Write-Host "📊 Running database migrations..." -ForegroundColor Cyan
    docker exec klip-backend npm run db:migrate
    if ($LASTEXITCODE -ne 0) {
        Write-Host "⚠️  Migrations may have already run" -ForegroundColor Yellow
    }
    
    $seedDB = Read-Host "Seed database with initial data? (y/n)"
    if ($seedDB -eq 'y' -or $seedDB -eq 'Y') {
        Write-Host "🌱 Seeding database..." -ForegroundColor Cyan
        docker exec klip-backend npm run db:seed
        if ($LASTEXITCODE -ne 0) {
            Write-Host "⚠️  Database may already be seeded" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📍 Access the application:" -ForegroundColor Cyan
Write-Host "   Frontend: http://localhost:3001"
Write-Host "   Backend:  http://localhost:5001"
Write-Host "   API Docs: http://localhost:5001/api-docs"
Write-Host ""
Write-Host "📋 View logs: docker-compose logs -f"
Write-Host "🛑 Stop:     docker-compose down"

