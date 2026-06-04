# Script to automatically create KLIP database

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  KLIP Database Creation Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Find PostgreSQL installation
Write-Host "Looking for PostgreSQL installation..." -ForegroundColor Yellow

$possiblePaths = @(
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe",
    "C:\Program Files\PostgreSQL\14\bin\psql.exe",
    "C:\Program Files\PostgreSQL\13\bin\psql.exe",
    "C:\Program Files (x86)\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files (x86)\PostgreSQL\15\bin\psql.exe",
    "C:\Program Files (x86)\PostgreSQL\14\bin\psql.exe"
)

$psqlPath = $null
foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        $psqlPath = $path
        break
    }
}

if ($psqlPath) {
    Write-Host "Found PostgreSQL at: $psqlPath" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "Creating database 'klip_db'..." -ForegroundColor Yellow
    Write-Host "Please enter your PostgreSQL password when prompted." -ForegroundColor Yellow
    Write-Host ""
    
    # Create database using psql
    $createDbCommand = "CREATE DATABASE klip_db;"
    
    # Run psql command
    echo $createDbCommand | & $psqlPath -U postgres
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Database 'klip_db' created successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Cyan
        Write-Host "1. Run: cd backend" -ForegroundColor White
        Write-Host "2. Run: npm run db:migrate" -ForegroundColor White
        Write-Host "3. Run: npm run db:seed" -ForegroundColor White
    } else {
        Write-Host ""
        Write-Host "Note: If database already exists, that's OK!" -ForegroundColor Yellow
        Write-Host "Proceed with the migration steps." -ForegroundColor Yellow
    }
} else {
    Write-Host "PostgreSQL not found in standard locations." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please use pgAdmin instead:" -ForegroundColor Yellow
    Write-Host "1. Open pgAdmin 4" -ForegroundColor White
    Write-Host "2. Right-click Databases -> Create -> Database" -ForegroundColor White
    Write-Host "3. Name: klip_db" -ForegroundColor White
    Write-Host "4. Click Save" -ForegroundColor White
}

Write-Host ""

