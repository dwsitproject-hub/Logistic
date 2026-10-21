# Inbound Shipping Instruction API — Test Guide

> **Version:** 1.3 (API v4.2) · **Audience:** JPS developers and operators who need to test the partner integration API locally.
> **Hand off to external developers:** Use [INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md](./INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md) (v4.2) — it includes the full API contract, **staging environment**, and self-service test walkthrough.

---

## 1. What you are testing

You simulate an **external system** (ERP, agency software, etc.) that:

1. **Syncs master data** — list terms/agents/surveyors/shippers (`GET`); upsert agents/shippers (`POST`/`PATCH`)
2. **Submits** a Shipping Instruction to JPS (`POST`) — including optional PO/SO, shipper, trade term on breakdown lines
3. **Updates** PO/SO while Pending (`PATCH`)
4. **Polls** for review status (`GET`)
5. **Observes** the lifecycle: `Pending` → `Approved` / `Rejected` → `Allocated`

The operator review (approve, reject, allocate a jetty) happens in the normal JPS web app — that is how you complete the end-to-end test.

```mermaid
flowchart LR
    tester[You POST via API] --> pending[Status Pending]
    pending --> operator[JPS operator in web app]
    operator -->|Approve| approved[Status Approved]
    operator -->|Reject| rejected[Status Rejected]
    approved -->|Allocate jetty| allocated[Status Allocated]
    approved --> poll[You GET via API]
    allocated --> poll
    rejected --> poll
```

---

## 2. Prerequisites

### 2.1 Backend running

**Docker (recommended):**

```powershell
cd Backend
docker compose up -d --build
```

| Service | URL |
|---------|-----|
| API | `http://localhost:3000` |
| Health check | `http://localhost:3000/api/v1/health` |
| Frontend (optional, for operator steps) | `http://localhost:5173` |

Open the health URL in a browser. You should see JSON like `{ "status": "ok", ... }`.

### 2.2 Database migration

The integration API needs migration `084`. Run once (or after pulling new migrations):

```powershell
docker exec jps-api npm run migrate
```

You should see `Applying migration: 084_integration_partner_api.sql` if it had not been applied yet.

### 2.3 API key

Each test partner needs an API key. Create one inside the API container:

```powershell
docker exec jps-api node scripts/create-integration-api-key.mjs --partner "MY_TEST_ERP"
```

**Copy the plaintext key immediately** — it is shown only once, for example:

```
jps_live_a73fc30df0307cf6e4a8b15be50e4373
```

Other useful commands:

```powershell
# List keys (prefix only, not the full secret)
docker exec jps-api node scripts/create-integration-api-key.mjs --list

# Revoke a key
docker exec jps-api node scripts/create-integration-api-key.mjs --deactivate 1
```

Keys are not port-scoped. Partners pass a valid `port_id` in each request payload; on a typical local dev database, port `1` is **BONTANG**.

### 2.4 Valid master data

Your test payload must use values that exist in JPS master data:

| Field | Rule |
|-------|------|
| `port_id` | Must be a valid JPS port (e.g. `1`); keys are not port-scoped |
| `cargo[].cargo_type` | Must match a commodity **short name** in JPS (case-insensitive), e.g. `CPO`, `CPKO`, `POME` |
| `cargo[].unit` | `MT` or `KL` only |
| `purpose` | `Loading` or `Unloading` |
| `trade_term` | Optional; must match a code from `GET /terms` (e.g. `FOB`, `CIF`) |
| `surveyor_name` | Optional; must match a name from `GET /surveyors` |
| `cargo[].shipper_name` | Optional; shipper must exist — create first via `POST /shippers` |
| `cargo[].po_no` / `so_no` | Optional; stored on breakdown lines; can also be set later via `PATCH` |
| `vessel_hub_code` | **Preferred** vessel identifier — sufficient alone; must exist in `master_vessels` |
| `vessel_name` | Required only when `vessel_hub_code` omitted; must match exactly one master vessel |

Pick a test `vessel_hub_code` from your local master data (DB column is `hub_code`):

```powershell
docker exec jps-api node -e "import('pg').then(async ({default:pg})=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL});const r=await p.query('SELECT hub_code,vessel_name FROM master_vessels WHERE deleted_at IS NULL AND hub_code IS NOT NULL ORDER BY id LIMIT 5');r.rows.forEach(x=>console.log(x.hub_code+' | '+x.vessel_name));await p.end();})"
```

