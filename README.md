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

#### The scoped Region/Plant box said "1 selected" with nothing ticked

Reported 2026-09-11 for a user scoped to product CPO and Region/Plant Bontang: on Contract
Performance the filter showed `1 selected (OR)` and the Bontang row was **unchecked**.

It is a display bug only, and the two halves of that are worth separating:

- The **request was always right.** `appendRegionSiteFilter` emits
  `UPPER(NULLIF(TRIM(expr), 'Blank')) IN (UPPER($n))`, so `plant=Bontang` matched. The rows on
  screen were correctly scoped the whole time.
- The **checkbox was comparing two spellings of the same place.** The user's scope is stored
  against `master_plants` and reaches the page as `Bontang`; the dropdown options are DISTINCT
  SAP Discharge Destination and arrive as `BONTANG`. `SearchableMultiSelect` renders
  `checked={selected.includes(option)}`, and the count comes from `selected.length` - hence one
  selected, nothing ticked. Both spellings were confirmed against the dev database.

Products were fine and stay fine: the stored value is `CPO` and the option is `CPO`.
`useUserScopeFilterDefaults` already had a `mapProducts` hook for pages that relabel products;
Region/Plant had no equivalent, and passed the stored value through untouched.

**Fixed in the state, not in the comparison** - and that distinction is the whole design. Ticking
the box with a looser comparison would have left it impossible to untick, because the toggle
removes with `selected.filter((s) => s !== value)` and that is strict. So the hook exposes
`alignGroupPlantsToOptions(options)`, which re-spells the selection as the options spell it
(reusing `alignSelectedToRegionSiteOptions`) and returns the **same array reference** when nothing
changes, so the effect that calls it cannot loop.

Wired on all six pages that show the filter: Contracts, Contract Performance (a second, separate
scope in the same file), Shipments, Trucking, Oil Loss, Shipping Performance, and Commercial
Documents - which names its options `availablePlants` rather than `availableGroupPlants` and sets
`uppercaseOptionLabels`, so its labels already looked uppercase while the value underneath did
not. `regionSiteScopeAlignment.test.ts` reproduces the original mismatch, asserts the aligned
value both ticks and unticks, and audits every page for the call - forgetting one is invisible
until a scoped user opens that page, since the count still reads correctly.

#### `tsc --noEmit` on the frontend: 124 errors to 0

Long-standing and entirely in test files, so the suite passed and nothing surfaced them. Split
two ways:

**104 were the vitest globals.** `vitest.config.ts` sets `globals: true`, so `describe` / `it` /
`expect` exist at runtime, but nothing told TypeScript - four test files that rely on the globals
rather than importing from `vitest` reported "Cannot find name". Fixed with
`src/vitest-globals.d.ts` carrying `/// <reference types="vitest/globals" />`, **not** a `types`
entry in tsconfig: setting `types` stops TypeScript auto-including every `@types/*` package
(node, react, d3, ...) and would have traded these errors for a different set.

**20 were real mismatches**, and two of them were tests quietly proving less than they appeared:

| file | what it was | fix |
| --- | --- | --- |
| `shipmentsPageFilterState.test.ts` | fixture predated `sourceTypeFilter`, so every key it built carried `undefined` there | added the field |
| `oilLossSfalNullHandling.test.ts` | fixtures omitted the required `id` | added it |
| `loadingPortDisplay.test.ts` | the test that proves SAP and KLIP port names stay independent passes a row with *both*, but each resolver declared only the field it reads - an excess-property error | one shared `PortRow` type across the three resolvers; each still reads only its own field |
| `contractPerformanceExport.test.ts` | callback params were typed `object`, so no caller could read a field off the row without casting | callbacks now receive the `Record<string, unknown>` the module already builds |

The two production edits are type-level only. Entry points still take `object`, because a typed
contract interface is assignable to that and would *not* be assignable to a `Record` without an
index signature - it is the callbacks, which callers write and this code invokes, that needed the
usable type. All 521 frontend tests still pass.

#### Region/Plant emptied the Trucking page - two dimensions, not a case bug

Reported 2026-09-11: filtering Trucking by Region/Plant, **especially Bontang or Tanjung Pura**,
left the summary cards and the view table empty.

`trucking_pipeline_daily_summary.group_plant` and `trucking_list_stage_snapshot.group_plant` are
written by `groupPlantExpr('c.plant_code', 'c.company_name')` - the **master_plants grouping**.
The toolbar's options come from `REGION_SITE_FILTER_OPTIONS_SQL` - DISTINCT SAP **Discharge
Destination**. The README has warned since the alias work that these are two different dimensions
shown side by side; the snapshot work scoped one with values from the other.

Measured on the dev database:

| | |
| --- | --- |
| dropdown options (Discharge Destination, alias applied) | **40** |
| snapshot `group_plant` values | **11** |
| overlap, case-insensitive | **4** — BEKASI, BONTANG, KARAWANG, TANJUNG PURA |

And even those 4 failed, because `appendGroupPlantFilter` compares case-sensitively while the two
sides disagree on case: `BONTANG` matched **0** rows against the stored `Bontang` (2,237),
`TANJUNG PURA` **0** against `Tanjung Pura` (4,866).

**Why case-insensitivity was the wrong fix**, though it was one line: it repairs 4 of 40 options
and leaves 36 silently empty. That is worse than uniformly broken, because it looks fixed. So a
plant filter now makes the request ineligible for the snapshot and falls back to the live path,
which filters the right dimension through `appendRegionSiteFilter` (`UPPER(...) IN (UPPER($n))`).

| Trucking, YTD | before | after |
| --- | --- | --- |
| no plant filter | 6,496 rows | 6,496 (unchanged, 3.9 s) |
| BONTANG | **0** | **1,119** |
| TANJUNG PURA | **0** | **2,339** |
| PALEMBANG (absent from the snapshot entirely) | 0 | 91 |

The honest cost: a plant-filtered request is back on the live path at 6-23 s. The fix that
returns the speed is to store Region/Site on the snapshot the way
`contract_performance_snapshot.plant_site` already does - it holds Discharge Destination values,
uppercase, and Contract Performance's Region/Plant filter works correctly today because of it.

**Shipments has the same defect** - `shipment_pipeline_daily_summary` and
`shipment_list_stage_snapshot` store the same master_plants dimension - and the guard sits in
`isPipelineDailySummaryEligible`, so both pages are covered by the one change. Contracts, Oil
Loss, Shipping Performance and Commercial Documents never read this snapshot, so their
Region/Plant filter was always on the live path and always correct.

The test that asserted `plants: ['PRC Karawang'] -> eligible` has been inverted with the reason
recorded. Its fixture value is worth noting: `PRC Karawang` is not a value either dimension ever
produces, which is a fair sign the case was written from assumption rather than from the data.

#### Migration 164: Region/Site on the stage snapshot, and what it did not fix

The live fallback restored correctness; this restores the speed for the paths that can take it.
`trucking_list_stage_snapshot` gets a `region_site` column filled by the refresh from
**`sqlRegionSiteRawForContract` itself** - the same expression the live filter evaluates, inlined
rather than re-derived, so the stored value cannot drift from what a live request would match.
Timed over all 18,751 contracts before building it: **5.2 s**. The rebuild came in at **214 s**
against a 227 s baseline, so the column costs nothing measurable - unlike the migration 163 first
attempt, whose extra CTE chain took the build to 469 s.

`group_plant` stays where it is rather than being repurposed: it is a real dimension the page
shows in its own right, and overwriting it would make the two indistinguishable again.

**Parity, checked in two layers** - because counts alone would not have caught the 163 failure,
where all six status counts were right and seven of thirteen quantities wrong:

| check | result |
| --- | --- |
| execution count, snapshot vs live, every value | **0 differing of 40** (39 region_site values + unfiltered) |
| Section 1's 22 figures, no filter / BONTANG / TANJUNG PURA | **0 differing** |
| loader latency | 12-80 ms against 1.0-13.5 s live |

41 of 15,562 rows have a NULL `region_site` - contracts with no b2b ending row and no SAP
discharge destination. They are excluded from a Region/Plant filter on **both** paths, because
live compares the same NULL through `appendRegionSiteFilter`, so this is not a behaviour change.
It did break the first readiness guard, which required *zero* NULLs and so would have refused the
snapshot forever over 0.3% of rows no filter can match; it now asks whether *any* row has a value.

**And the endpoint is still slow for a plant filter, which is the honest headline.** Three
predictions about where that time goes have now been wrong, so this is recorded as measurement
rather than diagnosis:

| piece, BONTANG | ms |
| --- | --- |
| execution count (snapshot) | 80 |
| backlog count (falls back to live) | 1,375 |
| Section 1 (snapshot) | 37 |
| page keys (snapshot) | 26 |
| **summaryOnly request, end to end** | **26,775** |

So it is neither the backlog count (predicted, wrong) nor the page keys (predicted earlier for the
unfiltered page, also wrong). It is the rest of the summary half, which does not read the stage
snapshot, and the specific query has not been identified yet. Note also that these timings are
not independent - a later call in the same process is warmed by the earlier ones, which is why a
"full" request can read faster than either half measured before it.

Deliberately still on live: `loadTruckingBacklogCountFromSnapshot` and both
`*_pipeline_daily_summary` readers. Their grain is
(group_plant, contract_date, product, incoterm), and a contract's `contract_number` is a
STRING_AGG that can span several `contracts` rows with different po_numbers - so different
region_sites. Adding the dimension to that key would split a MAX-deduped quantity across groups
and sum it twice, which is exactly the migration 163 failure. A separate contract-grain backlog
table would be the sound way to do it.

#### Tracing the summary half: one shared gate was sending Section 1 live

The endpoint stayed slow for a plant filter after migration 164, and three predictions about why
had already been wrong - so this was measured per query instead of per endpoint, by wrapping the
connection module's `query` and timing what the request actually issued.

Two queries, out of twelve, were the whole cost:

| query | bytes | ms |
| --- | --- | --- |
| `WITH filtered AS (...)` - Section 1, **live** | 347,743 | **18,826** |
| `WITH latest_spd_contract AS (...)` - backlog combined | 113,757 | 7,107 |
| everything else (10 queries) | - | < 110 each |

**Section 1 should never have been live here.** `dailyEligible` gated two different tables from
one flag: `loadTruckingSummaryFromDaily`, which reads the aggregate table and genuinely cannot
serve a Region/Plant filter, and `loadTruckingSection1FromStageSnapshot`, which reads the stage
snapshot and can, now that it carries `region_site`. Splitting them took Section 1 from
**18,826 ms to 68 ms**, and its statement from 347,743 to 5,902 bytes.

Counts came with a catch worth recording: the snapshot was asked for Section 1 with
`includeCounts: false`, because the daily summary normally supplies them. With a plant filter it
does not, so the counts would have gone missing. It now asks for counts exactly when the daily
summary did not supply them - which also fixes the same latent gap for a merely stale summary.

**The backlog query second.** The empty-backlog shortcut could not fire, because the count that
decides it came from the daily summary and that refused the plant filter. Asking the database
for the count directly is a query this path did not run before, and it earns its place only by
skipping a larger one: **1,375 ms against the 6,501 ms** combined query. Stated plainly, the
trade is one-way - a scope whose backlog is *not* empty now pays the count on top.

| summaryOnly, BONTANG | ms |
| --- | --- |
| before | 18,992 |
| Section 1 from the snapshot | 6,883 |
| plus the backlog count shortcut | **3,298** |

#### The other filters: region/plant was not the expensive one

Surveyed after the above, each in its own cold cache key. Timings on this box are noisy and
successive calls warm each other, so these are orders of magnitude rather than precise costs -
but the spread is far wider than noise:

| filter | summaryOnly ms | path |
| --- | --- | --- |
| incoterm | 14 | snapshot |
| product | 17 | snapshot |
| none | 326 | snapshot |
| loading location | 1,006 | live |
| column filter (supplier) | 1,362 | live |
| global search | 1,780 | live |
| region/plant | 4,633 | snapshot + live backlog count |
| **status** | **29,963** | live |
| **late indicator** | **44,121** | live |
| **source type** | **87,844** | live |

Product and incoterm were checked for the dimension mismatch that broke Region/Plant and do not
have it: 30 of 30 product values and 2 of 2 incoterm values in the snapshot match the option
list exactly, because both sides read `contracts` directly.

The three slow ones all fail `isPipelineDailySummaryEligible` and fall to the live expansion, and
their cost tracks how many rows the filter still matches - which is why a narrow global search is
1.8 s and `sourceType = 3RD PARTY` is 88 s. **Two of the three are already stored on the stage
snapshot**: `stage` (since migration 106) and `source_type` (since 163). Serving them the way
region_site is now served is the same shape of change, and would be worth more than everything
Region/Plant bought. Late indicator is not stored - it needs the delivery and completion dates -
so it would need columns first.

#### A Source filter was showing 116 rows of 1,236 - three leaks, one cause

Setting out to serve Source and Status from the snapshot, the first thing checked was whether a
Source filter's total matched its rows. It did not, and behind that were **three separate
defects, all introduced when the counts and page keys moved to the snapshot** - so they were
fixed before any performance work.

| # | defect | symptom |
| --- | --- | --- |
| 1 | the counts checked search / column filters / contract, and nothing about Source, Late Indicator, location or status | Source-filtered page reported **6,496**, the unfiltered total, against an actual 1,236 - with 324 phantom pages |
| 2 | the breakdown cache keyed on scope + search + column filters only | the count cached for the unfiltered page was served to a filtered one, and back again |
| 3 | `canPageAllHybridExecutionKeys` delegates to `canUseTruckingStoKeyPaging` **without passing Source** | the snapshot returned 500 keys chosen with no Source predicate; the expansion then dropped all but **116** - rows silently missing, which is worse than a wrong total |

The third is the one that matters most and was the hardest to see, because the page looked
plausible: 116 Interco rows, all genuinely Interco. The giveaway was arithmetic - 116 + 384 = 500,
exactly the unfiltered page size, so the page was being *partitioned* rather than queried.

One cause underneath all three: a filter the snapshot cannot express was reaching a snapshot
read. Eligibility is now decided once, where `req` is in scope, by the same predicate that gates
every other snapshot read, and carried on the context as `snapshotCountsEligible` - so a filter
the context does not even mention can no longer slip through. Plants stay allowed, because
`region_site` expresses them.

The live expansion-paging branch deliberately keeps the looser gate: it ranks `trucking_source`
with the filter applied, so it is correct exactly where the snapshot keys are not.

After the fix, the totals partition exactly:

| | rows on a 500 page | total |
| --- | --- | --- |
| no Source filter | 500 | 6,496 |
| Interco | 500 | 1,236 |
| 3rd Party | 500 | 5,260 |
| | | **1,236 + 5,260 = 6,496** |

**Correcting an earlier figure in this file:** the filter survey recorded `sourceType` at
87,844 ms. That measurement passed `3RD PARTY`, and `appendContractPerfSourceTypeFilter` matches
only the literal `3rd Party` or `Interco` - so it applied no predicate at all and timed an
unfiltered live request. The real filtered cost is 15-50 s. The conclusion it supported still
holds, for a different reason: a Source filter is expensive because it forces the live path, not
because the predicate is costly.

**Still to do:** serving Source and Status from the snapshot, which was the actual task. Both
columns exist (`source_type` since migration 163, `stage` since 106). Two useful findings for
that work: `appendContractPerfSourceTypeFilter` takes a column expression, so it can be applied
to the snapshot's own column for structural parity; and the summary is built with
`omitStatusFilter: true`, so it **ignores the status filter entirely** - meaning Status needs no
predicate on the snapshot at all, only a gate that stops refusing it.

#### Source and Status from the snapshot: 30-50 s to 36-49 ms

Both admitted to the stage snapshot, for different reasons - which is why the eligibility flags
are separate rather than one "stage snapshot" switch:

- **Source** needs a predicate. `source_type` has been on the snapshot since migration 163, and
  the scope applies `appendContractPerfSourceTypeFilter` - the *same* function the live query
  uses, which happens to take a column expression, so the snapshot's own column slots straight
  in and the two cannot drift.
- **Status needs no predicate at all.** The summary is built with `omitStatusFilter: true`, so it
  already reports every status regardless of which card is selected. Refusing the filter only
  forced an identical answer to be computed the slow way.

One guard worth its line: Source is admitted only for the two literals the predicate understands
(`Interco`, `3rd Party`). The UI sends nothing else, but
`appendContractPerfSourceTypeFilter` silently returns `''` for anything it does not recognise,
and an unfiltered answer to a filtered question is the failure mode this area has already
produced three times.

Parity to the same standard as Region/Plant - Section 1's **22 figures, live against snapshot**:

| case | live | snapshot | differing |
| --- | --- | --- | --- |
| no filter | 40,734 ms | 63 ms | **0** |
| Source = Interco | 9,314 ms | 20 ms | **0** |
| Source = 3rd Party | 49,442 ms | 66 ms | **0** |
| Status = COMPLETED | 33,412 ms | 54 ms | **0** |

The filter survey, re-run with the correct Source literals:

| filter | before | after |
| --- | --- | --- |
| incoterm | 14 ms | 6 ms |
| product | 17 ms | 7 ms |
| **Source (Interco)** | 15-50 s | **36 ms** |
| **Source (3rd Party)** | 15-50 s | **49 ms** |
| **Status** | 29,963 ms | **39 ms** |
| region/plant | 4,633 ms | 2,393 ms |
| global search | 1,780 ms | 2,524 ms |
| column filter | 1,362 ms | 1,748 ms |
| late indicator | 44,121 ms | 38,931 ms |

Late Indicator is unchanged and expected to be: it needs `delivery_end_date`,
`trucking_completion_date` and `eta_trucking_completion_date`, none of which the snapshot stores,
so it would need columns before it could be served. Global search and column filters move by less
than the run-to-run noise on this box; they remain live by design, since neither is expressible
from a fixed set of dimension columns.

