# Spek Teknis — Supplier
**KLIP (KPN Logistics Intelligence Platform)**
Versi: 1.0 | Tanggal: 2026-05-08

---

## 1. Stack & Lokasi File

| Layer | Teknologi | File |
|---|---|---|
| Frontend — Suppliers Dashboard | Next.js 14 (App Router), TypeScript, Tailwind CSS | `frontend/src/app/customer-360/page.tsx` |
| Frontend — Suppliers | Next.js 14 (App Router), TypeScript, Tailwind CSS | `frontend/src/app/supplier/page.tsx` |
| Backend Controller | Node.js, Express, TypeScript | `backend/src/controllers/supplier.controller.ts` |
| Backend Routes | Express Router | `backend/src/routes/supplier.routes.ts` |
| File Upload | multer | Upload ke direktori `backend/uploads/` |
| File Parsing | xlsx (SheetJS) | Parsing CSV/XLSX/XLS |
| Database | PostgreSQL | Tabel: `suppliers`, `products` |

---

## 2. Skema Database

### 2.1 Tabel `suppliers`

```sql
CREATE TABLE suppliers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_code            VARCHAR UNIQUE,
  prov_code             VARCHAR,
  prov_no               VARCHAR,
  mill_no               VARCHAR,
  mill_code             VARCHAR,
  mills                 VARCHAR,
  group_id              VARCHAR,
  parent_company        VARCHAR,
  group_holding         VARCHAR,
  controlling_shareholder VARCHAR,
  other_shareholders    VARCHAR,
  group_type            VARCHAR,
  group_scale           VARCHAR,
  integrated_status     VARCHAR,
  cap                   NUMERIC,
  cpo_prod_est_month    NUMERIC,
  pk_prod_est_month     NUMERIC,
  pome_prod_est_month   NUMERIC,
  shell_prod_est_month  NUMERIC,
  cpo_prod_est_year     NUMERIC,
  pk_prod_est_year      NUMERIC,
  pome_prod_est_year    NUMERIC,
  shell_prod_est_year   NUMERIC,
  city_regency          VARCHAR,
  province              VARCHAR,
  island                VARCHAR,
  longitude             NUMERIC,
  latitude              NUMERIC,
  kml_folder            VARCHAR,
  map                   TEXT,
  rspo                  VARCHAR,
  rspo_type             VARCHAR,
  ispo                  VARCHAR,
  iscc                  VARCHAR,
  ggl                   VARCHAR,
  year_commence         INTEGER,
  updated_date          DATE,
  update_year           INTEGER,
  remarks               TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 Tabel `products` (konfigurasi kalkulasi estimasi)

```sql
-- Field yang digunakan oleh supplier.controller.ts:
SELECT product_name, percent_produce, working_hours_per_day,
       working_days_per_month, working_days_per_year
FROM products
WHERE product_name IN ('CPO', 'PK', 'POME', 'SHELL')
```

| Field | Keterangan |
|---|---|
| `product_name` | `'CPO'`, `'PK'`, `'POME'`, `'SHELL'` |
| `percent_produce` | Persentase produksi dari CPB (0–100) |
| `working_hours_per_day` | Jam kerja per hari |
| `working_days_per_month` | Hari kerja per bulan |
| `working_days_per_year` | Hari kerja per tahun |

---

## 3. Backend

### 3.1 Routes — `/api/suppliers`

File: `backend/src/routes/supplier.routes.ts`

```
Middleware: authenticateToken (semua route)

