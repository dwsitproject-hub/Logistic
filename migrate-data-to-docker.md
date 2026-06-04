# 🔄 Migrate Data to Docker PostgreSQL

## Current Situation

- Your **existing data** is in your **host PostgreSQL** (port 5432)
- Docker is using its **own fresh database** (empty)
- You need to migrate data from host to Docker

## Solution: Export and Import Data

### Step 1: Export from Host Database

```powershell
# Export all data from your host PostgreSQL
pg_dump -U postgres -h localhost -d klip_db -F c -f klip_backup.dump

# Or export as SQL file
pg_dump -U postgres -h localhost -d klip_db > klip_backup.sql
```

### Step 2: Import into Docker Database

#### Option A: Using pg_restore (for .dump files)

```powershell
# Copy dump file to Docker
docker cp klip_backup.dump klip-postgres-dev:/tmp/

# Import into Docker database
docker exec -i klip-postgres-dev pg_restore -U postgres -d klip_db -c /tmp/klip_backup.dump
```

#### Option B: Using SQL file

```powershell
# Import SQL file
cat klip_backup.sql | docker exec -i klip-postgres-dev psql -U postgres -d klip_db
```

## Quick One-Line Command

```powershell
# Export and import in one command
pg_dump -U postgres -h localhost -d klip_db | docker exec -i klip-postgres-dev psql -U postgres -d klip_db
```

## Alternative: Use Host Database in Docker

Instead of migrating data, you can run the app **without Docker** for data access, or continue using Docker for development with fresh data.

## After Migration

1. Refresh your browser at http://localhost:3001
2. Login with `admin` / `admin123`
3. Your existing data will be visible

## Current Docker Database Status

```powershell
# Check what's in Docker database
docker exec klip-postgres-dev psql -U postgres -d klip_db -c "SELECT COUNT(*) FROM contracts;"
docker exec klip-postgres-dev psql -U postgres -d klip_db -c "SELECT COUNT(*) FROM shipments;"
```

## Files to Backup

If you want to keep a backup before migration:

```powershell
# Backup host database
pg_dump -U postgres -h localhost -d klip_db > backup_before_migration.sql
```

## Quick Start (Without Migration)

If you want to use Docker for development with **fresh data**:

1. The Docker database is already seeded with admin user
2. You can import test data or add new data
3. Your original data remains safe in host PostgreSQL

## Troubleshooting

### Permission Error
```powershell
# Grant necessary permissions
docker exec -u postgres klip-postgres-dev psql -d klip_db -c "GRANT ALL ON DATABASE klip_db TO postgres;"
```

### Connection Error
```powershell
# Check if Docker database is running
docker ps | findstr postgres

# Check database health
docker exec klip-postgres-dev pg_isready -U postgres
```

