# Pre-Planned Shipment Grouping — Concrete Spec

Status: DRAFT v1 · 2026-07-22 · Author: KLIP team + Claude analysis
Companion data: `docs/Pre-Planned-Group-Suggestions-2026-07-22.xlsx` (current Unplanned contracts on test-klip, grouped by this logic)

## 1. Purpose

Every contract that lands in KLIP today starts as **Unplanned** and waits for a planner to
assign it to a vessel shipment manually. This spec defines a **Pre-Planned** stage: the system
automatically groups new Unplanned contracts into suggested vessel shipments, so planners
confirm instead of assembling from scratch.

Accuracy target: ≥ 80% of auto-grouped contract pairs must match how planners actually ship
them. The rule below backtested at **85.7% pairwise precision / 86% of multi-contract groups
fully correct** against 416 contracts on 165 historical shipments (test-klip snapshot,
2026-07-22, statuses ≠ Unplanned/Cancelled).

## 2. Empirical basis (what real shipments look like)

Measured on all 187 shipments with status ≠ Unplanned (109 of them multi-contract):

| Variable                          | Same within one shipment | Verdict |
|-----------------------------------|--------------------------|---------|
| Group Plant (`master_plants.group_plant`) | **100%**          | hard rule |
| Buyer                             | **100%**                 | hard rule |
| Incoterm                          | **100%** (never FOB+CIF) | hard rule |
| Product                           | 98% (2 deliberate multi-parcel exceptions) | hard rule, manual override allowed |
| Discharge destination             | ~100% (naming variants only) | implied by Group Plant |
| Supplier                          | 57%                      | NOT a hard rule — but the strongest *pair* signal (see §4) |
| Supplier group                    | 76%                      | tier-2 signal only |
| LT/Spot                           | 69%                      | ignore |
| Delivery windows strictly overlap | 43% (median gap 2 days; 85% within 30 days) | proximity matters, strict overlap does not |
| Incoterm of multi-contract shipments | 103/105 FOB           | CIF defaults to single |
| One contract → one shipment       | 95% (23/451 split across 2) | pack whole contracts |

Key pair-level discriminators within the same hard key (base rate 3.1%):
window overlap only → 14% · identical delivery window → 61% · identical window + same
supplier → **79%** · + capacity split at median parcel → **86%**.

## 3. Trigger points

Evaluate (or re-evaluate) grouping when:

1. A contract is created in KLIP or arrives via SAP import (`source_type` any).
2. A contract's delivery window, quantity, plant, or transport mode is updated.
3. A contract gets attached to a real shipment/STO → remove it from its Pre-Planned group;
   re-pack the remainder of that group.
4. Nightly job re-evaluates all open groups (windows drift, outstanding qty changes).

## 4. Algorithm

### 4.1 Eligibility (which contracts enter the pool)

```sql
SELECT c.*
FROM contracts c
WHERE UPPER(COALESCE(NULLIF(TRIM(c.transport_mode), ''), 'SEA')) IN ('SEA', 'MIXED', 'MIX')
  AND UPPER(COALESCE(c.status, '')) NOT IN ('CLOSE', 'CLOSED', 'COMPLETED', 'CANCELLED')
  AND c.delivery_start_date IS NOT NULL
  AND c.delivery_end_date   IS NOT NULL
  AND <outstanding_qty_kg>  > :min_os_kg          -- reuse shipmentOutstandingQtyExpr; default 100 MT
  AND NOT EXISTS (                                 -- not already on a shipment
        SELECT 1 FROM shipments s
        WHERE s.contract_id = c.id
          AND UPPER(COALESCE(s.status,'')) NOT IN ('UNPLANNED','CANCELLED'))
  AND <group_plant_expr> NOT IN ('Blank', 'Trading')   -- excluded plants, configurable
```

`<group_plant_expr>` is the existing resolution used by the contracts list
(`contract.controller.ts` `pnc`/`pna` LATERAL joins):

```sql
COALESCE(
  NULLIF(TRIM(mp_company.group_plant), ''),   -- master_plants matched on plant_code + company_name
  NULLIF(TRIM(mp_any.group_plant),     ''),   -- master_plants matched on plant_code only
  'Blank')
```

Both joins compare `TRIM(UPPER(plant_code))` / `TRIM(UPPER(company_name))` — reuse the
existing expression-index pattern (cf. migrations 107/108/121/123) if this runs hot.

### 4.2 Hard partition key

```
partition_key = group_plant | buyer | incoterm | product
```

Contracts in different partitions are NEVER grouped. (Transport mode already filtered to
sea-capable in §4.1.)

### 4.3 Auto-group clustering (Tier 1)

Within each partition:

1. Sub-partition by **supplier** (exact `contracts.supplier`).
2. Sort by `delivery_start_date`, then `contract_id`.
3. Chain into window clusters: contract joins the current cluster when
   `|start − cluster.start| ≤ WINDOW_TOL_DAYS` **and** `|end − cluster.end| ≤ WINDOW_TOL_DAYS`
   (cluster start/end = anchor of its first member). Default `WINDOW_TOL_DAYS = 3`
   (0 and 3 backtest identically; 7 drops precision to ~76%).
4. **Capacity split**: pack the cluster's contracts, in `contract_id` (creation) order, into
   bins of `CAP = max(parcel_mt(group_plant), largest single contract)` with tolerance
   `CAP_TOL = 1.05`, using outstanding qty in MT (`quantity_ordered`/outstanding stored in KG
   → ÷ 1000). First bin that fits wins; overflow starts the next bin.
