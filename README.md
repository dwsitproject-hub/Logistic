## KLIP (KPN Logistics Intelligence Platform)

Web-based logistics management system for SAP-integrated contract, shipment, trucking, finance, documents, and audit workflows.

## Tech stack (current)

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind
- **Backend**: Node.js + Express, TypeScript
- **Database**: PostgreSQL
- **Auth**: JWT + role-based access control (RBAC)

## Repository layout (current)

```
.
├── frontend/                      # Next.js app (runs on :3001)
├── backend/                       # Express API (runs on :5001)
│   └── src/database/migrations/   # SQL migrations applied by `npm run db:migrate`
├── docs/                          # Deployment, Docker, SAP import and ops docs
└── docker-compose*.yml            # Docker setups (local dev, staging, production)
```

## Quick start (local dev)

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Install

```bash
npm run install:all
```

### Environment variables

**Frontend** (`frontend/.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:5001/api
```

**Backend** (`backend/.env`):

```env
PORT=5001
NODE_ENV=development
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=1d

DB_HOST=localhost
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=your-db-password
```

### Create DB + run migrations + seed

```bash
cd backend
npm run db:migrate
npm run db:seed
```

### Run the app

```bash
npm run dev
```

### Default URLs (local)

- Frontend: `http://localhost:3001`
- Backend API: `http://localhost:5001/api`

## User Roles

- **Trading**: Track gain/loss and contract performance
- **Logistics Operations**: Monitor shipments and SLA
- **Finance**: Payment status and verification
- **Management**: Executive dashboard with AI insights
- **Admin Support**: Data validation and audit logs
- **IT/System Admin**: User management and integration monitoring

## Key Modules

1. **Dashboard**: Overview with KPIs and AI insights
2. **Contracts**: Contract management and tracking
3. **Shipments**: Shipment tracker with gain/loss monitoring
4. **Shipping Performance**: SEA/MIX shipment performance page with ETA/ETR/ETB/ETC delta analytics, late/on-time drilldown, and configurable table
5. **Finance**: Payment status and proof upload
6. **Documents**: Upload and manage supporting documents
7. **SAP Import**: Excel file upload and data processing
8. **Administration**: User management and audit logs

## SAP Upload Mechanism

### Overview

The SAP upload mechanism allows administrators to import daily SAP data from Excel files (MASTER v2 format) into the system. The system automatically processes, validates, and distributes data to the appropriate database tables.

### Upload Flow

```
1. File Upload → 2. Excel Parsing → 3. Field Mapping → 4. Data Validation → 5. Distribution → 6. Table Updates
```

#### Step-by-Step Process

1. **File Upload** (`POST /api/sap-master-v2/import-upload`)
   - Admin uploads Excel file (.xlsx or .xls)
   - File validation (max 50MB, Excel format only)
   - File temporarily stored in `backend/uploads/`
   - Requires ADMIN role authorization

2. **Import Initialization**
   - Creates import record in `sap_data_imports` table
   - Status set to 'processing'
   - Import ID generated for tracking

3. **Excel Parsing** (`SapMasterV2ImportService`)
   - Reads Excel file using XLSX library
   - Locates "MASTER v2" sheet
   - Extracts metadata from header rows:
     - Row 1: Field headers (display names)
     - Row 2-3: User role legends (TRADING, LOGISTICS, FINANCE, etc.)
     - Row 4-5: SAP source field mappings
   - Processes data rows starting from Row 2

4. **Field Metadata Parsing**
   - Normalizes field names (removes line breaks, extra spaces)
   - Maps Excel columns to database fields
   - Categorizes fields by type (Contract, Shipment, Quality, Trucking, Payment, Vessel)
   - Identifies SAP vs manual vs calculated fields

5. **Data Row Processing** (Per Row)
   - Stores raw data in `sap_raw_data` table (JSONB format)
   - Parses row into structured object:
     ```typescript
     {
       contract: {...},      // Contract fields
       shipment: {...},      // Shipment/STO fields
       quality: [...],       // Quality survey data (multiple locations)
       trucking: [...],      // Trucking operations (multiple sequences)
       payment: {...},       // Payment fields
       vessel: {...},        // Vessel details
       raw: {...}            // All original fields
     }
     ```
   - Checks for duplicate entries (Contract + PO + STO tri-key)
   - Updates existing records if duplicate found

6. **Data Storage**
   - Stores processed data in `sap_processed_data` table
   - Includes key identifiers: contract_number, po_number, sto_number
   - Full structured data stored as JSONB

7. **Data Distribution** (`SapDataDistributionService`)
   - Routes data to appropriate tables based on transport mode (SEA/LAND)
   - Creates/updates records in:
     - `contracts` table
     - `shipments` table (if SEA transport)
     - `trucking_operations` table (if LAND transport or additional trucking)
     - `quality_surveys` table (multiple locations for SEA shipments)
     - `payments` table
     - `vessel_loading_ports` table (for multi-port loading)

8. **Error Handling**
   - Each row processed in a SAVEPOINT transaction
   - Failed rows marked with error messages
   - Processing continues even if individual rows fail
   - Import status updated: 'completed' or 'completed_with_errors'

9. **Cleanup**
   - Temporary uploaded file deleted after processing
   - Import summary returned with statistics

### Table Mapping

#### SAP Integration Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `sap_data_imports` | Tracks import sessions | `id`, `import_date`, `status`, `total_records`, `processed_records`, `failed_records` |
| `sap_raw_data` | Stores raw imported data | `id`, `import_id`, `row_number`, `data` (JSONB), `status`, `error_message` |
| `sap_processed_data` | Normalized processed data | `id`, `import_id`, `contract_number`, `po_number`, `sto_number`, `data` (JSONB) |

#### Domain Table Mappings

##### Contracts Table
SAP data maps to `contracts` table:

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `contract_id` | Contract No. | Primary identifier |
| `po_number` | PO No. | Purchase order number |
| `supplier` | Supplier (Vendor) | From LFA1-NAME1 |
| `product` | Product (Material Desc) | From ZTCONF_COMM_MAT |
| `contract_date` | Contract Date | Same as PO Date |
| `quantity_ordered` | Contract Quantity | Can also be PO Qty |
| `unit_price` | Unit Price | From PRCD_ELEMENTS |
| `contract_value` | Calculated | quantity × unit_price |
| `incoterm` | Incoterm | At starting point |
| `transport_mode` | Sea / Land | SEA or LAND |
| `delivery_start_date` | Due Date Delivery (Start) | |
| `delivery_end_date` | Due Date Delivery (End) | |
| `source_type` | Source (3rd Party/Inhouse) | |
| `contract_type` | LTC / Spot | |
| `status` | Status | |
| `sto_number` | STO No. | Links to shipment |
| `sto_quantity` | STO Quantity | |
| `logistics_classification` | Logistics Area Classification | |
| `po_classification` | PO Classification | |

##### Shipments Table
SAP data maps to `shipments` table (SEA transport only):

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `shipment_id` | STO No. | Primary identifier |
| `contract_id` | Links to contract | Foreign key |
| `vessel_name` | Vessel Name | From ZVESSEL2 |
| `voyage_no` | Voyage No. | |
| `vessel_code` | Vessel Code | |
| `vessel_owner` | Vessel Owner/Company | |
| `port_of_loading` | Vessel Loading Port 1 | Primary loading port |
| `port_of_discharge` | Vessel Discharge Port | |
| `eta_arrival` | ETA Vessel Arrival at Loading Port 1 | |
| `ata_arrival` | ATA Vessel Arrival at Loading Port 1 | |
| `quantity_shipped` | Quantity at Loading Port 1 (BAST) | |
| `quantity_delivered` | Actual Quantity at Final Location | |
| `status` | Derived from milestones | |

**Vessel Loading Ports** (Multiple ports supported):
- `vessel_loading_ports` table stores additional loading ports (Port 2, Port 3)
- Includes ETA/ATA for arrival, berthed, loading start/complete, sailed
- Loading rates per port

##### Quality Surveys Table
SAP data maps to `quality_surveys` table (Multiple locations per shipment):

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `shipment_id` | Links to shipment | Foreign key |
| `location` | Location Name | Loading Port 1/2/3 or Discharge Port |
| `surveyor` | Vendor Name (Surveyor) | |
| `ffa` | FFA values | Free Fatty Acid |
| `moisture` | M&I values | Moisture & Impurity |
| `impurity` | M&I values | |
| `iv` | IV values | Iodine Value |
| `dobi` | DOBI | |
| `color_red` | Color-Red | |
| `d_and_s` | D&S | Dirt & Sediment |
| `stone` | Stone | |

**Multiple Locations**: Quality surveys can be created for:
- Loading Port 1
- Loading Port 2
- Loading Port 3
- Discharge Port

##### Trucking Operations Table
SAP data maps to `trucking_operations` table:

**LAND Transport** (Primary trucking operation):
- Created when transport_mode = "LAND"
- Data converted from shipment fields

**Additional Trucking** (Supporting operations):
- Created for multi-location trucking sequences

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `contract_id` | Links to contract | Foreign key |
| `shipment_id` | Links to shipment | Null for LAND transport |
| `sequence` | Sequence Number | 1, 2, 3 for multiple locations |
| `cargo_readiness_date` | Cargo Readiness at Starting Location | |
| `truck_loading_date` | Truck Loading at Starting Location | |
| `truck_unloading_date` | Truck Unloading at Starting Location | |
| `trucking_owner` | Trucking Owner at Starting Location | |
| `trucking_oa_budget` | Trucking OA Budget at Starting Location | |
| `trucking_oa_actual` | Trucking OA Actual at Starting Location | |
| `quantity_sent` | Quantity Sent via Trucking (Surat Jalan) | |
| `quantity_delivered` | Quantity Delivered via Trucking | |
| `gain_loss` | Selisih Qty Receive vs Qty Deliver | |
| `start_date` | Trucking Starting Date at Starting Location | |
| `completion_date` | Trucking Completion Date at Starting Location | |

##### Payments Table
SAP data maps to `payments` table:

| Database Column | SAP Field Source | Notes |
|----------------|------------------|-------|
| `contract_id` | Links to contract | Foreign key |
| `invoice_date` | DP Date | Down Payment Date |
| `payment_due_date` | Due Date Payment | |
| `payment_date` | Payoff Date | Actual payment date |
| `payment_status` | Derived | Based on dates |
| `deviation_days` | Payment Date Deviation (days) | Calculated |

### Transport Mode Routing

The system routes data based on the `Sea / Land` field:

- **SEA Transport** (`transport_mode = 'SEA'`):
  - Creates/updates `shipments` record
  - Creates `quality_surveys` for multiple locations
  - Creates `vessel_loading_ports` for multi-port loading
  - Optional trucking operations for port-to-port transport

- **LAND Transport** (`transport_mode = 'LAND'`):
  - Creates `trucking_operations` record (no shipment)
  - Converts shipment-like data to trucking format
  - Links directly to contract

### Duplicate Handling

The system prevents duplicate entries using a **tri-key combination**:
- `contract_number` + `po_number` + `sto_number`

If a record with the same tri-key exists:
- Existing `sap_processed_data` record is **updated** with latest data
- Domain tables (`contracts`, `shipments`, etc.) are **upserted** (UPDATE if exists, INSERT if not)
- Preserves data history in raw data table

### Region/Site and Discharge Destination aliases

**Region/Site is SAP's `Discharge Destination`**, not `master_plants.group_plant` - two different
dimensions that KLIP shows side by side. `backend/src/utils/dischargeDestinationAlias.ts` maps SAP
port names onto the site they serve:

| SAP Discharge Destination | Shown in KLIP as |
| --- | --- |
| `KIJING` | `TANJUNG PURA` |

Kijing is the port for the Tanjung Pura plants, and `master_plants` already grouped all eight of
them (EU4C, EU2C, EU53, EU23, EU73, EU4E, EU2E, MG21) under `group_plant = 'Tanjung Pura'`, so the
two dimensions disagreed about the same place.

This is a **normalisation, not a display rename.** SAP is expected to start emitting
`TANJUNG PURA` as its own discharge location; when it does, both values must collapse into one
Region/Site rather than appear as two filter entries with the volume split between them. The map
sends the target to itself so it stays idempotent, and adding another alias is one line.

**Where it is applied** - two kinds of place, and both are needed:

- at the single point the value is read out of SAP JSON (`sapDischargeDestinationFromJson`), which
  covers Region/Site on Contracts, Contract Performance, Shipments, Shipping Performance,
  Trucking, Oil Loss, Commercial Documents, and the filter dropdown;
- wherever a **stored** copy is read - `b2b_ending_child_snapshot.discharge_destination`,
  `trucking_operations.location` - so a row written before the map still displays correctly.

`filterRegionSiteOptionValues` normalises in both directions: the dropdown offers one entry per
site, and an incoming `plant=KIJING` from an old bookmark still resolves to the Tanjung Pura group.

**Stored copies were realigned by migration 158** (6,028 `contract_performance_snapshot.plant_site`,
70 b2b, 5,761 `trucking_operations.location`). Deliberately untouched:
`trucking_operations.unloading_location` - that is SAP's truck-unloading field, a different
dimension that happens to carry the same place names.

> Watch the cost when adding an alias. The map compiles to a `CASE` that references its input
> twice, and Region/Site is a `MAX()` over every contract, so computing it live went from 3 jsonb
> reads per row to 6 - the Contract Performance view table went 1,360ms to 3,342ms. The fix was to
> stop computing it live at all: the contracts list now reads `plant_site` from
> `contract_performance_snapshot`, which stores what the same expression produces (verified
> identical across all 18,751 contracts).

### Migration 161: the snapshot stores its derived columns

**The Shipments summary reads them too.** Its own `latest_spd_contract` still extracted five of the
six from jsonb; it now names the columns when the snapshot is fresh, and computes them from
`contractLatestSpdDerivedSql` when it is not - one definition on both sides. `source_type_raw` is
stored but deliberately not projected there: nothing on that page reads it, and adding a column to
a CTE other queries build on is a change with no caller.

**One user-visible change came out of it, and it is worth knowing about.** Comparing the four page
payloads before and after the whole chain, exactly one value moved: the completed card's vessel
list shows `BG.PRIMA SAMUDRA IV` where it used to show `PRIMA SAMUDRA IV` - same 76 vessels, one
spelled differently. The cause is the now-deterministic SAP row choice, and the data behind it is
the real story: `vessel_code = MBGPSIV` is **not in `master_vessels` at all**, and its shipment
rows store two spellings (`BG.PRIMA SAMUDRA IV` on the older rows, `Prima Samudra IV` on the
newer). With no master entry the "name always comes from Master Vessel" rule has nothing to map
to, so whichever row wins decides the spelling. That is a data-quality item, not a query one -
adding MBGPSIV to Master Vessel would settle it.

Reading the snapshot instead of scanning SAP only bought 14-21%, and the reason was the snapshot
itself: it stores the SAP row as jsonb, and the backlog CTE makes **26 `data->` accesses per row**
to produce six values. A prototype settled it before the migration was written - a flat table of
those six columns came out at **2,480 kB against 52 MB**, with identical results.

So migration 161 stores them on `contract_latest_spd_snapshot`: `effective_sto`, `b2b_flag_raw`,
`contract_reference_po_raw`, `contract_ext_no_raw`, `discharge_destination`, `source_type_raw`.
`data` is deliberately kept - around a hundred other `latest_spd` references pull arbitrary keys
from it.

| breakdown | stored columns | live jsonb | saved |
| --- | --- | --- | --- |
| unplanned | 1,099 ms / 215,697 buf | 3,041 ms / 378,605 buf | −43% |
| **preplanned** | **144 ms / 7,138 buf** | 3,425 ms / 771,553 buf | **−99.1% (108x)** |
| completed backlog | 1,129 ms / 214,810 buf | 1,947 ms / 378,651 buf | −43% |
| cancelled backlog | 2,000 ms / 184,978 buf | 3,114 ms / 348,823 buf | −47% |

**Parity:** each count query generated once, then run twice with only the source of those six
values swapped. All four identical. The refresh was checked separately: the derived columns were
nulled for three contracts, `refreshForContracts` was run, and the values came back identical.

**One definition, enforced.** A stored column and the expression behind it that drifted apart
would show wrong data with nothing failing, so the six expressions live in
`contractLatestSpdDerivedSql.ts` and both sides read them - the refresh that writes the columns,
and the live fallback that computes them when the snapshot is stale.
`contractLatestSpdDerivedSql.test.ts` asserts every column is written by both refresh paths, read
by the fresh-snapshot CTE, that the fresh CTE touches no jsonb at all, and that the live CTE keeps
its `spd.id DESC` tiebreaker.

Snapshot size went 52 MB to 55 MB for the extra columns - paid once per refresh, saved on every
read.

> The earlier note in this file predicted 99% for preplanned and then measured only 21%, and
> concluded the projection was the blocker. That was right: with the columns stored it is 99.1%.
> The intermediate step was not wrong, it was incomplete.

### Backlog breakdowns read latest-SPD from the snapshot

The four Section-1 backlog counts (unplanned, preplanned, completed, cancelled) each rebuilt
`latest_spd_contract` by scanning `sap_processed_data`, and each runs on every summary call with a
per-filter cache. The snapshot for exactly that already existed and was fresh. One builder feeds
**18 call sites** across six files - including Oil Loss and the pre-planned eligibility SQL - so
the source is now chosen in a single place.

Buffers, snapshot against live, with identical results:

| breakdown | snapshot | live | saved |
| --- | --- | --- | --- |
| unplanned | 326,717 | 378,605 | −51,888 (−14%) |
| preplanned | 606,470 | 771,553 | −165,083 (−21%) |
| completed backlog | 326,763 | 378,651 | −51,888 (−14%) |
| cancelled backlog | 296,935 | 348,823 | −51,888 (−15%) |

**Parity:** each count query was generated once and then run twice - the snapshot CTE text swapped
for the live CTE text, so only the source differs - and the returned rows compared. All four
identical. The live form gained the `spd.id DESC` tiebreaker it was missing, without which the two
disagree on `effective_sto` for 1,484 contracts (the same divergence found when the Shipments
summary was switched over).

> **The win is smaller than the plan suggested, and the reason matters.** Ranking plan nodes by
> their own `Buffers` line had put the SAP scan at 763,222 buffers inside the preplanned count -
> but that figure is cumulative, it includes the node's children. The scan's own cost is about
> 164,000, and reading the snapshot is not free either: it stores `data` as jsonb and this CTE
> pulls about eight keys out of it, so it pays the detoast-per-access cost measured earlier in
> this file (20 accesses: 16.9s against 1.2s when the extraction is hoisted). Flattening
> `contract_latest_spd_snapshot` into typed columns is what would make this read genuinely cheap -
> the same conclusion the jsonb analysis reached, now with a second reason to do it.

**Also measured, and not worth pursuing:** the OS Qty Plan column
(`outstanding_qty_planning`). Its source CTE reads `user_sto_contract_assignments` - 229 rows -
and costs **583 buffers / 2.9 ms**, producing 25 rows. Removing it would save about 3ms of a
14-21s query, so it is not a candidate for removal on cost grounds.

### Contract Qty: the last full scan of `contracts`

After `contractsOnStoSubquery` was rewritten, one full-table scan of `contracts` was left in the
Shipments summary query, and it was the biggest single node:

    Seq Scan on contracts c_2   loops=463   Buffers: shared hit=628667
    Filter: (... unnest(contract_numbers) ...) OR (... sto_key ...)
    Rows Removed by Filter: 18749

628,667 of that query's 1,719,396 buffers - **37%** - for the Contract Qty column
(`shipmentListRowContractQtySql`): `SUM(quantity_ordered)` over contracts matched by an OR that no
index can serve.

Rewritten the same way that worked before - gather candidate contract ids from each source by
index, then sum. One predicate had to change form to be indexable:
`TRIM(COALESCE(c.sto_number::text, '')) = <sto>` became
`NULLIF(TRIM(cb.sto_number::text), '') = <sto>`, which agrees for every value this receives
(`<sto>` is `NULLIF(TRIM(...), '')`, so NULL or non-empty, and the branch is guarded on non-NULL).

| | buffers |
| --- | --- |
| before this change | 1,719,396 |
| after | **1,245,515** (−28%) |
| across the whole day's work | 5,113,203 → 1,245,515 (**−76%**) |

`Seq Scan on contracts c_2` is gone from the plan; the only remaining scan of that table is
`c_link` at a single loop.

**Parity:** both expressions rendered against the same `(sto_key, contract_numbers)` pairs and
compared row by row - **673 pairs, 0 differences** (668 real pairs from the YTD list plus five
edge cases: null, empty, whitespace-only, an STO with no contracts, and a contract list with no
STO).

**Also measured, and rejected:** sacrificing the five STO-linked columns (Contract Numbers, PO
Numbers, Contract Count, Suppliers, Contract Ext No) by forcing them to their cheap join-derived
branch. The four page calls went 76,378ms to 78,772ms - **no saving at all**, because the earlier
`contractsOnStoSubquery` rewrite had already made those lookups index-driven. Dropping them would
have cost accuracy (B2B origin remapping, contracts linked through the STO group) for nothing.
Worth recording: on this page the expense has consistently been query *shape*, not the value of
any particular column.

### Stage A wired up: a status-filtered page comes from memory

| action (replayed from a real session) | before | after |
| --- | --- | --- |
| click `status=OPEN` | 12,383 ms | **12 ms** |
| add `product=CPO` | 11,417 ms | **5 ms** |
| add `plant=BONTANG` | 4,035 ms | 3,268 ms - a new scope, so SQL by design |
| whole sequence | 267,874 ms | 164,181 ms |

**A request never loads a scope.** That was the first design and it was a net loss: the scope is
the *unfiltered* view, which costs more than the filtered query it replaces, so the first status
click went from 12.4s to 60.8s and the replayed session from 268s to 311s - even though a second
filter change inside the same scope answered in 15ms. Now a request either finds the row set
loaded and answers from memory, or runs the SQL path it would have run anyway while the row set
loads in the background. That makes the change strictly an improvement, never a regression.

`startShipmentRowSetScopeWarmer` loads the two default-window scopes (shell and hydrate - they
differ, because `skipSapJoin` changes the row contents). It used to be **last** in the startup
queue on the grounds that nothing waits on it, and it took 207s on the dev box - more than any
single page costs. See the section below for why it is now fourth.

### Why the startup queue was not sequencing three of its jobs

`docker logs` after a restart on the dev host, 2026-09-09 - the whole warm-up took **371s**:

| job | duration | finished |
| --- | --- | --- |
| Shipments list shell | 41.7s | 11:23:42 |
| Shipments summary | 19.2s | 11:24:06 |
| Shipments outstanding qty | 4.8s | 11:24:16 |
| Shipments scoped toolbar | 33.8s | 11:24:55 |
| Shipping Performance | *fire-and-forget* | started 11:25:00 |
| Trucking summary | *fire-and-forget* | started 11:25:05 |
| Oil Loss | *fire-and-forget* | started 11:25:10 |
| Shipments scope row sets (shell) | 25s | 11:25:40 |
| Shipments scope row sets (hydrate) | 206s | 11:29:06 |

Two things are wrong with that, and neither is about what any warmer computes.

**The queue could only sequence a job that hands it a promise.** Shipping Performance, Trucking
and Oil Loss were declared `: void` - they kicked off `warmX()` and returned - so the queue fell
back to the 5s inter-job gap and all three were still running throughout the heaviest job in the
queue. The "one heavy query in flight" property was broken at exactly the point it mattered most.
All eight jobs now return a promise, asserted in `startupWarmupOrder.test.ts` so a future `void`
cannot slip back in silently. The cost of this is honest: Shipping Performance, Trucking and Oil
Loss now warm *later* in wall-clock than they did, because they no longer overlap anything.

**The scope warmer started 135s in.** It is now fourth, right after the summary and
outstanding-qty warmers, which starts it around 76s in and leaves it alone with the database. It
stays *behind* those two deliberately: they feed Section 1, the first thing a visitor sees,
whereas the scope row sets only decide whether a later status-card click is answered from memory
(single-digit ms) or from SQL (about 12s). What moved back is the scoped toolbar warm
(CPO / Bontang), a secondary convenience.

Both changes are scheduling only - no query, no cache key and no payload changes.

**Now measured - see the section below.** The hydrate scope costs 206s against 25s for the shell
on the same 668 rows, and the difference is 1,076 jsonb accesses against none.
Separately, `SCOPE_PAGE_SIZE` is 500 and the scope is 668 rows, so each scope is read in two full
queries where the second returns only 168 rows - and `OFFSET 500 LIMIT 500` still has to produce
all 668 sorted rows, so it costs about as much as the first. Raising the page size would need the
`Math.min(500, ...)` cap in the controller lifted for the internal loader, and `ROW_SET_LOAD_MARKER`
travels in the query string, so a browser could send it too - the marker would have to move
somewhere it cannot be injected first.

**Parity, verified end to end:** `ROW_SET_LOAD_MARKER` in the query forces the SQL path, so the
same request runs both ways and the payloads are compared. Six shapes - Open and Close, both sort
directions, page 1/2/3, a product filter, a non-default limit - all byte-identical, with the
derived path confirmed as the one that served (6 of 6 logged `route=compact-node-derived`), at
5-12ms against 476-1,152ms.

One field had to be dropped to reach that: the scope load goes through the hybrid ALL path, which
stamps `row_kind='shipment_execution'`, while the filtered SQL path never sets it. Every derived
row is an execution row anyway (the status filter drops the backlog ones), so the derived rows are
returned as copies without it - and the shared cached row set keeps it for the ALL path.

`shipmentListRowSetCache` registers with `listCacheRegistry`, so a shipment write, a trucking
write or a SAP import clears it immediately, like every other list cache.

### The row set now keeps itself warm, instead of waiting for a user

The first version had a 5-minute TTL, no refresh-ahead, and a startup warmer that ran once. The
build takes 206s. So the steady state was: warm for five minutes after boot, then `expiresAt`
passed, nothing rebuilt it, and the next status-card click paid 12s of SQL and only *then* started
a 206s background load - during which every further click paid 12s again. The cache was cold more
often than warm, and the rebuild was triggered by a user rather than by the system. Compare the
caches that already had refresh-ahead:

| cache | TTL | renews at | driven by |
| --- | --- | --- | --- |
| Shipping Performance | 5 min | 4 min | 60s timer |
| Oil Loss | 30 min | 25 min | 60s timer |
| Shipments row set (before) | 5 min | never | a user's click |
| Shipments row set (now) | 60 min | 50 min | 60s timer |

**Refreshing at the old 5-minute TTL would have been worse than the disease:** 206s of work every
240s is an 86% duty cycle on the heaviest query in the system. The TTL was the wrong dial.
Freshness here comes from *invalidation* - shipment write, trucking write, SAP import - not from a
clock, so the TTL only has to cover changes arriving outside those paths. At 60 minutes renewed at
50 the duty cycle is about 7%.

**A write clears, then rebuilds.** Clearing is not negotiable: serving the previous rows after an
edit would hide the user's own change. But clearing *alone* left the next status click on the 12s
path until somebody happened to trigger a reload, so the invalidator now schedules the rebuild
itself, debounced 5s so a bulk write does not start one rebuild per row. Requests during the
rebuild fall back to SQL exactly as before.

**Superseded scopes are cut, not queued.** Every scope in the warm list is reloaded by the cycle,
and one reload is the most expensive query on the page - so a user cycling through filter
combinations must not be able to pile them up. The list is capped at 8, dropping the least
recently read; scopes the startup warmer primed are pinned and never dropped, because a
status-card click depends on them. Three places enforce it: an unread scope stops being refreshed
after 3 hours, a load that finishes for a scope no longer in the list is discarded rather than
cached, and the cycle re-checks each scope before starting it instead of trusting the list it
opened with.

Honest limit: none of this *cancels* a query Postgres has already started - there is no
`pg_cancel_backend` plumbing on this path. What it prevents is superseded work accumulating in
the cache and new unwanted work being started.

Two bugs surfaced while writing the tests for this, both pre-existing in effect:

- **Refresh-ahead did not refresh.** The cycle went through `loadShipmentRowSet`, which returns
  early on a cache hit - and the entry it wanted to renew was of course still valid, that being
  the point of renewing early. It only ever reloaded once the entry had fully expired. Fixed with
  an explicit `force`, and locked by a test that advances the clock 51 minutes.
- **A load could store rows that predate a write.** A load in flight when an invalidation landed
  would happily write its pre-write rows into the cache the invalidation had just cleared. Stores
  are now guarded on an epoch counter. The request-path background load always had this race.

### Why the hydrate list call costs 8x the shell: 1,076 jsonb accesses

`skipSapJoin=false` splices in a different set of CTEs, and the difference is not subtle:

| | shell | hydrate |
| --- | --- | --- |
| SQL length | 1,851 chars | **165,336 chars** |
| CTEs | 8 | **21** |
| `sap_processed_data` references | 0 | **26** |
| jsonb accesses | **0** | **1,076** |

`sto_metrics` alone is 885 of those, over 52 distinct paths - a 17x repeat factor. The same
COALESCE families are re-evaluated dozens of times across the chain: `raw.'Quantity Delivery'` 48
times, `raw.'GR PO Status'` 36, the five spellings of trucking-delivered quantity 24 each.

**What one access costs.** On `sap_processed_data` (27,003 rows, 22 MB heap, 138 MB TOAST),
root-node buffers from `EXPLAIN (ANALYZE, BUFFERS)`:

| per row | root buffers | time |
| --- | --- | --- |
| `count(*)`, no jsonb | 463 | 36 ms |
| 1 jsonb value | 85,402 | 1,477 ms |
| 5 distinct jsonb values | 407,905 | 10,023 ms |
| 23 jsonb values | 1,864,385 | 14,922 ms |
| the same 23 as stored columns | **1,110** | **20 ms** |

Linear in the number of accesses - about 2s and 81,000 buffers per value per scan - because every
access re-detoasts the whole blob. A stored column costs what touching no jsonb costs: **1,680x
fewer buffers, 750x faster**.

**Migration 162** stores 28 of those paths as `GENERATED ALWAYS AS (...) STORED` columns.
Generated rather than plain-plus-backfill so the SAP importer needs no change and the columns
cannot drift from `data` - drift here would surface as a wrong quantity, not as an error. All 28
were verified equal to their expressions across all 27,003 rows after applying.

One column per *path*, not per value. Collapsing each COALESCE family into one column would change
results: the GR/delete logic is `openNorm(A) OR openNorm(B)`, not `openNorm(COALESCE(A, B))`, so
with A='CLOSE' and B='OPEN' the OR is true where the collapsed form is false. Each path keeps its
own column and the expression trees above them are untouched - an access-path change only.

Two incidental findings from applying it: the ALTER took **3m45s** (one rewrite for all 23 columns,
ACCESS EXCLUSIVE - it will stall SAP queries on SIT for that long), and the rewrite reclaimed
bloat, taking the table from **160 MB to 95 MB**. Also, `contract_gr_po_status` and
`root_gr_po_status` are non-null on **zero** rows - two of the three GR PO arms never carry
anything in this dataset. They are kept, because the semantics are not ours to narrow.

**First group swapped: GR status and delete flags.** `sapDerivedColumnSql.ts` holds the mapping,
and every helper now takes a *source* rather than an alias or an expression - `row` for a real
`sap_processed_data` alias, `data` for anything that only carries the blob. That distinction is
load-bearing: `shipmentListSapAggSql.ts` passes alias `sk`, which is the `spd_keyed` CTE and
carries `data` but none of the columns, so a blind alias swap there would have produced SQL
referencing columns that do not exist.

**Second group swapped: the quantity families** - delivery, trucking-delivered,
vessel-delivered and received quantity, through `sqlSapQtyTruckingFromSpd`,
`sqlSapQtyVesselFromSpd`, `sqlSapQtyDeliveredAnyFromSpd` and the two STO-scoped receive
expressions.

**Third step: `spd_keyed` carries columns, not just the blob.** That CTE selects from
`sap_processed_data`, so it can pass the stored columns down - and once it does, `sk` is a row
source for those fields and `sap_agg` reads `sk.raw_quantity_delivery_vessel` instead of
extracting from `sk.data`. `data` stays on the CTE for everything with no column yet: vessel
fields, PO spellings, incoterm, source type, B2B flag, contract ext no, STO quantity.

| | before 162 | after status group | after quantity group | after spd_keyed passthrough |
| --- | --- | --- | --- | --- |
| hydrate chain | 1,076 accesses | 704 | 338 | **254** |
| `sto_metrics` | 885 | 513 | **147** | 147 |

**The whole 21-CTE chain was planned against the live schema**, both the hydrate and the
`skipSapJoin` stub form, with a synthetic `shipment_page` and `qty_move` standing in for the
upstream CTEs. Both plan clean, so every column reference resolves - including the new `sk.<column>`
reads and the passthrough itself. Worth doing because none of this SQL had ever been executed, and
a column name that does not exist is a runtime error rather than a compile one.

**Measured on the real expression, not extrapolated.** The same `SUM(delivered_kg)` over
`sap_processed_data` joined to `contracts`, rendered both ways and run:

| | root buffers | time |
| --- | --- | --- |
| jsonb arms | 388,721 | 4,244 ms |
| stored columns | **2,376** | **108 ms** |

164x fewer buffers, 39x faster - for *one* instance of one expression, which the chain renders
many times over.

The swapped SQL was also EXPLAINed against the live schema, because none of it had ever been
executed and a wrong column name is a runtime error, not a compile one: six probes covering
`delivered_kg`, both STO-scoped quantities, receive-by-STO-key, import status and the SAP-cancelled
predicate all plan clean.

Three guards, because the failure mode here is a plausible wrong number rather than an error:

- `sapDerivedColumnSql.test.ts` asserts each column is generated from the path the mapping claims,
  reading migration 162 itself - and that rewriting every column reference in a row-form
  expression back to its path reproduces the data form **exactly**, which is what makes the swap
  provably an access-path change rather than a rewrite.
- `shipmentListSapAggAccessBudget.test.ts` locks 338 and 147, so a new `data->` in this chain has
  to be a deliberate decision.
- The same file asserts `sk` is read only for the columns `spd_keyed` actually carries, and that
  `spd_keyed` selects every column it promises - in both UNION branches and in the stub, since a
  stub missing a column is the shape of bug that once emptied the whole Trucking page. TypeScript
  cannot catch either: the row helpers take a string alias. And it was a real mistake, not a
  hypothetical - the quantity helpers were being called with `'sk'` while the CTE still carried
  only `data`.

Left on `data` in `sto_metrics`, and why: the five `STO No.` arms (100 accesses) sit behind
`sto_number`, a real column that comes first in the COALESCE, so they short-circuit and cost
nothing at runtime - the static count overstates them. The four `sto_quantity` arms (20) have no
columns in 162 yet. The rest is a long tail of ones and twos: operation id, contract type,
contract reference PO, B2B flag.

### Rejected: getting `data` out of the spd_keyed tuplestore by joining back

`spd_keyed` is materialised, and `sap_keyed_qty_latest` re-selects it with `sk.*`, so the jsonb
blob is written into *two* tuplestores and read back by the CTEs above them. A microbenchmark
suggested that was expensive - 700 page rows, same rows either way:

| | buffers | temp files | time |
| --- | --- | --- | --- |
| CTE carries `data` | 1,175 | read 261 / written 262 | 1,342 ms |
| CTE leaves it behind | 1,170 | none | 470 ms |

So `data` was dropped from `spd_keyed` and the six CTEs that still need arbitrary keys joined back
to `sap_processed_data` on `spd_id` - identical by construction, one index lookup, no arm lists to
get wrong. The alternative was storing the remaining 53 paths as columns, where three *different*
PO families with three different arm orders is exactly how a silently wrong number gets shipped.

**It was 50% slower and was reverted.** Rendering the chain from the pre-change `dist` build and
the post-change source, running both over the same 400-row page:

| | root buffers | temp files | time |
| --- | --- | --- | --- |
| blob carried in the CTE | 228,770 | read 446 / written 584 | 24,900 ms |
| joined back by `spd_id` | **1,070,263** | read 354 / written 370 | **37,463 ms** |

The temp spill did shrink, and buffers went up 4.7x anyway: carrying the blob once in a tuplestore
is cheaper than re-fetching and re-detoasting it through six primary-key joins.

The microbenchmark was the mistake, and specifically this: its "without `data`" arm never needed
the blob at all, so it was not a fair stand-in for "join back to fetch the blob". It measured the
saving and none of the cost.

Both forms were also proved output-identical first - 1,668 rows across `sap_agg`, `sap_latest`,
`contract_ext_agg`, `po_numbers_agg` and both port aggregates, zero differing lines - which is how
the reverted version could be trusted enough to measure at all. After reverting, the same
comparison is byte-identical again at 218,932 buffers, 4.3% below the pre-162 build.

So `spd_keyed` still carries `data`, deliberately, and the 92 accesses that read it stay. The
column route remains open, but it needs the three PO families resolved one at a time, not in
bulk.

### Stage A: deriving a Shipments page in Node, and what it refuses to do

The list caches per (filters x status x sort x page), so every toolbar change is an uncached
query. Replaying a real session from the access log, in order, in one process:

| action | cold |
| --- | --- |
| click `status=OPEN` | 12,383 ms |
| add `product=CPO` | 11,417 ms |
| add `plant=BONTANG` | 4,035 ms |
| the hydrate behind them | 63,695 ms |
| repeat an identical combination | **80 ms** |

That last row is the point: the cache works perfectly, but only for a combination you have already
visited. `shipmentListNodePaging.ts` derives the page from one loaded row set instead - the set is
668 rows for the default YTD scope.

**What it refuses, and why - each one measured, not assumed:**

| refused | reason |
| --- | --- |
| the unfiltered (ALL) list | ordered by the hybrid global merge sort across execution + backlog rows, not the plain ORDER BY. Totals matched at 109 rows but the order diverged from index 5. |
| `plant` | not a row column: it filters the *contract scope*, so another plant is a different row set. |
| text sorts | Postgres orders text by database collation; JS string comparison does not reproduce it. |
| quantity sorts | `SHIPMENT_LIST_ENRICHED_SORT_KEYS` orders them by a resolved enriched expression, not the column a row carries. Ordering them here diverged from the SQL on three combinations even though the totals matched. |
| `date` column filters | the SQL compares `(expr)::date` in the database timezone while a row carries a UTC timestamp - `2027-12-30T17:00:00.000Z` is the 31st in Jakarta, so truncating would shift boundaries by a day. |
| `late_indicator` filter | filters a computed expression, not a stored column. |
| UNPLANNED / PREPLANNED | resolved by their own SQL path (`AND FALSE` in the execution query). |

Two behaviours it had to learn from the SQL rather than from the shape of the data:

- **a status filter also drops contract-backlog rows.** The filtered SQL is execution-only;
  backlog rows come from a separate resolver, so filtering on status alone over-counted -
  `status=CLOSE` gave 6 rows here against 5 from SQL.
- **`NULLS LAST` holds in both directions**, so it is decided before the sort direction, and the
  tie-break is `created_at DESC, id ASC` - `created_at` is a bulk-import timestamp shared by
  thousands of rows, so `id` decides far more often than it looks.

`canDeriveShipmentPageInNode` checks the request *and* that a sample row carries every field the
work needs, so a projection change cannot silently break the fast path - it falls back instead.

**Verified against the SQL path**: 24 (status x sort key x direction x page) combinations, 0
differences, with `row_kind` normalised away (the hybrid resolver stamps `shipment_execution`, the
filtered path leaves it unset, and every consumer only tests for `contract_backlog`). 27 unit
tests cover the filter, sort and gate semantics.

> Not yet wired into `getShipments` - this is the derivation layer with its parity established.
> The remaining work is the row-set cache and the scope key that excludes status, sort, page and
> the Node-handled column filters.

### Vessel name is always mapped from Master Vessel, never SAP free text

**Root cause of the two-way render, found afterwards:** `normalizeShipmentListRows` - which calls
`mergeShipmentVesselFromSapRow` - runs more than once over the same rows on the hybrid list path
(once per source array at `shipmentUnplannedHybridList.service.ts:448`, then again over the merged
array at 601/625). The merge read `row.vessel_name` unconditionally, so the second pass captured
the canonical display name it had just written and the stored value was lost. The status-filtered
list normalises once and kept the stored value; the unfiltered list normalised twice and ended up
with the Master form in `vessel_name_klip`.

The merge now keeps the first-seen KLIP name
(`trimOrNull(row.vessel_name_klip) ?? trimOrNull(row.vessel_name)`), which makes it idempotent -
canonicalising the same raw value twice yields the same display name. This also fixes the edit
modal's KLIP-vs-SAP badge, which compares that field: opened from the unfiltered list it had been
comparing Master against SAP instead of the stored KLIP value.

`row_kind` is deliberately left as-is. It is only ever tested for `'contract_backlog'` - in
`normalizeShipmentListRows`, in `shipments/page.tsx` and in `listSapStoPriority` - so its absence
on the filtered path already means "execution row". Stamping it would be a behaviour change for a
field nothing distinguishes; a row-set cache can normalise it at comparison time instead.

**The rule:** a vessel *code* may come from SAP, or from the code an operator picks when editing a
shipment. A vessel *name* is never free text - it is always mapped from KLIP's Master Vessel by
whichever code is in effect.

The backend already implemented this. `resolveShipmentDisplayVesselName` runs every candidate
through `canonicalVesselName`, which strips SAP's tug prefix and normalises, so the API's
`vessel_name` carries the master form even for an Open contract - verified directly:

    resolve('BG.TIGA JAYA 58', null, 'TEBAR/BG.TIGA JAYA 58', { contractSapClosed: false })
      -> 'BG.TIGA JAYA 58'

The frontend did not. `shipmentListHydrateVesselName` preferred `vessel_name_klip` while the
contract was Open, and the frontend's `trimVesselName` only trims - so it rendered the value **as
stored**, bypassing that canonicalisation.

**Why that is wrong: `shipments.vessel_name` has two writers.** The SAP import writes it as well
as KLIP, so `vessel_name_klip` is not evidence of an operator choice. Measured on the dev DB:

| | rows |
| --- | --- |
| stored name differs from the master name for its code | 551 |
| — of those, names that exist in Master Vessel at all | 6 |
| — names that do **not** exist in Master Vessel | **545** |
| not completed/cancelled, so displayed under the Open rule | 80 (64 differing) |

Those 545 came from SAP's `Vessel Name` field - confirmed against `sap_processed_data`:
`TEBAR/BG.TIGA JAYA 58` for code `MTEBAR58` (master: `BG.TIGA JAYA 58`), `Prima Samudra IX` for
`MPRIMA91` (master: `PRIMA SAMUDRA IX`). The edit modal cannot produce them: it uses
`MasterVesselCombobox`, a picker, so the input side already enforced the rule.

It also made one row render two ways: the status-filtered list carried the raw text in
`vessel_name_klip` while the unfiltered list carried the master form, so the same shipment showed
a different vessel depending on which view you were in.

**Fix:** `shipmentListHydrateVesselName` now returns the API's resolved `vessel_name`, falling
back to the base name. `vessel_name_klip` keeps its real job - the KLIP-vs-SAP comparison badge in
the edit modal - it is simply not a display name. `master_vessel_id` is not a usable substitute
marker either: it is set on 295 of the diverging rows, because the SAP import sets it too.

> Side effect worth noting: with the display no longer depending on `vessel_name_klip`, the
> filtered and unfiltered resolvers produce identical rows for this field - which removes one of
> the two blockers to serving every filter from a single cached row set (the other is `row_kind`).

### Shipments: why a first visitor waited, and what it costs now

Three separate reasons the startup warmers were not protecting the first visitor. All three were
key mismatches, none of them visible without comparing the warmed key against the key the browser
actually reads:

1. **`skipSapJoin` was never warmed as `false`.** Every warmer inherits `skipSapJoin: 'true'` from
   `buildSyntheticRequest`, and `skipSapJoin` is part of the list cache key - so the page's second
   call (the hydrate, 15.9s cold) was never warm for anyone.
2. **The summary warmer used `limit: '20'`, the page sends `limit=1`.** The Unplanned breakdown
   caches under `${shipmentCtx.cacheKey}:breakdown:...` - a *list* key, which includes limit. The
   summary row (filter-keyed) was warmed, the breakdown was not.
3. **`SUMMARY_CACHE` was read after the daily-rollup branch, so on the daily path it was written
   on every request and read on none.** Every call re-ran the two daily queries plus the live
   stage-count overlay. This one made the other two look unfixable: no amount of warming helped.

Measured by running the warmers and then replaying exactly what a browser sends on a default load:

| call | before | after |
| --- | --- | --- |
| shell (`skipSapJoin=true`) | 21,588 ms | **12 ms** |
| hydrate (`skipSapJoin=false`) | 26,853 ms | **4 ms** |
| `summaryOnly` | 73,196 ms | **3 ms** |
| `outstandingQtyOnly` | 13,062 ms | **3 ms** |
| **first visitor total** | ~59,674 ms | **22 ms** |

The warmers themselves take 65-85s at startup - that cost is paid by the server, once, not by a
user. Cold payloads stayed byte-identical across all four calls.

> **The one trade-off to know:** on the daily path the live stage-count overlay used to be
> recomputed on every request, so stage counts were always current even for changes that bypass
> the app's invalidation. They are now at most `CACHE_TTL_MS` old on that path, exactly as on the
> live path. Writes through the app are unaffected - see below.

### What an edit invalidates (new/edit shipment modal)
**Coverage audit of every invalidator** (why event-driven refresh is enough, and where it was
not): `invalidateContractsListCache`, `invalidateHybridShipmentsListCache`,
`invalidateHybridBreakdownCache` and `invalidateTruckingHybridBreakdownCache` all register with
`listCacheRegistry`, so a shipment write, a trucking write or a SAP import clears them - SAP
import calls both `invalidateShipmentsListCache()` and `invalidateTruckingListCache()`, and both
call through the registry, plus it refreshes all five snapshots (qty_move, sto_agg, latest_spd,
b2b_ending_child, contract_performance).

`invalidateLatePerformanceCache` was the exception: its only caller was `sapPresence.service`.
Contract Performance reads shipments and trucking, so a new/edit shipment or a trucking edit left
that page serving pre-edit rows until its 5-minute TTL lapsed. It is now registered too.
`shipmentListCacheInvalidation.test.ts` asserts each cross-module cache is registered, so a cache
added later cannot silently rely on TTL.


`invalidateShipmentsListCache()` runs **immediately** on the write, before the response, and it is
not just a cache clear:

- clears `PAGE_CACHE`, `COUNT_CACHE`, `SUMMARY_CACHE`, `OUTSTANDING_QTY_CACHE`,
  `STATUS_CARD_QTY_CACHE`, `ETC_NO_ATC_DUE_CACHE`;
- calls `invalidateRegisteredListCaches()`, which clears the hybrid breakdown caches that live in
  another module (they register a callback to avoid an import cycle);
- marks the pipeline daily rollup stale (`markPipelineDailySummaryStale(['shipment'])`), which
  schedules a debounced background rebuild;
- invalidates the Oil Loss cache, which reads shipment quantities;
- **re-warms** the recently used pages and summaries in the background
  (`PAGE_KEEP_WARM.rewarmRecentlyUsed()`), so the next viewer after an edit is served from memory
  rather than paying the cold cost.

`createShipment` and `updateShipment` additionally run a targeted
`ContractQtyMoveSnapshotService.refreshForShipmentIds(...)`.

So nothing waits for a TTL after an edit. TTL is only the upper bound on staleness when nothing
writes.

**Two write paths were missing from this, and are now fixed:**
`updateShipmentDailyDeliverables` and `bulkUploadShipmentDailyDeliverables` both run
`UPDATE shipments` but never invalidated, so an edit to daily deliverables left the list and
Section 1 serving pre-edit rows for up to `CACHE_TTL_MS`. `shipmentListCacheInvalidation.test.ts`
now audits the controller's source and fails if any handler writes `shipments` without clearing
the caches - including handlers added in future.

### `contractsOnStoSubquery`: gather candidates by index, don't scan contracts

This subquery decides which contracts belong to a grouped Shipments row, and it is embedded
**five times** in the list query (contract numbers, PO numbers, contract count, suppliers, and
contract ext no). It scanned `contracts` and tested a four-way `OR` of `EXISTS` per row, which no
index can serve: `Seq Scan on contracts cc_2 ... Rows Removed by Filter: 18749, loops=463,
Buffers: shared hit=630471`.

It now collects candidate contract ids *from* the four sources - each by index - and looks them up
by id. `A OR B OR C OR D` over `contracts` selects exactly the contracts whose id lies in the union
of the ids satisfying each branch, so the shapes are set-equivalent by construction. The
`operation_id` / `shipment_id` OR is split into two UNION branches so each uses its own index.

One predicate was rewritten to be indexable: `TRIM(COALESCE(cc.sto_number::text, '')) = KEY`
became `NULLIF(TRIM(c_sto.sto_number::text), '') = KEY`, matching
`idx_contracts_sto_number_trim`. Those agree for every KEY this function is given - callers always
pass `NULLIF(TRIM(...), '')`, so KEY is NULL or non-empty; NULL selects nothing either way, and for
a non-empty KEY both forms require a non-null, non-blank `sto_number` trimming to KEY.

**Parity: every STO key, not a sample.** The old and new shapes were run side by side over all
**10,388** distinct STO keys in the database (every key from `contract_stos`, `contracts`,
`shipments.operation_id`, `shipments.shipment_id` and SAP effective STO) and compared as sorted
sets - **0 mismatches**. Payloads for all four page calls are identical.

| Shipments page call | before today | after |
| --- | --- | --- |
| shell (`skipSapJoin=true`) | 21,588 ms | 10,939 ms |
| full (`skipSapJoin=false`) | 26,853 ms | 15,900 ms |
| `summaryOnly` | 73,196 ms | 25,521 ms |
| `outstandingQtyOnly` | 13,062 ms | 7,314 ms |
| **total** | **134,699 ms** | **59,674 ms** (2.26x) |

Summary query root buffers across the whole day's work: **5,113,203 -> 1,719,396 (-66%)**, and
`Seq Scan on contracts` is gone from the plan entirely.

### Shipments `shipment_page`: where the cost really is

`EXPLAIN (ANALYZE, BUFFERS)` on the Shipments summary query, root buffer count, one change at a
time (buffers, not wall-clock - see the note below):

| state | root buffers |
| --- | --- |
| before any of today's work | 5,113,203 |
| + migration 159 (`contracts (TRIM(po_number), created_at DESC)`) | 4,176,563 |
| + `vlp_*` CTEs as indexed LATERALs | 4,159,674 |
| + migration 160 (`contract_stos (TRIM(sto_number))`) | **3,618,351** (−29%) |

**The vlp LATERAL change removed 2.3M pointless row comparisons but almost no buffers.** The two
`DISTINCT ON` CTEs were joined with `LEFT JOIN ... ON vlp_l.shipment_id = s.id`; a CTE scan cannot
be indexed and the planner underestimated the outer side (rows=17 against 864), so it compared
every outer row against every VLP row - `Rows Removed by Join Filter: 1,151,237` and `1,150,232`.
As LATERALs each lookup is one index descent against `idx_vlp_shipment_first_load` /
`idx_vlp_shipment_discharge`, and the body of `shipment_page` went 4,366,945 → 3,413,461 buffers
(−22%). Both forms were proved to select the identical row for all 2,636 shipments, load and
discharge.

**It exposed a pre-existing non-determinism.** `sqlShipmentListPrimaryOrderBy` ended at
`s.created_at DESC` with no unique tiebreaker, so rows tying on every key were resolved by
whatever order the plan delivered and `array_agg(...)[1]` returned an arbitrary one. Changing the
plan changed two vessel names in the summary's completed list. The three `TK BINTANG PALMA 33`
rows involved share an identical `created_at` to the microsecond - a real tie, not a wrong value.
`s.id` is now the last ORDER BY key, so the choice is stable across plans. Nothing is lost: the
names come from `master_vessels` and a different representative row simply wins.

**What is left, and what will not fix it.** The remaining hot node is
`Seq Scan on contracts cc_2 ... Rows Removed by Filter: 18749, loops=463, Buffers: 630,471` inside
`contractsOnStoSubquery` (`stoLinkedContractSql.ts`), which is embedded four times as a
correlated subquery. Its `WHERE` is a four-way `OR` of `EXISTS` branches, so it has to be
evaluated per contract row - no index removes it. Removing it means rewriting the subquery to
gather candidate contract ids from the four sources by index and then look them up, which is
behaviour-sensitive and deliberately not bundled with the access-path changes above.

> **Not a memory problem - checked.** The plan reports `shared hit=3,618,351 read=1,744`, so
> 99.95% of those accesses already come from `shared_buffers`, and the largest sort is 25kB
> against a 4MB `work_mem`. Raising `shared_buffers` (128MB) or `work_mem` would not help; the
> cost is the *number* of buffer accesses, which only a query-shape change reduces. The dev
> container has no memory limit set (`HostConfig.Memory = 0`).
>
> Local wall-clock on this box is unusable for anything under a few minutes - the untouched shell
> call alone measured 21.6s and 40.3s in two runs of the same code. Buffer counts are the metric.

### Shipments: latest_spd from the snapshot, and a deterministic row choice

The Shipments page issues four calls (shell, full, `summaryOnly`, `outstandingQtyOnly`). Measured
cold on the dev DB, `summaryOnly` alone was 73.2s of the 134.7s total, and its query built
`latest_spd_contract` by scanning `sap_processed_data` - 73 references to that table in one
statement - while `contract_latest_spd_snapshot` sat fresh and unused.

It now reads the snapshot when fresh. Two things had to be settled first, both verified against
all 18,711 contracts:

- the snapshot has no `sto_number` column, but that first COALESCE arm adds nothing over the JSON
  arms - column and JSON-only forms agreed on **every** contract, so `NULL::text` is safe there;
- **the live query had no tiebreaker.** The snapshot is built `DISTINCT ON (contract_number)
  ORDER BY created_at DESC NULLS LAST, spd.id DESC`; this query ordered only by `created_at DESC`,
  so ties were broken arbitrarily. The two disagreed on `effective_sto` for **1,484 contracts**
  (and discharge destination for 1). Adding the same `spd.id DESC` tiebreaker to the live form
  brought all five projected columns to **zero** differences.

So the swap is not just faster, it makes the row choice deterministic. Payload parity across all
four calls: byte-identical, same SHA-256.

**Be honest about the size of this win: it is small.** Per-CTE timings put `latest_spd_contract`
at 739ms of a 95s query - the four calls went 134.7s to 128.2s (~5%). The prediction that this was
the bottleneck was wrong; the measurement corrected it.

**Where the time actually goes** (`EXPLAIN (ANALYZE, BUFFERS)` on the summary query):

| CTE | actual time |
| --- | --- |
| `shipment_page` | 47.0s → 83.6s |
| `enriched` (scans `shipment_page`) | 47.1s → 94.7s |
| `latest_spd_contract` | 0.74s |
| everything else | < 0.2s |

Inside `shipment_page`, two nested-loop joins against the `vlp_load_first` / `vlp_disc_first` CTEs
report `Rows Removed by Join Filter: 1,151,237` and `1,150,232` - the planner cannot index a CTE
scan, so 864 rows are compared against every vlp row twice over. That is the next target, not the
jsonb reads.

> Wall-clock on the 1 GiB dev container swings about 2x run to run, so buffer counts are the
> metric used for anything below a few seconds. SIT has 4 GB and production 8 GB.

### Trucking: scope the STO-line CTE to the page, not the whole database

`contract_sto_lines` (`backend/src/utils/truckingListStoExpandSql.ts`) resolves which STO lines
belong to each contract from two sources UNIONed together - `contract_stos`, and SAP rows whose
effective STO is not yet registered. Both branches were **unscoped**: they enumerated every
contract in the database, and only the outer `INNER JOIN ... ON sto.contract_id = c.id` narrowed
the result down to the contracts the page had actually asked for.

The cost showed up in the plan as a `Seq Scan on contracts c2` feeding a nested loop into
`sap_processed_data`: for a request filtered to **one** contract, the planner still walked 15,737
contracts and probed SAP once per contract - 15,737 of the query's 15,794 loops on
`sap_processed_data` (99.6%) came from that single node.

The fix adds one predicate to each branch, restricting them to
`(SELECT contract_id FROM trucking_source)`. It is **output-preserving by construction**: the outer
join already discards every row whose `contract_id` is not a `trucking_source` contract, so the
predicate removes only rows that could never have survived. Verified byte-for-byte across five
filter shapes (two single-contract, unfiltered page 1 and 2, and the Unplanned status card) -
60,834,712 bytes of result, identical SHA-256 before and after.

| request | before | after |
| --- | --- | --- |
| one contract, buffers touched | 4,343,020 | 62,154 |
| one contract, execution | 3,331 ms | 762 ms |
| single contract via list query | 4,596 / 6,202 ms | 2,668 / 1,756 ms |
| unfiltered default page | 136,592 ms | 117,134 ms |

> The gain scales with how narrow the filter is - unfiltered, `trucking_source` already covers most
> contracts, so scoping removes little. The unfiltered path's remaining cost is not this node: the
> root plan still touches 18.7M buffers (146 GB) for a 910 MB database, concentrated in the
> `trucking_source` -> `contract_sto_lines` -> `expanded` CTE-scan chain, which is the next thing
> to attack.

**Also measured and rejected here:** pruning the 47 `sap_processed_data` `data->'raw'` keys that
KLIP never reads after import. They are 23 MB of 57 MB of raw text, but TOAST compression already
collapses the repeated key names - a pruned prototype table came out **76 MB against 77 MB**, with
query time inside the noise. Repeated key names are not a storage problem. What *is* expensive is
re-reading the blob: forcing 20 `data->'raw'->>'key'` accesses per row took 16.9-20.6s, while
hoisting the extraction into one `WITH r AS MATERIALIZED (SELECT data->'raw' ...)` took 1.0-1.7s
(10-16x). Those 47 keys were confirmed byte-for-byte duplicated in the parsed sections, so
flattening stays safe to revisit - except the four `Quality at %Stone` columns, which exist only
in `raw`. Any future pruning must happen **after** `computeRowContentHash`, or the next import
rewrites every row.

### PO Cancellation vs. Absence

**A PO missing from an import file is not a cancelled PO.** SAP export files are produced **per
period** (`EXPORT jan - dec 2025.XLSX`, `CPO 7 Sep 2026.XLSX`), so a 2026 file legitimately
contains no 2025 PO at all. Any logic that reads "absent from the newest import" as "cancelled"
will withdraw an entire year of contracts the moment a file for a different period is imported.

**Cancellation comes only from what SAP states explicitly:**

| SAP field | Effect |
| --- | --- |
| `Delete PO Status` | whole PO → `import_status = Cancelled` |
| `Delete STO Status` | that STO → Cancelled; PO-wide only when every real SAP STO is deleted |

Resolved by `sqlContractImportStatusExpr` (`backend/src/utils/contractDeliveryStatus.ts`).
Cancelled contracts are excluded from outstanding quantity, and never counted as Open or Close.

**What absence tracking still does** (`backend/src/services/sapPresence.service.ts`):

- counts consecutive misses per `(po_number, sto_number)` on trusted imports;
- **supersedes** a stale SAP row whose PO is still present — an STO moved, or a blank-STO row was
  replaced once SAP assigned the STO;
- **restores** anything that reappears;
- **flags for review** every PO whose rows have all gone missing (`flaggedForReview`);
- **never withdraws a contract on its own.** Only an operator naming specific POs
  (`applySapPresence.ts --pos=…`) withdraws, audited as `Operator-approved withdrawal`.

Withdrawal excludes a contract from totals but deletes nothing: KLIP-entered planning, ATAs and
remarks stay, the row stays visible behind the `?presence=` filter, and every transition is
written to `sap_presence_audit`.

> Inferring a file's covered period from its own rows was considered and rejected: `CPO 31 Aug
> 2026.XLSX` holds no row before 2026-04-10, so a February 2026 PO would still look absent from
> it. Only a file that declares its own period could make absence safe, and Klip is not given
> that.

**History.** Before this rule, absence *did* withdraw: on 2026-09-07 a 2025 file followed by two
2026-only files withdrew 370 contracts, all 2025-dated. 227 of them did carry a real
`Delete PO Status`; the other 143 had no cancellation signal at all, hiding 83,623 MT that the
2025 file itself still reported as Open. `backend/src/scripts/restoreAbsenceWithdrawnContracts.ts`
reverses inference-made withdrawals (dry-run by default) and leaves operator-approved ones alone.

### API Endpoints

- `POST /api/sap-master-v2/import-upload` - Upload and import Excel file (ADMIN only)
- `GET /api/sap-master-v2/imports` - Get import history (ADMIN, MANAGEMENT)
- `GET /api/sap-master-v2/imports/:importId` - Get import details and errors
- `GET /api/sap-master-v2/pending-entries` - Get pending manual entries
- `GET /api/shipments/performance` - Shipping Performance dataset (SEA/MIX), includes PO/Contract/STO identifiers and loading/discharge delta metrics

### Shipping Performance (new)

- **Frontend route**: `frontend/src/app/shipping-performance/page.tsx`
- **Sidebar entry**: `Shipping Performance` (uses `page.shipments` visibility)
- **Data source**: `GET /api/shipments/performance`
- **Scope**: only contracts with transport mode `SEA` or `MIX`
- **Main metrics**:
  - Loading: `ETA-ETR`, `ETA-ETB`, `ETB-ETC`
  - Discharge: `ETA-ETB`, `ETB-ETC`
  - `Total` = sum of loading + discharge deltas
- **Late Performance card**:
  - Late logic: `Total > 0`
  - On-time logic: `Total <= 0`
  - Drilldown tree: `Total -> Incoterm -> Product -> Plant`
  - Clicking card counts scopes the table below
- **Table capabilities**:
  - Column visibility toggle (including `PO No`, `Contract Ext No`, `Contract No`, `STO No`)
  - Per-column header filter popover
  - Drag-and-drop column ordering
  - Per-column sorting

### Error Handling

- **Row-level errors**: Individual rows can fail without stopping entire import
- **Error tracking**: Failed rows stored in `sap_raw_data` with error messages
- **Import summary**: Returns count of processed vs failed records
- **Error log**: Limited to first 100 errors per import for performance

## Development

### Frontend Development
```bash
cd frontend
npm run dev
```

### Backend Development
```bash
cd backend
npm run dev
```

### Database Migrations
```bash
cd backend
npm run db:migrate
```

## Run with Docker

**Local laptop development:** use **`docker-compose.dev.yml`** (live code mounts, dev Dockerfiles):

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

To run the full stack (PostgreSQL, backend, frontend) in containers on a single host with production-style images:

```bash
docker compose up -d --build
```

`docker compose` is the Docker Compose v2 syntax; if your system only has v1 installed you can use `docker-compose` instead.

Then open http://localhost:3001. Optional env vars, overrides, and dev-focused setup: **[docs/DOCKER.md](docs/DOCKER.md)**.

**Compose files in this repo:**

- `docker-compose.yml` – single-host stack (Postgres + backend + frontend), good for local or simple servers.
- `docker-compose.dev.yml` – development stack with live code mounts and dev Dockerfiles.
- `docker-compose.backend.yml` – backend + Postgres on the backend server in the two-server staging/production topology.
- `docker-compose.frontend.yml` – frontend on the frontend server in the two-server staging/production topology.
- `docker-compose.aws.yml` – alternative Compose setup for AWS-style environments.

---

## Production deployment

For a **full step-by-step deployment guide** (database, backend, frontend, Nginx, PM2, SSL, firewall, troubleshooting), see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

If you are using the **two‑server Docker staging/production setup** (AliCloud example: frontend 172.28.92.56 / 8.215.6.189, backend 172.28.92.57), follow section **“2. Staging deployment with Docker”** in `docs/DEPLOYMENT.md`. The typical update flow is:

- **Backend server (172.28.92.57)**:

  ```bash
  cd /opt/klip
  git pull
  docker compose -f docker-compose.backend.yml up -d --build
  ```

- **Frontend server (172.28.92.56)**:

  ```bash
  cd /opt/klip
  git pull
  docker compose -f docker-compose.frontend.yml up -d --build
  ```

Below is a minimal outline for a non‑Docker deployment matching the same AliCloud topology (frontend 172.28.92.56 / 8.215.6.189, backend 172.28.92.57):

- **Frontend server**
  - Private IP: `172.28.92.56`
  - Public IP: `8.215.6.189`
- **Backend server**
  - Private IP: `172.28.92.57` (no public IP – only reachable inside the VPC)
- **Database**
  - PostgreSQL instance reachable from the backend (for example: AliCloud RDS)

### 1. Backend deployment (172.28.92.57)

- **Environment (`backend/.env`):**

```env
PORT=5001
NODE_ENV=production

DB_HOST=<your-db-host>
DB_PORT=5432
DB_NAME=klip_db
DB_USER=<your-db-user>
DB_PASSWORD=<your-db-password>
```

- **Install & migrate (on the backend server):**

```bash
cd backend
npm ci
npm run db:migrate   # applies all SQL migrations, including vessel_loading_ports backfill
```

- **Run backend API (choose one):**

```bash
# Simple
npm run start

# Or with PM2
pm2 start dist/index.js --name klip-backend
```

Backend listens on `http://172.28.92.57:5001` inside the VPC.

### 2. Frontend deployment (172.28.92.56 / 8.215.6.189)

Because the backend has only a **private** IP, the browser must call the API via
the frontend server, using a reverse proxy.

#### 2.1 Configure frontend env

On the frontend server create `frontend/.env.production`:

```env
NEXT_PUBLIC_API_URL=/api
```

Using `/api` keeps all requests on the same origin (`https://8.215.6.189`) and lets
Nginx proxy them to the backend private IP.

Build and start the frontend:

```bash
cd frontend
npm ci
npm run build
npm run start   # Next.js production server (default :3001)
```

Frontend will be reachable at `http://8.215.6.189:3001` (or behind your load balancer).

#### 2.2 Nginx reverse proxy on frontend server

On the frontend host, configure Nginx (or another reverse proxy) so that:

- `/` is proxied to the Next.js frontend
- `/api` is proxied to the backend private IP `172.28.92.57:5001`

Example Nginx server block (HTTP, adjust for HTTPS as needed):

```nginx
server {
    listen 80;
    server_name 8.215.6.189;

    # Frontend (Next.js) – running on localhost:3001
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API – private IP in the same VPC
    location /api/ {
        proxy_pass http://172.28.92.57:5001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

After reloading Nginx:

- Browser → `http://8.215.6.189` (or `:3001` depending on your setup)
- Frontend JavaScript calls `NEXT_PUBLIC_API_URL=/api`
- Nginx forwards `/api/*` to `http://172.28.92.57:5001/api/*` over the private network


## API Documentation

API documentation is available at:
`http://localhost:5001/api-docs`

## Contributing

Please read CONTRIBUTING.md for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please contact the development team or create an issue in the repository.