#### The Late Indicator rule was wrong in three places

**The rule, confirmed with the business 2026-09-11:** due date delivery end against **ATA** (SAP
Trucking Last Receive Date, or the last WB date), falling back to **ETA** (the last daily-planning
deliverable date), then to today.

No implementation matched it. The *logic* was already right everywhere - one shared SQL expression
and one frontend function, both four-branch - but every caller fed it different inputs:

| place | ATA slot | ETA slot |
| --- | --- | --- |
| badge on screen | realization, which falls back to the planning date on shell responses | `eta_trucking_completion_date` - **0 of 16,552 rows**, because ETA is a shipment concept |
| sort | same | same |
| backend filter | **the planning date** - wrong slot entirely | same |

So filtering Late could return rows whose badge read On Time, and the ETA fallback never fired
anywhere. Correcting it moves **2,908 of 7,485 YTD rows** (measured with WB-only ATA; the real
shift is larger).

Fixed by giving the row an unconflated `ata_end_date` alongside the existing `planning_end_date`,
and pointing filter, sort and badge at the same two slots. `sqlShellRealizationEndDate` keeps its
planning fallback for the *displayed* completion date, which is right there and wrong for
lateness.

Migration 165 stores the three inputs as `late_due_date` / `late_ata_date` / `late_eta_date`,
named for their role - because the first attempt stored the expansion's like-named
`trucking_completion_date` and **failed parity on 13 of 22 Section 1 figures**: that column holds
14,458 values where the actual holds 1,310, so past-due rows looked received. Same-named is not
same-valued. Parity after: **22 figures, 0 differing** for none / LATE / ON_TIME / NA, live
27-63 s against snapshot 38-78 ms, and the filter went **38,931 ms to 41 ms**.

#### What went wrong operationally, and what it cost

Three self-inflicted faults, all from stacking changes without verifying end to end between them.
Recorded because the pattern matters more than the individual bugs.

**1. Empty cards.** Splitting the eligibility gate let a Region/Plant filter reach Section 1's
snapshot path for the first time, which made `fromDaily` null and pushed the code down a branch
that had never run with the snapshot. The loader was asked for counts; the *parser* was still
hardcoded to no counts, so they were fetched and discarded, `summary` came back undefined, and the
endpoint returned no summary at all. Every card read zero and the Outstanding strip spun.
**Parity testing missed it because it compared SQL rows, not the endpoint response** - 22 figures
matched while the response carried no summary.

**2. A freshness rule that made the page unusable.** Requiring a fresh snapshot for row membership
was reverted the same day. The reasoning was sound - a WB upload marks the snapshot stale, the
rebuild takes 150-240 s, and a missing row reads as a failed upload. The measurement was not:
every write marks it stale, and **14,591 of 16,552** operations had been touched since the last
rebuild, so essentially every request went live and the page took 25-190 s. The requirement is
real and is **still open**; closing it properly means refreshing the touched operations on write,
the pattern `contractPerformanceSnapshot.service` already uses in `refreshForTruckingOperationIds`.

**3. All-or-nothing counts.** `loadTruckingHybridCountsFromSnapshot` required both halves from the
snapshot. The backlog half reads the aggregate table, which refuses a plant filter, so one refusal
dragged the execution count to live as well - **9,668 ms** for 717 rows the snapshot had already
counted, against **1,887 ms** for the live backlog count alone. Each half now comes from wherever
can answer it.

Net for the reported case, Product CPO + Region/Plant BONTANG: **25,305 ms to 7,038 ms**, with
cards correct (55/28/631/3 = 717, matching the table).

**Two misattributions worth recording**, both from reasoning off a table name instead of tracing
the query. The remaining cost was blamed on the backlog count, which measured 1,375 ms. And a
saturated box was blamed on a SAP import - the `WITH parsed AS MATERIALIZED` queries are
`buildOilLossGainSql`, the **Oil Loss warmer**, triggered by a `docker restart` done to load new
code. Warm-up plus two snapshot rebuilds, on a box where `sap_processed_data` (160 MB) does not
fit in `shared_buffers` (128 MB), is enough to make every timing meaningless.

**Deploy ordering matters for this batch.** Migration 165 drops the three columns an earlier
revision added and marks the snapshot stale. Between the migration running and the backend loading
the new code, the refresh fails with 42703 and the page falls to live. Apply the migrations, deploy
the code, then confirm `pipeline_summary_refresh_meta` reports `is_stale = false` for trucking
before judging performance.

#### Add/Edit User: 36 of 40 Region/Plant choices save nothing

Found while checking the same filter elsewhere. The user form offers the same
`/contracts/filter-options/group-plants` list (40 Discharge Destination values), but persistence
goes through `user_plants -> master_plants`, matched on `master_plants.group_plant`
case-insensitively with alias expansion. Only **4** of the 40 resolve: BEKASI, BONTANG, KARAWANG,
TANJUNG PURA. The other 36 match nothing - `syncUserPlants` logs a warning, saves the subset, and
returns success, so the admin sees the save succeed and the scope silently is not what they
picked. Not fixed here: that area was being actively edited in parallel.

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

## Contract Performance

### Filter lists offered values the page could never return

The incoterm options endpoint is shared by Contracts, Contract Performance, Trucking and
Shipments, and answered with a `DISTINCT` over the whole `contracts` table. So Trucking offered
FOB/CIF/CFR and Shipments offered FRC/LCO - values a user could pick and get nothing back - plus a
literal `Blank` the frontend then stripped again.

`?scope=trucking` and `?scope=shipment` now narrow it to the page's domain set, intersected with
what the table actually holds, so an incoterm nobody uses still does not appear. No scope means no
restriction, and an unrecognised scope falls back the same way rather than emptying a filter.

The sets are a business decision, not a reading of the data, and the difference is recorded because
it matters: `trucking_operations` currently holds **64 FOB, 11 CIF and 2 CFR** rows and `shipments`
holds **3 LCO**, so those rows are not reachable through the incoterm filter. That was raised before
implementing and confirmed as intended; if they turn out to be anomalies, `FILTER_OPTION_SCOPES` is
where the decision lives.

### Contracts with no Region/Site are excluded, from both sections

`plant_site` is `COALESCE(MAX(...), 'Blank')`, so a contract SAP gives no discharge destination for
arrived as the literal string "Blank" and rendered as an unlabelled drilldown card. On dev that
bucket holds **59 contracts / 41,060 MT**, and only 5 of the 59 actually have a Discharge
Destination in SAP - the rest genuinely have none, so this is filtered display, not hidden data
loss.

Filtered on the ROWS rather than on the tree, and that is the point: `aggregateLatePerformanceRows`
builds the Section 1 summary and the Section 2 drilldown from one list. Dropping the card alone
would have left Section 1 counting 41,060 MT the tree no longer showed - and the page displays that
discrepancy to the user. Excluding on both sides was the user's call once the trade-off was put to
them. Verified afterwards: 7,306 rows, 29 distinct Region/Site values, no Blank bucket.

The View table follows, on the same page-level rule rather than on tree membership: with the
Late/On-Time filter on ALL the table sends `excludeUnscheduled=false`, so the tree's inclusion
predicate is not applied and the table would otherwise have kept listing rows the cards above it no
longer count. It is filtered in SQL as its own CTE stage, not on the returned rows, because the
page total and the LIMIT come from that chain - and `countSource` had to be moved onto the same
stage too, or the page would have shown 18,122 rows while claiming 18,181.

Requested with an explicit `requireRegionSite=true` rather than inferred from `scope` or `_ts`,
neither of which is unique to this page - the plain Contracts page must keep showing those
contracts. Both sides use the identical `COALESCE(MAX(sqlRegionSiteRawFromJsonAndB2b(...)),
'Blank')`, so they cannot disagree about which contracts go. Measured end to end: total
18,181 -> 18,122, exactly the 59, and no blank-region row left in the page.


### SEA Trade Cycle fell back to the start of the voyage instead of its end

Reported: PO 1001031296 and 1001031455 show "-" for Trade Cycle although they have a Due Date
Delivery End and an ETC. ATC is still null on both.

The SEA completion chain was ATC → **ETA at Loading Port** → null. ETC was never consulted -
`last_eta_vessel_complete_discharge` is computed, carried through the performance snapshot and sent
to the frontend, but no cycle calculation read it.

That fallback is the wrong date, not merely a missing one. The four milestones pair up as
estimate/actual over start/end: ETA and ATA are the vessel *arriving to start loading*; ETC and ATC
are it *finishing discharge* (see `contractStoListMilestoneDates`). A cycle measures when the
contract completes, so with no ATC the natural stand-in is ETC - the estimate of that same event.
ETA at LP is the beginning of the voyage, often weeks earlier.

Now ATC → ETC → ETA at LP, with the existing "estimate already past → today" clamp applying to
whichever estimate is used. ETA at LP is kept last so nothing that shows a value today loses one.

On dev: **81** SEA contracts that show "-" gain a value, and **23** change - those had an ETA at LP
and an ETC, and every one of the 23 had a different ETC, so their Trade Cycle was reading weeks too
optimistic. That second group was not reported and is the larger correctness gain.

Neither estimate comes from SAP. Checked across every row, the export carries **no ETA column of
any kind** - in `data->'raw'` or `data->'shipment'` - so ETA at LP and ETC are both entered in KLIP.
That killed the one defence of the old order (that ETA at LP might be the more reliably populated
SAP field); the reason to prefer ETC is meaning, and that it is filled ~4x more often is a bonus,
not the argument.

Changed in two places that must stay in step: `resolveSeaTradeCycleCompletionDate` (used by both
the Open and Closed paths) and the SQL mirror in `contract.controller.ts`, which drives the
Late/On Time filter and sort - a difference there would filter rows by one rule and display them by
another. The help text said `if ATA is empty use ETA at LP … no ETA → "-"`, describing the wrong
behaviour correctly, which is how this survived; it is updated too.

**Not addressed here, on the user's instruction:** Closed Cash Cycle and Closed DP Cycle carry the
opposite sign to their Open counterparts and to Trade Cycle. `computeClosedCashCycleDays` does
`diffCalendarDays(end, payoff)` where Open does `diffCalendarDays(payoff, end)`, so the same
contract reads +10 while Open and -10 once Closed. Demonstrated on identical dates; 16,925 closed
contracts on dev would change sign, so it waits for a decision rather than being folded in here.

## Shipments

### A contract whose shipments were all cancelled vanished from the OS

Contract Performance and the Shipments OS summary disagreed by 50,768 MT on sea incoterms, and the
most legible symptom was CFR: Contract Performance showed it, the Shipments card showed **0**, and
there are 7 non-cancelled CFR shipments in the data.

CFR turned out to be the clean case that exposed a general gap. The Shipments OS is built from two
arms, and neither covered a contract whose shipments are all cancelled:

- the **execution** arm buckets only the active stages (`PLANNED`..`UNLOADING`), so a cancelled
  shipment contributes nothing - correctly;
- the **backlog** arm excluded any contract with `EXISTS (SELECT 1 FROM shipments ...)`, *whatever
  the status*.

So such a contract was in neither, while Contract Performance still counted it as Open with
outstanding quantity. The only Open CFR contract is exactly that shape, which is why that bucket
read zero rather than merely low.

**Trucking never had this problem, and comparing the two is what named it**: its backlog excludes a
contract only when it has an ACTIVE operation. That is the whole reason Trucking's OS already
agreed with Contract Performance and Shipments' did not.

The Shipments backlog now qualifies its `NOT EXISTS` the same way. The arms stay disjoint, which is
what makes the union safe: a contract with any live shipment is counted in execution and excluded
from backlog; one with only cancelled shipments is counted in backlog and not execution; one with
none is counted in backlog. Exactly once, either way.

The same gap had a second half. `sqlContractHasNoRegisteredEtaExpr` counted a **cancelled**
shipment's ETA as a registered plan, so such a contract dropped out of the Unplanned backlog as
"already planned" while having no live shipment kept it out of the execution arm. Same principle,
same fix: a cancelled shipment is not a shipment.

**Correction to how this was first analysed, because two conclusions were wrong.** The gap was
originally reported as 50,768 MT with FOB and CIF diverging in *opposite* directions, and that was
an artefact of comparing the wrong number: Contract Performance's **drilldown tree** sums
`isClosed ? contract_qty : outstanding_qty`, so it is not an OS measure at all. Against the Open OS
the real gap was 7,811 MT. Two "causes" evaporated with it - incoterm attribution (only 2 STO
groups span more than one incoterm) and signed-vs-clamped OS (no open sea contract is
over-delivered, so `GREATEST(0, ...)` never bites). Neither was worth the change it would have
justified.

What the contract-by-contract diff then showed, which the totals never could:

```
CIF  508 MT   1 contract in neither arm      -> exactly the CIF discrepancy
CFR  5,000 MT the only Open CFR contract     -> exactly the CFR discrepancy
```

Both now match to the MT. The remaining **8,319 MT was FOB only**.


### The FOB remainder: a B2B origin counted by both arms

That 8,319 MT was first written up here as deliberate - the sea-leg filter
(`sqlShipmentBacklogSpdSeaLegFilterSql`) lets the Shipments backlog ignore Type T rows when closing
a FOB contract, while Contract Performance uses the PO-wide status, so the two pages would disagree
by design. **That was wrong, and measuring it before implementing is what caught it**: adopting the
sea-leg definition would have moved 292 FOB contracts Open -> Close and made the gap *wider*, not
zero. The explanation was abandoned unimplemented.

Listing both arms per contract - rather than reasoning from totals, which had by then produced four
wrong answers - accounted for the whole 8,319 MT exactly:

| MT | contracts | cause |
| --- | --- | --- |
| +9,500 | 4 | counted by **both** arms |
| +1,000 | 1 | backlog row that is not FOB-Open on Contract Performance |
| +519 | 4 | execution rows that are not FOB-Open on Contract Performance |
| -2,700 | 3 | FOB-Open on Contract Performance, in **neither** arm |
| **8,319** | | |

Two things the totals had implied are not true: the per-contract OS **values** agree to the kg in
both arms (the earlier "628 MT across 390 contracts" does not apply to FOB), so the whole gap is
membership, not arithmetic; and `COMPLETED` rows inside `execution_os` are expected, not a leak -
the OS-completed rule rewrites the status once nothing is outstanding, and those rows carry 0 MT.

The 9,500 MT is a defect, and it comes from the **B2B origin remap**. `shipment_base.contract_numbers`
is built over `c.id = COALESCE(c_origin.id, c_link.id)`, so a shipment attached to a B2B *child* is
re-attributed to the *origin* contract, and the execution arm counts the origin. The backlog arm's
guards only ask whether a shipment points AT a contract - and nothing points at the origin: the
child owns the shipment, and the origin carries no STO at all. Both arms counted it.

```
origin 9194100034 <- child 1004030568 [B2B], 1 active shipment
origin 9194100035 <- child 1004031407 [B2B], 1 active shipment
origin 9334100045 <- child 1004030594 [B2B], 1 active shipment
origin 9334100046 <- child 1004031409 [B2B], 1 active shipment
```

`contractBacklogCoreWhereSql` now carries `sqlContractIsB2bOriginOfShippedChildExpr` alongside its
two existing guards, restoring the "exactly once, either way" property the section above claims.
The guard keys the origin by `po_number` equality rather than copying the remap's
`ORDER BY created_at DESC LIMIT 1`, because `po_number` is unique across contracts (verified: zero
duplicate groups) so the two are equivalent and the cheap form is exact.

Measured on the dev copy after the change - the removal is exactly the intended one, and the two
incoterms that already matched are untouched:

| | before | after |
| --- | --- | --- |
| FOB backlog rows | 118 / 171,150 MT | 114 / 161,650 MT |
| FOB gap vs Contract Performance | +8,319 MT | **-1,181 MT** |
| CIF gap | 0 MT | 0 MT |
| CFR gap | 0 MT | 0 MT |

`docs/scripts/diag-b2b-origin-double-count.sh` re-measures the affected population on any
environment.


### ...and a sibling STO's discharge finished the wrong group

The -2,700 MT row of that table was three contracts that reached **neither** arm. The first
explanation tried - their shipment had finished, so relax the backlog guards the way the cancelled
case did - was measured and turned out to be false: their own shipments carry no ATA at all. The
change was reverted unimplemented.

What the per-shipment listing showed instead is that the group they belong to is not made of their
shipments alone. For FOB with a vessel, `shipmentListSeaStoKeyExpr` keys a row by a contract-level
STO pick rather than by the shipment's own STO, so a contract holding two shipments on two STOs puts
both in one group:

```
1004029281  own STO 1006019385  COMPLETED  ATA present  -> group 1006019867   regrouped
1004029907  own STO 1006019385  COMPLETED  ATA present  -> group 1006019867   regrouped
1004029445  own STO 1006019867  PLANNED    no ATA       -> group 1006019867
1004030295  own STO 1006019867  PLANNED    no ATA       -> group 1006019867
1004030473  own STO 1006019867  PLANNED    no ATA       -> group 1006019867
```

`MAX()` over that group takes the finished voyage's ATA, so a group of still-planned shipments reads
as discharged. The execution arm drops it as finished; the backlog rejects those contracts for
holding live shipments; the quantity is counted nowhere. Same family as the ATA bleed that
migrations 169/170 cleared, except here it is the grouping key that bleeds, not the data. On the dev
copy 286 FOB shipments are regrouped this way, 40 of them already discharged - CIF has 16 regrouped
and none discharged, which is why CIF never showed it.

