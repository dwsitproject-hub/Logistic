# Laporan Uji SAP UAT — Status & Quantity Delivery

**Tanggal:** 1 Juli 2026  
**Environment:** Local Docker (`localhost:3001` / `localhost:5001`)  
**Scope:** Format import SAP baru — routing **Status** (GR PO vs GR STO) dan **Quantity Delivery** (Trucking vs Vessel + transport/STO type)

---

## 1. Aturan bisnis (target UAT)

### Status kontrak
| Incoterm | Sumber status SAP |
|----------|-------------------|
| CIF, FRC | **GR PO Status** |
| FOB, LCO | **GR STO Status** |

### Quantity Delivery
| Kondisi | Kolom SAP |
|---------|-----------|
| FRC, LCO + **LAND** | Quantity Delivery **Trucking** |
| CIF, FOB + **SEA** | Quantity Delivery **Vessel** |
| CIF, FOB + **MIX** + STO Type **T** | Quantity Delivery **Trucking** |
| CIF, FOB + **MIX** + STO Type **V** | Quantity Delivery **Vessel** |

---

## 2. Ringkasan hasil uji

| Layer | Hasil | Keterangan |
|-------|-------|------------|
| Unit test backend (36 test) | **PASS 36/36** | `sapIncotermMetrics`, `contractDeliveryStatus`, `contractGlobalOutstandingSql`, STO type scope |
| Integration SQL+API (80 check, 40 kontrak) | **PASS 55 / FAIL 25** | Semua kegagalan pada **qty delivery CIF/FOB** — logic belum pakai transport + STO Type |
| API spot-check (4 kontrak kunci) | **2 PASS / 2 FAIL** | Lihat §4 |

**Kesimpulan:** Parsing SAP UAT dan routing status **sudah benar di layer canonical** (`sqlContractImportStatusExpr`, split trucking/vessel di `qty_move`). Namun **beberapa UI/list masih pakai logic lama**, dan **matrix qty delivery belum lengkap** (transport + STO Type untuk CIF/FOB MIX belum diimplementasi).

---

## 3. Matriks surface UI / API

| Surface | Status kontrak | Qty Delivery | Sesuai UAT? |
|---------|----------------|--------------|-------------|
| **Contracts — view table** | `import_status` dari raw `contract.status` (GR PO saja) | Incoterm-only (`sqlIncotermQuantityDeliveryCase`) | **Status: FAIL** untuk FOB/LCO; **Qty: PARTIAL** |
| **Contract Detail Modal** | Data dari list API (sama) | `contract.quantity_delivery` dari list | **Sama dengan list** |
| **Trucking — view table** | `SQL_CONTRACT_IMPORT_STATUS` (GR PO/STO by incoterm) | Outstanding: FRC→receive, LCO→delivered (bukan kolom trucking SAP) | **Status: PASS**; **Qty/outstanding: PARTIAL** |
| **Shipments — view table** | `SQL_CONTRACT_IMPORT_STATUS` | Outstanding: rules lama (receive vs delivery) | **Status: PASS**; **Qty: PARTIAL** |
| **Edit Shipment Modal** | — | PO outstanding via `sqlContractGlobalOutstandingExpr` | **Qty global: PASS** (incoterm-only) |
| **Dashboard KPI** | — | `qm.quantity_delivery` + receive/delivery lama | **FAIL** |
| **Oil Loss** | — | Raw `Quantity Delivery` (legacy) | **FAIL** |
| **Late Performance** | Raw GR PO | Receive/delivery lama | **FAIL** |

---

## 4. Spot-check API (kontrak sampel)

### TC-01 — `1004030657` (FRC, LAND, trucking=100,060 kg)
| Field | SAP | API Contracts List | Expected | Result |
|-------|-----|-------------------|----------|--------|
| import_status | GR PO = Close | Close | Close | **PASS** |
| quantity_delivery | Trucking 100,060 | 100,060 | 100,060 | **PASS** (fix NULLIF+incoterm sudah aktif) |
| Modal Qty Delivery | — | ~100.06 MT | 100.06 MT | **PASS** |

### TC-02 — `1364001990` (LCO, GR PO=Close, GR STO=**Open**)
| Field | SAP | API Contracts List | Expected | Result |
|-------|-----|-------------------|----------|--------|
| import_status | GR STO = **Open** | **Close** (GR PO) | Open | **FAIL** |
| quantity_delivery | Trucking 0 | 0 | 0 | PASS (data SAP nol) |

**Root cause:** `contractsListOuterSql.ts` baris 65 — `latest_spd_data->'contract'->>'status'` (GR PO only).

### TC-03 — `1014003049` (CIF, MIX, STO Type **T**, trucking=300,550)
| Field | SAP | API Contracts List | Expected | Result |
|-------|-----|-------------------|----------|--------|
| import_status | GR PO = Close | Close | Close | **PASS** |
| quantity_delivery | Trucking 300,550 | **0** | 300,550 | **FAIL** |