#### Commodity mapping (`cargo_type` → JPS short name)

Send the **JPS short_name** value in `cargo_type`. Full display names are **not** accepted.

| JPS short_name (`cargo_type`) | JPS display name | Type |
|-------------------------------|------------------|------|
| `CG` | CRUDE GLYCERINE | Liquid |
| `CPKO` | CRUDE PALM KERNEL OIL | Liquid |
| `CPO` | CRUDE PALM OIL | Liquid |
| `FAME` | Fatty Acid Methyl Ester | Liquid |
| `INS POME FAD` | INS PALM OIL MILL EFFLUENT FATTY ACID DISTILLATE | Liquid |
| `INS RPOME` | INS REFINED PALM OIL MILL EFFLUENT | Liquid |
| `ISCC POMEPFAD` | ISCC PALM OIL MILL EFFLUENT FATTY ACID DISTILLATE (POMEPFAD) | Liquid |
| `ISCC RPOME` | ISCC REFINED PALM OIL MILL EFFLUENT | Liquid |
| `METHANOL` | METHANOL | Liquid |
| `PFAD` | Palm Fatty Acid Distillate | Liquid |
| `PKE` | Palm Kernel Expeller | Solid |
| `PKM` | Palm Kernel Meal | Solid |
| `PKS` | Palm Kernel Shell | Solid |
| `POME` | Palm Oil Mill Effluent | Liquid |
| `RBD PO` | RBD PO | Liquid |
| `RG` | REFINED GLYCERINE | Liquid |
| `ROL` | Refined Olein | Liquid |
| `RPOME` | REFINED PALM OIL MILL EFFLUENT | Liquid |
| `SPLIT CPKO FA` | SPLIT CRUDE PALM KERNEL OIL FATTY ACID | Liquid |
| `SPLIT RBD PKO FA` | SPLIT RBD PALM KERNEL OIL FATTY ACID | Liquid |

*20 commodities as of master data export. Re-query if commodities are added or changed.*

To refresh this list from your database:

```powershell
docker exec jps-api node -e "import('pg').then(async ({default:pg})=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL});const r=await p.query('SELECT short_name, name, commodity_type FROM si_commodities WHERE deleted_at IS NULL ORDER BY short_name');r.rows.forEach(x=>console.log(x.short_name+' | '+x.name+' | '+x.commodity_type));await p.end();})"
```

If you send an unknown `cargo_type`, the API returns `400` with a list of valid short names in `valid_cargo_types` — use that list to fix your payload.

---

## 3. Base URL and auth (local)

| Item | Local value |
|------|-------------|
| Base URL | `http://localhost:3000/api/v1/integrations` |
| Auth header | `x-api-key: jps_live_...` (your key) |
| Content-Type (POST) | `application/json` |

For staging/production, replace the host with your HTTPS domain (see the [partner API guide](./INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md)).

---

## 4. Test with curl (PowerShell)

curl is built into Windows 10/11. Use `curl.exe` in PowerShell so you do not hit the `Invoke-WebRequest` alias.

> **PowerShell tip:** Always save JSON bodies to a file under `$env:TEMP` and pass `--data "@$env:TEMP\file.json"`. Inline `-d '{"name":"..."}'` often breaks due to quoting.

### 4.1 Set variables

```powershell
$API_KEY = "jps_live_PASTE_YOUR_KEY_HERE"
$BASE    = "http://localhost:3000/api/v1/integrations"
$SI_ID   = $null   # fill after first POST
```

### 4.2 Automated full test run (recommended)

Runs 16 checks (master data, shipper upsert, SI submit with **vessel_hub_code**, PATCH, negatives) and writes a markdown report:

```powershell
$env:JPS_INTEGRATION_API_KEY = "jps_live_PASTE_YOUR_KEY_HERE"
powershell -ExecutionPolicy Bypass -File Backend\scripts\run-integration-self-test.ps1
```

Report output: `Backend/tmp-integration-self-test-report.md`

### 4.3 Manual step-by-step tests

Recommended order matches a real partner flow: master data → upsert shipper → submit → PATCH → poll → error paths.

#### 4.3.1 List master data (expect `200`)

```powershell
curl.exe "$BASE/terms" -H "x-api-key: $API_KEY"
curl.exe "$BASE/agents" -H "x-api-key: $API_KEY"
curl.exe "$BASE/surveyors" -H "x-api-key: $API_KEY"
curl.exe "$BASE/shippers" -H "x-api-key: $API_KEY"
```

