# PRD — Supplier
**KLIP (KPN Logistics Intelligence Platform)**
Versi: 1.0 | Tanggal: 2026-05-08 | Status: Released

---

## 1. Latar Belakang & Tujuan

Modul Supplier terdiri dari dua halaman yang saling berkaitan:

| Halaman | URL | Menu Sidebar | Tujuan |
|---|---|---|---|
| **Suppliers Dashboard** | `/customer-360` | Suppliers Dashboard | Visualisasi agregat estimasi produksi seluruh supplier dalam bentuk bar chart |
| **Suppliers** | `/supplier` | Suppliers | Master data management untuk data mill/pabrik beserta produksi estimasi dan atribut lengkap |

---

## 2. Sumber Data

| Tabel | Keterangan |
|---|---|
| `suppliers` | Master data mill. Setiap baris = satu pabrik kelapa sawit (PKS) |
| `supplier_groups` | Profil grup — digunakan untuk agregasi per group_id |
| `contracts` | Digunakan untuk loading_method (transport_mode per grup) |
| `shipments` | Tidak langsung digunakan oleh halaman Supplier, namun agregasinya tersedia di Suppliers Dashboard |

### Field utama tabel `suppliers`

| Field | Keterangan |
|---|---|
| `plant_code` | Kode plant (Primary Key untuk import) |
| `mill_code` | Kode mill |
| `mills` | Nama mill/pabrik |
| `group_id` | ID grup supplier |
| `parent_company` | Induk perusahaan |
| `group_holding` | Grup/Holding |
| `controlling_shareholder` | Pemegang saham pengendali |
| `other_shareholders` | Pemegang saham lainnya |
| `group_type` | Tipe grup |
| `group_scale` | Skala grup |
| `integrated_status` | Status integrasi |
| `cap` | Kapasitas pabrik (ton per jam / tph) |
| `cpo_prod_est_month/year` | Estimasi produksi CPO per bulan/tahun (MT) |
| `pk_prod_est_month/year` | Estimasi produksi PK per bulan/tahun (MT) |
| `pome_prod_est_month/year` | Estimasi produksi POME per bulan/tahun (MT) |
| `shell_prod_est_month/year` | Estimasi produksi Shell per bulan/tahun (MT) |
| `city_regency` | Kota/Kabupaten |
| `province` | Provinsi |
| `island` | Pulau |
| `latitude`, `longitude` | Koordinat lokasi |
| `rspo`, `rspo_type` | Status & tipe sertifikasi RSPO |
| `ispo`, `iscc`, `ggl` | Status sertifikasi ISPO, ISCC, GGL |
| `year_commence` | Tahun mulai operasi |
| `remarks` | Catatan tambahan |

---

## 3. Halaman 1 — Suppliers Dashboard (`/customer-360`)

### 3.1 Tujuan
Memberikan gambaran visual distribusi kapasitas produksi seluruh supplier, dapat dibandingkan antar grup, antar pulau, dan antar provinsi.

### 3.2 Toggle Periode
Semua chart memiliki toggle **Per Month / Per Year** yang mengontrol field produksi:

| Toggle | Field yang digunakan |
|---|---|
| Per Month | `cpo_month`, `pk_month`, `pome_month`, `shell_month` |
| Per Year | `cpo_year`, `pk_year`, `pome_year`, `shell_year` |

### 3.3 Empat Chart

#### Chart 1 — Production Estimates by Supplier Group
- **Sumber:** Agregasi semua mill per `group_id` dari API `/supplier-groups`
- **Tampil:** Top 15 grup dengan total produksi terbesar (total > 0), descending
- **Label:** `group_id`

#### Chart 2 — Production Estimates by Supplier (Top 50)
- **Sumber:** Data per mill individual dari API `/suppliers`
- **Field:** `cpo_prod_est_month/year`, `pk_prod_est_month/year`, dst.
- **Tampil:** Top 15 mill dengan total produksi terbesar, descending
- **Label:** `mills` (nama mill)

#### Chart 3 — Production Estimates by Island
- **Sumber:** Agregasi dari API `/suppliers/aggregates/by-island`
- **Tampil:** Semua pulau dengan total > 0, descending
- **Label:** `island`

#### Chart 4 — Production Estimates by Province
- **Sumber:** Agregasi dari API `/suppliers/aggregates/by-province`
- **Tampil:** Semua provinsi dengan total > 0, descending
- **Label:** `province`

### 3.4 Komponen Chart — SupplierBarChart

Chart dibangun dengan **SVG custom** (tanpa library chart eksternal):

