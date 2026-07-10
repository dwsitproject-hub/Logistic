# Checklist Regression Test — Performance Optimization (Tanpa Ubah Kalkulasi)

**Versi:** 1.0  
**Tanggal:** 9 Juli 2026  
**Scope:** Verifikasi bahwa optimasi performance (daily summary read path, kurangi triple-fetch, denormalisasi SAP — jika diterapkan) **tidak mengubah** rumus bisnis yang sudah ada:

- OS Quantity (actual / planning) berdasarkan incoterm & transport
- Import status (GR PO vs GR STO)
- Cycle aging (log / trade / cash / DP)
- Kartu pipeline status (Planned, Unplanned, ETA buckets)
- Hybrid Unplanned (contract backlog + execution rows)

**Environment disarankan:** Local Docker (`http://127.0.0.1:3001` / `http://127.0.0.1:5001`) dengan data SAP production-like (SIT clone atau UAT June 2026).

**Referensi rumus (single source of truth):**

| Metrik | File backend |
|--------|----------------|
| Incoterm matrix (status, qty delivery, OS) | `backend/src/utils/sapIncotermMetrics.ts` |
| Contracts OS global (`qty_move`) | `backend/src/utils/contractGlobalOutstandingSql.ts` |
| Contracts list outer | `backend/src/controllers/contractsListOuterSql.ts` |
| Cycle aging | `backend/src/services/latePerformance.service.ts` |
| Shipment pipeline status | `backend/src/utils/shipmentPagePipelineSql.ts` |
| Trucking pipeline status | `backend/src/utils/truckingEffectiveStatus.ts` |
| Daily summary refresh SQL | `backend/src/utils/shipmentPipelineDailySummarySql.ts`, `pipelineDailySummarySql.ts` |

---

## 0. Prasyarat

| # | Item | Cara verifikasi | ✓ |
|---|------|-----------------|---|
| 0.1 | Backend & frontend Docker healthy | `GET /health` → 200 | ☐ |
| 0.2 | Migration 096 sudah jalan | Tabel `trucking_pipeline_daily_summary`, `shipment_pipeline_daily_summary`, `pipeline_summary_refresh_meta` ada | ☐ |
| 0.2b | Migration 098 sudah jalan | Tabel `contract_qty_move_snapshot`, `contract_qty_move_snapshot_meta` ada | ☐ |
| 0.2c | Migration 099 sudah jalan | Tabel `contract_sto_agg_snapshot`, `contract_sto_agg_snapshot_meta` ada | ☐ |
| 0.2d | Migration 100 sudah jalan | Tabel `contract_latest_spd_snapshot`, `contract_latest_spd_snapshot_meta` ada | ☐ |
| 0.3 | Pipeline summary fresh | `SELECT module, is_stale, refreshed_at FROM pipeline_summary_refresh_meta;` → `is_stale = false` untuk trucking & shipment | ☐ |
| 0.4 | Refresh manual jika stale | `docker exec klip-backend node dist/scripts/refreshPipelineDailySummary.js` | ☐ |
| 0.5 | Akun uji | Admin + Logistics (scope plant/product jika perlu) | ☐ |
| 0.6 | **Baseline JSON disimpan** sebelum deploy optimasi | Folder `docs/test-reports/baselines/YYYY-MM-DD/` (lihat §1) | ☐ |

**Catatan PowerShell:** gunakan `;` bukan `&&` untuk chain command.

---

## 1. Baseline capture (WAJIB sebelum & sesudah perubahan)

Simpan response API ke file JSON agar bisa diff otomatis/manual.

### 1.1 Parameter filter default (toolbar only — eligible daily summary)

```
dateFrom = YTD start (1 Jan tahun berjalan)
dateTo   = hari ini
plants   = [] (semua) ATAU 1 plant spesifik untuk scope test
status   = ALL
scopeStatus = ALL
```

### 1.2 Endpoint baseline

Jalankan **sebelum** dan **sesudah** optimasi; bandingkan field numerik.