GET  /                          → listSuppliers           [ADMIN, TRADING, LOGISTICS, FINANCE, MANAGEMENT, SUPPORT]
POST /                          → createSupplier          [ADMIN, LOGISTICS]
GET  /:id                       → getSupplierById         [ADMIN, TRADING, LOGISTICS, FINANCE, MANAGEMENT, SUPPORT]
PUT  /:id                       → updateSupplier          [ADMIN, LOGISTICS]
DELETE /:id                     → deleteSupplier          [ADMIN]
POST /import                    → importSuppliersFromExcel [ADMIN, LOGISTICS] + multer upload.single('file')
GET  /aggregates/by-island      → getTotalsByIsland       [ADMIN, TRADING, LOGISTICS, FINANCE, MANAGEMENT, SUPPORT]
GET  /aggregates/by-province    → getTotalsByProvince     [ADMIN, TRADING, LOGISTICS, FINANCE, MANAGEMENT, SUPPORT]
GET  /aggregates/by-parent-company → getTotalsByParentCompany [ADMIN, TRADING, LOGISTICS, FINANCE, MANAGEMENT, SUPPORT]
```

**Catatan multer:** File upload disimpan sementara di direktori `backend/uploads/`. Direktori dibuat otomatis jika belum ada.

---

### 3.2 Controller — `listSuppliers`

**Query params:** `search`, `page` (default 1), `limit` (default 50, max 5000)

**SQL:**
```sql
-- WHERE clause (jika search tidak kosong):
WHERE (
  plant_code ILIKE $1
  OR mills ILIKE $1
  OR mill_code ILIKE $1
  OR group_id ILIKE $1
  OR island ILIKE $1
  OR province ILIKE $1
)

SELECT * FROM suppliers
[WHERE ...]
ORDER BY updated_at DESC NULLS LAST, created_at DESC
LIMIT $N OFFSET $M
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 245,
    "page": 1,
    "limit": 5000
  }
}
```

---

### 3.3 Controller — `computeEstimates` (fungsi helper)

Dipanggil saat `createSupplier` dan `updateSupplier` (jika `cap` disertakan dalam request body).

```typescript
// Formula:
const calc = (prod: ProductConfig, useYear: boolean): number | null => {
  const pct   = prod.percent_produce     / 100
  const hours = prod.working_hours_per_day
  const days  = useYear ? prod.working_days_per_year : prod.working_days_per_month
  if (pct == null || hours == null || days == null) return null
  return cap * pct * hours * days
}
```

| Field Output | Formula |
|---|---|
| `cpo_month` | `cap × (CPO.percent_produce/100) × CPO.working_hours_per_day × CPO.working_days_per_month` |
| `pk_month` | `cap × (PK.percent_produce/100) × PK.working_hours_per_day × PK.working_days_per_month` |
| `pome_month` | `cap × (POME.percent_produce/100) × POME.working_hours_per_day × POME.working_days_per_month` |
| `shell_month` | `cap × (SHELL.percent_produce/100) × SHELL.working_hours_per_day × SHELL.working_days_per_month` |
| `cpo_year` | `cap × (CPO.percent_produce/100) × CPO.working_hours_per_day × CPO.working_days_per_year` |
| `pk_year` | (formula sama dengan month, ganti days) |
| `pome_year` | (formula sama dengan month, ganti days) |
| `shell_year` | (formula sama dengan month, ganti days) |

Jika salah satu parameter konfigurasi `null`, output field terkait adalah `null`.

---

### 3.4 Controller — `createSupplier`

**Method:** POST `/`

**Body:** Semua field `suppliers` kecuali `id`, `created_at`, `updated_at`.

**Alur:**
1. `loadProductConfigs()` — fetch konfigurasi produk dari tabel `products`
2. `computeEstimates(cap, productMap)` — hitung 8 field estimasi
3. INSERT dengan semua field termasuk hasil estimasi

**Error 23505** (unique constraint `plant_code`): mengembalikan pesan `"Supplier with this plant_code already exists"`.

---

### 3.5 Controller — `updateSupplier`

**Method:** PUT `/:id`

**Perilaku:**
- Hanya field yang ada di `req.body` yang di-UPDATE (dynamic SET clause)
- Jika `cap` disertakan: recompute semua 8 field estimasi via `computeEstimates()` dan ikutkan dalam SET clause
- Field numerik otomatis di-cast ke `Number`
- String kosong (`""`) dinormalisasi ke `null`
- `updated_at = NOW()` selalu diset

---

### 3.6 Controller — `importSuppliersFromExcel`

**Method:** POST `/import`  
**Content-Type:** `multipart/form-data` (field name: `file`)  
**Format:** `.csv`, `.xlsx`, `.xls`

**Alur parsing:**

1. Baca file menggunakan `XLSX.readFile(path, { raw: false })`
2. Convert ke array 2D: `XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })`
3. Cari header row: scan 10 baris pertama, cari baris yang mengandung `"PLANT CODE"` (case-insensitive)
4. Normalisasi header: collapse whitespace & newline
5. Mapping kolom berdasarkan nama header (lihat tabel di bawah)
6. Data mulai dari `headerRowIdx + 3` (skip widths row + sub-header row)
7. Per baris: jika `plant_code` kosong → skip (footer/summary row)
8. **Upsert logic:** cek `SELECT id WHERE plant_code = $1`
   - Jika ada → `UPDATE ... WHERE id = $N`
   - Jika tidak ada → `INSERT`

**Mapping kolom file → database:**

| Database Field | Header CSV |
|---|---|
| `plant_code` | `MILL CODE` (key unik) |
| `mill_code` | `MILL CODE` (sama dengan plant_code) |
| `prov_code` | `PROV CODE` |
| `prov_no` | `PROV #` |
| `mill_no` | `MILL NO` |
| `mills` | `MILLS` |
| `group_id` | `GROUP ID` |
| `group_type` | `GROUP TYPE` |
| `group_scale` | `GROUP SCALE` (atau `Group Scale`) |
| `integrated_status` | `INTEGRATED STATUS` |
| `cap` | Header yang diawali `CAP` |
| `cpo_prod_est_month` | Kemunculan pertama header yang mengandung `CPO` dan `PROD EST` |
| `pk_prod_est_month` | Kemunculan pertama header yang mengandung `PK` dan `PROD EST` |
| `pome_prod_est_month` | Kemunculan pertama header yang mengandung `POME` dan `PROD EST` |
| `shell_prod_est_month` | Kemunculan pertama header yang mengandung `SHELL` dan `PROD EST` |
| `cpo_prod_est_year` | Kemunculan **kedua** header CPO PROD EST |
| `pk_prod_est_year` | Kemunculan **kedua** header PK PROD EST |
| `pome_prod_est_year` | Kemunculan **kedua** header POME PROD EST |
| `shell_prod_est_year` | Kemunculan **kedua** header SHELL PROD EST |
| `city_regency` | `CITY / REGENCY` |
| `province` | `PROVINCE` |
| `island` | `ISLAND` |
| `longitude` | `LONGITUDE` atau `LONG.` |
| `latitude` | `LATITUDE` atau `LAT.` |
| `kml_folder` | `KML_FOLDER` |
| `map` | `GOOGLE MAPS` atau `MAP` |
| `rspo` | `RSPO` |
| `rspo_type` | `RSPO TYPE` |
| `ispo` | `ISPO` |
| `iscc` | `ISCC` |
| `ggl` | `GGL` |
| `year_commence` | `YEAR COMMENCE` |
| `updated_date` | `UPDATE DATE` atau `UPDATED DATE` |
| `update_year` | `UPDATE YEAR` |
| `remarks` | `REMARKS` |