`buildShipmentListAtaSelectSql` now also emits `ata_vessel_complete_discharge_own_sto`, the same MAX
with `FILTER (WHERE the row has no STO of its own OR its STO is the group's)`, and only the OS path
(`sqlShipmentOutstandingActiveStagePredicate`, the Section 1 execution enrich) reads it. The list
keeps displaying the group-wide ATA it always has. The column is emitted even without a group key,
because a shipment_base variant missing a column the summary selects fails the refresh with 42703 -
which has already happened once here, with `is_contract_os_within_band`.

| | before | after |
| --- | --- | --- |
| FOB gap vs Contract Performance | -1,181 MT | **+2,462 MT** |
| CIF / CFR gap | 0 MT | 0 MT |

The 2,700 MT returns to the execution arm, and 942 MT more with it: contracts 1004029281 and
1004029907, whose own planned shipment on the regrouped STO was hidden by the same bled ATA.

The remaining +2,462 MT is now only two things, and neither is a Shipments defect:

- **1,117 MT** (1004028041, 1004032347) were blank Region/Site - now excluded, see below;
- **1,345 MT** (1004029281, 1004029907, 1004030633) are contracts whose SAP GR still says **Open**
  with most of the quantity undelivered (62/400, 146/750, 97/500 MT), but whose KLIP
  `contracts.status` says COMPLETED - so Contract Performance calls them Close and Shipments does
  not. Here Shipments is the one telling the truth; the question of whether a stored KLIP status may
  close a GR-Open contract is a Contract Performance decision, left open.


### Blank Region/Site leaves the OS total, not the page

Contract Performance counts only contracts that resolve to a real Region/Site
(`hasResolvedRegionSite`: `plant_site` neither empty nor the literal `Blank`). As the agreed shared
reference that exclusion has to hold on Shipments too, so both OS arms now carry
`sqlContractHasResolvedRegionSiteExpr`. It sits in the OS aggregates rather than in
`backlog_contract_ids`, because the decision was to drop these contracts from the **total** while
leaving the rows on the page and in the Unplanned / Preplanned counts.

**Region/Site is the SAP discharge destination, not the plant code.** The first attempt used
`groupPlantExpr`, which also falls back to the literal `'Blank'` and so reads as interchangeable.
Measured, it removed **14,700 MT of real work** and still left both target contracts counted. The
predicate now reuses `sqlRegionSiteDisplayForContract` - the same expression the page renders in its
Region/Site column - so the card and the column cannot disagree about which contracts are blank.

| | before | after |
| --- | --- | --- |
| FOB gap vs Contract Performance | +2,462 MT | **+1,346 MT** |
| CIF / CFR gap | 0 MT | 0 MT |
| backlog OS query | ~1.6 s | ~1.7 s |

What remains is only the 1,345 MT of GR-Open contracts above - closed in the section below.

**Trucking has the same exposure and has not been changed yet**: 33 FRC/LCO contracts with a blank
Region/Site carry 13,927 MT. Its OS builders are shaped differently - the combined backlog query
produces the Unplanned card's COUNT and contract qty from the same scan as the OS buckets - so
applying the exclusion there without also removing the rows from that card needs its own pass.


### One PO, several STOs - and the ATC that closed all of them

The last 1,345 MT was three POs, and the mechanism was not the stored KLIP status this write-up
first blamed. `isContractEffectivelyDone` closes a contract when
`last_ata_vessel_complete_discharge` is set - and that column is a **MAX across the PO**. On a PO
carrying several STOs, one discharged STO therefore closed the whole contract while another was
still Open with quantity left:

```
PO 1004030633   Contract Quantity = 500,000 kg
  STO 1006019438   STO Quantity =  97,340   Receive = 97,340   GR STO = Close   -> discharged
  STO 1006019958   STO Quantity = 402,660   Receive =      0   GR STO = Open    -> 402,660 kg left
```

Contract Performance called the PO Close and dropped its 403 MT; the Shipments OS went on counting
it. Same shape as the sibling-STO discharge above, one page over.

The ATC arm now applies only when the PO has a single STO (`sto_count`), which leaves the case the
arm exists for - a single-STO PO whose vessel discharged while GR lags - exactly as it was. The
count comes from `contract_sto_agg_snapshot` joined onto the Contract Performance snapshot, which
does not store it; one small row per contract, and no snapshot rebuild. The SQL mirror
(`sqlContractEffectivelyDoneExpr`) takes the count as an optional expression so callers that do not
carry one keep their previous behaviour.

Measured on the dev copy: **3 contracts move Close -> Open, 1,346 MT, all FOB** - exactly the three
in question, nothing else. And with that, the two pages agree:

| | Shipments | Contract Performance | gap |
| --- | --- | --- | --- |
| FOB | 234,539 MT | 234,539 MT | **0** |
| CIF | 104,609 MT | 104,609 MT | **0** |
| CFR | 5,000 MT | 5,000 MT | **0** |

### The same shape, twice more: incoterm and GR read from the group

Production kept a gap after all of the above, and listing every sea contract on both pages reduced
it to **11 contracts, net 1,548 MT** - small enough to name, and two more instances of the shape
this whole investigation kept finding: a group-level value deciding a contract-level fact.

| MT | contracts | cause |
| --- | --- | --- |
| +1,050 | 4 | bucketed and valued by the STO group's incoterm |
| +608 | 3 | own GR says Close, but the group's BOOL_AND does not |
| -110 | 3 | Contract Performance counts them, Shipments has them in neither arm |

**Incoterm.** `execution_os` preferred the grouped row's `os_incoterm` over the contract's own, and
an STO group can hold contracts of different incoterms. Three FRC contracts in Karawang and one LCO
in Bontang were therefore counted in the **sea** OS card as FOB. That is not only a wrong bucket:
the incoterm selects which delivery column the outstanding quantity reads, so the same four were
valued off the vessel column instead of the trucking one - Contract Performance had them at 0-3 MT
against 100-750 MT here. Both the bucket and the quantity now take the contract's own incoterm, with
the group's kept as the fallback for a contract carrying none.

**GR Close.** `is_contract_sap_closed` on the grouped row is `BOOL_AND` over the group's contracts,
so a group finishes only once every contract in it has. A closed contract sharing an STO with open
ones stayed in the execution arm and kept contributing. The test is now made per contract inside
`execution_os_contracts`, where the rows are already split out; the grouped flag is left alone
because it also drives the list's status column, and there "every contract closed" is the right
question to ask of a row that stands for the whole group.

Measured on the dev copy after both: FOB, CIF and CFR stay at a 0 MT gap - neither change moves a
number there, which is what a fix for a production-only data shape should do.

**Diagnostics, because the reasoning went wrong repeatedly.** Three hypotheses were tested on the
dev copy and generalised to production without checking there, and all three were wrong; a fourth
compared against a figure the page never displayed (55,653 against 47,153 on screen, because the
query omitted the year-to-date range, the B2B child exclusion and the PO-placeholder exclusion).
`docs/scripts/diag-os-gap-slice.sh` now makes reproducing the page's own number an explicit gate
before any diff, `diag-shipments-os-contracts.sh` lists the Shipments OS per contract from the real
query inside the container, `diag-why-not-on-cp.sh` names the gate a contract fails, and
`diag-os-gap-classes.sh` sizes every class across the whole dataset so the order of work follows the
numbers.


**Why the OS is not computed per STO.** SAP does carry per-STO quantities, and for the PO above they
sum exactly to the contract quantity - so `contract qty - qty STO1 - qty STO2` looks like the
natural model. It does not survive contact with the data: of 2,706 multi-STO POs, **1,325 have
`SUM(STO Quantity) <> Contract Quantity`**, several by exactly 2x, because the reverse relation (one
STO shared by several POs) is the common one and `STO Quantity` is then the whole STO's, not this
PO's share - the same grain problem `po_sto_count` already divides for. Restricted to POs whose STOs
are all exclusive, 324 of 1,593 still disagree. The OS therefore stays at PO grain, where it is
right, and per-STO quantities are used only to decide **which** STO carries it.

Attribution is already correct as a side effect of the own-STO discharge column: a group whose own
STO has discharged leaves the execution arm, so the quantity lands on the STO that is still open.
What is left is 5 POs holding more than one *simultaneously active* STO group, where
`DISTINCT ON (contract_number)` shows the whole PO's OS on one of them. Splitting it would need the
per-STO quantities the paragraph above shows cannot be trusted, so it is deliberately not done: the
totals are exact, and a split would trade that for a nicer-looking row.


### ...and the list's status column now says so too

The OS cards stopped counting finished shipments as soon as the rule went into `execution_os`, but
the list's status column kept reading PLANNED for the same rows - a screen disagreeing with its own
KPI strip. That column is driven by `shipmentEffectiveStatusExpr`, which had no OS to consult.

Cost was the reason to defer it, so it was measured rather than guessed. `qty_move` turned out to
be a pure read of `contract_qty_move_snapshot` (primary key on `contract_number`, 18,711 rows), and
the list already pays for the 26KB GR-status expression once per group, so the missing piece was
one indexed join, not a derivation. Joining it across every sea contract: **33ms**.

Through the real page, all four calls it makes:

```
baseline          55,763 ms
with the change   53,978 ms   then   51,736 ms
```

Both runs after the change came in faster than the baseline; the spread between runs (~4s) dwarfs
any effect. No regression.

Deliberately a joined alias rather than splicing the `qty_move` CTE into this statement: adding a
CTE here has changed plans badly before. Same table, same formula, so the column and the card
cannot disagree - the expression reports 1,591 sea contracts inside the band, matching the
independently derived `contract_performance_snapshot` count exactly.

`BOOL_AND` over the group's contracts, not a summed OS, and that is not an optimisation: a contract
can belong to several STO groups, so summing would need the per-STO division the aggregates apply.
Testing each contract sidesteps it. The arm sits after Cancelled and GR-Close, so it can only add
COMPLETED, never override a decision already made (11 cancelled contracts fall inside the band and
are untouched).

Incremental effect: of 3,008 sea contracts, 1,591 are inside the band, 231 of those are not already
Close or Cancelled, and **220** additionally have no ATC - so 220 rows newly read COMPLETED. The
rest were already finished by the existing rules.

One trap worth recording: the first version of this comment used the literal `po_sto_count`, and
four tests that assert the rendered SQL does not contain that string failed. Prose inside a SQL
comment is still part of the statement.

### Nothing outstanding now finishes a shipment, and one tolerance governs all of it

Trucking has always had it (`isTruckingPipelineCompleted`), and so has the contract-level test
(`isContractEffectivelyDone`): once outstanding quantity is within the zero band, the thing is
finished even if GR still says Open and no ATC was ever recorded. Shipment **execution** rows were
the only grain without that rule - their ladder knew just two routes to COMPLETED, GR Close and a
filled ATC - so residual quantity sat in the OS cards forever.

Applied inside `execution_os` (`shipmentOutstandingQtySummarySql.ts`), where `outstanding_quantity`
is already computed, so the rule costs nothing. The OS buckets `FILTER` on `effective_status` and
there is no `completed` bucket, so a row that lands there leaves the OS total outright rather than
contributing ~0. CANCELLED is never overridden - a cancelled shipment is not a completed one.

Deliberately NOT applied in `shipmentEffectiveStatusExpr`, which drives the list's status column:
that expression runs on an alias with no OS column at all, so the rule there would mean pulling OS
derivation - the expensive part - into the base CTE of a page that is already slow. Measured
separately before any such change.

The cycle that forbids this at contract level does not exist here, and that was checked rather than
assumed: the only read of `shipments.status` anywhere in the OS/qty machinery is
`COALESCE(s.status, '') <> 'CANCELLED'` in `contractGlobalOutstandingSql.ts`, and a COMPLETED
derived from OS can never change that predicate.

`BACKLOG_OS_COMPLETED_MAX_KG` was 1000 while everything else used 499
(`OUTSTANDING_QTY_ZERO_TOLERANCE_KG`), so the same residual counted as finished on the Shipments
backlog and as still open everywhere else. Now unified on the shared constant. Cost measured first:
of 1,052 sea backlog contracts on dev only **7** sit in the 500-1000 kg band and move back to open.
(An earlier count of 1,475 used the wrong denominator - every contract, including trucking
incoterms that were already on 499.) Tests now assert against the constant rather than the literal,
so the next change to it cannot silently diverge.

### Loading-port ATAs needed a stricter rule than the discharge ones

Migration 169 cleared discharge-port ATAs copied from a sibling STO. The loading ports carry the
same legacy damage - PO 1001029907's STO 1006019867 had its sibling's arrival, berthed, start,
completed and sailed dates, not just the ATC - but 169's rule cannot be reused for them.

Several STOs under one PO can legitimately share ONE vessel voyage. Where SAP recorded the loading
dates on only one of those STO rows, the others genuinely have no value of their own and the date
they show is CORRECT. 169's test ("own STO has no such value in SAP") would delete those: on dev
it flags 79 rows for `ata_loading_completed` alone, and 16 are siblings on the same vessel.

Migration 170 adds a fourth condition: a sibling under the same contract holds the identical date
on a **different vessel**. Two ships cannot finish loading at the same moment, so with the other
conditions the copy explanation is the only sensible one - and it is the shape of the reported
case, whose two shipments are MT. GIAT ARMADA 02 and MT.ANGGRAINI SPIRIT.

Tiers on dev: 52 different-vessel (repaired), 16 same-vessel and 11 with no sibling holding the
date (both left alone, and reported by the detector rather than swept in). Production turned out
to have no ambiguity at all - 2 rows per field, every one in the different-vessel tier, the same
two shipments 169 repaired.

Verified before shipping: the migration updates exactly what the detector names, field by field
(52 / 3 / 52 / 52 / 51), and a second pass updates 0.

### One STO spans several POs - but only the ones SAP still reports for it

STO 1006017267 listed **8** POs where operations expect **6**
(1001027063/64/116, 1001027600, 1001027719/720). The two extras were not corrupt; they were
retired.

SAP files arrive out of order. A per-year slice, `EXPORT jan - dec 2025.XLSX`, was loaded on
2026-09-03; the current export, `CPO 7 Sep 2026.XLSX`, on 2026-09-07. Every KLIP-side link -
`contract_stos`, `contracts.sto_number`, `shipments` - was populated from whichever file mentioned
the pair, so a STO accumulated POs from retired slices and never dropped them. All four sources
agreed on 8, which is why no single-source check found anything wrong.

**Order by the import's `created_at`, not the row's.** The six correct rows carry 2026-05-15 and
the two stale ones 2026-09-03, so row timestamps give exactly the wrong answer - the trap that
makes this look like a data problem rather than a scoping one.

A contract is dropped only when SAP knows the (contract, STO) pair **and** none of those rows
belong to the STO's newest import. KLIP-only links survive, and a manual
`user_sto_contract_assignments` entry always wins, because a person set it deliberately.

This is emphatically **not** "absent from the latest file means cancelled" - that reading once
withdrew 370 contracts wrongly. It decides which POs a STO currently groups and changes no
contract's status.

Blast radius measured before shipping: of 10,172 STOs on dev, 10,098 unchanged, 74 shrink, and
**none** is left with no POs. Verified through the real endpoint afterwards, not a stand-in query:
1006017267 returns exactly the expected six, and 1006019867 still returns its five.

### Edit Shipment is a STO-level view, so its PO list comes from the STO

Reported as the view table showing 6 POs where the edit modal showed 4. No data source explains
either number: `contract_stos`, `shipments.shipment_id`, user assignments, SAP's own PO/STO pairs
and `/shipments/contracts/details?sto=` all return the same **5** in production, and the SAP header
rows that could have padded the table's list do not exist for these contracts at all.

The difference was in where the modal built its rows. `hydrateShipmentEditForm` seeded them from
`row.contract_numbers ?? shipment.contract_number ?? contractIdFallback`. Opened from a list row
that is the whole STO group; opened by id it is the detail endpoint's `contract_number` - a
**single** contract, because `getShipmentById` returns one. The form then listed one contract's POs
while the table listed the STO's.

`/shipments/contracts/details?sto=` already answers the STO question and was already being called
here - but only to fill quantities. Its contract numbers are now merged into the list the form
renders, so the same STO yields the same POs however the modal was opened. The seed is kept ahead
of them so an explicitly passed group keeps its order, and the merge is a Set so nothing doubles.

Worth recording what this was *not*, since two plausible theories died on measurement. The two
screens do read different sources - the table takes `COALESCE(sla.po_numbers, ...)` from SAP's raw
`PO No` grouped by sto_key, the modal reads KLIP linkage - but in this case both sources agree.
And `spd_keyed`'s fallback branch looked like it could pull rows from a *different* STO; its second
guard (`key ~ '^OP-' OR sto IS NULL`) excludes them, so it cannot.

### SAP does not export per-loading-port dates, and that is not a gap to fill

Investigating the ATA bleed turned up keys the service reads that do not exist, and my first
reading of that was wrong: I took it as SAP sending data the code looked for in the wrong place.
It is the opposite. Checked across all 27,003 rows, the raw export carries exactly five ATA
loading columns and **none of them names a port**:

```
ATA Vessel Arrival at Loading Port / Berthed at Loading Port / Start Loading /
Completed Loading / Sailed from Loading Port
```

SAP reports one set of loading dates per shipment, not one per port. So:

- The `..._at_loading_port_1` keys read first for start, completed and sailed exist on **zero**
  rows. Harmless - the global fallback carries the real value - but they read like evidence that
  per-port data exists, which is what misled me.
- Loading ports 2 and 3 read only `..._at_loading_port_2/3` with no fallback, and none of those
  keys exists either: not the dates, not the port name, not the quantity. Those ports receive
  nothing from SAP, and that is correct.

**Do not "fix" this by giving ports 2 and 3 the global keys as a fallback.** That would stamp port
1's dates onto every other port - the same wrong-data spreading migrations 169 and 170 had to
clean up.