#### 4.3.2 Upsert shipper (expect `201` or `200`)

```powershell
@'
{"name":"PT Integration Test Shipper","long_name":"PT Integration Test Shipper Long"}
'@ | Set-Content -Path "$env:TEMP\shipper.json" -Encoding UTF8

curl.exe -X POST "$BASE/shippers" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  --data "@$env:TEMP\shipper.json"
```

Run again with the same file — expect **200** (matched existing name).

#### 4.3.3 Submit a shipping instruction (expect `201`)

Use a **unique** `external_reference` each run:

```powershell
@'
{
  "external_reference": "SI-TEST-001",
  "port_id": 1,
  "vessel_hub_code": "PASTE_HUB_CODE_FROM_QUERY_ABOVE",
  "voyage_no": "VY-001",
  "purpose": "Loading",
  "eta": "2026-06-20T08:00:00Z",
  "etd": "2026-06-22T18:00:00Z",
  "agent_name": "PT Test Agency",
  "agent_contact": "ops@test.example.com",
  "trade_term": "FOB",
  "notes": "My first API test",
  "cargo": [
    {
      "cargo_type": "CPO",
      "description": "Main lot",
      "tonnage": 25000,
      "unit": "MT",
      "contract_no": "CTR-001",
      "po_no": "PO-TEST-001",
      "so_no": "SO-TEST-001",
      "shipper_name": "PT Integration Test Shipper"
    }
  ]
}
'@ | Set-Content -Path "$env:TEMP\si-test.json" -Encoding UTF8

curl.exe -X POST "$BASE/shipping-instructions" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  --data "@$env:TEMP\si-test.json"
```

**Success response (`201`):**

```json
{
  "success": true,
  "data": {
    "id": 41,
    "external_reference": "SI-TEST-001",
    "status": "Pending",
    "vessel_name": "MV TEST VESSEL",
    "port_id": 1,
    "received_at": "2026-06-12T08:49:12.525Z"
  }
}
```

**Save `data.id`** into `$SI_ID` for later steps.

> Reusing the same `external_reference` returns `409 DUPLICATE_REFERENCE`.

#### 4.3.4 PATCH PO/SO while Pending (expect `200`)

Replace `41` with your `$SI_ID`:

```powershell
@'
{"cargo":[{"line_order":0,"po_no":"PO-UPDATED-001","so_no":"SO-UPDATED-001"}]}
'@ | Set-Content -Path "$env:TEMP\si-patch.json" -Encoding UTF8

curl.exe -X PATCH "$BASE/shipping-instructions/41" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  --data "@$env:TEMP\si-patch.json"
```

After operator approval, the same PATCH returns **409** `INVALID_STATE`.

#### 4.3.5 Check status by id (expect `200`, status `Pending`)

```powershell
curl.exe "$BASE/shipping-instructions/41" -H "x-api-key: $API_KEY"
```

#### 4.3.6 Check status by external reference

```powershell
curl.exe "$BASE/shipping-instructions?external_reference=SI-TEST-001" -H "x-api-key: $API_KEY"
```

#### 4.3.7 Negative tests

| Test | Command | Expected |
|------|---------|----------|
| Duplicate submit | Re-run POST from §4.3.3 unchanged | `409 DUPLICATE_REFERENCE` |
| Bad API key | `curl.exe "$BASE/shipping-instructions/41" -H "x-api-key: jps_live_wrong"` | `401 INVALID_API_KEY` |
| Unknown port | Change `"port_id": 99` + new `external_reference` in JSON file | `400 VALIDATION_ERROR` |
| Unknown cargo | Change `"cargo_type": "FAKE_CARGO"` + new reference | `400` with `valid_cargo_types` |
| Unknown shipper | Use `"shipper_name": "Does Not Exist"` on POST | `400` — create via `POST /shippers` first |
| Unknown vessel_hub_code | Use `"vessel_hub_code": "INVALID-HUB"` on POST | `400` on `vessel_hub_code` field |
| PATCH after approve | PATCH same SI after operator approves in UI | `409 INVALID_STATE` |

---

## 5. Test with Postman (visual)

Postman is a free desktop app for building and saving HTTP requests without typing curl.

### 5.1 Install and setup

