# PRD — Halaman Oil Loss
**KLIP (KPN Logistics Intelligence Platform)**
Versi: 1.0 | Tanggal: 2026-05-08 | Status: Released

---

## 1. Latar Belakang & Tujuan

Dalam proses pengiriman CPO/minyak sawit, selalu ada potensi selisih antara kuantitas yang dikirim (Qty Delivery) dengan kuantitas yang diterima (Qty Receive) di lokasi tujuan. Selisih negatif ini disebut **Oil Loss** — kehilangan kuantitas selama transportasi, baik melalui jalur darat (trucking) maupun jalur laut (shipment).

Halaman Oil Loss hadir untuk memberikan visibilitas terpusat atas semua kejadian oil loss per kontrak, memudahkan analisis pola kehilangan berdasarkan moda transport, produk, plant/site, grup supplier, dan supplier secara hierarki.

---

## 2. Sumber Data

- **Tabel:** `sap_processed_data` (data upload dari SAP via menu SAP Data)
- **Field utama (JSONB `data->'raw'`):**

| Field SAP | Keterangan |
|---|---|
| `SEA / LAND` | Moda transport (`SEA` / `LAND`). Default: `LAND` jika kosong |
| `Contract No` | Nomor kontrak |
| `Contract Ext No` | Nomor kontrak eksternal (jika ada, dijadikan Operation ID utama) |
| `STO No` | Nomor STO |
| `PO No` | Nomor PO |
| `Supplier` | Nama supplier |
| `Buyer` | Nama buyer |
| `Product` | Nama produk |
| `Vendor Group` | Grup supplier |
| `Vessel Discharge Port` | Lokasi bongkar (SEA) |
| `Truck Discharge Location` | Lokasi bongkar (LAND) |
| `Contract Date` | Tanggal kontrak (format SAP: `M/D/YY`, dinormalisasi ke `YYYY-MM-DD`) |
| `Status` | Status kontrak |
| `Quantity Delivery` | Qty yang dikirim (Kg, bisa mengandung koma/spasi) |
| `Quantity Receive` | Qty yang diterima (Kg, bisa mengandung koma/spasi) |

---

## 3. Aturan Bisnis & Scope Data

### 3.1 Data yang ditampilkan sebagai Oil Loss
Record dimasukkan ke halaman ini **hanya jika memenuhi semua kondisi berikut:**

1. `Quantity Receive` < `Quantity Delivery` → ada selisih kurang (loss)
2. `Status` = `close` (case-insensitive) → kontrak sudah selesai/closed
3. Nilai `Quantity Delivery` dan `Quantity Receive` keduanya tidak kosong dan merupakan angka valid (lolos validasi regex `^[0-9.]+$` setelah strip koma dan spasi)

### 3.2 Kalkulasi utama
| Field | Formula |
|---|---|
| **Oil Loss (Kg)** | `Qty Receive − Qty Delivery` (nilai negatif) |
| **Oil Loss %** | `(Qty Receive − Qty Delivery) / Qty Delivery × 100` dibulatkan 4 desimal |
| **Plant/Site** | Jika SEA → `Vessel Discharge Port`; jika LAND → `Truck Discharge Location` |
| **Operation ID** | `Contract Ext No` jika ada, fallback ke `Contract No` |

### 3.3 Normalisasi tanggal
`Contract Date` dari SAP disimpan dalam format `M/D/YY` (contoh: `1/5/26`). Backend mengonversinya ke `YYYY-MM-DD` menggunakan `TO_CHAR(TO_DATE(..., 'MM/DD/YY'), 'YYYY-MM-DD')` sebelum dikirim ke frontend, agar perbandingan tanggal di filter berjalan benar.

---

## 4. Struktur Halaman

Halaman terdiri dari **3 section utama** yang disusun secara vertikal:

```
┌─────────────────────────────────────────┐
│  Section 1: Oil Loss Performance (YTD)  │
│  [KPI Cards] + [Drilldown]              │
├─────────────────────────────────────────┤
│  Section 2: Filter Panel                │
├─────────────────────────────────────────┤
│  Section 3: Tabel Detail (All Records)  │
└─────────────────────────────────────────┘
```

---

