# Changelog — Contracts & Contract Performance
**Tanggal:** 2026-05-11

---

## View Table

### Freeze / Actions Column
- Gap besar antara kolom data terakhir dan kolom Actions dihilangkan.
- Lebar grid template disesuaikan: `120px` untuk Contracts, `60px` untuk Contract Performance.

### Trade Cycle & Cash Cycle — wording di kolom tabel
- Sebelumnya: `X days` (dengan warna merah/hijau)
- Sekarang: `X day(s) overdue` (merah) / `X day(s) left` (hijau) / `0 days` (abu-abu)

### Visible Columns panel
- Tombol Close, Reset, Select All, Unselect All dipindahkan ke **atas** daftar kolom.
- Tombol Close diganti menjadi **icon X**.
- "Reset Default" disingkat menjadi **Reset**, sejajar dengan Select All & Unselect All dalam satu baris.

---

## Contract Performance (khusus)

### Default kolom yang langsung tampil
Diubah menjadi: `Group → Supplier → Contract No → PO Number → Trade Cycle → Outstanding Qty`

### Month Delivery End
- Disembunyikan dari tampilan default.
- Tetap bisa dimunculkan via Visible Columns.
- Storage key di-bump ke `v5` agar preference lama direset.

---

## Modal View (berlaku di Contracts & Contract Performance)

### Struktur modal
Dirombak dari flat menjadi 5 section terpisah dengan pemisah horizontal antar section.

| Section | Isi |
|---|---|
| **Highlight Information** | Contract Date, Qty Contract, Outstanding Qty, Incoterm, Supplier |
| **Contract Detail** | Ext No, Source/Contract Type, B2B Flag, LT/SPOT, PO Number, tanggal-tanggal, Log/Trade/Cash Cycle, info pembayaran |
| **Product Detail** | Product, Qty Contract, Total STO Qty, Qty Delivery, Qty Receive, Outstanding Qty, Over/Under Delivery Status |
| **Supplier Detail** | Buyer, Supplier, Group Name, Company Name, B2B Parties (jika applicable) |
| **Shipment Detail** | Performance summary (Contract Performance only) + tabel STO |
| **Documents** | Daftar dokumen yang diupload |
| **Activity** | Activity Log & Comments |

### Highlight Information — konten
- Sebelumnya: Status, Delivery Status, Unusual Flag, Transport Mode, Incoterm, Outstanding Qty
- Sekarang: Contract Date, Qty Contract, Outstanding Qty, Incoterm, Supplier

### Qty Contract di Highlight Information
- Diubah dari satuan **MT** menjadi **Kg** (menggunakan `formatNumber`).

### Trade Cycle & Cash Cycle di modal
- Menggunakan wording yang sama dengan tabel: `X day(s) overdue` / `X day(s) left` / `0 days`.

---

## File yang Diubah

| File | Perubahan |
|---|---|
| `frontend/src/app/contracts/page.tsx` | Semua perubahan di atas |
| `frontend/src/app/contract-performance/page.tsx` | Re-export dari contracts/page — otomatis ikut semua perubahan |