**Root cause:** `sqlIncotermQuantityDeliveryCase` untuk CIF selalu ambil **vessel**; vessel=0 → tampil 0. Belum ada branch MIX + STO Type T.

### TC-04 — `1014003019` (FOB, MIX, STO Type **V**, vessel=249,490)
| Field | SAP | API | Expected | Result |
|-------|-----|-----|----------|--------|
| quantity_delivery | Vessel 249,490 | Tidak muncul di contracts search | 249,490 | **INCONCLUSIVE** (kontrak tidak di slice list; perlu cek shipment/trucking) |

### TC-05 — `1004026972` (LCO, GR STO=Close)
| Field | Expected (GR STO) | Canonical SQL | Contracts list |
|-------|-------------------|---------------|----------------|
| import_status | Close | Close | Close (kebetulan GR PO=GR STO) | PASS |

---

## 5. Skenario positif & negatif

### Positif (PASS)
- FRC/LCO + LAND → qty dari kolom **Trucking** (`1004030657`, `1004022767`)
- CIF/FRC → status dari **GR PO** di trucking/shipment list & STO detail
- FOB/LCO → status dari **GR STO** di trucking list (`SQL_CONTRACT_IMPORT_STATUS`)
- Unit test UAT field mapping (`sapMasterV2UatFormat.test.ts`) — kolom split ter-parse
- `qty_move` tidak lagi mask trucking dengan vessel=0 (NULLIF fix)

### Negatif (FAIL / GAP)
- LCO/FOB dengan **GR PO ≠ GR STO** → contracts list/modal tampil GR PO (`1364001990`)
- CIF/FOB + **MIX + STO T** → qty delivery = 0 padahal trucking terisi (25 kontrak di integration test)
- CIF + SEA + STO T dengan trucking terisi, vessel=0 → per spec strict SEA=vessel → 0 (by design); perlu konfirmasi bisnis apakah STO T di SEA pakai trucking
- Dashboard, Oil Loss, Late Performance masih logic lama
- Trucking outstanding: FRC pakai **receive**, bukan Qty Delivery Trucking
- Help text frontend (`fieldHelpText.ts`) masih dokumentasi rules lama

---

## 6. Backend test files dijalankan

```
vitest run sapIncoterm contractDelivery contractGlobalOutstanding 
  shipmentStoType truckingStoType truckingIncoterm sapMasterV2Uat
→ 7 files, 36 tests, ALL PASS
```

Script integrasi: `backend/src/scripts/testSapUatStatusQtyDelivery.ts`  
PowerShell API: `docs/test-reports/sap-uat-status-qty-api-test.ps1`

---

## 7. Rekomendasi perbaikan (prioritas)

1. **P0 — Contracts list `import_status`:** ganti ke `sqlContractImportStatusExpr` di `contractsListOuterSql.ts`
2. **P0 — Qty delivery matrix:** extend `sapIncotermMetrics.ts` dengan transport + STO Type; update `contract.controller.ts` + outstanding
3. **P1 — Trucking/Shipment outstanding:** selaraskan dengan kolom trucking/vessel SAP (bukan receive/delivery lama)
4. **P2 — Dashboard, Oil Loss, Late Performance, fieldHelpText, ContractDetailModal labels**

---

## 8. Cara reproduksi

```powershell
# Login
$login = Invoke-RestMethod -Uri "http://localhost:5001/api/auth/login" `
  -Method POST -Body '{"username":"admin","password":"admin123"}' -ContentType "application/json"
$h = @{ Authorization = "Bearer $($login.data.token)" }

# Contracts list
Invoke-RestMethod -Uri "http://localhost:5001/api/contracts?search=1004030657&limit=3" -Headers $h

# Integration script
cd backend
$env:DB_PORT='5433'; $env:DB_USER='klip_user'; $env:DB_PASSWORD='change-me'
npx ts-node --transpile-only src/scripts/testSapUatStatusQtyDelivery.ts
```

**UI:** Buka `http://localhost:3001/contracts` → search contract no → buka modal detail → bandingkan Status & Qty Delivery dengan tabel §4.

---

## 9. Screenshot checklist (manual)

| # | Halaman | Aksi | Contract sampel |
|---|---------|------|-----------------|
| 1 | Contracts table | Kolom Status + Qty Delivery | 1004030657, 1364001990, 1014003049 |
| 2 | Contract Detail Modal | Section Quantity | sama |
| 3 | Trucking table | Contract Status | 1004026972 |
| 4 | Shipments table | Contract Status + Outstanding | 1014003049 |
| 5 | Edit Shipment Modal | PO outstanding | CIF/FOB MIX |

*Screenshot dapat diambil setelah hard refresh (Ctrl+Shift+R).*

---

**Tester:** KLIP Agent (automated SQL + API + unit test)  
**Status overall:** **PARTIAL PASS** — FRC/LAND qty & canonical status OK; **FOB/LCO status di contracts list** dan **CIF/FOB MIX qty** belum sesuai UAT.