1. Download from [postman.com/downloads](https://www.postman.com/downloads/).
2. Create a **Collection** named `JPS Integration API`.
3. Open the collection → **Variables** tab:

| Variable | Initial value |
|----------|---------------|
| `baseUrl` | `http://localhost:3000/api/v1/integrations` |
| `apiKey` | your `jps_live_...` key |
| `siId` | leave empty; fill after first POST |

### 5.2 Request: Submit shipping instruction

| Setting | Value |
|---------|-------|
| Method | `POST` |
| URL | `{{baseUrl}}/shipping-instructions` |
| Headers | `x-api-key`: `{{apiKey}}`, `Content-Type`: `application/json` |
| Body | raw → JSON — paste the sample from section 4.2 |

Click **Send**. Status should be `201 Created`. Copy `data.id` into the collection variable `siId`.

### 5.3 Request: Get status by id

| Setting | Value |
|---------|-------|
| Method | `GET` |
| URL | `{{baseUrl}}/shipping-instructions/{{siId}}` |
| Headers | `x-api-key`: `{{apiKey}}` |

Click **Send**. Status should be `200 OK`, `"status": "Pending"`.

### 5.4 Request: Get status by external reference

| Setting | Value |
|---------|-------|
| Method | `GET` |
| URL | `{{baseUrl}}/shipping-instructions?external_reference=SI-TEST-001` |
| Headers | `x-api-key`: `{{apiKey}}` |

Also add:

| Method | URL | Body |
|--------|-----|------|
| `GET` | `{{baseUrl}}/terms` | — |
| `POST` | `{{baseUrl}}/shippers` | `{"name":"PT Test Shipper"}` |
| `PATCH` | `{{baseUrl}}/shipping-instructions/{{siId}}` | `{"cargo":[{"line_order":0,"po_no":"PO-1","so_no":"SO-1"}]}` |

---

## 6. Simulate the operator side (full lifecycle)

The API only submits and reads status. To see `Approved` or `Allocated`, an operator must act in JPS:

| Step | Where | Action |
|------|-------|--------|
| 1 | API (`POST`) | Submit instruction → status `Pending` |
| 2 | JPS web app | Log in → open **Shipment Plans** / approval queue |
| 3 | JPS web app | Find **MV TEST VESSEL** (or reference `SI-TEST-001`) |
| 4 | JPS web app | **Approve** or **Reject** the plan |
| 5 | API (`GET`) | Confirm status is `Approved` or `Rejected` |
| 6 | JPS web app | If approved → **Allocation** → assign jetty/berth |
| 7 | API (`GET`) | Confirm status is `Allocated` and `allocation.jetty_name` is set |

### Expected status after each stage

| Stage | GET `status` | Notable fields |
|-------|--------------|----------------|
| Just submitted | `Pending` | `allocation: null`, `rejection_reason: null` |
| Operator approved | `Approved` | `allocation: null` |
| Jetty assigned | `Allocated` | `allocation.jetty_name`, `allocation.planned_berthing_time` |
| Operator rejected | `Rejected` | `rejection_reason` populated |

Poll every few minutes in real integrations — operator review is a human process, not instant.

---

## 7. Reading responses

### Success envelope

```json
{ "success": true, "data": { ... } }
```

### Error envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Payload validation failed",
    "details": [ { "field": "eta", "issue": "required" } ]
  },
  "request_id": "req_abc123"
}
```

Always note `request_id` when reporting failures — it helps trace the request in server logs.

### HTTP status reference

| HTTP | Error code | Meaning |
|------|------------|---------|
| `201` | — | Instruction or master record created |
| `200` | — | Status retrieved, master upsert matched existing, or PATCH applied |
| `400` | `VALIDATION_ERROR` | Fix the JSON payload |
| `401` | `INVALID_API_KEY` | Missing or wrong `x-api-key` |
| `404` | `NOT_FOUND` | Unknown id or reference (or not yours) |
| `409` | `DUPLICATE_REFERENCE` | Same `external_reference` already submitted |
| `409` | `INVALID_STATE` | PATCH when status is not `Pending` |
| `429` | `RATE_LIMITED` | Over 120 requests/minute — wait and retry |
| `500` | `INTERNAL_ERROR` | Server error — retry with backoff |

---

## 8. First-session checklist

- [ ] Backend up — `http://localhost:3000/api/v1/health` returns OK
- [ ] Migration `084` applied — `docker exec jps-api npm run migrate`
- [ ] API key created and saved — `create-integration-api-key.mjs`
- [ ] Automated self-test passes — `run-integration-self-test.ps1` (or manual §4.3)
- [ ] `GET /terms`, `/shippers` → `200`
- [ ] `POST /shippers` → `201` then duplicate → `200`
- [ ] `POST` SI with PO/SO/shipper/trade_term → `201`, status `Pending`
- [ ] `PATCH` PO/SO while Pending → `200`
- [ ] `GET` by id and `external_reference` → `200`
- [ ] Duplicate `POST` → `409 DUPLICATE_REFERENCE`
- [ ] Bad key → `401 INVALID_API_KEY`
- [ ] Plan visible in JPS web app (Shipment Plans / approval)
- [ ] Approve in UI → `GET` shows `Approved`; PATCH → `409 INVALID_STATE`
- [ ] Allocate jetty in UI → `GET` shows `Allocated`