**Parsing tanggal:**
- `Date` object → `.toISOString().substring(0, 10)`
- Excel serial number → `(serial - 25569) × 86400 × 1000` ms → ISO date
- String → `new Date(s).toISOString().substring(0, 10)`

**Response:**
```json
{
  "success": true,
  "data": { "inserted": 150, "updated": 45, "errors": ["Row 23: ...", "Row 67: ..."] }
}
```

---

### 3.7 Controller — `getTotalsByIsland`

```sql
SELECT
  COALESCE(island, 'UNKNOWN') AS island,
  COALESCE(SUM(cpo_prod_est_month), 0)  AS cpo_month,
  COALESCE(SUM(pk_prod_est_month), 0)   AS pk_month,
  COALESCE(SUM(pome_prod_est_month), 0) AS pome_month,
  COALESCE(SUM(shell_prod_est_month), 0) AS shell_month,
  COALESCE(SUM(cpo_prod_est_year), 0)   AS cpo_year,
  COALESCE(SUM(pk_prod_est_year), 0)    AS pk_year,
  COALESCE(SUM(pome_prod_est_year), 0)  AS pome_year,
  COALESCE(SUM(shell_prod_est_year), 0) AS shell_year
FROM suppliers
GROUP BY COALESCE(island, 'UNKNOWN')
ORDER BY island
```

**Response:** `{ "success": true, "data": [...] }`

---