No migration for the ~21 port-2 rows that do carry ATAs from some earlier path: about half match
port 1's date and half do not, which is no clean signal of corruption, and nothing has been
reported against them. The reads are kept rather than deleted so a future export carrying per-port
columns is picked up without another change.

### A phantom ATC came from the discharge-port row, not from SAP

Reported: STO 1006019867 showed an ATC of 2026-08-13 that SAP leaves NULL. It belonged to its
sibling STO 1006019385 under the same PO.

The ATC a user sees is `COALESCE(shipments.ata_discharge_complete, vlpd.ata_loading_completed)`.
Production's four sources, read one by one, settled it: the stored column was NULL, the manual
override was NULL, SAP itself carried nothing for that STO - and the discharge-port row held
2026-08-13. Both siblings' port rows were byte-identical, PORT MERAUKE and PORT BONTANG alike.

The join was never the problem (`vlpd.shipment_id = s.id` is correctly scoped). The **data** was.
The SAP port lookup used to fall back to a PO-wide row and could write another STO's dates; that
was fixed later with `sto_match_rank`, but `mergeSapPortValue` is fill-gaps-only -
`if (hasCurrent) return current` - so nothing written before the fix is ever corrected by a later
import. Dev is clean, production kept the legacy rows.

Migration 169 removes them, under three conditions that each carry weight: discharge rows only;
`ata_loading_completed` must equal the `sap_ata_loading_completed` mirror, so values a person typed
are untouched; and the shipment's **own** STO must have no such value in SAP.

"Own STO" means `shipments.shipment_id`, never `contracts.sto_number` - one contract row can carry
two STOs, and using the contract's value is the very conflation that causes the bug. Including it
in the identity test reported **zero** candidates and nearly closed the investigation on a false
negative; removing it surfaced 5 on dev and 2 in production, one of them the reported row.

Verified before shipping: the migration updates exactly the 5 rows the detector names on dev
(518 -> 513), a second pass updates 0, and all 27 user-typed rows survive.

Two measurement mistakes are worth recording, because both produced confident wrong numbers. The
SAP field is `data->'shipment'->>'ata_vessel_completed_discharge'`, not a raw Excel column name -
testing the raw names returned a meaningless "491 of 491". And the service reads
`ata_discharging_completed_at_discharge_port` first, which exists on **none** of the 27,003 rows,
so that arm is dead code.

Loading-port rows (sequences 1-3) read different SAP keys and may carry the same legacy problem.
Deliberately left alone so this change can be verified on its own.

### The edit form looked up the sibling STO's SAP row

Two shipments can hang off ONE contract row. PO 1001029907 carries STOs 1006019385 and 1006019867,
and the contract's `sto_number` is 1006019385 for both. The edit payload resolved which SAP row to
read with `TRIM(COALESCE($2, c.sto_number, s.operation_id, s.shipment_id))` - the contract's value
ahead of the shipment's own - so opening 1006019867 without a `?sto=` hint fetched STO 1006019385's
SAP row and showed its ATA/ATC chips on a STO SAP leaves NULL.

A second, independent defect made it worse: the row filter ORed in
`spd.contract_number = c.contract_id` unguarded, so even when nothing matched the STO the
`ORDER BY spd.created_at DESC LIMIT 1` handed back the newest row of the whole PO - again a
sibling's.

Reproduced on dev before changing anything, by driving the same query per shipment:

```
1006019867  hint=(none)       -> SAP row of STO 1006019385  ATC=8/13/26   <- bug
1006019867  hint=1006019867   -> SAP row of STO 1006019867  ATC=NULL
```

`sqlShipmentOwnStoKey` now leads with the shipment's own numeric STO, mirroring what
`shipmentListStoKeyExpr` already did for the list, and `sqlSapRowScopeForShipment` makes a row
belonging to a *different* STO ineligible outright. Header rows - SAP's PO-level rows with no STO,
which are the only source where SAP never itemised a STO - stay eligible, because their effective
STO is NULL and so can never be mistaken for a sibling's. Verified through the real service
afterwards: 1006019867 returns NULL while 1006019385 keeps its 2026-08-13.

Not to be confused with the PO-count mismatch reported alongside it (view table 6, edit modal 4).
That one does **not** reproduce on dev: both STO keys resolve to 1006019867 there, and all four PO
sources - `contract_stos`, `shipments.shipment_id`, user assignments and SAP's own PO/STO pairs -
return the same five POs. Whatever splits them in production is data, not a key divergence;
`docs/scripts/diag-atc-per-sto.sh` prints each source separately so the extra POs get named.

### Backlog rows carry a contract id, so they must never open a shipment-by-id screen

The Shipments list is a union of two different things. Execution rows are real `shipments`
records. Backlog rows are open POs that have no shipment yet, and `shipmentUnplannedHybridSql`
emits them as `c.id::text AS id` alongside `'contract_backlog'::text AS row_kind` - the `id` is
the CONTRACT's uuid, because there is nothing else it could be.

Both View and Edit passed that `id` straight to `GET /api/shipments/:id`, which looks it up in
`shipments.id` and answers **404**. Only one narrow case was guarded (read-only AND Cancelled, which
opened Contract Details), so every other backlog row failed. Users saw `Failed to load shipment
for edit`.

`resolveShipmentRowOpenTarget` now decides this in one place, and a backlog row never reaches a
shipment-by-id screen: View opens Contract Details, Edit opens Add New Shipment with the contract
prefilled - which is what clicking a row that has no shipment should do. Permission is then
checked by the add handler, the correct gate, since the action really is a create.

Status is deliberately ignored for backlog rows. The backlog SQL promotes low-OS rows to
`COMPLETED`, and `handleOpenAddShipmentForContractRow` routes anything with registered planning
back to the edit modal - so without a second guard a COMPLETED backlog row would have bounced
between the two handlers forever once Edit began delegating to Add. That guard is the reason the
delegation is safe, not an optimisation.

## User Region/Site scope

### The picker showed the right list and the save path threw the answer away

A user scoped to Region/Plant **Bontang** opened Shipments and some of their contracts were simply
absent; picking the region by hand found them. The suspicion - that the default carried the plant
dimension - was right, and measuring it showed the fault was bigger than the symptom.

The Users page picker has **always** listed SAP Discharge Destination: it reads
`/contracts/filter-options/group-plants`, which is `REGION_SITE_FILTER_OPTIONS_SQL`, the same list
the Region/Site dropdown on Shipments uses. `syncUserPlants` then looked that choice up in
`master_plants.group_plant` so it could store a foreign key - and those are two dimensions that
share **4 labels out of 14**:

| `group_plant` | plants | exists as a discharge destination? |
| --- | --- | --- |
| Bekasi, Bontang, Karawang, Tanjung Pura | 27 | yes |
| Bulking Lubuk Gaung | 8 | no - SAP says `LUBUK GAUNG` (3,251 rows) |
| EOP Tj Morawa | 3 | no - `TANJUNG MORAWA` (2,030) |
| Cisadane | 4 | no - `TANGERANG` (708) |
| Bulking Kumai / Batam / Palembang / Belawan | 11 | no - `KUMAI`, `BATAM`, `PALEMBANG`, `BELAWAN` |
| Bulking Sintang | 2 | no - its plants have no SAP rows at all |
| Trading | 20 | no - spread across 8+ destinations |

So an admin picking `LUBUK GAUNG` had it **silently dropped** - the only trace was a `logger.warn` -
and that user opened Shipments scoped to nothing at all. The four that did match stored the
plant-dimension spelling, which then filtered by destination and hid real work: Bontang's plants
also ship to `MERAUKE` (15 rows), `TRADING TRANSIT HO` (2) and `KUMAI` (1), and none of it showed.
That is the reported symptom, and it was the smaller half of the defect.

**Nothing is looked up any more.** `user_region_sites` (migration 177) stores the text that was
picked, and every page filters by that same text. The mapping table this could have needed does not
exist, because the question it would answer is one the data already answers - the derivation from
SAP `Plant Code` -> `master_plants.plant_code` is what produced the table above, including
`Cisadane -> TANGERANG`, which nobody could have guessed.

**Not backfilled** (Ryan, 2026-09-18). The scope is a default filter and an alert scope, not an
access boundary - no page query enforces it server-side - so starting empty widens what people see
rather than locking anyone out, and every stored assignment came from the wrong dimension anyway.
Admins re-assign from the picker, which was always showing the right list. The legacy `users.plant`
fallback is removed for the same reason, in both `enrichUserRow` and `fetchUserScopeAssociations`:
consulting it when Region/Site is empty would restore the retired dimension exactly when an admin
had deliberately cleared someone.

**The second consumer had to move in the same change.** `missingEtaAlertScopeSql` compared the
user's labels against `groupPlantExpr('c.plant_code', ...)`, which was consistent only while the
stored scope came from there too. Left behind, it would have matched nothing and Staff would have
stopped receiving missing-ETA alerts with no error anywhere. It now uses
`sqlRegionSiteRawForContract`, the same expression the pages use, and its test asserts the plant
dimension does **not** come back.

## Shipping Performance

### Shipping Performance counts the unplanned contracts too

Outstanding Qty means two different things on two pages. The Shipments OS is two disjoint arms -
execution (a contract with a live shipment) and backlog (a contract without one). Shipping
Performance is built from shipments, so it only ever had the first.

That was never decided; it follows from where each page started. But one label with two meanings is
a defect however it arose, and it cost a day of investigation: CPO / Bontang read 49,107 MT against
80,939 MT, and almost all of the gap was backlog - 156 contracts, 126,011 MT in that slice alone.

**The decision (Ryan, 2026-09-18):** Shipping Performance counts them, and shows them **as rows**
with status **UNPLANNED**, so the figure can be traced rather than only reconciled.

**The design, and the one hazard that must not be missed:**

- Membership comes from `contractBacklogCoreWhereSql` - the SAME function the Shipments page uses,
  not a copy of its criteria. Its own comments establish that the arm is disjoint from execution,
  which is what makes adding it safe. A rewritten copy would agree today and drift later, exactly
  as three write paths drifted into invalidating different caches.
- It belongs **inside** `buildShippingPerformanceSql`, which already has `latest_spd_contract` as a
  CTE and already joins it as `l` - the alias that function needs. Every attempt to run it from a
  standalone script failed with 42P01: these builders are fragments of one query, not functions
  that stand alone.
- **The hazard:** Section 1's delay figures are `sum / rowCount`. A backlog contract has no vessel
  and no dates, so counting it in that denominator would shrink every average simply because
  something has not been planned yet - degrading the metric the page exists for, silently. The
  outstanding total must span all rows; the averages and Total Vessels must span only rows with a
  voyage.

**Verification:** the outstanding rises by exactly the backlog figure, every average delay is unchanged to the decimal, and Total Vessels is unchanged.

**It shipped broken once, and the reason is worth keeping.** There are TWO CTEs named
`latest_spd_contract` in this codebase: `shipment.controller.ts` projects the `_raw` columns
(`b2b_flag_raw`, `contract_reference_po_raw`, …) and `shippingPerformance.service.ts` projects the
same values without the suffix. `contractBacklogCoreWhereSql` was written against the first, and
its only other caller joins the first. The arm was handed the second - a name that matched and a
shape that did not - and production answered `column l.b2b_flag_raw does not exist`. Because the
query sat in the cache refresh unguarded, that took the whole page down rather than one arm, and
it was reverted within minutes.

Five unit tests were green throughout, every one asserting on the SQL **string**. A correct string
proves nothing about whether the query runs. The suite now executes it, and the refresh wraps the
arm in try/catch so a failure costs the backlog rows and nothing else.

**Built as a second query, not a UNION.** The main query takes ~52s cold and has OOMed the
database before now, and this arm needs none of its vessel machinery. Joining the two rowsets in
memory also keeps the backlog out of the STO grouping - those contracts have no STO, so grouping
them by STO key would collapse every one of them into a single row.

`latest_spd_contract` moved to module scope so both queries share one definition rather than
carrying a copy each.

**Then it shipped again, correct, and the number still did not move.** The drilldown kept reading
49,107 MT. The backend was right - the rows existed, the totals were right, the query ran - and the
page threw every one of them away in its first line:

```ts
// frontend/src/app/shipping-performance/page.tsx - "Step A", the base of Sections 1-3
const baseFilteredRows = materializeFlowRates(excludeUnplannedShippingRows(rows))
```

Two different things share the status `UNPLANNED`, and one rule was covering both:

| | what it is | on this page |
| --- | --- | --- |
| UNPLANNED **shipment** | a shipment record not yet scheduled | excluded, as it always was |
| **backlog** row | a contract with outstanding and no shipment to schedule | kept |

The base filter now keeps a row that the backend **marked** `is_unplanned_backlog`, and is never
allowed to infer that from the status - the flag is the backend's statement, the status is a
coincidence of spelling. `frontend/src/lib/shippingPerfUnplannedBase.test.ts` pins both halves.

The frontend keeps its own copy of the summary (`buildCardSummary`), so the same split the backend
makes had to be made there too: outstanding over all rows, vessel count and averages over rows with
a voyage. `buildPerVesselSummary` also stopped returning `EMPTY_SUMMARY` when `rowCount` is zero -
a site where nothing has been planned yet has a real backlog, and reporting it as zero is the same
class of error in miniature.

**Backlog counts as Open (Ryan, 2026-09-18).** A contract with outstanding and no shipment is open
work, so it sits on the **On Going** card and passes the table's **Open** toggle - never on Close,
which would claim a shipment finished when there is no shipment at all.

The two were widened **together**, and that is the constraint to preserve: `shippingPerfRowMatchesCard`
and `matchesTableStatusFilter` decide the same question on two surfaces, so widening one alone would
let a card and the table beneath it report different memberships for the same rows.
`matchesTableStatusFilter` therefore takes the **row**, not the status string - `OPEN_TABLE_STATUSES`
lists shipment execution stages and `UNPLANNED` is legitimately not one of them, so Open is decided
by the flag first and the stage list second.

`shippingPerfRowIsUnplannedBacklog` in `shippingPerformanceCardFilter.ts` is the single definition
all three surfaces import - the base filter, the cards and the toggle. An earlier pass had a second
copy inside `page.tsx`; two spellings of one rule is how the three cache-invalidation paths drifted.

The averages are still safe: `buildCardSummary` excludes backlog from `voyageRows`, so the On Going
card's delay figures and vessel count span only rows with a voyage even though its outstanding and
contract count span the backlog too.

`c.source_type` is projected on the backlog rows for the same reason - the Source toggle (Interco /
3rd Party) filters on it, and a missing column would have silently dropped every backlog row again,
from a different place.

### Region/Site: the alias was already there; the stored reads were not

Shipping Performance was written up here as showing the **raw** discharge destination against
Shipments' normalised one. That was wrong, and checking the data rather than repeating the claim is
what caught it - `contract_latest_spd_snapshot` holds **0** KIJING rows against 6,032 TANJUNG PURA,
and `b2b_ending_child_snapshot` holds 0 against 70. Both CTE branches of `latest_spd_contract`
compute through `sapDischargeDestinationFromJson`, which wraps the map, and migration 161's backfill
is that same expression compiled.

What was real is narrower. The rule in `dischargeDestinationAlias.ts` is that the map applies at the
JSON extraction point **and at every read of a stored copy**. This page read two stored copies raw:

| read | before | now |
| --- | --- | --- |
| `b2b_end.discharge_destination` (main query) | raw | normalised |
| `l.discharge_destination` (backlog arm, from the snapshot column) | raw | normalised |
| `sa.discharge_destination`, `l.discharge_destination` (main query) | already normalised | left alone |

The last row is a cost decision, not an oversight. The alias compiles to a `CASE` that reads its
input **twice**, and `latest_spd_contract` is `NOT MATERIALIZED` - so an inlined
`l.discharge_destination` is a jsonb extraction, and doubling those is exactly what took Contract
Performance 1,360ms -> 3,342ms. The two stored-column reads are plain columns, so doubling them is
free. `shippingPerfDischargeAlias.test.ts` pins all three, and EXPLAINs the real query rather than
only asserting on its text.

### The last 161 MT: one finished voyage marks its whole STO group finished

Named, verified, and NOT fixed - the first fix made it worse, and the reason is worth keeping.

Three contracts are priced by Shipments and never by Shipping Performance:

```
1004030359  CIF  3,003 MT     own STO MNL-37125720-...  status PLANNED  own ATC NULL
1004029445  FOB    259 MT     own STO 1006019867        status PLANNED  own ATC NULL
1004031792  CIF     12 MT     own STO 1006020003        status PLANNED  own ATC NULL
```

Their own shipments are PLANNED with no discharge ATC at all, yet this page shows their rows as
COMPLETED - because `aggregateShippingPerformanceRowsBySto` MAX-merges milestones across the STO
group, and a *sibling* shipment in that group has an ATC.

**Shipments already solved exactly this**, and its comment names the same STO:

> the plain column is a MAX over the whole STO group ... a finished voyage can mark a group of
> still-planned shipments as COMPLETED ... only the OS buckets use the narrowed one.
> "STO 1006019867 cost 3 contracts / 2,700 MT"

So Shipments keeps the group-wide value for the list and uses
`ata_vessel_complete_discharge_own_sto` for OS. This page has one status serving both.

**Why the obvious fix failed.** Deciding the stage from the pre-merge rows and rescuing those
contracts moved the CPO/BONTANG total **down**, 103,545 -> 103,142 MT on dev. The rescue awards the
contract to the merged row it belongs to - and that row is COMPLETED, so the On Going card filters
it straight back out. The outstanding moved somewhere nothing counts.

**The fix: `os_status`, a second stage on the row.** `status` stays the group-wide value and the
table still shows it. `os_status` is derived from the milestones of the rows whose OWN STO is the
group's, and it is what the aggregates and the **cards** read - both, because putting a contract's
outstanding on a row the Close card then swallows is exactly how the first attempt moved the total
DOWN.