---

## 9. Common mistakes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 INVALID_API_KEY` | Missing/wrong header | Add `-H "x-api-key: jps_live_..."` |
| `400` unknown port | `port_id` is not a valid JPS port | Use a real `port_id` (e.g. `1` on staging) |
| `400` unknown cargo | Typo in `cargo_type` or full name instead of short code | Use commodity short name from §2.4 mapping table or `valid_cargo_types` in the error |
| `400` vessel_hub_code / vessel_name | Missing or unknown vessel identifier | Send valid **`vessel_hub_code`** from master data (preferred) |
| `409 DUPLICATE_REFERENCE` | Reused `external_reference` | Change to a new reference for each test |
| `409 INVALID_STATE` on PATCH | SI no longer Pending | Submit new instruction or PATCH only before approval |
| `400` unknown shipper | `shipper_name` not in master | `POST /shippers` first, then submit or PATCH |
| Inline JSON fails in PowerShell | Quoting/escaping | Use `@' ... '@ \| Set-Content` + `--data "@file.json"` |
| Status stuck on `Pending` | No operator action yet | Approve/reject in JPS web app |
| Status never `Allocated` | No jetty assigned | Complete allocation in JPS after approval |
| Connection refused | API not running | `docker compose up -d` in `Backend/` |

---

## 10. Troubleshooting

### API container not starting after code changes

Rebuild and restart:

```powershell
cd Backend
docker compose up -d --build
docker exec jps-api npm run migrate
```

### Check API logs

```powershell
docker logs jps-api --tail 50
```

### Verify integration tables exist

```powershell
docker exec jps-api node -e "import('pg').then(async ({default:pg})=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL});const r=await p.query(`SELECT to_regclass('integration_api_keys'), to_regclass('integration_submissions')`);console.log(r.rows[0]);await p.end();})"
```

Both columns should show table names, not `null`.

---

## 11. Related files

| File | Purpose |
|------|---------|
| [INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md](./INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md) | Full API contract for external partners (v4.0) |
| [Backend/scripts/run-integration-self-test.ps1](../../Backend/scripts/run-integration-self-test.ps1) | Automated local self-test + report |
| [Backend/scripts/create-integration-api-key.mjs](../../Backend/scripts/create-integration-api-key.mjs) | Create/list/revoke API keys |
| [Backend/src/routes/integrations.js](../../Backend/src/routes/integrations.js) | SI submit/GET/PATCH routes |
| [Backend/src/routes/integration-master.js](../../Backend/src/routes/integration-master.js) | Master data routes |
| [Backend/src/lib/integration-master-data.js](../../Backend/src/lib/integration-master-data.js) | Shared master-data helpers |
| [Backend/migrations/084_integration_partner_api.sql](../../Backend/migrations/084_integration_partner_api.sql) | Database schema |

---

## Document history

| Version | Date | Notes |
|---------|------|-------|
| 1.3 | 2026-09-23 | v4.2 API: renamed **`hub_code`** → **`vessel_hub_code`** |
| 1.2 | 2026-09-23 | v4.1 API: **vessel_hub_code** primary vessel identifier; self-test resolves master vessel from DB |
| 1.1 | 2026-09-21 | v4.0 API: master data + PATCH tests; automated `run-integration-self-test.ps1`; fixed duplicate §4 numbering; PowerShell file-based JSON guidance; `INVALID_STATE` and shipper prerequisites |
| 1.0 | 2026-06-12 | Initial test guide: curl, Postman, operator lifecycle, checklist |