### 3.8 Controller — `getTotalsByProvince`

```sql
SELECT
  COALESCE(province, 'UNKNOWN') AS province,
  COALESCE(SUM(cpo_prod_est_month), 0)  AS cpo_month,
  -- ... (sama dengan by-island, GROUP BY province)
FROM suppliers
GROUP BY COALESCE(province, 'UNKNOWN')
ORDER BY province
```

---

## 4. Frontend — Suppliers Dashboard (`/customer-360`)

File: `frontend/src/app/customer-360/page.tsx`

### 4.1 State Management

```typescript
type Period = 'month' | 'year'

const [groups, setGroups]           = useState<any[]>([])
const [islandTotals, setIslandTotals] = useState<any[]>([])
const [provinceTotals, setProvinceTotals] = useState<any[]>([])
const [suppliers, setSuppliers]     = useState<any[]>([])
const [period, setPeriod]           = useState<Period>('month')
```

### 4.2 Data Fetching — Paralel saat mount

```typescript
const [groupsRes, islandRes, provinceRes, suppliersRes] = await Promise.all([
  api.get('/supplier-groups?page=1&limit=500'),
  api.get('/suppliers/aggregates/by-island'),
  api.get('/suppliers/aggregates/by-province'),
  api.get('/suppliers?page=1&limit=5000'),
])
```

### 4.3 Derived Data (useMemo)

```typescript
// Suffix berdasarkan period toggle
const suffix        = period === 'month' ? '_month' : '_year'
const supplierSuffix = period === 'month' ? '_est_month' : '_est_year'

// Chart 1 — Top 15 grup berdasarkan total produksi
const sorted = useMemo(() =>
  groups
    .map(g => ({ ...g, _total: cpo + pk + pome + shell }))  // menggunakan suffix
    .filter(g => g._total > 0)
    .sort((a, b) => b._total - a._total)
    .slice(0, 15),
  [groups, suffix]
)

// Chart 2 — Top 15 mill individual
const sortedSuppliers = useMemo(() =>
  suppliers
    .map(s => ({ ...s, _total: cpo + pk + pome + shell }))  // menggunakan supplierSuffix
    .filter(s => s._total > 0)
    .sort((a, b) => b._total - a._total)
    .slice(0, 15),
  [suppliers, supplierSuffix]
)

// Chart 3 — Semua pulau dengan total > 0
const sortedIslands = useMemo(() => islandTotals
  .map(g => ({ ...g, _total: ... })).filter(g => g._total > 0).sort(...),
  [islandTotals, suffix]
)

// Chart 4 — Semua provinsi dengan total > 0
const sortedProvinces = useMemo(() => provinceTotals
  .map(g => ({ ...g, _total: ... })).filter(g => g._total > 0).sort(...),
  [provinceTotals, suffix]
)
```

### 4.4 Kategori Warna per Produk

```typescript
const categories = [
  { key: `cpo${suffix}`,   label: `CPO / ${periodLabel}`,   color: '#2563eb' },
  { key: `pk${suffix}`,    label: `PK / ${periodLabel}`,    color: '#16a34a' },
  { key: `pome${suffix}`,  label: `POME / ${periodLabel}`,  color: '#f59e0b' },
  { key: `shell${suffix}`, label: `SHELL / ${periodLabel}`, color: '#ef4444' },
]
```

| Produk | Warna Hex | Tailwind |
|---|---|---|
| CPO | `#2563eb` | Biru |
| PK | `#16a34a` | Hijau |
| POME | `#f59e0b` | Amber |
| Shell | `#ef4444` | Merah |

### 4.5 Komponen `SupplierBarChart`

```typescript
function SupplierBarChart({
  data,
  categories,
  labelField = 'group_id',
}: {
  data: any[]
  categories: { key: string; label: string; color: string }[]
  labelField?: string
})
```

**Implementasi SVG:**