5. Each bin = one **Pre-Planned group** (`PP-<PLANT>-<seq>`). `est_vessels = 1` per bin by
   construction; a cluster of N bins is N suggested vessels.

CIF/CFR/FRC contracts follow the same path — since supplier + identical window is required,
they naturally stay single unless the same supplier cut one deal into several contracts,
which is exactly the case that should merge.

### 4.4 Vessel capacity model

`parcel_mt(group_plant)` = median BL quantity (MT) of non-cancelled historical shipments
delivering to that group plant, refreshed monthly:

```sql
SELECT plant_site, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY bl_quantity / 1000.0)
FROM shipments_history           -- shipments with bl_quantity >= 100 MT, status not cancelled
GROUP BY plant_site;
```

Snapshot used for the current export: Bontang 2,700 · Tanjung Pura 3,971 · Bulking Batam
2,998 · Karawang 1,000 · Bekasi 750 · Cisadane 501 (thin history → fallback) · fallback
**3,000 MT**. Median (not max/p90) is deliberate: planners on these routes prefer several
smaller barges; median-bin packing is what lifted precision 79% → 86%.

### 4.5 Merge suggestions (Tier 2 — never auto-applied)

For planner UI only: flag pairs of groups in the same partition with the same **supplier
group** (`contracts.group_name`) and window gap ≤ 7 days as "consider merging" (~60–66%
historical precision). Shown as a hint chip; requires explicit confirmation.

## 5. Data model

New tables (do NOT overload `shipments` — a Pre-Planned group is a suggestion, not a shipment):

```sql
CREATE TABLE pre_planned_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code      TEXT UNIQUE NOT NULL,          -- PP-BONTAN-031
  partition_key   TEXT NOT NULL,                 -- plant|buyer|incoterm|product
  group_plant     TEXT NOT NULL,
  supplier        TEXT NOT NULL,
  window_start    DATE NOT NULL,
  window_end      DATE NOT NULL,
  bin_capacity_mt NUMERIC NOT NULL,
  total_os_mt     NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'SUGGESTED',  -- SUGGESTED | ACCEPTED | DISMISSED | SUPERSEDED
  shipment_id     UUID NULL REFERENCES shipments(id), -- set when accepted
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pre_planned_group_members (
  group_id     UUID REFERENCES pre_planned_groups(id) ON DELETE CASCADE,
  contract_id  UUID REFERENCES contracts(id),
  os_mt_at_grouping NUMERIC NOT NULL,
  PRIMARY KEY (group_id, contract_id)
);
CREATE UNIQUE INDEX ux_ppgm_active_contract
  ON pre_planned_group_members (contract_id);   -- a contract sits in at most one active group
```

Regeneration is idempotent: recompute → diff against existing SUGGESTED groups → keep stable
`group_code` when membership unchanged; mark replaced ones SUPERSEDED. Never touch
ACCEPTED/DISMISSED groups automatically.

## 6. API & UI

- `GET  /api/pre-planned/groups?plant=&status=` — list groups with members.
- `POST /api/pre-planned/groups/:id/accept` — opens the existing Add New Shipment flow
  prefilled with the group's contracts/POs; on save, links `shipment_id`, status ACCEPTED.
- `POST /api/pre-planned/groups/:id/dismiss` — planner rejects; member contracts become
  eligible for regrouping (excluding the dismissed combination).
- `POST /api/pre-planned/rebuild` — admin/nightly trigger.
- Shipments page: "Unplanned" card splits into "Pre-Planned (suggested)" and "Unplanned
  (ungrouped)"; group rows render like shipment rows without a vessel.

## 7. Configuration (defaults)

| Key | Default | Note |
|---|---|---|
| `WINDOW_TOL_DAYS` | 3 | window start/end tolerance for clustering |
| `CAP_TOL` | 1.05 | bin overflow tolerance |
| `PARCEL_STAT` | median | per-plant bin size statistic |
| `PARCEL_FALLBACK_MT` | 3000 | plants with < 3 historical shipments |
| `TIER2_GAP_DAYS` | 7 | merge-hint window gap |
| `MIN_OS_MT` | 100 | ignore near-closed contracts |
| `EXCLUDED_PLANTS` | Blank, Trading | no auto-grouping |

## 8. Acceptance & monitoring

- Ship behind a feature flag; log every suggestion.
- Monthly metric: of AUTO groups whose contracts have since been shipped, pairwise precision
  (pairs that actually shared a vessel ÷ suggested pairs). Alert if < 80%.
- Secondary: planner acceptance rate of suggested groups; dismissal reasons.

## 9. Edge cases

- **Multi-parcel vessels** (CPO+CPKO / CPO+POME): out of scope for auto-grouping (2 cases in
  history, both deliberate). Planner can still combine manually at accept time.
- **Contract split across vessels** (~5% historically): a single contract larger than the
  plant's max vessel gets one group per `CEILING(os / cap)`; UI labels it "partial".
- **Contracts already carrying an SAP STO** bypass Pre-Planned entirely (already committed).
- **Blank group plant** usually means `master_plants.group_plant` is not maintained — surface
  as a data-quality list rather than grouping garbage.

## 10. Backtest reproduction

Snapshot 2026-07-22, test-klip: 416 planned/completed contracts, 165 shipments.
Naive (partition + window overlap + greedy capacity): 25% pairwise precision.
Partition + same supplier + identical window: 79.1%.
Plus median-parcel capacity split: **85.7% pairwise / 86% groups fully correct**; coverage
~30% of contracts auto-grouped (rest remain single-contract suggestions).