## 5. Section 1 — Oil Loss Performance (YTD)

### 5.1 KPI Cards (5 cards, responsif 2 kolom mobile / 5 kolom desktop)

| Card | Nilai | Warna |
|---|---|---|
| **Records with loss** | Jumlah record oil loss (setelah filter tanggal/mode/produk/plant) | Abu-abu |
| **Total loss (MT)** | Jumlah Oil Loss (Kg) dikonversi ke Metric Ton | Merah |
| **Avg loss %** | Rata-rata Oil Loss % dari semua record | Abu-abu |
| **Max loss %** | Nilai Oil Loss % tertinggi dari semua record | Abu-abu |
| **Total gain (MT)** | Total kuantitas kontrak `Close` di mana Qty Receive > Qty Delivery, dikonversi ke MT. Bersumber dari query terpisah di backend. Sebagai informasi tambahan — perlu validasi kualitas data SAP | Hijau |

> **Catatan:** KPI Cards (kecuali Total Gain) dipengaruhi oleh filter top-level (Mode, Product, Plant/Site, Operation Date). Total Gain adalah nilai fixed dari backend dan tidak berubah mengikuti filter frontend.

### 5.2 Drilldown Panel

Drilldown adalah navigasi hierarki interaktif untuk mempersempit fokus data di tabel bawah. Terdiri dari **5 kolom panel** yang disusun horizontal:

```
Mode → Product → Plant/Site → Group → Supplier
```

**Perilaku:**
- Setiap panel menampilkan daftar node yang dapat diklik, diurutkan berdasarkan **total loss terbesar** di atas.
- Setiap node menampilkan: nama node, progress bar (proporsi terhadap total loss), jumlah record, dan total loss dalam MT.
- Klik pada node di level tertentu akan **otomatis me-reset semua level di bawahnya** dan memfilter tabel sesuai pilihan.
- Tombol **"Reset selection"** menghapus semua pilihan drilldown sekaligus.
- Setiap level hanya bisa dipilih jika level di atasnya sudah dipilih (kecuali Mode yang bisa langsung dipilih).

**Cascade reset:**
| Klik level | Direset otomatis |
|---|---|
| Mode | Product, Plant, Group, Supplier |
| Product | Plant, Group, Supplier |
| Plant | Group, Supplier |
| Group | Supplier |
| Supplier | — |

**Warna tema per level:**

| Level | Warna |
|---|---|
| Mode | Sky (biru muda) |
| Product | Amber (kuning) |
| Plant/Site | Violet (ungu) |
| Group | Emerald (hijau) |
| Supplier | Rose (merah muda) |

---

## 6. Section 2 — Filter Panel

Filter top-level mempengaruhi KPI Cards, Drilldown, dan Tabel secara bersamaan.

| Filter | Tipe | Keterangan |
|---|---|---|
| **Search** | Text input | Pencarian bebas pada field: Operation ID, Contract No, Contract Ext No, STO No, PO No, Supplier, Group |
| **Mode** | Dropdown | `All Modes` / `LAND` / `SEA` |
| **Product** | Multi-select searchable | Daftar produk unik dari data yang ada |
| **Plant/Site** | Multi-select searchable | Daftar plant/site unik dari data yang ada |
| **Operation Date From** | Date input | Filter tanggal mulai (default: 1 Januari tahun berjalan) |
| **Operation Date To** | Date input | Filter tanggal akhir (default: hari ini) |
| **Apply** | Button | Menerapkan filter tanggal (filter lainnya reaktif otomatis) |
| **Clear** | Button (kondisional) | Menghapus filter tanggal, muncul hanya jika ada nilai tanggal |

**Default filter saat halaman pertama dibuka:**
- Operation Date: `1 Jan [tahun berjalan]` s/d `hari ini`
- Mode: All
- Product & Plant: kosong (semua)

---

## 7. Section 3 — Tabel Detail (All Records)

### 7.1 Kolom Tabel