Two mistakes inside this change, both caught by measurement rather than reading:

| | |
| --- | --- |
| filtered with `shippingPerfStoGroupKey(row) === groupKey` | vacuous - every row in a group has that key by construction, so it matched everything and changed nothing |
| spread the own-STO milestones over `merged` | `maxMergeMilestoneFields` only writes fields it found a value for, so the foreign row's ATC survived. The milestones are cleared first now |

**`import_status` had to be narrowed too, and it matters more than the milestones.**
`deriveShipmentStatus` tests it FIRST, before any ATA, so a group-aggregated `Close` makes a row
COMPLETED whatever its dates say. Measured: **289 of 844** COMPLETED rows carry no ATA at all -
`Close` alone did it. Narrowing only the milestones therefore changed nothing on production, and
that is how this was found: the page did not move after the first version shipped.

**15 of 887** groups on dev take their `Close` solely from a foreign-STO row; those are the ones
the narrowing releases, and only for OS and card membership. Rows differing on `os_status` went
from 2 to 17.

**Narrowing applies only inside a real STO group** (`sto:`), and that bound was learned the
expensive way. An `op:` group has no STO for a row to be foreign to, so comparing a KLIP shipment
id against an operation id marked **every** row foreign, cleared every milestone and rescued the
whole group. Production went from 161 MT **under** Shipments to **2,841 MT over** - almost exactly
contract 1004030359 (own STO `MNL-37125720-1004030359`, an `op:` group) at 3,003 MT. Same exception
`buildShipmentListAtaSelectSql` makes: a row with no STO of its own has no other group to belong
to, so it stays counted.

**Dev cannot demonstrate the effect**, and that is worth stating rather than hiding: the mechanism
fires on **39 of 887** groups there and **2** rows end up with a different `os_status`, but none of
them sit in CPO / BONTANG, so the slice total is unchanged on dev. The three contracts are on
production. Unit tests build the shape directly instead of relying on data that happens to exist.

The narrowing can only make a stage EARLIER - fewer milestones, never more - so it can restore
outstanding that was wrongly dropped and can never invent any.

### Contract Qty read 0 for a contract that has one

Reported while chasing the last 161 MT, and bigger than what was being chased: **9194100035**, a
B2B parent of child PO 9191000035 holding **3,000 MT**, displayed **Contract Qty 0 MT**.

It was first written up here as dirty data. It is not. `sqlContractExecutionOutstandingKgExpr`
reads that contract at 3,000 MT correctly - only the ROW's `contract_qty` was zero, because it
came from `COALESCE(sm.contract_qty, 0)` and `sto_metrics` is keyed by **STO**. A B2B parent has
no STO of its own; the child carries it, while this page deliberately shows the parent. The key
misses, and the fallback said zero.

Measured before touching it: **40 rows of 887, whose contracts hold 108,970 MT, all shown as 0** -
against a 161 MT reconciliation gap.

`COALESCE(sm.contract_qty, c.quantity_ordered, 0)`. Preferring `sm` is right whenever it exists,
because it SUMs over the PO's contracts; when it does not exist there is no STO to sum over, so
the contract's own quantity is the only sensible value. Zero rows remain.

**It does not touch outstanding** - the aggregates read `outstanding_qty_aggregate`, which the
contract-grain correction fills. It does change the **By Vessel** contract-qty column, which sums
this field: that total rises, and the rise is the correction.

### Is the OS calculation the same on all four pages? Mostly - and where it is not

Asked directly (Ryan, 2026-09-21) of Contract Performance, Shipping Performance, Shipments and
Trucking. Checked rather than assumed, and the answer is better than expected in one way and worse
in another.

**The formula is already shared.** All four reach `sqlContractGlobalOutstandingExpr`. There is one
definition of "ordered minus delivered, clamped at zero", and nobody has a private copy.

**The arguments are not.** The incoterm decides which delivery column the quantity is read from -
trucking or vessel - and each page spells it differently:

| page | `incotermExpr` |
| --- | --- |
| Contract Performance | `contractEffectiveIncotermExpr` - the contract's, falling back to the latest SAP row |
| Shipments (execution) | the contract's own, falling back to the STO group's |
| Trucking | `c.incoterm`, the raw column alone |
| Shipping Performance | the contract's own, no fallback |

**Measured: 0 contracts** where the own incoterm differs from the effective one. So this is latent,
not live - it costs nothing today and will cost something the first time SAP carries an incoterm
the contract row does not. Worth collapsing onto one expression, not worth a rushed change.

**The gate I first reported was not a live difference - the measurement was wrong.** Shipments and
Shipping Performance zero a contract whose own GR says Close (`sqlIsContractSapClosedExpr`).
Contract Performance uses that expression only as a status *filter*. From that I reported "50
contracts, 9,485 MT valued by one page and zeroed by two". That number came from
`diag-cross-page-invariants.cjs`, which calls `parseLatePerformanceFilters` with **no status**, so
it summed Contract Performance's Open **and** Close rows and compared them with Shipping
Performance's On Going. Not a comparison of like with like.

The Open card never contained those contracts in the first place:
`sqlContractImportStatusIsOpenExpr` requires `import_status IN ('OPEN', 'ACTIVE')`, so a SAP-Close
contract is already out. The gate is real in the code and aligned in effect. Corrected 2026-09-22.

**The clamp is a real difference in the code, and latent in the data.** Contract Performance's
`outstanding_quantity` is built by `sqlContractOutstandingSignedExpr`; Shipments and Shipping
Performance use `sqlContractGlobalOutstandingExpr`. Both are the same function,
`sqlContractOutstandingFromFields`, differing by one flag - `clampAtZero`. Over-delivery therefore
*subtracts* on Contract Performance and contributes 0 on the other two. Measured on the dev copy
(CPO / BONTANG / YTD, sea): **240 MT across 59 over-delivered contracts** - and **none of them
reached the Open card**, because an over-delivered contract is Close and the Open filter had
already dropped it. Live in the table column, latent in the card.

### Which contracts actually disagree - measured per contract, not reasoned from totals

`docs/scripts/diag-os-per-contract.cjs`. On the dev copy (CPO / BONTANG / YTD) 77 contracts carry
Open outstanding and **exactly three** disagree:

| contract | Contract Performance | Shipping Performance | why |
| --- | --- | --- | --- |
| 9194100034 | 3,200 MT Open | 0 | B2B **parent** - no shipment is raised against it |
| 9334100045 | 1,800 MT Open | 0 | B2B parent, same shape |
| 1004031937 | absent | 500 MT | a **POME** contract counted inside a CPO scope |

Neither is an arithmetic fault, and that is the point: both are questions about what *should*
count.

1. **B2B parents.** The parent carries the quantity; the movement happens on the child PO, so
   Shipping Performance and Shipments never see the parent. Contract Performance counts it. Nothing
   is double counted today - the other two simply cannot see it.
2. **Product and site follow the ROW, not the contract.** `applyContractGrainOutstanding` places a
   contract's whole outstanding on the row carrying its furthest active stage, and the drilldown
   then filters by that **row's** product and region/site. A contract whose own product is POME can
   therefore be counted under CPO. Contract grain placed on a row grain, filtered at row grain.

The direction of the gap differs between environments - on dev Contract Performance reads *higher*,
on production 2026-09-22 it reads *lower* (80,413 vs 81,414 MT) - so the dev composition must not be
carried over. Run the script where the question is being asked.

### B2B: which side of the family carries outstanding, decided from the data

Asked by Ryan on 2026-09-22, with a warning attached: B2B doubling is how outstanding ballooned
here before, which is why each page picks one side rather than summing both. His rule: take the PO
parent, and fall back to the B2B child when the parent is null.

`docs/scripts/diag-b2b-policy.cjs` classifies every pair by who holds the VALUE and who holds the
LINK. Over all 566 pairs on the dev copy, two absolutes:

| | |
| --- | --- |
| parents holding an sto / shipment link of their own | **0 of 566** |
| parents with no `contract_qty_move_snapshot` row | **0 of 566** |

So the value is always on the parent and the movement is always on the child. Only one policy
covers both: **keep the child's row as the carrier, value and attribute it under the parent.**

**The trap is case C**, 49 pairs and 17,402 MT: the parent is fully delivered (4,500 delivered,
4,500 received) and the child is an empty SAP duplicate (0 / 0) still showing its whole quantity.
A guard that falls back to the child "when the parent has no outstanding" inflates outstanding by
all of it. The first version of `applyB2bParentPreference` did exactly that. **Zero is not null** -
the fallback now keys on whether the parent has a `qty_move` row at all, and none of the 566 lack
one, so the child is never the source today.

**Where each page stood, checked rather than assumed:**

| page | B2B handling | verdict |
| --- | --- | --- |
| Contract Performance | excludes children, values the parent | already correct |
| Shipments | `sqlShipmentListB2bOriginContractJoins` remaps the child's shipment to the origin (`c.id = COALESCE(c_origin.id, c_link.id)`) | already correct |
| Shipping Performance | relabels the child row to the origin in the main query, then **threw it away at the STO merge** | the only one wrong |

An earlier note in this work claimed Shipments drops B2B children and would need the same change.
That was read off the comment above its exclusion clause without following the join: `c` there is
ALREADY the origin, so the clause tests the origin, not the child. Verified against the builder -
shipments on children 1004030568, 1004031407 and 1004030594 are attributed to origins 9194100034,
9194100035 and 9334100045. Shipments needs no change, and fixing Shipping Performance moves it
INTO agreement with the other two rather than away from them.

### The 1,001 MT between Shipping Performance and Contract Performance: one contract

Measured against a **copy of production** (dumped 2026-09-22, restored locally), because dev and
production disagreed on the direction of this gap and dev had already sent two conclusions the
wrong way.

| | script, production copy | the screen |
| --- | --- | --- |
| Contract Performance (Open) | 80,413.2 MT | 80,413 MT |
| Shipping Performance | 81,413.9 MT | 81,414 MT |
| difference | 1,000.7 MT | 1,001 MT |

`diag-os-per-contract.cjs` named it: **one contract, 1004032347, 1,000 MT.** Not B2B, not the
clamp, not the SAP-closed gate - all three of which had been proposed and measured away.

**Region/Site is the agreed reference, and this page was the only one not applying it.**
`loadLatePerformanceRows` ends with `.filter(hasResolvedRegionSite)`, so Contract Performance drops
every contract whose SAP discharge destination is blank; Shipments applies the same test through
`requireResolvedRegionSite`. Shipping Performance did not. The rule's own comment in
`regionSiteSql.ts` names this exact contract, so the gap was documented before it was found again.

It reaches a BONTANG-filtered scope at all because outstanding is **contract** grain while the
drilldown filters at **row** grain: 1004032347's own site is blank, but its outstanding is placed on
the row carrying its furthest active stage, and that row's site is BONTANG.

Both arms of Shipping Performance now require a resolved Region/Site - the contract-grain execution
arm and the backlog arm, since an unresolved site is no more countable in one than the other.
Re-measured on the same production copy: **1,000.7 MT -> 0.7 MT, and no contract differs by more
than 1 MT.**

**What is left, and it is a different fault.** On the dev copy a 500 MT residual remains: contract
1004031937 is a **POME** contract counted inside a **CPO** scope. Its site resolves, so the fix
above does not touch it. Same root shape as the site case - contract-grain outstanding placed on a
row, then filtered by that row's attributes - but through product rather than site. It does not
appear in the production slice measured here.

### One check that asks whether the pages still agree

`docs/scripts/diag-cross-page-invariants.cjs`. Run it **before** a deploy that touches
outstanding, not after.

Every discrepancy in these sections had one shape - one rule with two spellings - and the cost was
never the first page. Closing Shipping Performance against Shipments left Shipments no longer
agreeing with Contract Performance, and that only surfaced when someone opened the third page days
later.

It calls the pages' **own entry points**: `runShippingPerformance` and `loadLatePerformanceRows`.
Copying a page's query to measure it has produced a confidently wrong answer four times here - the
backlog formula standing in for the execution one (5,162 MT against a real 1,661), an even split
of a merged row across its contracts, "has a shipment" standing in for "is at an active stage",
and a group key compared against itself.

| | |
| --- | --- |
| **Invariant 1** | Shipping Performance backlog == Shipments Unplanned + Preplanned. Both call `contractBacklogCoreWhereSql`, so a difference can only be scope or period, never a rule. **Dev: 0 MT** |
| **Invariant 2** | Shipping Performance == Contract Performance, the agreed reference |
| **Invariant 3** | Shipments, which it says plainly it cannot prove: `loadShipmentOutstandingQtyForRequest` needs the `shipmentBaseCteSql` the controller assembles. That figure is read off the page, and the script prints what it should equal |

**Its first run found its own fault**, which is the standard to keep: comparing the two pages whole
reported 75,477 MT of "drift" that was simply trucking, because Contract Performance covers every
incoterm and Shipping Performance covers CIF/CFR/FOB. The scopes are matched with the page's own
`isShipmentPageSeaIncoterm` rather than a list written out again. A check that cries wolf gets
ignored, and an ignored check is worse than none.

### The correction took the page down, and try/catch could not have stopped it

`/api/shipments/performance` stopped answering on production. The logs show the request logged
with no status and no size, over and over as the browser retried, while **`pg_stat_activity` was
empty** - the database idle and every other endpoint still serving 304s. A restart did not clear
it; a fresh container reproduced it.

That shape is not a slow query. It is a promise that never settles: the contract-grain correction
stopped returning, so `ROW_CACHE` was never filled, `refreshInFlight` never resolved, and every
later request queued behind it forever.

**The guard was the wrong kind.** The correction was wrapped in try/catch, copied from the backlog
arm, and try/catch catches a *rejection*. Nothing catches an await that never comes back.

Three changes, and the order of the first one is the point:

| | |
| --- | --- |
| **cache first** | the rows are put in `ROW_CACHE` **before** the correction runs, and the correction mutates that array in place. The worst case is a page showing per-STO shares, never a page showing nothing |
| **timeout** | `withRefreshTimeout` bounds anything optional inside the refresh. A hang now costs the correction, which is what the try/catch was always meant to guarantee |
| **chunked** | the real cause |

**The real cause, measured:** every contract on the page went into one query - **1,861 ids** spliced
into the `qty_move` CTE *and* the outer `WHERE`, around an expression that is itself two correlated
subqueries per row. Chunked at 400 the same work takes **1.7 seconds**.

And one more that only running it could find: `SET LOCAL statement_timeout = ...; WITH ...` fails
with *"cannot insert multiple commands into a prepared statement"* - the SELECT takes a parameter,
so it uses the extended protocol, which allows one command. It is set on its own statement on a
dedicated client now, and reset before the connection returns to the pool.

**What actually went wrong in how this was worked.** The change was validated with unit tests and
with scripts that call the builders. Neither calls the endpoint. A green unit test proves the rule
is right; it says nothing about whether the request finishes. Every change to the refresh path is
now checked by calling `runShippingPerformance` for all three parts and watching it resolve -
which is how both faults above were caught before the second deploy.

### Closing the last 2%: the aggregates count the contract

Chosen after the first plan was measured and abandoned, which is the part worth keeping.

**The plan that failed.** A remainder row per contract - contract outstanding minus what its
in-scope STOs carry - needed each row's outstanding split across the contracts it carries, and a
merged STO row can carry several. Every split is an invention. A diagnosis that divided evenly
produced ten contracts "over-counted" by the same few values (684, 634, 3,833 MT) - the even split
showing through, not the data. A remainder computed against an invented split moves the
arbitrariness instead of removing it.

Two earlier explanations died the same way and are worth recording:

| claim | how it died |
| --- | --- |
| the shortfall is 5,162 MT | one-sided. Both directions exist and net off |
| the 5,162 is wrong because the diagnosis used the backlog formula | swapping in the execution expression changed nothing; the two agree |

**What shipped instead.** Each contract's outstanding, valued by
`sqlContractExecutionOutstandingKgExpr` - the execution arm's own rule, lifted unchanged - is
placed **whole** on the one row carrying its furthest active stage, the rule Shipments already
applies. Every contract lands on exactly one row, so the total equals Shipments by construction,
the drilldown stays additive, and nothing is apportioned.

Only `outstanding_qty_aggregate` is rewritten - the field that means "the value to use in
aggregates". `outstanding_qty` is untouched, so the view table still shows each STO's own
outstanding.

`shipmentActiveStageRank.ts` defines the ranks **once** and renders them to both SQL and
TypeScript. Shipments applies the rule in SQL; this page has to apply the identical rule in TS.
That is the one case in this codebase where a copy is unavoidable, so it is generated rather than
written.

Measured end to end on dev: On Going CPO/BONTANG **101,369 -> 103,545 MT, +2,176** - exactly the
net the per-contract comparison had measured, which is the check that the implementation
reproduces the diagnosis rather than merely moving in its direction.

Guarded like the backlog arm: a failure costs the correction, not the page.

### Where the CPO / Bontang gap actually went, and what the last 2% is

Reported 2026-09-18 as Shipping Performance 49,107 MT against Shipments 80,939. Closed by
measurement, in this order - each step found by measuring rather than by reasoning from the total,
which produced four wrong explanations along the way:

| | gap |
| --- | --- |
| reported | 31,832 MT |
| + the unplanned backlog arm | |
| + the page's Step A no longer discards it | |
| + Region/Site from the shared helper | |
| + the frontend aggregate rule matched to the backend's | **1,661 MT (2.0%)** |

**The residual is one difference, and it is structural.** Splitting by arm the way the Shipments
cards already do puts it in two stages and nowhere else:

| stage | Shipping Performance | Shipments | gap |
| --- | --- | --- | --- |
| backlog (Unplanned + Preplanned) | 28,019 MT | 28,019 MT | **0** |
| Planned | 36,500 (11 rows) | 36,500 (11) | **0** |
| At Loading Port | 2,800 (1) | 3,059 (1) | 259 |
| At Discharge Port group | 12,596 (8) | 13,997 (6) | 1,401 |

