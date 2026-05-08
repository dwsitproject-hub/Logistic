# PRD — Customer 360
**KLIP (KPN Logistics Intelligence Platform)**
Versi: 1.1 | Tanggal: 2026-05-08 | Status: Released

---

## 1. Latar Belakang & Tujuan

Halaman Customer 360 menyediakan profil mendalam per supplier group — mencakup identitas perusahaan, estimasi produksi, sebaran geografis, kinerja armada pengiriman, dan daftar mill. Tujuannya adalah memberi tim procurement dan manajemen satu tampilan terpadu untuk memahami profil lengkap seorang customer/supplier tanpa harus berpindah sistem.

- **URL:** `/customer-360-company`
- **Menu Sidebar:** Customer 360
- **Posisi:** Setelah menu Suppliers

---

## 2. Sumber Data

| Tabel | Peran |
|---|---|
| `suppliers` | Data mill level — produksi estimasi, lokasi, sertifikasi, group_id |
| `supplier_groups` | Profil level grup — PIC, land bank, credit rating, financial info |
| `contracts` | Loading method (transport_mode unik per grup, non-Cancelled) |
| `shipments` | Metrik armada — voyage, volume, vessel unik, avg lead time |

---

## 3. Alur Pengguna

1. Pengguna mengetik nama Group ID di kotak pencarian
2. Sistem menampilkan dropdown hasil (maks. 25 grup)
3. Pengguna memilih satu grup → profil lengkap tampil di bawah
4. Pengguna dapat klik tombol 👁 pada "Mill Quantity" untuk melihat daftar mill di modal

---

## 4. Section 1 — Select Customer (Search)

| Elemen | Perilaku |
|---|---|
| Text input | Placeholder "Search by Group ID...", pencarian ILIKE pada field `group_id` |
| Dropdown hasil | Maks. 25 item; tiap item tampilkan `group_id` dan `parent_company · islands` |
| Tombol X | Menghapus pencarian dan menutup profil |
| Badge terpilih | Badge biru menampilkan group_id dan parent_company setelah dipilih |

---

## 5. Section 2 — Group Profile

Seluruh section ini **hanya muncul setelah grup dipilih**.

### 5.1 Card — Identity Profile

| Field | Sumber Data |
|---|---|
| Group ID | `suppliers.group_id` |
| Group Type | `suppliers.group_type` |
| Group Scale | `suppliers.group_scale` |
| Integrated Status | `suppliers.integrated_status` |
| Loading Method | Mode transport unik dari `contracts` non-Cancelled grup ini (contoh: `LAND / SEA`) |
| PIC | `supplier_groups.pic` |
| Mill Quantity | Jumlah mill dengan `group_id` ini. Dilengkapi tombol 👁 untuk membuka Mill List Modal |

### 5.2 Sub-section — Turnover Summary (dalam Identity Profile)

Bersumber dari `shipments` JOIN `contracts` berdasarkan `group_name`:

| Metrik | Formula |
|---|---|
| Total Voyages | COUNT shipments non-CANCELLED dari kontrak grup ini |
| Unique Vessels | COUNT DISTINCT `vessel_name` (non-NULL, non-CANCELLED) |
| Total Volume Shipped | SUM `quantity_shipped` (MT, non-CANCELLED) |
| Avg Lead Time | AVG `total_lead_time_days` (hari, non-NULL, non-CANCELLED) |

### 5.3 Card — Coverage & Location

| Field | Sumber Data |
|---|---|
| Map embed | OpenStreetMap iframe menggunakan `latitude`/`longitude` dari mill pertama (ORDER BY mill_code ASC). Bbox ±0.05 derajat. Jika tidak ada koordinat → placeholder "No coordinates available" |
| Province(s) | `STRING_AGG` provinsi unik dari semua mill dalam grup |
| Island(s) | `STRING_AGG` pulau unik dari semua mill dalam grup |
| Land Bank | `supplier_groups.land_bank` (Hektar) |
| Credit Rating | `supplier_groups.credit_rating` |

### 5.4 Card — Production Metrics