| File baseline | Endpoint |
|---------------|----------|
| `contracts-ytd.json` | `GET /api/contracts?limit=20&dateFrom=...&dateTo=...` |
| `contracts-unassigned.json` | `GET /api/contracts/unassigned-counts?dateFrom=...&dateTo=...` |
| `shipments-list-shell.json` | `GET /api/shipments?compact=true&skipSapJoin=true&includeSummary=false&limit=20&dateFrom=...&dateTo=...` |
| `shipments-summary-live.json` | `GET /api/shipments?summaryOnly=true&limit=1&dateFrom=...&dateTo=...` |
| `shipments-hydrate.json` | `GET /api/shipments?compact=true&skipSapJoin=false&limit=20&dateFrom=...&dateTo=...` |
| `trucking-list-shell.json` | `GET /api/trucking?compact=true&skipSapJoin=true&includeSummary=false&limit=20&dateFrom=...&dateTo=...` |
| `trucking-summary-live.json` | `GET /api/trucking?summaryOnly=true&limit=1&dateFrom=...&dateTo=...` |
| `trucking-hydrate.json` | `GET /api/trucking?compact=true&skipSapJoin=false&limit=20&dateFrom=...&dateTo=...` |
| `contract-perf-summary.json` | `GET /api/contracts/late-performance/summary?dateFrom=...&dateTo=...` |

### 1.3 Kriteria diff baseline

| Tipe field | Toleransi |
|------------|-----------|
| OS qty, qty delivery (kg) | **0** (integer kg) atau ±1 kg jika float rounding |
| Count kartu pipeline | **0** (harus exact match live vs baseline) |
| Cycle days (log/trade/cash/dp) | **0** hari |
| Import status (Open/Close/Cancelled) | Exact string match |
| ETA bucket counts (D, D-2, Delay, …) | Exact match **jika** baseline & after-test di hari yang sama; lihat §6 untuk staleness |

**Screenshot UI (opsional tapi disarankan):** Contracts row, Shipments Section 1 cards, Trucking Section 1 cards — simpan di folder baseline yang sama.

---

## 2. Layer A — Automated tests (backend)

Jalankan dari `backend/`:

```powershell
cd D:\Project\Klip\backend; npm test
```

### 2.1 Test wajib PASS (regression guard)

| Suite | File | Apa yang dilindungi |
|-------|------|---------------------|
| Incoterm matrix | `utils/sapIncotermMetrics.test.ts` | FRC/LCO/CIF/FOB routing, UAT transport MIX |
| OS global SQL | `utils/contractGlobalOutstandingSql.test.ts` | `qty_move`, WB overlay LAND FRC/LCO |
| Delivery status | `utils/contractDeliveryStatus.test.ts` | Open/Close/Cancelled mapping |
| Cycle aging rules | `services/latePerformance.deliveryEnd.test.ts` | Trade cycle late/on-time, delivery end |
| Shipment OS | `utils/shipmentOutstandingQtySql.test.ts` | OS per list row |
| Shipping perf PO | `utils/shippingPerformancePoMetrics.test.ts` | STO net outstanding, over-delivery offset |
| Pipeline eligibility | `services/pipelineDailySummary.service.test.ts` | Fast path hanya date+plant |
| Trucking list | `services/truckingList.service.test.ts` | Summary / cache keys |
| Shipment SAP agg | `utils/shipmentListSapAggSql.test.ts` | skipSapJoin vs full join |
| Integration (jika DB tersedia) | `npm run test:integration` | ITEST-A outstanding = 500 |

| # | Hasil | ✓ |
|---|-------|---|
| 2.A | `npm test` → **0 failed** | ☐ |
| 2.B | `npm run test:integration` → PASS (optional, perlu Postgres test) | ☐ |

---

## 3. Layer B — Live SQL vs Daily Summary (parity kartu)

**Tujuan:** Angka kartu Section 1 dari daily table = angka dari live `summaryOnly` (filter toolbar only).

### 3.1 Trucking (sudah wired)

| # | Langkah | Expected | ✓ |
|---|---------|----------|---|
| B-T1 | `GET /api/trucking?summaryOnly=true&limit=1&dateFrom=...&dateTo=...` | Response `summary.status.*` terisi | ☐ |
| B-T2 | Query DB rollup manual: `SELECT SUM(planned_count), SUM(unplanned_execution_count), ... FROM trucking_pipeline_daily_summary WHERE contract_date BETWEEN ...` | **Exact match** dengan API summary | ☐ |
| B-T3 | Bandingkan total Unplanned card vs `unplannedTable.totalTableRows` | Match (contract backlog + execution) | ☐ |
| B-T4 | Set `pipeline_summary_refresh_meta.is_stale = true` untuk trucking → panggil API lagi | Fallback live SQL; angka **sama** dengan B-T1 sebelum stale (jika data tidak berubah) | ☐ |

### 3.2 Shipments (setelah wire `loadShipmentSummaryFromDaily`)