The backlog arm agrees to the MT because both pages call `contractBacklogCoreWhereSql` - the same
function, which is the whole argument for sharing rather than copying. Planned agrees because those
POs carry one STO each.

One shipment shows the rest: **MT. GIAT ARMADA 02**, Arrived LP, reads **2,800 MT** here and
**3,059 MT** on Shipments. Same shipment, two numbers, because Shipments takes the CONTRACT's
outstanding (`sqlShipmentExecutionOsPerContractCtes`, per contract, no division) while this page
takes the STO's share of it. **No filter can close that.** It closes only by choosing one grain,
and the two grains are each right for their own page: a contract-grain figure cannot be broken down
by vessel, and an STO-grain figure cannot be summed per contract without apportioning.

So 2% is where this stops being a defect and starts being a definition. Fixing it means deciding
that one page's grain wins everywhere, not finding another bug.

### Two files, one function name, two answers

`shippingPerformanceOutstandingAgg.ts` exists twice - `backend/src/utils/` and `frontend/src/lib/` -
exporting `shippingPerfOutstandingQtyKgForAggregate` from both. They drifted, and nothing caught
it because the name, the file name and the signature all matched.

```
backend   prefer outstanding_qty_aggregate, else outstanding_qty / po_sto_count
frontend  outstanding_qty / po_sto_count          <- never read the column at all
```

The backend's own comment already priced the fallback: it "understated every PO spanning fewer
STOs than the widest one by 5.76% (203,568,180 kg) over 728 STOs" and was "kept only for rows that
predate the column". The page ran it for **every** row, so every figure it drew - drilldown, cards,
By Vessel - was that understatement.

Found by measuring the screen against the builders rather than reasoning about either. Production,
CPO / BONTANG / YTD:

| | MT |
| --- | --- |
| drilldown on screen | 76,863 |
| the same rows through the backend rule | 79,914 |
| Shipments Outstanding Qty | 81,583 |

So most of what looked like a Shipping-Performance-versus-Shipments gap was Shipping Performance
disagreeing with its own backend. `shippingPerfAggParity.test.ts` pins the contract between the two
files.

**The generalisation worth keeping:** every discrepancy chased on 2026-09-18 and 09-21 had the same
shape - one rule with two spellings. The B2B child exclusion, the Region/Site chain, the per-STO
destination, and now this. When a rule has to hold in two places, share the expression or pin the
two against each other in a test; "equivalent today" is not a property that survives.

### Region/Site: one helper, evaluated once per contract

Shipping Performance kept its own spelling of Region/Site - a COALESCE over `b2b_end`, a
per-shipment SAP aggregate and the latest-SPD CTE. It was argued branch-for-branch equivalent to
`sqlRegionSiteRawForContract` and it measured as equivalent. **"Equivalent today" is how two
spellings of one rule drift**, and both drifts were found the same week: the per-shipment branch
filed five contracts under a destination their own SAP rows contradict, and the backlog arm shipped
with no B2B overlay at all, putting contract 9114100050 at TANJUNG PURA while every other surface
said BATAM.

Both arms now emit the **same expression** as `sqlRegionSiteDisplayForContract`, the one Shipments,
Trucking, Pipeline and both unplanned hybrids already call.
`shippingPerfRegionSiteShared.test.ts` asserts the expression itself, not that the SQL mentions a
column, so it cannot drift without failing.

**Where it is evaluated matters as much as which expression it is.** The helper is two correlated
subqueries, one of them ordering `sap_processed_data` per contract. Spliced into the row projection
it runs once per ROW for a value that only varies per CONTRACT:

| | dev, 2,213 rows |
| --- | --- |
| before (own chain) | ~52s |
| helper in the row projection | **96.8s** |
| helper in `perf_region_site AS MATERIALIZED`, joined | **55.5s** |

`MATERIALIZED` is explicit because Postgres inlines a single-reference CTE by default, which puts
the evaluation straight back per row. This is the same trap as the Contract Performance
1,360ms -> 3,342ms regression: the alias compiles to a `CASE` that reads its input twice, so where
you put it decides what it costs.

### One STO, two discharge destinations - a SAP anomaly, and the page that amplified it

Measuring the source divergence (`docs/scripts/diag-sp-vs-shipments-site.cjs`) found **6 contracts
of 2,027**, and reading the six is what turned a precedence question into a data finding. SAP gives
**one STO different discharge destinations depending on which contract carries it**:

```
STO 1016010337  ->  KARAWANG  on contracts 1014002659, 2897, 2932, 2933
                ->  BEKASI    on contracts 1014002893, 2909
STO 1016010372  ->  KARAWANG  on contracts 1014002924, 2935
                ->  BEKASI    on contract  1014002934
```

96 STOs database-wide are like this. Confirmed with Ryan 2026-09-18 as a SAP data defect - one STO
is one physical movement and can only discharge in one place - and raised with the SAP team. It is
**not** the blank-Contract-No class: 69 such rows exist and none of them touch these STOs.

**Shipping Performance amplified it, and the other nine surfaces did not.** Region/Site is contract
grain everywhere - `sqlRegionSiteRawForContract` on Shipments, Trucking, Pipeline and both unplanned
hybrids, `MAX(sqlRegionSiteRawFromJsonAndB2b)` on Contract Performance and Late Performance. This
page alone added a third source: a **per-shipment** SAP aggregate. Rows are then grouped by STO and
`mergeShippingPerfStoGroup` keeps one row's `plant_site`, so five contracts displayed a destination
their own SAP rows contradict.

The per-shipment source is removed, and its now-dead `MAX(...) AS discharge_destination` with it.
`plant_site` on both arms is now the same two branches in the same order as the shared helper:

```sql
COALESCE(normalise(b2b_end.discharge_destination), l.discharge_destination, 'Blank')
```

`l` stands in for the helper's "newest SAP row for this contract" - the same pick plus an
`spd.id DESC` tiebreaker the helper lacks. 2,382 contracts have tied `created_at`; measured, **none**
of them disagree on destination, so the two are equal on today's data and this side is the
deterministic one.

**The backlog arm shipped with no B2B overlay at all** - a defect introduced the same day, found by
this measurement rather than by a test. Contract 9114100050 has a B2B ending child at EUP EDIBLE OIL
BATAM, so the goods finish in Batam; the arm showed TANJUNG PURA, the origin's own destination,
while every other surface in KLIP showed Batam. It carried **2,000 MT - the only outstanding in the
entire divergence**.

| | before | after |
| --- | --- | --- |
| contracts disagreeing with Shipments | 6 | 5 |
| outstanding disagreeing | 2,000 MT | **0 MT** |

**Membership closed, measured after the arm and the frontend fix (CPO / BONTANG):**

| | before | after |
| --- | --- | --- |
| Shipping Performance outstanding | 54,126 MT | **107,234 MT** |
| contracts outside it that Shipments **would** count | (not asked) | **0 contracts, 0 MT** |
| contracts outside it that Shipments excludes too | - | 147 contracts, 142,372 MT |

`diag-sp-vs-shipments-os.js` had been answering the wrong question and reporting the answer as a
gap. It asked "which contracts have outstanding that Shipping Performance has no row for", which is
not "which contracts does Shipments count that Shipping Performance does not". It also predated the
backlog arm, so it counted 178 contracts / 185,958 MT as missing from a page that already showed
them. Both are fixed: it now runs **both** arms, and it splits what is left by
`contractBacklogCoreWhereSql` - the Shipments rule itself.

The 147 that remain all fail `sqlIsContractSapInactiveForShipmentBacklogExpr`, which sits inside
that rule, so **Shipments excludes them for the same reason** and nothing is diverging. Pinpointed
by evaluating the six conditions of the rule one at a time rather than reasoning about the total,
which had already produced two wrong explanations here.

**The remaining 5 are the SAP anomaly itself and cannot be fixed by a rule.** This page's row grain
is the STO; when one STO belongs to contracts SAP gives different destinations, one of them must
lose whatever the precedence. They carry 0 MT, they are display-only, and the diag script is the
watch on them - the fix is in SAP.


### A whole voyage could disappear when the B2B origin had no shipment

The page's row scope ended with an unconditional exclusion:

```sql
AND NOT (l.b2b_flag = 'B2B' AND l.contract_reference_po IS NOT NULL)
```

It drops B2B **child** contracts so their quantity is not counted twice beside the origin's. The
assumption is that the origin carries it. SAP puts the shipment on the **child**, and the origin
usually has none of its own - and a page built from shipments cannot show a contract without one.
Both halves therefore vanished, and the voyage with them.

**Measured on production, 2026-09-18** (`docs/scripts/diag-sp-vs-shipments-os.js`):

```
B2B child contracts with a shipment whose origin has none   220
shipments involved                                          231
distinct STOs                                                71
outstanding never shown                                   6,760 MT
```

The quantity is modest; the 71 voyages are not. This page computes average ETA-vs-ATA delay, and
those voyages - MT. GIAT ARMADA 02 with seven COMPLETED contracts among them, their actual dates
final - never reached a single average. The cost was to the metric the page exists for, not to the
outstanding column.

The exclusion is now conditional: a child is dropped **only when the origin actually has a
non-cancelled shipment** to carry it. Nothing that was already counted can be counted twice,
because the gate only withholds the drop where nothing else covers the row.

A kept child is shown under its **origin's** contract number, matching the choice already made for
Contract Details' Table List STO, so the two pages agree about whose contract a voyage belongs to.

**How this was found, because the route matters more than the answer:** CPO / Bontang read 49,107
MT on Shipping Performance against 80,939 MT on Shipments. Most of that gap is a definition
difference - 156 contracts with no shipment at all, which a shipments-derived page cannot show. The
residue was 14 contracts that did have a shipment. Two guesses about them were wrong (an FOB
trucking leg; SAP STO type T - production said all 14 were type V, real sea legs with real
vessels), and only splitting the residue again, into "the STO is missing" versus "the STO is there
but does not name this contract", exposed the clause above.


## SAP import

### SAP may now correct what SAP provably wrote

Two columns describe one field on `vessel_loading_ports`, maintained by opposite rules
(`vesselLoadingPortsFromSap.service.ts`):

```
value   mergeSapPortValue   if (hasCurrent) return current   - fill gaps only, keeps it forever
mirror  mergeSapSnapshot    no incoming value -> NULL        - reflects what SAP says now
```

One import in which SAP sends the port with a field blank nulls the mirror while the stale value
survives, and the row becomes indistinguishable from something a user typed. Migrations 169 and 170
proved SAP authorship by testing `value = mirror`; after such an import that test can never fire
again. Migration 173 exists for exactly that shape, and STO 1006019867 proves it recurs - 170
cleared it, and its mirror was NULL again with the value back.

**The measurement reframed the problem** (`docs/scripts/diag-sap-mirror-asymmetry.js`, production
2026-09-18):

```
values set                             10,684
  provably SAP  (value = mirror)       10,325   96.6%
  provably KLIP (klip_edited_fields)        5
  AMBIGUOUS     (mirror gone)             119    1.1%
```

The fill-gaps rule exists to protect what a user typed. Across the whole table there are **five**
such values. What it was actually doing was stopping SAP from correcting the 10,325 values SAP
itself wrote - which is how one wrong date becomes permanent, and why three migrations had to clear
them by hand.

The rule is now: when the stored value still equals the mirror, SAP wrote it and may write it
again, **including writing nothing to take it back**. Everything else is untouched.

- **Retraction is safe here** because `upsertVesselLoadingPortRow` runs once per port SAP actually
  sent. An empty incoming value means SAP sent this port and left the field blank, not that the STO
  was missing from the export - a partial export never reaches the function.
- **An explicit claim beats an inferred one.** A user's edit can coincidentally equal the mirror, so
  a field named in `klip_edited_fields` is never overwritten even when the values match.
- **"No evidence" is not "SAP's".** The 119 rows whose mirror has already gone stay exactly as they
  are. Treating an empty `klip_edited_fields` as "from SAP" is the inference migration 167 was
  written to end.

Migration **174** clears the four ambiguous rows that sit on shipments which have **not sailed** -
impossible rather than merely doubtful, the same test migration 173 used - and leaves the other
115. Dry-run it first (`docs/scripts/dryrun-migration-174.js`): the container entrypoint applies
migrations on start, so by the time the backend is up, 174 has already run.


## Shipments — cache and invalidation

### One door for invalidation, because a list of names drifts

Invalidation after a shipment write was a list of named caches, spelled out at each write path.
Measured across them:

```
createShipment.service.ts        Shipments  Shipping Performance  Contract Performance
shipmentAtaOverride.controller   Shipments  -                     -
ensureSapStoShipment.service     Shipments  -                     -
prePlanned.controller (x6)       Shipments  -                     -
```

So a refresh did run on every update, and it was a real one - it simply named a single page. The
other two kept serving cached rows until their TTL expired, which is why an edit showed on
Shipments at once and elsewhere minutes later. The sharpest case was the ATA override: the ATC it
writes is what Trade Cycle and Log Cycle are measured from, and Contract Performance was told
nothing at all.

Patching the nine call sites would have restored the invariant and kept the mechanism that lost it.
They now all call `invalidateAfterShipmentWrite` (`shipmentWriteInvalidation.service.ts`), so
adding a cache later means changing one function instead of finding every writer.

`shipmentIds` is optional because not every writer knows them - a pre-planned rebuild reshapes many
groups at once. The Contract Performance refresh is per-shipment and is skipped without them,
exactly as before, but visibly rather than by omission; the two cache invalidations always run. The
ATA override passes the whole STO group rather than the anchor the request named, because the
override fans out across all of it.

**This is the prerequisite for extending the Shipments TTL past 5 minutes.** A longer TTL is only
safe once every writer reliably clears every cache; before this, it would have made the stale
window longer on precisely the pages that were not being told.

## Trucking

### While GR is open, the weighbridge leads but does not get to hide SAP

Delivery and receive quantities resolve through `sqlTruckingResolvedDeliveryQty` /
`sqlTruckingResolvedReceiveQty` (`backend/src/utils/truckingQuantitySql.ts`). The rule was:

```
WHEN (has WB rows) AND NOT (GR closed) AND (wb sum) > 0  THEN wb sum
WHEN (GR closed)                                         THEN sap
ELSE COALESCE(sap, inner, 0)
```

so a single weighbridge ticket discarded SAP entirely for as long as GR stayed open. Contract
**1004031065** is what that costs: an LCO for 100 MT whose weighbridge holds two tickets totalling
**0.09 MT** while SAP reports **89.74 MT** received. Outstanding read **100 MT** - the whole
contract, as though nothing had moved - on an operation that was very nearly finished.

The first branch now takes `GREATEST(wb, COALESCE(sap, 0))`. The two systems record the same
trucks; neither is a correction of the other, so the one that is further along is the one that
describes where the cargo actually is. GREATEST can only raise a figure, so a weighbridge ahead of
SAP still wins - the normal case, and the reason WB leads at all. The GR-closed branch is
untouched: it already reads SAP, which is what closing GR means.

The same asymmetry ran through the dates. Contract Details' Table List STO read **WB only** for an
open operation's ATA/ATC and **SAP only** for a Completed one, so contract 1004030966's land leg
(`OP-LAND-110920264450`), which has no weighbridge upload at all, printed "-" under both columns
while Edit Trucking showed 28/02/2026 and 07/03/2026 one click away. `resolveStoListMilestoneDates`
now falls back to the other side in both directions - preference unchanged, blanks filled.

**A measurement that said the opposite, and why it was wrong.** The first version of
`docs/scripts/diag-wb-vs-sap.js` reported that this change would affect 0 of 286 contracts. It read
`contract_qty_move_snapshot` directly, but the application reads SAP through
`sqlSapQtyDeliveryOnly` / `sqlSapQtyReceiveOnly` - an *overlay*, live `sap_processed_data` first and
the snapshot only as a fallback. That snapshot is built for Close contracts and is empty for the
Open ones that are this question's entire scope, so SAP measured as 0 everywhere and could never
exceed WB. The conclusion was arithmetic on a column that was structurally blank. The rewritten
script composes the same expressions the pages compose; when a diagnostic and a screenshot
disagree, the screenshot is the evidence.

**The rule exists in two places, and both had to move.** The trucking resolvers are what the
Trucking page and Contract Details read. Contract Performance reads `qm.*` - the
`contract_qty_move_snapshot` table - whose builder (`contractGlobalOutstandingSql.ts`,
`qty_move_resolved`) carries its own copy of the same decision in three branches:

```
WHEN w.wb_delivery_qty_kg > 0 THEN w.wb_delivery_qty_kg
ELSE s.quantity_delivery_trucking
```

Changing only the resolvers moved the Trucking page and left Contract Performance showing contract
1364002000 at 100 MT outstanding on 89.74 MT received - which looks exactly like a failed deploy
and is not. Both copies now take GREATEST, and a test asserts the bare weighbridge preference is
gone from every branch of the snapshot builder.

Because it is a snapshot, the change is invisible on Contract Performance until it is rebuilt:
`docs/scripts/refresh-qty-move-snapshot.js`. The rebuild marks the snapshot stale first, so readers
fall back to the live path while it runs, then swaps in one transaction.

**The 499 kg tolerance was not the problem, and that is worth knowing.** Before this change the
obvious suspicion was that operations were finishing but not reaching COMPLETED -
`isTruckingPipelineCompleted` is "GR closed OR outstanding <= 499 kg", so a stuck status would hold
outstanding open. Measured in production over all 15,537 live operations
(`docs/scripts/diag-trucking-stuck-complete.js`): 9,841 sit inside the 499 kg band and **none** of
them fails to show Completed, with zero unknown outstanding quantities. The rule fires everywhere it
should. What was holding outstanding was the quantity itself, which is what GREATEST addresses: 58
operations fell, 8,922 MT released, 3 reached Complete. The other 55 are genuinely still outstanding
above the band.

