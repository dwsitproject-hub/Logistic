# Summary Perubahan — Branch `SIT`
**KLIP (KPN Logistics Intelligence Platform)**
Tanggal: 2026-05-08 | Branch: `SIT` | Status: Siap Push (menunggu akses repo)

---

## Commit 1 — `e1529cb`
**Replace total late days → total qty delivery (kg) di contract performance drilldown**

- Kolom metrik di drilldown Contract Performance diubah dari "Total Late Days" menjadi "Total Qty Delivery (kg)" agar lebih relevan secara operasional

---

## Commit 2 — `630902b`
**v1.0.0 — Shipping & Contract Performance Enhancements**

- Modul **Shipping Performance**: monitoring kinerja pengiriman per rute/vessel/contract
- Pembaruan **Master Data** terkait modul shipping
- Peningkatan tampilan dan logika **Contract Performance**

---

## Commit 3 — `840c8b2`
**Oil Loss Module, Supplier Groups, Customer 360, dan Dokumentasi**

### Fitur Baru

| Modul | Perubahan |
|---|---|
| **Oil Loss** (`/oil-loss`) | Halaman baru: KPI cards (Records, Total Loss, Avg/Max Loss %, Total Gain), drilldown 5 level (Mode → Product → Plant → Group → Supplier), filter panel, tabel detail 16 kolom |
| **Customer 360** (`/customer-360-company`) | Halaman profil grup: search by Group ID, Identity Profile + fleet metrics (voyages, vessels, volume, lead time), peta OpenStreetMap, Production Metrics, Mill List Modal dengan kolom sertifikasi dinamis |
| **Suppliers Dashboard** (`/customer-360`) | Refactor: 4 stacked bar chart SVG custom (by Group, Supplier, Island, Province), toggle Per Month/Per Year, 4 API call paralel |
| **Suppliers** (`/supplier`) | Multi-select filter Group ID dengan 7 pinned groups, column manager, CSV import dengan upsert logic, kalkulasi estimasi produksi otomatis dari CAP |

### Backend Baru

| File | Keterangan |
|---|---|
| `backend/src/controllers/oilLoss.controller.ts` | Query Oil Loss + Total Gain paralel dari `sap_processed_data` |
| `backend/src/controllers/supplier-groups.controller.ts` | `listSupplierGroups` (agregasi mill + correlated subquery contracts/shipments), `upsertSupplierGroup` |
| `backend/src/routes/oilLoss.routes.ts` | Route `/api/oil-loss` |
| `backend/src/routes/supplier-groups.routes.ts` | Routes `/api/supplier-groups` |

### Migrasi Database

| File | Keterangan |
|---|---|
| `054_create_supplier_groups.sql` | Tabel baru `supplier_groups` (land_bank, credit_rating, PIC, dll.) |
| `055_add_oil_loss_permission.sql` | Permission `page.oil_loss` untuk role ADMIN, MANAGEMENT, SUPPORT, LOGISTICS |

### Dokumentasi (`docs/`)

| File | Keterangan |
|---|---|
| `PRD - Oil Loss.md / .docx` | PRD halaman Oil Loss |
| `PRD - Customer 360.md / .docx` | PRD halaman Customer 360 company |
| `PRD - Supplier.md / .docx` | PRD Suppliers Dashboard + Suppliers master data |
| `Spek Teknis - Customer 360.md / .docx` | Spesifikasi teknis Customer 360 |
| `Spek Teknis - Supplier.md / .docx` | Spesifikasi teknis Supplier (kedua halaman) |

---

## Statistik

| Keterangan | Nilai |
|---|---|
| Total commit siap push | 3 commit |
| Total file berubah | 24 file |
| Baris ditambahkan | +4.339 |
| Baris dihapus | -1.054 |
| Remote target | `https://github.com/dwsitproject-hub/Logistic.git` |
| Branch | `SIT` |