| # | Langkah | Expected | ✓ |
|---|---------|----------|---|
| B-S1 | `GET /api/shipments?summaryOnly=true&limit=1&dateFrom=...&dateTo=...` | `summary.pipelineStatus.*` terisi | ☐ |
| B-S2 | DB rollup: `SELECT SUM(planned_count), SUM(at_loading_port_count), ... FROM shipment_pipeline_daily_summary WHERE ...` | **Exact match** API | ☐ |
| B-S3 | Unplanned hybrid: `summary.unplannedTable` = contractRows + shipmentRows | Match hybrid breakdown | ☐ |
| B-S4 | ETA loading buckets: `summary.etaLoading.*` | Match SUM kolom `eta_loading_*` di daily table | ☐ |
| B-S5 | ETA discharge buckets: `summary.etaDischarge.*` | Match SUM kolom `eta_discharge_*` | ☐ |
| B-S6 | Stale fallback (sama seperti B-T4) | Live SQL = angka sebelum stale | ☐ |

### 3.3 Filter yang **harus** tetap live SQL (bukan daily)

| # | Request | Expected path | ✓ |
|---|---------|---------------|---|
| B-F1 | `status=PLANNED` + summaryOnly | **Bukan** daily table; angka ≠ rollup global daily | ☐ |
| B-F2 | `globalSearch=ABC` | Live SQL | ☐ |
| B-F3 | Column filter product=CPO | Live SQL | ☐ |
| B-F4 | `scopeStatus=AT_LOADING_PORT` | Live SQL | ☐ |

---

## 4. Layer C — OS Quantity by Incoterm (TIDAK BOLEH BERUBAH)

Gunakan kontrak sampel dari UAT / production clone. Isi kolom "Baseline" sebelum optimasi.

### 4.1 Matriks incoterm — Contracts list

| TC | Contract ID | Incoterm | Transport | Sumber SAP | Field API | Rumus expected | Baseline | After | ✓ |
|----|-------------|----------|-----------|------------|-----------|----------------|----------|-------|---|
| C-01 | `1004030657` | FRC | LAND | Qty Trucking 100,060 kg | `quantity_delivery`, `outstanding_quantity` | Delivery = trucking; OS = ordered − fulfilled | | | ☐ |
| C-02 | `1364001990` | LCO | LAND | GR STO = Open | `import_status` | **GR STO** (bukan GR PO) | | | ☐ |
| C-03 | `1014003049` | CIF | MIX | STO Type T, trucking 300,550 | `quantity_delivery` | UAT matrix: trucking leg | | | ☐ |
| C-04 | `1014003019` | FOB | MIX | STO Type V, vessel 249,490 | Shipment/trucking OS | Vessel leg | | | ☐ |
| C-05 | `1004026972` | LCO | LAND | GR STO = Close | `import_status` | Close dari GR STO | | | ☐ |
| C-06 | `ITEST-A` (integration) | FOB | — | 2 STO: 400+100 delivered | `outstanding_quantity` | 1000 − 500 = **500** | | | ☐ |

**API:** `GET /api/contracts?search={contract_id}&limit=5`

### 4.2 Multi-STO & over-delivery

| TC | Skenario | Expected | ✓ |
|----|----------|----------|---|
| C-07 | Kontrak multi-STO, satu STO over-delivery | OS signed boleh **negatif** (hijau di UI); tidak di-floor ke 0 di contracts list signed expr | ☐ |
| C-08 | STO count > 1 dan sum qty > 120% ordered | `qty_move` pakai max-per-STO cap (dedup rule) | ☐ |
| C-09 | Shipping Performance STO `1646000083` pattern | Over-delivery satu PO offset STO outstanding (net) | ☐ |

**Referensi test:** `shippingPerformancePoMetrics.test.ts`

### 4.3 LAND FRC/LCO + WB daily actuals overlay

| TC | Skenario | Expected | ✓ |
|----|----------|----------|---|
| C-10 | Kontrak LAND FRC/LCO dengan `trucking_daily_actuals` / WB upload | `qty_move` prefer `trucking_operations.quantity_delivered` overlay | ☐ |
| C-11 | Tanpa WB upload | Fallback ke SAP SPD aggregate | ☐ |

**Verifikasi:** bandingkan `GET /api/contracts` OS vs `GET /api/trucking` qty untuk kontrak yang sama.

### 4.4 Shipments / Trucking OS (planning vs actual)

| TC | Endpoint | Field | Expected | ✓ |
|----|----------|-------|----------|---|
| C-12 | `GET /api/shipments` (hydrate) | OS planning / actual per STO | Sama dengan baseline JSON §1.2 | ☐ |
| C-13 | `GET /api/shipments/contracts/details?sto=...` | Global OS Plan | Match `sqlContractGlobalOutstandingExpr` | ☐ |
| C-14 | `GET /api/trucking` (hydrate) | `outstanding_qty` / planning fields | Match baseline | ☐ |
| C-15 | Unplanned planning upload validation | Total planning = OS qty (± toleransi kg) | `truckingUnplannedPlanningOsQty` rules | ☐ |