| Metrik | Sumber | Satuan |
|---|---|---|
| Total Factory Capacity (CAP) | SUM `cap` seluruh mill dalam grup | tph (ton per jam) |
| CPO / Month | SUM `cpo_prod_est_month` | MT |
| PK / Month | SUM `pk_prod_est_month` | MT |
| POME / Month | SUM `pome_prod_est_month` | MT |
| Shell / Month | SUM `shell_prod_est_month` | MT |
| CPO / Year | SUM `cpo_prod_est_year` | MT |
| PK / Year | SUM `pk_prod_est_year` | MT |
| POME / Year | SUM `pome_prod_est_year` | MT |
| Shell / Year | SUM `shell_prod_est_year` | MT |

Warna card per produk: CPO → Biru | PK → Hijau | POME → Amber | Shell → Merah

---

## 6. Mill List Modal

Dibuka via tombol 👁 pada Mill Quantity. Menampilkan tabel daftar mill dalam grup yang dipilih.

### 6.1 Kolom Tabel

| Kolom | Sumber | Keterangan |
|---|---|---|
| Mill Code | `mill_code` | |
| Mill Name | `mills` | |
| Province | `province` | |
| Island | `island` | |
| CAP (tph) | `cap` | Format ribuan |
| RSPO | `rspo` | Kolom hanya muncul jika ada ≥1 mill bersertifikasi |
| ISPO | `ispo` | Kolom hanya muncul jika ada ≥1 mill bersertifikasi |
| ISCC | `iscc` | Kolom hanya muncul jika ada ≥1 mill bersertifikasi |
| GGL | `ggl` | Kolom hanya muncul jika ada ≥1 mill bersertifikasi |

### 6.2 Logika Sertifikasi Aktif

Kolom sertifikasi (RSPO/ISPO/ISCC/GGL) **hanya ditampilkan** jika ada minimal satu mill dalam grup yang memiliki nilai bukan kosong, bukan `'NO'`, `'N/A'`, atau `'-'`.

- Ikon ✓ hijau = tersertifikasi
- `—` = tidak tersertifikasi

---

## 7. API Endpoints

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/supplier-groups?page=1&limit=500` | List semua grup untuk search dropdown |
| GET | `/api/suppliers?search={group_id}&page=1&limit=5000` | Mill dalam grup terpilih (difilter ulang client-side berdasarkan `group_id`) |

### Response structure `/api/supplier-groups` (field yang digunakan halaman ini)

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "group_id": "...",
        "parent_company": "...",
        "group_type": "...",
        "group_scale": "...",
        "integrated_status": "...",
        "total_cap": 1500.00,
        "cpo_month": 4500.00, "pk_month": 900.00,
        "pome_month": 2250.00, "shell_month": 450.00,
        "cpo_year": 54000.00, "pk_year": 10800.00,
        "pome_year": 27000.00, "shell_year": 5400.00,
        "provinces": "Riau, Jambi",
        "islands": "Sumatera",
        "latitude": 1.234, "longitude": 102.567,
        "loading_method": "LAND / SEA",
        "total_voyages": 48,
        "total_volume_shipped": 125000.00,
        "unique_vessels": 12,
        "avg_lead_time_days": 4.5,
        "land_bank": 15000,
        "pic": "John Doe",
        "credit_rating": "A"
      }
    ]
  }
}
```

---

## 8. Permission & Akses

| Role | Akses |
|---|---|
| ADMIN | Ya |
| MANAGEMENT | Ya |
| SUPPORT | Ya |
| LOGISTICS | Ya |
| Role lainnya | Sesuai permission `page.customer_360_company` |

Permission key: `page.customer_360_company`

---

## 9. Catatan & Limitasi

1. **Data produksi adalah estimasi** — bukan realisasi aktual, melainkan kalkulasi dari data master kapasitas pabrik.
2. **Map embed gratis** — menggunakan OpenStreetMap tanpa API key. Koordinat dari mill pertama (mill_code ASC). Jika tidak ada koordinat, area map tidak tampil.
3. **Kolom sertifikasi dinamis** — pada Mill List Modal, kolom cert hanya tampil jika ada data, mencegah kolom kosong yang tidak informatif.
4. **Filter mill client-side** — data mill di-fetch dengan parameter `search={group_id}`, lalu difilter ulang di frontend untuk memastikan hanya mill dengan `group_id` yang tepat yang ditampilkan.
5. **Loading bertahap** — 1 API call saat pertama buka (load semua grup), lalu 1 API call tambahan setiap kali user memilih grup baru (load mills).