| Aspek | Detail |
|---|---|
| Tipe | Stacked bar chart — 4 segment ditumpuk per bar |
| Responsif | `containerRef` + `ResizeObserver` → update `containerWidth` state |
| Lebar SVG | `containerWidth` (menyesuaikan container) |
| Tinggi SVG | 420px total; 50px untuk area label; 370px untuk area chart |
| Lebar bar | `Math.max(20, (containerWidth - gap × (n-1)) / n)`, min 20px |
| Gap antar bar | 6px |
| Baseline | `<line>` horizontal di `y = chartAreaHeight` |
| Segmen | `<rect>` per kategori; tinggi proporsional terhadap `maxVal`; min height 2px jika nilai > 0 |
| Tooltip | `<title>` di dalam `<rect>` — native SVG tooltip saat hover |
| Label baris 1 | Nama grup/mill/pulau/provinsi, ditruncate jika melebihi lebar bar (`Math.floor(barWidth / 6)` karakter) |
| Label baris 2 | Nomor urut `#1`, `#2`, ... |
| Font size | Label: `Math.min(10, barWidth/5)`; Rank: `Math.min(9, barWidth/6)` |

---

## 5. Frontend — Suppliers (`/supplier`)

File: `frontend/src/app/supplier/page.tsx`

### 5.1 Interface Type

```typescript
interface Supplier {
  id: string
  plant_code: string
  prov_code: string | null
  prov_no: string | null
  mill_no: string | null
  mill_code: string | null
  mills: string | null
  group_id: string | null
  parent_company: string | null
  group_holding: string | null
  controlling_shareholder: string | null
  other_shareholders: string | null
  group_type: string | null
  group_scale: string | null
  integrated_status: string | null
  cap: string | null
  cpo_prod_est_month?: number | null
  pk_prod_est_month?: number | null
  pome_prod_est_month?: number | null
  shell_prod_est_month?: number | null
  cpo_prod_est_year?: number | null
  pk_prod_est_year?: number | null
  pome_prod_est_year?: number | null
  shell_prod_est_year?: number | null
  city_regency: string | null
  province: string | null
  island: string | null
  longitude: number | null
  latitude: number | null
  kml_folder: string | null
  map: string | null
  rspo: string | null
  rspo_type: string | null
  ispo: string | null
  iscc: string | null
  ggl: string | null
  year_commence: number | null
  updated_date: string | null
  update_year: number | null
  remarks: string | null
}
```

### 5.2 Definisi Kolom Tabel

```typescript
const COLUMN_DEFS = [
  { key: 'mill_code',            label: 'Mill Code',      defaultVisible: true  },
  { key: 'mills',                label: 'Mills',          defaultVisible: true  },
  { key: 'group_id',             label: 'Group',          defaultVisible: true  },
  { key: 'province',             label: 'Province',       defaultVisible: true  },
  { key: 'island',               label: 'Island',         defaultVisible: true  },
  { key: 'group_type',           label: 'Group Type',     defaultVisible: true  },
  { key: 'cap',                  label: 'CAP (tph)',      defaultVisible: false },
  { key: 'cpo_prod_est_month',   label: 'CPO / Month',   defaultVisible: false },
  { key: 'pk_prod_est_month',    label: 'PK / Month',    defaultVisible: false },
  { key: 'pome_prod_est_month',  label: 'POME / Month',  defaultVisible: false },
  { key: 'shell_prod_est_month', label: 'SHELL / Month', defaultVisible: false },
] as const
```

### 5.3 Pinned Groups (hardcoded)

```typescript
const PINNED_GROUPS = [
  'FIRST RESOURCES',
  'KORINDO',
  'PALMA SERASIH',
  'SAMPOERNA',
  'TELADAN',
  'TRIPUTRA',
  'USTP',
]
```

Ditampilkan di atas dropdown filter Group ID dengan label "Top Groups". Grup lainnya tampil di bawah section "All Groups".

### 5.4 State Management

```typescript
// Data
const [allItems, setAllItems] = useState<Supplier[]>([])

// Pagination & Sort (client-side dari allItems)
const [page, setPage]         = useState(1)
const [search, setSearch]     = useState('')
const [sortBy, setSortBy]     = useState<string>('mill_code')
const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc')
const PAGE_SIZE = 20

// Filter Group ID
const [selectedGroups, setSelectedGroups] = useState<string[]>([])
const [groupSearch, setGroupSearch]       = useState('')
const [groupDropdownOpen, setGroupDropdownOpen] = useState(false)

// Column visibility
const [visibleCols, setVisibleCols] = useState<Set<string>>(
  new Set(COLUMN_DEFS.filter(c => c.defaultVisible).map(c => c.key))
)

// Modals
const [showForm, setShowForm]       = useState(false)
const [editItem, setEditItem]       = useState<Supplier | null>(null)
const [viewItem, setViewItem]       = useState<Supplier | null>(null)
const [deleteItem, setDeleteItem]   = useState<Supplier | null>(null)
const [colManagerOpen, setColManagerOpen] = useState(false)
```

