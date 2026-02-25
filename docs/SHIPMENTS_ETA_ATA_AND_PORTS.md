# ETA/ATA and Port Data: `shipments` vs `vessel_loading_ports`

## Table link: how the two tables connect

- **`vessel_loading_ports.shipment_id`** (UUID) references **`shipments.id`** (UUID).
- Foreign key: `vessel_loading_ports.shipment_id` → `shipments.id` with `ON DELETE CASCADE`.
- So each row in `vessel_loading_ports` belongs to exactly one shipment; one shipment can have many rows (multiple loading/discharge ports).

**Querying by shipment:** use the column name without quotes. Wrong: `WHERE 'shipment_id' IN (...)` (that compares the literal string `'shipment_id'`). Correct:

```sql
SELECT * FROM vessel_loading_ports
WHERE shipment_id IN ('3a71512a-e075-434c-8219-4365420dd719', '70228442-88eb-405c-ba21-80df3c53ed1c');
```

---

## 1. Why do we have ETA and ATA in both tables?

**Historical / design reasons:**

- **`shipments` table**
  - Holds **one set** of high-level dates per shipment (e.g. one "loading" and one "discharge" timeline).
  - Columns were added over time: `port_of_loading`, `port_of_discharge`, then ETA/ATA fields such as `eta_arrival`, `ata_arrival`, `eta_loading_start`, `ata_loading_start`, `eta_loading_complete`, `ata_loading_complete`, `eta_sailed`, `ata_sailed`, and the discharge equivalents.
  - Used for: simple reporting, list views, and as a **fallback** when there is no detailed port data.

- **`vessel_loading_ports` table**
  - Added later to support **multiple loading ports per shipment** (e.g. Loading Port 1, 2, 3) and **one discharge port**, each with:
    - Its own ETA/ATA timeline
    - Quantity loaded at that port
    - Loading rate (MT/hour)
    - Quality at that location
  - Used for: the "Vessel Loading Ports" UI and any logic that needs per-port detail.

So in practice:

- **Shipment-level:** ETA/ATA on `shipments` = one summary timeline per shipment (and fallback when there are no port rows).
- **Port-level:** ETA/ATA on `vessel_loading_ports` = per-port detail; the UI prefers this when present and falls back to `shipments` for shipment-level info.

That's why both tables have ETA/ATA: one for summary/legacy, one for detailed port-by-port data.

---

## 2. Why are there no rows in `vessel_loading_ports` for contract 1014002145 even though port names exist on `shipments`?

Port names on the shipment (**Vessel Loading Port 1**, **Vessel Discharge Port 1**) are stored in:

- `shipments.port_of_loading`
- `shipments.port_of_discharge`

Rows in **`vessel_loading_ports`** are **not** created automatically when you set those two columns. They are created only when:

1. **SAP data distribution** runs for that shipment and the parsed data includes at least one of:
   - Loading: `vessel_loading_port_1` (or 2/3), or `quantity_at_loading_port_1_based_on_bast`, or quality at "Loading Port 1" (etc.)
   - Discharge: `vessel_discharge_port` / `port_of_discharge` or quality at "Discharge Port"
   Then `upsertVesselLoadingPorts()` creates or updates rows in `vessel_loading_ports`.

2. **User adds a port** via the "Add Loading Port" flow in the UI (POST to `/shipments/:id/loading-ports`).

3. **User saves ETA (or similar)** in the Vessel Loading Ports modal when **no** port rows exist: the app creates **one** initial loading port row so that ETA can be stored (and optionally one discharge port), as implemented in the frontend "first save" logic.

So for contract **1014002145** (and any shipment created/updated without going through the above):

- `shipments.port_of_loading` and `shipments.port_of_discharge` can be set (e.g. "Loading Port 1", "PORT TANJUNG PRIOK").
- No process has yet run that inserts into `vessel_loading_ports` for that shipment, so **there are no rows** there until:
  - A SAP import that includes port/quantity/quality runs for that shipment, or
  - The user adds a port or saves ETA in the modal (which creates the first row(s)).

The UI shows "No loading ports yet" because it lists only rows from `vessel_loading_ports`; it still shows the names from `shipments` in the "Shipment Information" section.

---

## Optional: backfill so "Vessel Loading Ports" always has at least one loading + one discharge row

If you want every shipment that has `port_of_loading` and/or `port_of_discharge` to also have corresponding rows in `vessel_loading_ports` (so the modal never shows "No loading ports yet" when the shipment has port names), you can add a small backfill (e.g. when loading ports are fetched or on a one-time job) that:

- For the given `shipment_id`, if `vessel_loading_ports` has no rows:
  - Insert one row with `port_name = shipments.port_of_loading`, `port_sequence = 1`, `is_discharge_port = false`.
  - If `shipments.port_of_discharge` is set, insert one row with `port_name = shipments.port_of_discharge`, `port_sequence = 999` (or similar), `is_discharge_port = true`.

That way the "Vessel Loading Ports" view would always have at least one loading and one discharge row for such shipments, and ETA/ATA would be editable there without creating duplicate ports on every save.

**Note:** The backend implements this backfill automatically in `getVesselLoadingPorts`: when there are no rows for a shipment, it creates one loading and one discharge row from `shipments.port_of_loading` and `shipments.port_of_discharge` so the modal always has rows when port names exist.

---

## Frontend: how the Vessel Loading Ports modal shows ports

The UI treats "one set" vs "multiple sets" of ports differently:

1. **Single set (exactly one loading port and one discharge port)**
   All information is shown in the **Shipment Information** section only:
   - Quantities, Vessel Loading Port 1, Vessel Discharge Port 1, OA, B/L
   - All ATA fields (arrival, berthed, start/completed loading, sailed, discharge dates)
   - All ETA fields (same labels)
   - Quality at Loading Loc 1
   No separate port cards or sections are shown; everything is in that one block.

2. **Multiple sets (more than one loading port and/or more than one discharge port)**
   - The **Shipment Information** section still shows the same shipment-level and first-port summary (and the first loading + first discharge are represented there).
   - For each **additional** loading or discharge port (sequence 2, 3, … or second discharge, third discharge, …), the frontend creates a **new section** with a clear heading, e.g.:
     - **Loading Port 2 —** (port name)
     - **Loading Port 3 —** (port name)
     - **Discharge Port 2 —** (port name)
   Each of these sections shows that port's details (name, sequence, quantity, ETA/ATA dates, rate, quality) in one block, so multiple ports are easy to scan and edit.