| Karakteristik | Keterangan |
|---|---|
| Tipe | Stacked bar chart — 4 segment (CPO, PK, POME, Shell) ditumpuk per bar |
| Responsif | Lebar bar menyesuaikan container menggunakan ResizeObserver |
| Tooltip | Hover pada segment menampilkan label produk dan nilai (format ribuan) |
| Label | Ditruncate jika melebihi lebar bar, disertai nomor urut (#1, #2, ...) |

**Warna per produk:**

| Produk | Warna Hex |
|---|---|
| CPO | `#2563eb` (Biru) |
| PK | `#16a34a` (Hijau) |
| POME | `#f59e0b` (Amber) |
| Shell | `#ef4444` (Merah) |

### 3.5 API Endpoints

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/supplier-groups?page=1&limit=500` | Semua grup dengan agregasi produksi |
| GET | `/api/suppliers/aggregates/by-island` | Agregasi produksi per pulau |
| GET | `/api/suppliers/aggregates/by-province` | Agregasi produksi per provinsi |
| GET | `/api/suppliers?page=1&limit=5000` | Semua mill individual |

> Keempat API call dilakukan secara **paralel** saat halaman pertama dibuka.

---

## 4. Halaman 2 — Suppliers (`/supplier`)

### 4.1 Tujuan
Halaman master data untuk mengelola data mill/pabrik kelapa sawit: menambah, mengedit, mengimpor via CSV, dan melihat detail lengkap setiap mill.

### 4.2 Struktur Halaman

```
┌──────────────────────────────┐
│  Header: judul + tombol aksi │
├──────────────────────────────┤
│  Card Filter                 │
├──────────────────────────────┤
│  Card Supplier List (Tabel)  │
└──────────────────────────────┘
```

### 4.3 Header & Tombol Aksi

| Tombol | Fungsi |
|---|---|
| **Upload CSV** | Membuka file picker (CSV/XLSX/XLS), melakukan bulk import ke backend |
| **Add Supplier** | Membuka modal form untuk menambah mill baru |

### 4.4 Card Filter

| Filter | Tipe | Keterangan |
|---|---|---|
| Search | Text input | Pencarian pada: Mill Code, Mills, Group ID, Province, Island (case-insensitive) |
| Filter by Group ID | Multi-select dropdown | Daftar semua group_id unik dari data. Mendukung pencarian dalam dropdown |

#### Pinned Groups
Tujuh grup utama selalu muncul di bagian atas dropdown dengan label "Top Groups":

1. FIRST RESOURCES
2. KORINDO
3. PALMA SERASIH
4. SAMPOERNA
5. TELADAN
6. TRIPUTRA
7. USTP

Grup lainnya tampil di bawah section "All Groups". Pilihan grup yang aktif ditampilkan sebagai chip/badge yang bisa dihapus satu per satu atau sekaligus.

### 4.5 Tabel Supplier List

**Kolom yang tersedia:**

| Kolom | Default Visible | Sort | Tipe |
|---|---|---|---|
| Mill Code | ✅ | Ya | Text |
| Mills | ✅ | Ya | Text |
| Group | ✅ | Ya | Text |
| Province | ✅ | Ya | Text |
| Island | ✅ | Ya | Text |
| Group Type | ✅ | Ya | Text |
| CAP (tph) | ❌ | Ya (numeric) | Number |
| CPO / Month | ❌ | Ya (numeric) | Number |
| PK / Month | ❌ | Ya (numeric) | Number |
| POME / Month | ❌ | Ya (numeric) | Number |
| SHELL / Month | ❌ | Ya (numeric) | Number |
| Actions | — | Tidak | Tombol |

**Fitur tabel:**

| Fitur | Keterangan |
|---|---|
| Sort | Klik header kolom untuk sort ASC/DESC. Default: Mill Code ASC |
| Column manager | Tombol "Columns" → checklist show/hide kolom |
| Pagination | 20 record per halaman, navigasi di atas dan bawah tabel |
| View | Tombol hijau 👁 View per baris — membuka modal detail lengkap |

### 4.6 Modal Add / Edit Supplier

Form dengan **35 field** dalam 3 kolom (grid), dikelompokkan secara logis:

| Grup | Field |
|---|---|
| Identitas Pabrik | Plant Code*, Prov Code, Prov #, Mill No, Mill Code, Mills |
| Grup & Kepemilikan | Group ID, Parent Company, Group/Holding, Controlling Shareholder, Other Shareholders, Group Type, Group Scale, Integrated Status |
| Kapasitas & Produksi | CAP (tph), CPO/PK/POME/Shell Prod Est /Month & /Year (8 field, otomatis, read-only) |
| Lokasi | City/Regency, Province, Island, Longitude, Latitude, KML Folder, Google Maps |
| Sertifikasi | RSPO, RSPO Type, ISPO, ISCC, GGL |

> `*` = field wajib diisi (required)

#### Kalkulasi Otomatis Estimasi Produksi

Ketika user mengisi field **CAP (tph)**, sistem secara otomatis menghitung delapan field estimasi produksi menggunakan konfigurasi dari **Master Product Configuration**:

```
Estimasi Bulanan = CAP × (percent_produce / 100) × working_hours_per_day × working_days_per_month
Estimasi Tahunan = CAP × (percent_produce / 100) × working_hours_per_day × working_days_per_year
```

- Konfigurasi di-fetch dari `/api/products?limit=200`
- Parameter yang digunakan: `percent_produce`, `working_hours_per_day`, `working_days_per_month`, `working_days_per_year` per produk (CPO, PK, POME, SHELL)
- Field estimasi **tidak bisa diedit manual** — read-only dan hanya berubah jika CAP berubah
- Jika salah satu parameter konfigurasi bernilai null, field estimasi dikosongkan

### 4.7 Modal View Detail

Modal read-only yang menampilkan seluruh atribut mill dalam 5 seksi:

| Seksi | Field |
|---|---|
| **Basic Info** | Plant Code, Mill Code, Mill No, Prov Code, Prov #, Mills |
| **Group Info** | Group ID, Parent Company, Group/Holding, Group Type, Group Scale, Integrated Status, Controlling Shareholder, Other Shareholders |
| **Production Capacity** | CAP, CPO/PK/POME/Shell per Month & Year |
| **Location** | City/Regency, Province, Island, Longitude, Latitude, KML Folder, Google Maps |
| **Certification** | RSPO, RSPO Type, ISPO, ISCC, GGL |

### 4.8 CSV Import (Bulk Upload)

**Format file yang diterima:** `.csv`, `.xlsx`, `.xls`

**Urutan kolom header CSV** (35 kolom):

```
PLANT CODE, PROV CODE, PROV #, MILL NO, MILL CODE, MILLS, GROUP ID, GROUP TYPE, Group Scale,
Integrated Status, CAP (tph), CPO Prod Est /Month, PK Prod Est /Month, POME Prod Est /Month,
SHELL Prod Est /Month, CPO Prod Est /Year, PK Prod Est /Year, POME Prod Est /Year,
SHELL Prod Est /Year, CITY / REGENCY, PROVINCE, ISLAND, LONGITUDE, LATITUDE, KML_FOLDER,
GOOGLE MAPS, RSPO, RSPO Type, ISPO, ISCC, GGL, YEAR COMMENCE, UPDATE DATE, UPDATE YEAR, REMARKS
```

**Perilaku import:**
- `PLANT CODE` sebagai key — record yang sudah ada akan di-update (upsert), record baru akan di-insert
- Hasil import ditampilkan sebagai notifikasi: `Imported: X inserted, Y updated, Z errors`
- Jika ada error, detail error pertama (maks. 10) ditampilkan di bawah notifikasi success

> Template CSV dapat diunduh langsung dari sistem — file kosong dengan header lengkap sesuai urutan di atas.

### 4.9 API Endpoints

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/suppliers?page=1&limit=5000` | Ambil semua supplier (load sekali, filter client-side) |
| POST | `/api/suppliers` | Tambah supplier baru |
| PUT | `/api/suppliers/:id` | Edit supplier |
| DELETE | `/api/suppliers/:id` | Hapus supplier |
| POST | `/api/suppliers/import` | Bulk import CSV/XLSX |
| GET | `/api/products?limit=200` | Ambil konfigurasi produk untuk kalkulasi estimasi |

---

## 5. Permission & Akses

### Suppliers Dashboard (`/customer-360`)

Permission key: `page.customer_360`

### Suppliers (`/supplier`)

Permission key: `page.suppliers`

> Kedua halaman mengikuti role_permissions yang dikonfigurasi oleh ADMIN.

---

## 6. Navigasi

| Halaman | Menu Label | Posisi Sidebar |
|---|---|---|
| `/customer-360` | Suppliers Dashboard | Setelah Oil Loss |
| `/supplier` | Suppliers | Setelah Suppliers Dashboard |

---

## 7. Catatan & Limitasi

1. **Data produksi adalah estimasi** — dihitung berdasarkan parameter Master Product Configuration, bukan dari realisasi pengiriman aktual.
2. **Kalkulasi estimasi bergantung konfigurasi** — jika `percent_produce`, `working_hours_per_day`, atau `working_days_per_month/year` belum diisi di Master Product Configuration, field estimasi akan kosong meski CAP sudah diisi.
3. **Semua filtering dilakukan client-side** — data diambil sekaligus (limit 5000) saat halaman dibuka. Filter teks dan Group ID diproses di browser tanpa request ulang ke backend.
4. **Pinned groups hardcoded** — 7 grup utama yang di-pin di dropdown Group ID tidak bersifat dinamis, melainkan dikonfigurasi langsung di kode frontend.
5. **Import tidak menghapus data** — proses import hanya insert/update berdasarkan `plant_code`. Data yang tidak ada di file CSV tidak akan dihapus.