### 5.5 Data Fetching

```typescript
// Load sekali saat mount (limit 5000 — seluruh data ke client)
api.get('/suppliers?page=1&limit=5000')
  .then(res => setAllItems(res.data.data.items || []))

// Fetch konfigurasi produk untuk kalkulasi estimasi di form
api.get('/products?limit=200')
  .then(res => setProductConfigs(res.data.data?.items || []))
```

### 5.6 Filter & Sort (client-side)

```typescript
// 1. Filter teks pada: mill_code, mills, group_id, province, island (case-insensitive)
// 2. Filter Group ID multi-select (selectedGroups)
// 3. Sort berdasarkan sortBy dan sortDir
// 4. Paginate: slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)
const filteredItems = useMemo(() => {
  let items = allItems
  if (search) items = items.filter(/* ILIKE mill_code|mills|group_id|province|island */)
  if (selectedGroups.length) items = items.filter(s => selectedGroups.includes(s.group_id || ''))
  items = [...items].sort(/* berdasarkan sortBy, sortDir */)
  return items
}, [allItems, search, selectedGroups, sortBy, sortDir])

const pageItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
```

### 5.7 Kalkulasi Estimasi di Frontend (Modal Form)

Ketika user mengubah field **CAP (tph)** di modal Add/Edit:

```typescript
// Dari productConfigs (fetch dari /api/products)
const calcEst = (cap: number, product: string, useYear: boolean): number | null => {
  const cfg = productConfigs.find(p => p.product_name === product)
  if (!cfg) return null
  const pct   = cfg.percent_produce     == null ? null : Number(cfg.percent_produce)   / 100
  const hours = cfg.working_hours_per_day == null ? null : Number(cfg.working_hours_per_day)
  const days  = useYear
    ? (cfg.working_days_per_year  == null ? null : Number(cfg.working_days_per_year))
    : (cfg.working_days_per_month == null ? null : Number(cfg.working_days_per_month))
  if (pct == null || hours == null || days == null) return null
  return Number(cap) * pct * hours * days
}
```

Field estimasi ditampilkan sebagai **read-only** di form — hanya berubah jika CAP berubah.

### 5.8 CSV Template Download

```typescript
const headersOrder = [
  'PLANT CODE','PROV CODE','PROV #','MILL NO','MILL CODE','MILLS','GROUP ID','GROUP TYPE',
  'Group Scale','Integrated Status','CAP (tph)',
  'CPO Prod Est /Month','PK Prod Est /Month','POME Prod Est /Month','SHELL Prod Est /Month',
  'CPO Prod Est /Year','PK Prod Est /Year','POME Prod Est /Year','SHELL Prod Est /Year',
  'CITY / REGENCY','PROVINCE','ISLAND','LONGITUDE','LATITUDE','KML_FOLDER','GOOGLE MAPS',
  'RSPO','RSPO Type','ISPO','ISCC','GGL','YEAR COMMENCE','UPDATE DATE','UPDATE YEAR','REMARKS'
]
// Generate CSV dengan header-only, trigger download via Blob + <a>
```

---

## 6. API Contract Lengkap

### GET `/api/suppliers`