---

## 5. Layer D — Cycle Aging (TIDAK BOLEH BERUBAH)

Optimasi daily summary **tidak** menyentuh layer ini — tetap wajib dicek jika ada refactor paralel.

### 5.1 Contracts list computed fields

| TC | Contract profile | Field | Rule (ringkas) | Baseline | After | ✓ |
|----|------------------|-------|----------------|----------|-------|---|
| D-01 | Open SEA, ada standard ETA | `trade_cycle_days`, `contract_perf_on_time` | Condition A: cycle 0 = on-time | | | ☐ |
| D-02 | Open SEA, **tanpa** standard ETA | `trade_cycle_days` | Condition B: cycle 0 = **late** | | | ☐ |
| D-03 | Open, delivery_end null di DB & SAP | `log_cycle_days` | Skip / null per `resolveEffectiveDeliveryEnd` | | | ☐ |
| D-04 | Paid contract | `cash_cycle_days` | payoff date − contract date | | | ☐ |
| D-05 | DP date present | `dp_cycle_days` | SAP DP calendar rules | | | ☐ |

**API:** `GET /api/contracts?...&sort=trade_cycle_days` (Node sort path) + Contract Performance mode.

### 5.2 Contract Performance tree

| # | Langkah | Expected | ✓ |
|---|---------|----------|---|
| D-06 | `GET /api/contracts/late-performance/summary` vs baseline | Late/on-time counts exact | ☐ |
| D-07 | `GET /api/contracts/late-performance/tree` — sample branch | Trade cycle late flag konsisten dengan D-01/D-02 | ☐ |
| D-08 | Filter Section 3 `lateIndicator=LATE` | Row set sama dengan baseline | ☐ |

---

## 6. Layer E — Staleness & timing (bukan rumus baru, tapi boleh beda angka)

**Document expected behavior** — bukan failure jika memang by design.

| # | Skenario | Expected behavior | Pass criteria |
|---|----------|-------------------|---------------|
| E-01 | Refresh daily summary jam 06:00; user buka jam 17:00 | ETA bucket pakai `CURRENT_DATE` **saat refresh** | Kartu ETA **boleh** beda ±1 bucket vs live; dokumentasikan delta |
| E-02 | Setelah SAP import | `is_stale=true` → refresh debounce 60s | User melihat live SQL sampai refresh selesai |
| E-03 | Setelah edit shipment/trucking status | Cache invalid + stale | Kartu update setelah refresh; **baris tabel** tetap live |
| E-04 | Filter plant spesifik | Daily rollup WHERE plant match | Count ≤ global total |

**Acceptance:** Jika E-01 delta > 0, wajib catat di sign-off; bukan blocker kecuali product minta real-time ETA cards.

---

## 7. Layer F — Shell vs Hydrate parity (optimasi triple-fetch)

| # | Langkah | Expected | ✓ |
|---|---------|----------|---|
| F-01 | Load Shipments — bandingkan row `id`/STO key shell vs hydrate | Same row set, same count pagination | ☐ |
| F-02 | Field **non-SAP** (status KLIP, ETA manual, plant) | Identik shell & hydrate | ☐ |
| F-03 | Field **SAP** (vessel SAP, ext no, SAP qty) | Shell kosong/null → hydrate terisi; **nilai hydrate = baseline hydrate JSON** | ☐ |
| F-04 | Ulangi F-01–F-03 untuk Trucking | Same rules | ☐ |
| F-05 | Contracts (single fetch) — tidak ada shell/hydrate split | OS qty & import status ada di response pertama | ☐ |

---

## 8. Layer G — UI smoke + screenshot

Login Logistics; hard refresh (`Ctrl+Shift+R`).

| # | Halaman | Screenshot | Cek visual | ✓ |
|---|---------|------------|------------|---|
| G-01 | `/contracts` | Row kontrak C-01..C-06 | OS qty, import status, qty delivery | ☐ |
| G-02 | `/contract-performance` | Summary + tree | Late count, cycle columns | ☐ |
| G-03 | `/shipments` | Section 1 cards + table page 1 | Kartu = API summary; baris = hydrate | ☐ |
| G-04 | `/shipments` tab UNPLANNED | Hybrid table + cards | contractRows + shipmentRows | ☐ |
| G-05 | `/trucking` | Section 1 cards + table | Kartu daily = live (B-T2) | ☐ |
| G-06 | Edit Shipment modal | 1 STO sample | `/edit-payload` qty = list hydrate | ☐ |
| G-07 | Network tab | Shipments load | 2–3 request (shell, summary, hydrate) — catat timing | ☐ |

