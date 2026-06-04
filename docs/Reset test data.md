# Reset test data (fresh QA database)

Use this when the team needs an **empty transactional database** while keeping **logins, roles, and master/config** tables.

## What gets removed

| Area | Tables (summary) |
|------|-------------------|
| SAP imports | `sap_data_imports`, `sap_raw_data`, `sap_processed_data`, `user_data_inputs` |
| Operations | `contracts` and **all** dependent rows (shipments, trucking, vessel/loading ports, payments, documents, quality surveys, etc.) |
| Misc | `audit_logs`, `ai_insights`, `alerts`, `dashboard_ai_insights`, `remarks`, `user_sto_contract_assignments` (if present) |

## What is kept

- **Auth**: `users`, `roles`, `permissions`, `role_permissions`
- **Master** (typical): `suppliers`, `products`, `vessel_master`, `master_vessels`, `master_loading_ports`
- **SAP config**: `sap_field_mappings`, `data_validation_rules`
- **Migrations**: `schema_migrations` (never truncated)

Optional: to also clear **Customer 360** (`companies`, `company_notes`), edit `scripts/reset-test-data.sql` and uncomment the optional block.

## Before you run

1. **Backup** the database if there is anything worth keeping.
2. Ensure **PostgreSQL is reachable** (local Docker or host).

## Run (Windows, Docker dev DB)

From the repo root:

```powershell
.\scripts\reset-test-data.ps1
```

Default: executes SQL inside container `klip-postgres-dev`, database `klip_db` (matches `docker-compose.dev.yml`).

## Run (Windows, psql on host)

```powershell
.\scripts\reset-test-data.ps1 -UseDocker:$false -DbHost localhost -Port 5433
```

(requires `psql` on PATH and matching credentials)

## Run (Linux / macOS)

```bash
chmod +x scripts/reset-test-data.sh
./scripts/reset-test-data.sh
```

Use host `psql` instead of Docker:

```bash
USE_DOCKER=0 PGHOST=localhost PGPORT=5433 ./scripts/reset-test-data.sh
```

## Uploaded files

Excel/PDF uploads under `backend/uploads/` are **not** deleted by the SQL script. Delete or archive that folder manually if you need a fully clean filesystem.

## Staging / production

Only run on environments where wiping data is **explicitly approved**. Use the same `scripts/reset-test-data.sql` with your staging `psql` connection.