| Parameter | Tipe | Default | Keterangan |
|---|---|---|---|
| `search` | string | `''` | Filter ILIKE pada plant_code, mills, mill_code, group_id, island, province |
| `page` | integer | `1` | Halaman |
| `limit` | integer | `50` | Max 5000 per request |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "items": [ { ...Supplier } ],
    "total": 245,
    "page": 1,
    "limit": 5000
  }
}
```

### POST `/api/suppliers`

**Auth:** ADMIN, LOGISTICS

**Request body:** Semua field `Supplier` (kecuali `id`, timestamps, dan 8 field estimasi — dihitung otomatis dari `cap`).

**Response 201:** `{ "success": true, "data": { ...Supplier } }`

**Error 500 (duplicate):** `{ "success": false, "error": { "message": "Supplier with this plant_code already exists" } }`

### GET `/api/suppliers/:id`

**Response 200:** `{ "success": true, "data": { ...Supplier } }`  
**Response 404:** `{ "success": false, "error": { "message": "Supplier not found" } }`

### PUT `/api/suppliers/:id`

**Auth:** ADMIN, LOGISTICS

**Request body:** Field yang ingin di-update saja (partial update). Jika `cap` disertakan, 8 field estimasi akan dihitung ulang.

**Response 200:** `{ "success": true, "data": { ...Supplier } }`

### DELETE `/api/suppliers/:id`

**Auth:** ADMIN only

**Response 200:** `{ "success": true, "data": { "id": "..." } }`

### POST `/api/suppliers/import`

**Auth:** ADMIN, LOGISTICS  
**Content-Type:** `multipart/form-data`  
**Field:** `file` (CSV, XLSX, atau XLS)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "inserted": 150,
    "updated": 45,
    "errors": ["Row 23: duplicate key ...", "Row 67: ..."]
  }
}
```

### GET `/api/suppliers/aggregates/by-island`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "island": "Sumatera",
      "cpo_month": 45000.0, "pk_month": 9000.0, "pome_month": 22500.0, "shell_month": 4500.0,
      "cpo_year": 540000.0, "pk_year": 108000.0, "pome_year": 270000.0, "shell_year": 54000.0
    }
  ]
}
```

### GET `/api/suppliers/aggregates/by-province`

**Response 200:** Struktur sama dengan by-island, dengan field `province` sebagai label.

---

## 7. Aturan Bisnis Teknis

| Aturan | Detail |
|---|---|
| Upsert key import | `plant_code` (UNIQUE constraint di DB). Import tidak pernah menghapus — hanya insert atau update |
| Header row detection | Scan maksimal 10 baris pertama file, cari baris yang mengandung cell bernilai `"PLANT CODE"` (case-insensitive) |
| Data start offset | `headerRowIdx + 3` — melewati baris widths dan sub-header |
| Duplicate Prod Est header | Disambiguasi berdasarkan posisi: kemunculan ke-1 = monthly, kemunculan ke-2 = yearly |
| Excel serial date | Konversi: `(serial - 25569) × 86400000` ms → ISO date |
| Footer/summary row | Baris dengan `plant_code` null/kosong di-skip |
| Estimasi produksi | Selalu dihitung ulang dari `cap` jika `cap` disertakan di create/update. Tidak bisa diedit langsung via API |
| Sort default tabel | `updated_at DESC NULLS LAST, created_at DESC` — baris paling baru di atas |
| Client-side filter | Frontend memuat semua data (`limit=5000`) sekali saat halaman dibuka, filter dilakukan di browser |
| Pinned groups | 7 grup utama hardcoded di `PINNED_GROUPS` — tidak dinamis dari database |
| Column visibility | Default: Mill Code, Mills, Group, Province, Island, Group Type. CAP dan kolom produksi hidden by default |
| Pagination | 20 record per halaman, dihitung dari data yang sudah difilter dan disort |

---

## 8. Error Handling

| Kondisi | Response |
|---|---|
| DB error di `listSuppliers` | HTTP 500, `{ "success": false, "error": { "message": "Failed to list suppliers" } }` |
| Supplier tidak ditemukan (GET/PUT/DELETE /:id) | HTTP 404 |
| Duplicate plant_code (POST) | HTTP 500, pesan khusus: `"Supplier with this plant_code already exists"` |
| File tidak ada (POST /import) | HTTP 400, `"No file uploaded"` |
| Header PLANT CODE tidak ditemukan | HTTP 400, `"Cannot find header row with PLANT CODE column"` |
| File < 2 baris | HTTP 400, `"File must have header and at least one data row"` |
| Row-level error saat import | Error dicatat di array `errors`, proses import baris lain tetap berlanjut |
| Unauthorized (role tidak sesuai) | HTTP 403 |
| Token tidak valid / tidak ada | HTTP 401 |