| Kolom | Default Visible | Tipe |
|---|---|---|
| Mode | ✅ | Badge: `LAND` (oranye) / `SEA` (biru) |
| Group | ✅ | Text |
| Supplier | ✅ | Text |
| Product | ✅ | Text |
| Plant/Site | ✅ | Text |
| Operation ID | ✅ | Text |
| Contract No | ❌ | Text |
| Contract Ext No | ❌ | Text |
| STO No | ❌ | Text |
| PO No | ❌ | Text |
| Status | ✅ | Text |
| Date | ✅ | Text (format `YYYY-MM-DD`) |
| Qty Sent (Kg) | ✅ | Number |
| Qty Received (Kg) | ✅ | Number |
| Oil Loss (Kg) | ✅ | Number — merah jika negatif, hijau jika positif |
| Oil Loss % | ✅ | Number — merah jika negatif, hijau jika positif |

### 7.2 Fitur Tabel

| Fitur | Keterangan |
|---|---|
| **Sort** | Klik header kolom untuk sort ASC/DESC. Default sort: Oil Loss (Kg) ascending (loss terbesar di atas) |
| **Column filter** | Filter per-kolom via icon di header — menampilkan popover input teks |
| **Column manager** | Tombol "Columns" → checklist untuk show/hide kolom |
| **Drag & drop** | Header kolom bisa di-drag untuk mengubah urutan kolom |
| **Pagination** | 20 record per halaman, navigasi halaman di atas dan bawah tabel |
| **Dual scrollbar** | Scrollbar horizontal di atas dan bawah tabel tersinkronisasi |
| **Drilldown filter** | Pilihan di drilldown panel mempersempit record yang tampil di tabel |

---

## 8. API Endpoint

### `GET /api/oil-loss`

**Auth:** Bearer token (JWT)

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "transport_mode": "LAND | SEA",
      "operation_id": "...",
      "contract_number": "...",
      "contract_ext_no": "...",
      "sto_number": "...",
      "po_number": "...",
      "supplier": "...",
      "buyer": "...",
      "product": "...",
      "group_name": "...",
      "plant_site": "...",
      "operation_date": "YYYY-MM-DD",
      "status": "close",
      "quantity_sent": 123456.78,
      "quantity_received": 123000.00,
      "gain_loss_amount": -456.78,
      "gain_loss_percentage": -0.3705
    }
  ],
  "gainSummary": {
    "totalGainKg": 9876543.21,
    "gainCount": 42
  }
}
```

- `data` → array record oil loss (qty_receive < qty_delivery, status close), diurutkan loss terbesar di atas
- `gainSummary` → agregat dari query terpisah: record dengan qty_receive > qty_delivery, status close

---

## 9. Permission & Akses

| Role | Akses |
|---|---|
| ADMIN | Full (view, create, edit, delete) |
| MANAGEMENT | View only |
| SUPPORT | View only |
| LOGISTICS | View only |
| Role lainnya | Tidak tampil di navigasi |

Permission key: `page.oil_loss`
Migration: `055_add_oil_loss_permission.sql`

---

## 10. Navigasi

- Menu sidebar: **Oil Loss** dengan ikon `Droplets` (Lucide)
- Posisi: setelah menu Claim Susut
- URL: `/oil-loss`

---

## 11. Catatan & Limitasi

1. **Total Gain tidak difilter oleh filter frontend** — nilainya adalah agregat global dari backend dan tidak berubah saat user memilih filter Mode/Product/Plant/tanggal. Ini by design karena dimaksudkan sebagai informasi referensi global.

2. **Kualitas data Total Gain** — nilai Total Gain bisa jauh lebih besar dari Total Loss. Kemungkinan disebabkan oleh correction entry SAP, unit mismatch, atau data entry error. Perlu validasi lebih lanjut bersama tim SAP sebelum dijadikan metrik resmi.

3. **Hanya kontrak Close** — baik Loss maupun Gain hanya menghitung record dengan `Status = 'close'`. Kontrak yang masih Open tidak termasuk karena kuantitas delivery belum final.

4. **Blank handling** — field kosong ditampilkan sebagai `Blank` di drilldown dan diperlakukan sebagai nilai tunggal, bukan diabaikan.

5. **Semua komputasi dilakukan client-side** — data di-fetch sekali saat halaman dibuka, seluruh filter, drilldown, sort, dan paginasi diproses di browser tanpa request ulang ke backend.
