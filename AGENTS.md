## KLIP Agent playbook (for AI + humans)

This document is a **map of the KLIP application** so an agent can answer questions correctly by tracing **code → SQL → data → UI**, and can also give **logistics best‑practice recommendations** grounded in KLIP’s real data model.

---

## Product overview (what KLIP is)

KLIP is a SAP-integrated logistics management system covering **Contracts, Shipments (SEA), Trucking (LAND), Finance/Payments, Documents, Audit, and Dashboard KPIs**.

Tech stack:
- **Frontend**: `frontend/` Next.js (App Router) + TS + Tailwind
- **Backend**: `backend/` Express + TS
- **DB**: PostgreSQL
- **Auth**: JWT + RBAC

See `README.md` for the authoritative repo overview and the SAP upload flow.

---

## How to answer questions correctly (required method)

When asked “why does KLIP show X?” or “how is KPI Y calculated?”:

- **Step 1 — Identify the surface**: which page / API endpoint / export.
- **Step 2 — Identify the computation layer**:
  - **SQL** (CTEs, materialized views, migrations) vs
  - **Backend computation** (controller/service) vs
  - **Frontend derived display** (formatting, tooltips, client-side formulas).
- **Step 3 — Verify the source of truth**:
  - Contracts / deliveries often depend on **`sap_processed_data`** (and whether STO identifiers exist).
  - SEA milestone dates can live in both `shipments` and `vessel_loading_ports` (port-level vs shipment-level).
- **Step 4 — Return an evidence-based answer**:
  - What the system does now (cite the file/function/query)
  - Why (design/data constraints)
  - What to change (if requested)
  - Logistics best-practice recommendation + KPI to measure impact

If you cannot verify from repo context, **state the missing evidence** and provide the next precise check (file/function/query).

---

## Core domain data model (high-signal anchors)

SAP integration / ingest tables:
- `sap_data_imports`: import session (status, counts)
- `sap_raw_data`: row-level raw JSON + error tracking
- `sap_processed_data`: normalized JSONB + identifiers (`contract_number`, `po_number`, `sto_number`)

Domain tables (main):
- `contracts`: contract master / commercial fields
- `shipments`: SEA transport execution (shipment milestones, quantities)
- `vessel_loading_ports`: per-port SEA timeline + quantities (multi-loading ports + discharge port)
- `trucking_operations`: LAND execution (+ optional supporting legs)
- `payments`: due vs paid, amount, dates
- `documents`: uploads linked to contract/shipment/payment/trucking
- `audit_logs`: who changed what/when
- `users`, `roles`, `permissions` (RBAC)

Important concept:
- **Tri-key dedupe** (per docs): `contract_number` + `po_number` + `sto_number`. If duplicates appear, always verify this path across SAP import services + DB uniqueness expectations.

---

## SAP “MASTER v2” upload flow (where logic lives)

Docs summary is in `README.md` (search “SAP Upload Mechanism”). Implementation typically spans:
- `backend/src/controllers/sapMasterV2.controller.ts`
- `backend/src/services/sapMasterV2Import.service.ts` (parsing + metadata/field mapping)
- `backend/src/services/sapDataDistribution.service.ts` (route SEA vs LAND, upsert domain tables)

Operational expectation:
- Row-level errors should not stop the import (SAVEPOINT pattern).
- Data quality issues should surface via import status + failed row messages.

---

## Contracts list & “delivered/outstanding” quantities (common pitfall)

The contracts list query aggregates STO deliveries from `sap_processed_data`.
Key implication:
- If STO identity is missing (e.g., `sto_number` not set and no raw STO field present), STO aggregation may not count as delivered even if `sto_quantity` exists in JSON.

Primary location:
- `backend/src/controllers/contract.controller.ts` (`getContracts` CTEs like `sto_agg`)

When investigating “outstanding qty looks wrong”:
- Confirm STO identifiers exist (`spd.sto_number` or raw STO fields).
- Confirm the quantity fields used (`data->'contract'->>'sto_quantity'`) are present and parseable.
- Compare API output with raw SQL on the same DB.

---

## Shipments ETA/ATA & ports (SEA)

There are **two layers** of timeline data:
- `shipments`: shipment-level/legacy summary timeline
- `vessel_loading_ports`: port-level detail (multi-port)

Rules/notes and a debugging example are in:
- `docs/SHIPMENTS_ETA_ATA_AND_PORTS.md`

When users report “port rows missing”:
- It can be expected if only `shipments.port_of_loading/discharge` were set but no port rows were created.

---

## Documents upload + scanning

Upload endpoint(s) and validation live under:
- `backend/src/routes/document.routes.ts` (multer limits + allowed MIME)
- `backend/src/controllers/document.controller.ts`
- `backend/src/services/clamScan.service.ts` (optional ClamD INSTREAM)

Operational best practice:
- Treat “scanner unreachable” as a **hard control decision** (fail closed) or explicitly configure “fail open” by policy (don’t guess; confirm desired policy).

---

## Finance / payments

Primary backend entry points:
- `backend/src/controllers/finance.controller.ts`
- `backend/src/services/financeMaterializedView.service.ts` (if dashboards depend on refreshed views)

When validating finance totals:
- Compare API aggregates vs raw SQL on `payments` joined to `contracts`.
- Watch for status logic (paid vs pending) derived from payoff dates and due dates.

---

## Audit trail & “recent activity”

Recent activity UI uses audit logs filtered by page area:
- Frontend: `Layout` floating activity button
- Backend: `backend/src/controllers/activity.controller.ts`
- Doc: `docs/UX Features.md`

When asked “who changed X?”:
- Find the entity + corresponding `audit_logs` entries.
- Confirm RBAC allows viewing audit routes for the requester role.

---

## RBAC (routes and permissions)

Routes live in:
- `backend/src/routes/*.routes.ts`
Controllers in:
- `backend/src/controllers/*.controller.ts`

When asked “who can access route X?”:
- Trace the route middleware chain (auth + permission checks).
- Prefer **least-privilege** recommendations:
  - Separate “view” vs “edit” permissions
  - Keep admin-only ingestion endpoints locked (SAP imports, user/role management)

---

## KLIP “Agent AI” (in-app AI endpoint)

Backend controller:
- `backend/src/controllers/agentAi.controller.ts`

Key behaviors:
- Builds a **live DB summary context** (contracts/shipments/trucking/payments + product rollups).
- Uses “deterministic-first” logic for some metric questions (avoids LLM hallucinating KPIs).
- Stores Q/A memory in `agent_ai_memory` and supports user rating/feedback.

When improving in-app AI quality:
- Prefer adding **deterministic metrics** for common operational questions.
- Add clearer source labels + short “why” explanations for each metric.
- Use memory retrieval only as supporting context, not as truth.

---

## Logistics best-practice checklist (what to recommend, when relevant)

When the user asks “what should we improve?” prefer these patterns:
- **Exception management**: show the few items that need action (late milestones, overdue payments, negative gain/loss, missing documents).
- **Single source of truth**: define which table/field is authoritative for a KPI.
- **Controls**: RBAC least privilege + complete audit logging for sensitive actions.
- **KPIs** (pick 1–3 per recommendation):
  - OTIF / on-time milestone attainment (SEA/LAND)
  - Outstanding quantity accuracy (contract vs delivered)
  - Payment aging (due vs paid, deviation days)
  - Data quality rate on SAP imports (failed rows %, top error reasons)