---

## 9. Layer H — Denormalisasi SAP snapshot (HANYA jika fase ini diimplementasi)

| # | Test | Expected | ✓ |
|---|------|----------|---|
| H-01 | Snapshot OS qty = live `qty_move` untuk 20 kontrak random | Exact match | ☐ |
| H-02 | Setelah SAP re-import | Snapshot ter-update; match live | ☐ |
| H-03 | Setelah WB trucking upload | LAND FRC/LCO overlay ter-update | ☐ |
| H-04 | Edit manual qty KLIP | Snapshot invalidate / recalc | ☐ |
| H-05 | Rollback: flag OFF → baca live SQL | Angka kembali ke baseline §1 | ☐ |

---

## 10. Script bantu (PowerShell)

### 10.0 Jalankan semua (disarankan)

```powershell
.\docs\test-reports\scripts\run-performance-regression.ps1
```

Parity daily vs live (Docker):

```powershell
docker exec klip-backend node dist/scripts/performanceRegressionShipmentSummary.js
docker exec klip-backend node dist/scripts/performanceRegressionContractQtySnapshot.js
docker exec klip-backend node dist/scripts/performanceRegressionContractStoAggSnapshot.js
docker exec klip-backend node dist/scripts/performanceRegressionContractLatestSpdSnapshot.js
```

### 10.1 Login & simpan token

```powershell
$login = Invoke-RestMethod -Uri "http://127.0.0.1:5001/api/auth/login" -Method POST `
  -ContentType "application/json" -Body '{"username":"admin","password":"admin123"}'
$token = $login.data.token
$headers = @{ Authorization = "Bearer $token" }
```

### 10.2 Ambil baseline shipments summary

```powershell
$yr = (Get-Date).Year
$uri = "http://127.0.0.1:5001/api/shipments?summaryOnly=true&limit=1&dateFrom=${yr}-01-01&dateTo=$(Get-Date -Format yyyy-MM-dd)"
Invoke-RestMethod -Uri $uri -Headers $headers | ConvertTo-Json -Depth 20 |
  Out-File "docs/test-reports/baselines/$(Get-Date -Format yyyy-MM-dd)/shipments-summary-live.json"
```

### 10.3 Bandingkan daily table vs API (psql / Docker)

```powershell
docker exec -it klip-postgres psql -U postgres -d klip_db -c "
  SELECT SUM(planned_count) AS planned, SUM(total_count) AS total
  FROM shipment_pipeline_daily_summary
  WHERE contract_date >= '2026-01-01';
"
```

---

## 11. Sign-off

| Role | Nama | Tanggal | Layer lulus | Catatan |
|------|------|---------|-------------|---------|
| QA / Logistics | | | A ☐ B ☐ C ☐ D ☐ E ☐ F ☐ G ☐ | |
| Dev backend | | | A ☐ B ☐ | |
| Product owner | | | E staleness accepted ☐ | |

### Definisi GO / NO-GO

| Status | Kondisi |
|--------|---------|
| **GO** | Layer A PASS; C & D **zero delta** vs baseline; B exact match daily vs live (filter toolbar); F hydrate = baseline |
| **GO dengan catatan** | E-01 ETA card staleness diterima product; performance gain terdokumentasi |
| **NO-GO** | Any C atau D delta tanpa penjelasan bisnis; B mismatch daily vs live; F SAP field salah setelah hydrate |

---

## 12. Quick reference — kontrak sampel UAT

| Contract | Incoterm | Transport | Fokus test |
|----------|----------|-----------|------------|
| `1004030657` | FRC | LAND | Qty trucking, GR PO status |
| `1364001990` | LCO | LAND | GR STO vs GR PO |
| `1014003049` | CIF | MIX + STO-T | UAT qty matrix |
| `1014003019` | FOB | MIX + STO-V | Vessel qty |
| `1004026972` | LCO | LAND | GR STO Close |
| `ITEST-A` | FOB | Integration | Multi-STO OS = 500 |

Lihat juga: `docs/test-reports/SAP-UAT-Status-QtyDelivery-Test-Report.md`

---

## Lampiran — Mapping optimasi → layer test

| Optimasi | Layer wajib | Layer opsional |
|----------|-------------|----------------|
| Wire shipment daily summary | A, B-S*, B-F*, G-03 | E |
| Kurangi triple-fetch | F, G-07 | — |
| Lazy filter-options / vessel-idle | G (timing only) | — |
| Denormalisasi SAP snapshot | H (+ semua C) | — |
| Jadwalkan refresh off-peak | E | — |