### A fully delivered STO row could not say so

Contract Details' Table List STO printed rows reading "22 MT ordered / 22 MT delivered / 22 MT
received" and labelled them **Planned**. The status came from
`resolveContractLogisticsStoStatus`, which called `deriveTruckingEffectiveStatus` **without an
outstanding quantity**. `isTruckingPipelineCompleted` is "GR closed OR outstanding <= 499 kg", and
`isTruckingOutstandingWithinToleranceKg(undefined)` is `false` - so on an Open contract the
tolerance arm could never fire and no row could ever reach COMPLETED, however much of it had
arrived.

This is why the production sweep found zero stuck operations while the screen showed several: the
sweep measures at operation grain with the contract's outstanding quantity, and it was right. The
table is at STO grain and was passing nothing.

Each row is now judged on the quantities printed beside it, via `truckingRowOutstandingQtyKg` - the
JS mirror of `sqlTruckingOutstandingQtyByIncoterm`, so LCO measures delivery and FRC measures
receive, exactly as the SQL does. The zero guard is load-bearing: without it an STO whose quantity
is unknown computes 0 - 0 = 0, lands inside the tolerance band, and reports Completed on the
strength of knowing nothing.

### A B2B origin's Table List STO is no longer empty

SAP puts a B2B pair's STOs on the **child**, not the origin. Contract 1004028289 (PO 1001028289)
therefore has no `contract_stos` row, no `contracts.sto_number` and no SAP row carrying an STO
number - they all sit on child 1014002890 (STOs 1016010373 and 1016010384). Its Table List STO
read "No STO information for this contract" while the Table List PO (Child) directly below it
listed the child PO with 500 MT delivered and received, and the Quantity block already showed
Delivery Quantity 500 MT rolled up from that child. Only the STO side stayed blank.

`CONTRACT_STO_SCOPE_IDS_SQL` now defines, in one place, which contracts' STOs belong on one
contract's detail page: itself, plus the B2B children pointing at its PO. The controller's four
row laterals and the STO key gathering all scope to it, so the contract number on screen stays the
parent's while the rows come from the child.

**Three gates, all required**, and they are what make this safe to apply to every contract rather
than to a flagged list: the children are added only when the parent has no `contract_stos` row, no
`contracts.sto_number`, and no SAP row with an STO number. A contract that already has STOs of its
own can never start collecting its children's. The change fills a gap; it cannot reinterpret
anything that already worked.

Only the Contract Details modal reads this SQL - two call sites, both in `contract.controller.ts` -
so no list page or aggregate moves.

### A truck no longer reports that it arrived at a loading port

Contract Details lists shipments and trucking operations in one table and ran every row through the
**shipment** status map. The two vocabularies overlap on exactly one value and disagree about it:
`IN_PROGRESS` is "Arrived LP" to a vessel and "Planned" to a truck, so an LCO contract with a single
land leg read "Arrived LP" on a row labelled Trucking. The map now lives in
`frontend/src/lib/truckingStatusDisplay.ts` and the Trucking page reads it from there, so the two
cannot drift apart again.

### LCO and FOB: a closed PO with no GR STO line no longer hangs forever

LCO reads GR **STO** status, FRC/CIF/CFR read GR **PO** - that split lives in
`INCOTERM_GR_STO_STATUS` / `INCOTERM_GR_PO_STATUS` (`backend/src/utils/sapIncotermMetrics.ts`) and
is unchanged. What it did not cover is the case operations kept reporting: SAP closes the PO and
never writes a GR STO line at all.

For those contracts `sqlContractImportStatusExpr` produced **NULL** - not Open, not Close. The
per-row status is NULL (LCO reads GR STO, which is blank), the row-open signal is false, so the
aggregate's `WHERE st IS NOT NULL OR row_open` discards every row and the subquery returns nothing;
the commercial-`contracts.status` fallback is deliberately skipped for LCO/FOB. Trucking COMPLETED
is `isContractDeliveryClosed(status)`, and NULL is not closed, so those operations hung open
permanently. On dev: **282 LCO contracts, 343 trucking operations**.

The fix adds one arm to the `COALESCE`, after the B2B child lookup: for the GR-STO incoterms, when
every arm above yielded NULL, an unambiguous GR PO Close is accepted as the close signal.

