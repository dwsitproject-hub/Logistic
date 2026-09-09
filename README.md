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