**FOB was added afterwards**, on request, having been deliberately excluded at first because a sea
incoterm reaches the Shipments page and its OS rather than Trucking. That reach was then measured
rather than argued: 423 FOB contracts move NULL → Close, and of those exactly **one** has a
shipment at all - the same one that carries a KLIP qty overlay, which is the only place a Close can
move a quantity (qty_move's shipment overlay gates on `NOT grClosed`). Six have trucking
operations, and FOB is not in `INCOTERM_QTY_TRUCKING`, so their OS Qty is NULL either way and they
simply reach COMPLETED through the closed PO. Verified over all 18,751 contracts: 423 changed, all
FOB, `changed_from_nonnull = 0`; LCO, FRC, CIF and CFR unmoved.

Three properties make it safe rather than a behaviour change:

- **Purely additive.** `COALESCE` short-circuits, so the arm can only ever fill a NULL. Verified
  over all 18,751 contracts by rendering both expressions side by side: 282 values changed, all
  LCO, and `changed_from_nonnull = 0`. FRC (11,798), FOB (2,586), CIF and CFR: zero changes. The
  54 anomaly contracts the B2B child lookup already answered Close, the 3 it answered Open and the
  1 Cancelled delete-flag all keep their existing answer.
- **One-directional.** GR PO *Open* does not yield `'Open'`. That would pull a further ~218 LCO
  contracts out of NULL and change Open/Close list filters nobody asked to change. No signal in,
  NULL out, exactly as before.
- **OS Qty is untouched.** This was the real risk: `grClosed` flips the Delivery/Receive resolver
  (`sqlTruckingResolvedDeliveryQty`) from the WB branch to the SAP branch, so OS Qty *could* move.
  Measured across all 343 affected operations: **none has WB data**, so the branch switch never
  fires - 0 delivery-qty changes, and the count of operations outside the 499 kg OS band is 289
  before and 289 after. 289 operations reach COMPLETED through the new status; the other 54 were
  already COMPLETED via the OS tolerance band.

Blast radius is narrower than the expression's reach suggests: all 340 contracts already have a
trucking operation, so the unplanned-contract backlog (which counts contracts *without* one) is
unaffected, and none has a shipment, so the Shipments page is untouched. The visible change is the
Trucking list status and the status column on Contracts / Contract Performance.

Cost is nil. The new subquery runs only for contracts the earlier arms left NULL (~420 of 18,751,
2.2%) and reads the same latest-import, PO-matched, non-deleted rows through
`idx_sap_processed_data_contract`. Timed over all contracts: 15.48 s before, 15.47 s after; a
reversed-order re-run gave 26.1 s before and 20.8 s after, so the spread is machine noise, not the
arm. FOB is deliberately excluded - it sits on the sea leg and has its own logic.

### The backlog's outstanding qty is now stored, not recomputed: 39s -> 3.8s

One query was 35,078ms of a 39,226ms cold load - **89% of the page** - in a single 150KB statement
returning one row. It aggregates outstanding qty over the Unplanned contract backlog, and it is
expensive because per contract it expands the 26KB GR-status expression through the backlog
predicate *and* the cancelled check inside the outstanding expression.

The row **count** for that same backlog was already instant, for the one reason that matters: it is
stored in `trucking_pipeline_daily_summary` and read back by `loadTruckingBacklogCountFromSnapshot`.
Migration 171 gives the quantity the same treatment - `backlog_os_third_party_kg`,
`backlog_os_interco_kg`, `backlog_contract_qty_kg`. Only the source split needed columns: `incoterm`
is already a dimension of that table, so the card's FRC/LCO halves come from the existing grouping.

Written by the same builder over the same predicate, so this is that query's answer and not an
approximation - and verified as such before being wired in, because "same builder" is an argument
and a parity run is evidence:

```
live aggregate    34,493 ms   3rd=503,920  interco=0
snapshot read          7 ms   3rd=503,920  interco=0
```

Page cold load: **39,226ms -> 3,849ms**. The cost moves rather than vanishes - the daily refresh
does the work once - and it falls back to the live query whenever a global search, column filter,
contract filter or Region/Plant scope narrows the backlog in ways the summary's dimensions cannot
express.

**A regression this caused, and the lesson in it.** Adding `is_contract_os_within_band` to
`shipmentEffectiveStatusExpr` broke the *shipment* summary refresh outright - `column
f.is_contract_os_within_band does not exist` (42703) - because that refresh runs the same
expression over its own base CTE. The fix is to compute the flag there too, not to default it away:
the circle counts this table feeds are derived from that expression, so a defaulted-away column
would have let the cards disagree with the rows they count. Same shape as the `grc` alias-scope bug
that once emptied the whole Trucking page.

### Where the cold Trucking page's time goes

Measured 2026-09-10 through `resolveTruckingListForRequest`, default YTD view, fresh process so
every in-process cache is empty. **60,862 ms wall, 13 queries, 97,324 ms of database time** - more
DB time than wall time because several of them run concurrently:

| ms | query |
| --- | --- |
| 34,038 | status / OS summary (`WITH filtered AS ...`, 391 KB of SQL) |
| 13,458 | page rows (`trucking_source`, 302 KB) |
| 13,399 | `latest_spd_contract` (133 KB) |
| 13,189 | count (`trucking_filtered`, 336 KB) |
| 12,156 | `latest_spd_contract` (108 KB) |
| 10,985 | `latest_spd_contract` (51 KB) |

The page query is no longer the dominant cost - it was 82s when
[[klip-trucking-endpoint-cost-floor]] was written and is now 12,673 ms on its own EXPLAIN
(root buffers 2,379,603). Part of that is migration 162 arriving here for free: the Trucking query
makes **116 reads of its stored status columns** (GR PO/STO status, delete flags), because
`contractDeliveryStatus` is shared with Shipments. That is exactly the "~6ms per contract for the
SAP status expression" the cost-floor note identified.

### The `latest_spd_contract` CTE was a second copy

Three of those queries - **36,540 ms, 38% of the database time** - were
`buildTruckingUnplannedBacklogLatestSpdCte()`, a Trucking-local copy of three COALESCE families
that `contractLatestSpdDerivedSql` already defines and migration 161 already **stores** on
`contract_latest_spd_snapshot`: `b2b_flag_raw`, `contract_reference_po_raw`,
`contract_ext_no_raw`. The Shipments twin had been switched to read the snapshot; this one never
was, so it kept scanning all 27,003 SAP rows and detoasting 138 MB of jsonb to derive values that
were sitting in a 2,520 kB column store with a primary key on `contract_number`.

The two copies still agreed arm for arm, which is the dangerous state rather than a safe one:
nothing would have failed if either had been edited. The Trucking builder now delegates to the
shared resolver, so there is one definition, and a test asserts the delegation and rejects any arm
being re-spelled there.

One behaviour change, and it is an improvement: the Trucking live form ordered by
`created_at DESC NULLS LAST` with **no tiebreaker**, so which SAP row won a tie was undefined. The
snapshot breaks ties on `spd.id DESC`, as the shared live form now does too.

The async ripple reached nine call sites and two test files; `tsc` found every one, including
`pipelineDailySummary.service`'s statement callback, which is now `async`.

### What the CTE swap is actually worth: 20%, not 38%

The first re-measurement after the change read 192,394 ms, worse than the baseline - but its own
log shows a shipment pipeline refresh running concurrently (68,238 ms of build) and a trucking
build holding the refresh lock. That is contention, not the change, and is not usable.

So it was measured the narrow way instead: one real backlog query, built once, with **only the CTE
swapped** - the two statements otherwise byte-identical, run alternately on an idle database, live
form first so any cache warming would favour the snapshot form rather than the other way round.

| | execution | root buffers |
| --- | --- | --- |
| live jsonb CTE | 24,386 ms / 20,334 ms | 2,350,081 / 2,350,056 |
| fresh snapshot CTE | 22,189 ms / 15,250 ms | **1,862,811 / 1,862,811** |

**Buffers: -20.7%, and deterministic** - identical across both runs of each form. Execution time
ranges overlap (15.3-22.2s against 20.3-24.4s), so the time is suggestive and is *not* claimed.

That is the honest size of it, and it is smaller than "38% of the database time" implies. The CTE
is only part of each of those three queries; what remains is the backlog predicate over
`contracts`, which [[klip-trucking-endpoint-cost-floor]] measured at ~8 correlated SubPlans per
row, 92 SubPlans and 97 scans of `sap_processed_data` in one plan. The swap removes about 487,000
buffers per query - roughly 7s of the 36.5s, not all of it. The remaining 1.86M buffers per query
are the next thing to look at, and they are not jsonb extraction.

The run also confirms, uncontaminated, that all three queries now begin
`WITH latest_spd_contract AS (SELECT lss.contract_number, lss.effective_sto, lss.b2b_flag_raw
...)` - the snapshot columns, no `DISTINCT ON` over `sap_processed_data`.

### Section 1's summary: four candidates measured, four ruled out

The biggest single query on the cold page is the Trucking Section 1 combined summary - ~23-37s and
~3.0M root buffers. Every candidate cause was measured rather than argued, and none of them is it:

| candidate | verdict |
| --- | --- |
| SAP qty jsonb families (a migration-163 target) | 524K of 3.07M buffers - **17%**, not dominant |
| nested loops over unindexed CTE Scans | `enable_nestloop=off` made it **3x worse**: 9,186,103 buffers against 3,073,831 |
| `grOpenOnly` - live expansion for GR-open POs only | 3,011,414 against 3,073,797 buffers - **2%** |
| planning time | 7,107 ms on the cold run but 1,098-1,755 ms on repeats; not a fixed cost |

Two of those came from misreading EXPLAIN and are worth naming, because the mistakes are easy to
repeat. Buffers in the text output are **cumulative up the tree**, so the biggest number points at
whatever sits nearest the root. And `rows x loops` is not cost: four `CTE Scan` nodes showed 154M
row visits, which reads as catastrophic and is in fact an in-memory tuplestore scan - cheap per
row, nearly free in buffers. `FORMAT JSON` does not rescue the attribution either, because a CTE's
definition is not a child of its `CTE Scan`, so subtracting children hands the whole query to the
scan. The check that settles it is to disable the plan node type and re-measure.

What is left is not a tuning target. `SELECT count(*) FROM filtered` costs the same as the entire
summary - 28,322 ms and 3,073,828 buffers - so **all** of the cost is producing the expanded row
set, computing status, qty and OS live for all 6,496 rows. The outer aggregation is free.

So the remaining move is precomputation, and it is a **data-visibility decision rather than a
technical one**: `trucking_list_stage_snapshot` already holds 21,157 rows and the daily summary
already supplies the counts and the GR-closed contract qty. Extending it to cover the live parts
would make Section 1 fast at the cost of lagging a SAP import by however long the build takes -
measured at 234s. The status circles already make exactly that trade, so it would be consistent;
it still needs asking.

### Section 1 precomputed: 34,912 ms to 70 ms, and the attempt that had to be thrown away

Approved, with the condition that the page tells the viewer the figures can trail an import.

**The first attempt was wrong and was measured wrong, not reasoned wrong.** It stored the
aggregates per `(group_plant, contract_date, product, incoterm)` alongside the counts already in
`trucking_pipeline_daily_summary`. That is unsound: the live query dedups with
`GROUP BY status, contract_number`, and `contract_number` in the trucking expansion is **not a
contract id** - it is `STRING_AGG(DISTINCT cc.contract_id, ', ')` over every LAND contract sharing
the STO (`truckingListSelectSql.ts`). One group can span several real contracts with different
plants, products and incoterms, and `MAX(contract_qty)` is taken once for the whole group.
Splitting that group by dimension breaks it apart and the per-part MAXes sum to more than the
whole:

| | live | snapshot | delta |
| --- | --- | --- | --- |
| completed_contract_qty | 2,145,394,200 | 2,147,412,690 | +2,018,490 |
| cancelled_contract_qty | 45,546,331 | 45,946,331 | +400,000 |
| interco_lco_kg | 50,074,520 | 49,574,520 | -500,000 |

**7 of 13 figures wrong, and all six status counts exactly right** - because counting rows is
additive at any grain and quantities are not. Nothing failed. Three hypotheses were tested and
discarded before the real cause was found: contracts spanning multiple `contracts` rows (zero),
null `contract_date` splitting a contract across dimension rows (zero), and the shell-versus-full
inner query (identical deltas). Time skew was ruled out too - the last write to `contracts`,
`sap_processed_data` and `trucking_operations` all predated the build.

**What works instead: store the expensive part at the grain it is produced at.** Verified before
building rather than assumed - `trucking_list_stage_snapshot` holds exactly **6,496** rows for the
default YTD window, the identical count to the live `filtered` CTE. Same grain, so nothing needs
re-deriving, and dimension filters keep working because filtering still happens *before* the
grouping, exactly as live. Migration 163 adds seven columns there (`contract_number`,
`contract_qty`, `outstanding_quantity`, `source_type`, `incoterm_eff`, `sap_presence`,
`status_db`), and the refresh fills them from the expansion it **already runs** to write `stage`.

| | before | after |
| --- | --- | --- |
| Section 1 | 34,912 ms live expansion | **70 ms** snapshot read |
| trucking build | 227 s | **227 s** (unchanged) |
| parity | - | **0 of 22 figures differ** |

The rejected aggregate version had taken the build from 234s to **469s** by adding its own CTE
chain; the row-grain version adds only the writes.

**Parity is structural, not maintained by hand.** `truckingStatusSummaryCombinedSql` is split into
the live `filtered` source, the snapshot `filtered` source, and
`TRUCKING_SECTION1_AGGREGATE_CTES` plus the outer SELECT, which both sources embed **verbatim**.
`truckingSection1SharedAggregates.test.ts` asserts that, that both `filtered` forms expose the
same columns, that the snapshot form groups on the whole `contract_number` and never on a
dimension, and that it applies the same `sap_presence` predicate. `sap_presence` is stored rather
than approximated from the contract precisely because the live predicate reads it off the expanded
row.

Two guards on top: the loader refuses a snapshot whose `contract_number` is still NULL (written
before 163, which would otherwise read as zero quantities), and Section 1 falls back to the live
path whenever the daily summary is not eligible for the request.

**What the viewer sees.** `summaryFreshness: { source, asOf, isStale }` on the response, rendered
under the Outstanding Qty strip **only when the figures really came from the snapshot** - a badge
that is always present is a badge nobody reads. Wording and tone live in
`frontend/src/lib/truckingSummaryFreshness.ts` with its own tests; a pending rebuild reads
differently from a completed one, and both say that the table's own row quantities are still live.

**Live is no longer needed for freshness** - the three events that change trucking data (WB
upload, daily planning upload, SAP import) all already call `invalidateTruckingListCache()`, which
marks the summary stale and schedules the rebuild. It is still needed for **coverage**: requests
with a global search, column filters or other non-dimension filters cannot be answered from
columns the snapshot does not carry. Status filters already can, since `stage` is stored.

**And the page is still ~60s, because Section 1 was never the critical path.** Worth stating
plainly next to the 425x: the cold endpoint went 60,862 ms to 59,854 ms. The queries run
concurrently, so removing the largest one only helps if it is the longest, and it was not. What
bounds the page now, from the same breakdown:

| ms | query |
| --- | --- |
| 24,609 | page rows (`trucking_source`) |
| 24,558 | count (`trucking_filtered`) |
| 19,213 / 15,750 / 10,243 | the three `latest_spd_contract` backlog queries |
| **80** | Section 1 (was 34,038) |

### The ALL view's counts from the snapshot: 60,862 ms to 18,581 ms

Both halves of the hybrid total now come from the snapshot when the request is toolbar-only.
Verified against the live forms **before** being wired in, on a scope with a non-zero backlog
because a 0-vs-0 comparison proves nothing:

| | live | snapshot |
| --- | --- | --- |
| execution count | 9,066 (15,632 ms) | 9,066 (**57 ms**) |
| backlog count | 3 (7,294 ms) | 3 (**8 ms**) |

The execution count reads `trucking_list_stage_snapshot`, **not**
`trucking_pipeline_daily_summary.total_count`. That column filters
`COALESCE(c.sap_presence, 'PRESENT') = 'PRESENT'` because it feeds the status circles, which must
drop SAP-cancelled POs - while the list still shows those rows. Using it would have quietly
undercounted the table. The stage snapshot applies no such filter and is keyed one row per
operation with the same `INNER JOIN contracts` as `expansion_keys`, so `COUNT(*)` is the same
number by construction.

Two deliberate exclusions: Unplanned mode keeps its live counts (its execution half counts only
UNPLANNED ops, and the column that answers that carries the same sap_presence filter), and any
request with a global search or column filters falls through to live, because those cannot be
answered from the columns the snapshot carries.

Cold endpoint, measured through `resolveTruckingListForRequest`:

| | baseline | now |
| --- | --- | --- |
| endpoint | 60,862 ms | **18,581 ms** |
| DB time | 97,324 ms | **26,848 ms** |
| Section 1 | 34,038 ms | 51 ms |
| execution count | 24,609 ms | gone (snapshot) |
| backlog count | one of the 10-19s queries | 8 ms |

### Page rows: a paging bug found by trying to make the page fast

The remaining 12,567 ms was the ALL view's execution page. The first attempt was built, compared
and **not shipped**, because the page membership differed - one row per page, `db3460bd...` on
live's page 1 and the snapshot's page 2. Four candidate causes were ruled out by measurement
before the real one was found, and the one that read as most plausible was wrong:

- **The SAP-STO sort priority.** `shouldPrioritizeSapStoRows` returns true only for UNPLANNED and
  PLANNED, and the ALL view passes no stage, so that prefix is never applied.
- **An untrimmed / pre-expansion `supplier`.** The stated suspect: the key order sorts on
  `ts.supplier` while the snapshot stores a TRIMmed, post-expansion value. Checked directly - **0
  contracts needed TRIM, 0 were empty, 0 were null.** Not it.
- **Non-determinism.** Two live runs returned byte-identical page-1 ids, so live looked stable.
- **A boundary effect.** The differing row sat at position 13 of 20, not at the edge.

The actual cause is that the live path was **not stable at all** - it only looked stable because
identical repeats of the same query happen to break ties the same way. Rows 16-21 of page 1 share
supplier `AGRAJAYA BAKTITAMA PT.` **and** `created_at 2026-05-20 09:51:57.265719+00`, straddling
the 20-row boundary, and the live key order ended at `created_at DESC` with **no unique
tiebreaker**. Page 1 and page 2 are separate queries; nothing made them break that tie
consistently.

**So this was a live paging bug, not a snapshot mismatch.** With the tie block identified,
operation `159a784a...` was returned on page 1 *and* page 2, while `db3460bd...` appeared on
neither. A user paging through that stretch saw one row twice and never saw another - independent
of any of this optimisation work, and now fixed.

Two defects, in the SQL and in the Node comparator that decides the final merged page:

| | was | now |
| --- | --- | --- |
| `buildTruckingExpansionKeyOrderBy` | `supplier <dir>, created_at DESC` | `..., created_at DESC NULLS LAST, ts.id` |
| `sortTruckingListRows` | `compareSortValues(b.created_at, a.created_at, 'DESC')` - a double negation, sorting created_at **ascending** while the SQL sorted it descending | `created_at DESC`, then `id` |

`NULLS LAST` is what makes the two orders identical rather than merely equal on today's data;
DESC defaults to NULLS FIRST and the snapshot spells NULLS LAST. It changes no row -
`trucking_operations.created_at` is nullable but holds no NULLs, nor do the snapshot's 15,562
rows.

With both sides deterministic, pages 1 and 2 matched **in set and in order**, and the snapshot
path could be wired.

#### Handing over the keys saved nothing on its own

The stated reason for the cost was that the live query materialises `trucking_source` and
`contract_sto_lines` to work out *which* keys the page holds. That was wrong, and measuring it
said so: with the keys supplied from the snapshot in **25 ms**, the page still cost **19,353 ms**.

`resolvedExpansionKeys` only added `INNER JOIN paged_expansion` inside `expanded`, and
`trucking_source` is referenced more than once - `contract_sto_lines` alone reads it twice - so
Postgres materialises it, which means running the full list select with its per-row laterals over
all 6,496 rows before anything filters it to 20. The restriction has to be **inside** that CTE:

| | page query |
| --- | --- |
| live expansion paging | 23,124 ms / 23,825 ms |
| snapshot keys, `paged_expansion` join only | 19,353 ms |
| snapshot keys restricting `trucking_source` | **4,565 ms / 4,298 ms** |

Parity is checked on **every column of every row**, not just the ids - a faster page showing
different rows is a failure, not a win: **0 of 20 rows differ** on both page 1 and page 2.

Gated to the default `supplier` sort, which is the only one the snapshot carries columns for and
the only one the orders were compared on; every other sort keeps the live ranking.

Cold endpoint at the scope the page actually sends (YTD), through
`resolveTruckingListForRequest`:

| | before | after |
| --- | --- | --- |
| endpoint (shell) | 13,262 ms | **3,612 ms** |
| endpoint (hydrate) | - | **3,338 ms** |
| page rows query | 23,124 ms | 4,565 ms |

**What now dominates is planning, not execution.** On the keyed page query, `EXPLAIN (ANALYZE)`
reads **Planning Time 2,328-3,202 ms against Execution Time 787-2,559 ms** on a statement of
**336,730 characters**. [[klip-trucking-endpoint-cost-floor]] records that making the SQL 3x
smaller did not previously make it faster; that was measured when execution was tens of seconds
and planning was noise. It is no longer noise - it is roughly three quarters of what is left, and
statement size is the next target.

#### View Table now opens on newest-first, and the template pins its own order

The `supplier` asc default was never a View Table requirement - it existed for the **Download
Template** button, which builds its rows from this same list request and so inherited whatever
the table happened to be sorted by. That was a latent bug of its own: a viewer who sorted by PO
number silently downloaded a differently ordered template.

So the two were separated. `buildTruckingListSearchParams` takes a `sortOverride`, the template
passes `{ key: 'supplier', dir: 'asc' }`, and the table defaults to `created_at` desc. The table
does not remember a sort between visits (plain `useState`; only the column layout is persisted),
so every visit starts there.

It is also faster, and for two reasons that are visible in the code rather than guessed:

- `idx_trucking_created_at_desc (created_at DESC NULLS LAST)` already exists and matches the
  order exactly. There is no index on `supplier`.
- `hybridListUsesGlobalMergeSort()` returns false for `created_at`, so the ALL view takes the
  sliced branch instead of merging in Node.

| page query, YTD | live | snapshot keys |
| --- | --- | --- |
| `created_at` desc, page 1 | 9,879 ms | **1,463 ms** |
| `created_at` desc, page 2 | 12,766 ms | **2,085 ms** |
| `supplier` asc, page 1 | 23,124 ms | 4,565 ms |

Parity to the same standard as the supplier sort - every column of every row, pages 1 and 2:
**same order, 0 of 20 rows differing.** The snapshot loader takes the sort field rather than
assuming one, restricted to the two columns it stores; `created_at` needs no second clause
because the live order repeats `created_at DESC` after it, which is redundant on the same column.

Two follow-ons:

- **The startup warmer was warming a key nobody would request.** It runs `summaryOnly` with an
  explicit `sortKey`, and the response cache keys on it - so warming `supplier` while the page
  asks `created_at` warms nothing useful. It now uses the page's default.
- **A global merge with nothing to merge is pure overhead**, and it was running unconditionally.
  The merge fetches `offset + limit` rows from the execution side and sorts in Node, so page 10
  asked for 200 rows to show 20. It is now gated on `breakdown.contractRows > 0`, which is
  already computed on the line above. Safe only because `sortTruckingListRows` was fixed to break
  ties the way the SQL does - before that the two branches could return different pages.

**One behaviour change worth stating.** With `created_at` the ALL view no longer merge-sorts the
two halves, so when the backlog is non-empty its rows are appended after all execution rows
rather than interleaved - they land on the last page. On the default YTD window the backlog is 0
so nothing moves; on a 2025 scope it is 3 rows. Whether those belong interleaved is a product
decision, not a performance one.

#### An unscoped request produced invalid SQL

Found while measuring, not by a test: `buildDailySummaryWhere` returns `''` when a request carries
no date, plant, product or incoterm filter, and `buildTruckingSection1FromSnapshotQuery` appended
the `sap_presence` predicate as ` AND ...` regardless - `FROM trucking_list_stage_snapshot s  AND
COALESCE(...)`, a 42601 that failed the whole request. The page always sends a date range, so no
user could reach it, but any caller without a toolbar scope could. Fixed and covered both ways.

Also worth recording, because it was offered as a way out and turned out not to be needed: hiding
the total row count and page count would save essentially nothing - the counts are 8-57 ms. The
cost was finding and fetching the 20 rows, which a hidden total does not touch.

### After a SAP import: what refreshes, in what order, and the race that was there

The scheduled SAP import (06:00 Asia/Jakarta, `SAP_AUTO_IMPORT_CRON`) runs the same MASTER v2
engine as a manual upload, so both share one post-import chain. It refreshes four derived
snapshots in parallel - `contract_qty_move_snapshot`, `contract_sto_agg`, `contract_latest_spd`,
`b2b_ending_child` - then the Contract Performance snapshot, which is computed from them.

**The trucking rebuild was not in that chain.** It was started by the cache invalidation at the
top of the block, which marks the pipeline snapshot stale and schedules a rebuild immediately. So
it ran *alongside* the four snapshots it reads: the trucking build joins
`contract_qty_move_snapshot` for the B2B origin overlay, and could publish a generation computed
from pre-import quantities. The page would then serve those until the next rebuild - the following
morning.

So `markPipelineDailySummaryStale` and `invalidateTruckingListCache` take a flag to mark stale
*without* scheduling. The import passes it, and runs `PipelineDailySummaryService.refreshAll()`
itself after the upstream snapshots have landed. Caches are still cleared at the top, immediately;
only the rebuild moved. If an upstream refresh fails, the rebuild falls back to the normal
debounced schedule rather than not happening at all - stale but consistent beats never rebuilt.

Then the keep-warm registry is re-run, so the first viewer is served from memory rather than
paying the live query (25-190s on Trucking). That is bounded by what the registry holds: it
re-warms scopes someone opened recently, and after a container restart, or a scope nobody has
opened, there is nothing to re-warm and the first load pays the snapshot-served cost (70ms-3s)
rather than the live one.

### WB upload rows appear immediately: a targeted snapshot refresh

The snapshot made the page fast and made it lie. `trucking_list_stage_snapshot` is the source of
the page's rows, their Outstanding Qty **and** Section 1's quantities, and only the full rebuild
ever wrote it - 227s on dev, 1,070s and 1,634s measured on SIT. So after a WB upload the page kept
showing the pre-upload OS Qty until the next rebuild, which is precisely the figure the upload
exists to change.

Requiring freshness instead was tried on 2026-09-11 and reverted the same day: 14,591 of 16,552
operations had been touched since the last rebuild, so the page fell to the live path and took
25-190s. Staleness is not an error state here; it is the normal state.

**The fix is to rebuild the operations that changed, not the whole table.** `buildTruckingStage
SnapshotInsertSql` now takes `operationIds` and passes them as `resolvedExpansionKeys` - the same
restriction the snapshot-served *page* already uses to expand 20 rows out of 16,000, and it works
for the same reason: it lands inside `trucking_source` itself, where it can prune work, rather
than filtering afterwards.

Measured on dev, warm:

| Operations | Delta |
|---|---|
| 10 | 2,658 ms |
| 50 | 3,038 ms |
| 200 | 3,982 ms |

That is ~2.5s fixed (planning a 386 KB statement) plus ~7ms per operation, against 227s for the
full rebuild. The WB upload controller awaits it before answering, because the user opens the page
straight after; it swallows its own errors, so it can never fail an upload whose data is already
committed.

**Parity, not reasoning.** The claim that a subset build is safe rests on nothing downstream
aggregating over the wider set. That was checked rather than argued: rebuilding 1, 10, 50 and 200
operations reproduced what the full rebuild had written with **0 differences across all 20
columns**, every time.

**Two things it deliberately does not do.**

`is_stale` stays true. A full rebuild is still owed for every operation nobody touched; this only
stops the page misreporting the ones somebody just did.

It does not touch `trucking_pipeline_daily_summary`, whose grain is a dimension aggregate rather
than a row. That table supplies Section 1's status circles, so while deltas are pending the counts
would describe the state before the upload while the quantities beside them described the state
after - which reads as a bug, not as staleness. So `hasPendingTruckingStageDeltas()` routes
Section 1's counts to the stage snapshot as well while that is true. That path is not new: it is
the one a Region/Plant filter already takes, measured at 70ms and parity-verified on 22 figures.

**The regression this could have caused, and the log that prevents it.** A rebuild reads its
source, builds for minutes, then swaps wholesale. A delta applied during that window would be
replaced by what the build read *before* the upload existed - the row silently reverting to its
pre-upload quantities, which is worse than never refreshing it. So every targeted refresh records
its operations in `trucking_stage_snapshot_delta_log` (migration 166), and a rebuild that
publishes re-applies everything touched since it started reading, then prunes the rest.

Still lagging until the next rebuild: the status circles for operations nobody touched, and the
Unplanned backlog aggregates. Manual daily-actual edits and manual realization updates write the
same tables and do **not** yet trigger a delta - the same one-line call would cover them.

### An empty backlog was still running both backlog queries: 18,581 ms to 13,262 ms

Not an optimisation so much as waste that was already there. For the ALL view,
`fetchContractBacklogPage` was called **unconditionally** - while `breakdown.contractRows`, counted
from the same scope and toolbar predicate, sat computed on the line above it, unused. On the
default YTD window, where the backlog is genuinely empty, that ran
`buildTruckingUnplannedBacklogPageQuery` for **8,309 ms** to return no rows. The combined backlog
query did the same for **5,789 ms** to return zeros.

Both are now skipped when the backlog count is zero - a decision that costs 8 ms from the snapshot.
Verified on both sides, because a guard that fires when it should not is worse than the waste:

| | YTD 2026 (backlog empty) | 2025 (backlog = 3) |
| --- | --- | --- |
| backlog page query | **not run** | still runs (10,186 ms) |
| combined backlog query | **not run** | still runs (18,524 ms) |
| endpoint | **13,262 ms** | 38,433 ms |
| Unplanned card qty | 297,921,180 | 126,794,090 |
| OS total | 404,656,114 | 189,844,221 |

The YTD figures are identical to the live values proved in the Section 1 parity run, and the 2025
path is untouched. The gate is narrow on purpose - a global search, a column filter or a contract
filter narrows the backlog in ways the snapshot's dimension columns cannot express, so those keep
running the query rather than answering a different question. The empty result is built from the
query's own parser (`parseTruckingOutstandingQtySummaryRow(null)`) rather than a hand-written zero
object, so its shape cannot drift.

Where that leaves the page: **60,862 ms to 13,262 ms cold, 4.6x** at this point, with the
12,567 ms execution page query the one thing still outstanding - see the section above for how
that was closed and what it exposed.

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

