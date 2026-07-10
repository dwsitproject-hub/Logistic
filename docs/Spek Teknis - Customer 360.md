# Spek Teknis — Customer 360
**KLIP (KPN Logistics Intelligence Platform)**
Versi: 1.0 | Tanggal: 2026-05-08

---

## 1. Stack & Lokasi File

| Layer | Teknologi | File |
|---|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS | `frontend/src/app/customer-360-company/page.tsx` |
| Backend Controller | Node.js, Express, TypeScript | `backend/src/controllers/supplier-groups.controller.ts` |
| Backend Routes | Express Router | `backend/src/routes/supplier-groups.routes.ts` |
| Database | PostgreSQL | Tabel: `suppliers`, `supplier_groups`, `contracts`, `shipments` |

---

## 2. Skema Database

### 2.1 Tabel `suppliers` (mill level)

```sql
CREATE TABLE suppliers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_code            VARCHAR UNIQUE,
  prov_code             VARCHAR,
  prov_no               VARCHAR,
  mill_no               VARCHAR,
  mill_code             VARCHAR,
  mills                 VARCHAR,
  group_id              VARCHAR,           -- FK logis ke supplier_groups.group_id
  parent_company        VARCHAR,
  group_holding         VARCHAR,
  controlling_shareholder VARCHAR,
  other_shareholders    VARCHAR,
  group_type            VARCHAR,
  group_scale           VARCHAR,
  integrated_status     VARCHAR,
  cap                   NUMERIC,           -- kapasitas (ton per jam)
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

### 2.2 Tabel `supplier_groups` (profil grup)

```sql
CREATE TABLE supplier_groups (
  group_id              VARCHAR PRIMARY KEY,
  land_bank             NUMERIC,           -- Hektar
  loading_method        VARCHAR,
  estimated_loading_rate NUMERIC,
  pic                   VARCHAR,
  company_type          VARCHAR,
  annual_turnover       NUMERIC,
  credit_rating         VARCHAR,
  credit_limit          NUMERIC,
  other_assets          TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 3. Backend

### 3.1 Routes — `/api/supplier-groups`

File: `backend/src/routes/supplier-groups.routes.ts`

```
Middleware: authenticateToken (semua route)

GET  /              → listSupplierGroups   [ADMIN, TRADING, LOGISTICS, FINANCE, MANAGEMENT, SUPPORT]
GET  /:group_id     → getSupplierGroup     [ADMIN, TRADING, LOGISTICS, FINANCE, MANAGEMENT, SUPPORT]
PUT  /:group_id     → upsertSupplierGroup  [ADMIN, LOGISTICS, MANAGEMENT]
```

### 3.2 Controller — `listSupplierGroups`

**Query params:** `search`, `page` (default 1), `limit` (default 50, max 200)

**SQL utama** — agregasi mill menjadi profil per group_id, dengan correlated subqueries ke `contracts` dan `shipments`:

```sql
SELECT
  s.group_id,
  MAX(s.parent_company)     AS parent_company,
  MAX(s.group_type)         AS group_type,
  MAX(s.group_scale)        AS group_scale,
  MAX(s.integrated_status)  AS integrated_status,
  (SELECT COUNT(*)::int FROM contracts c
   WHERE c.group_name = s.group_id
     AND c.status NOT IN ('Cancelled','CANCELLED'))  AS jumlah_pks,
  ROUND(SUM(COALESCE(s.cap::numeric, 0)), 2)          AS total_cap,
  ROUND(SUM(COALESCE(s.cpo_prod_est_month, 0)), 2)    AS cpo_month,
  ROUND(SUM(COALESCE(s.pk_prod_est_month, 0)), 2)     AS pk_month,
  ROUND(SUM(COALESCE(s.pome_prod_est_month, 0)), 2)   AS pome_month,
  ROUND(SUM(COALESCE(s.shell_prod_est_month, 0)), 2)  AS shell_month,
  ROUND(SUM(COALESCE(s.cpo_prod_est_year, 0)), 2)     AS cpo_year,
  ROUND(SUM(COALESCE(s.pk_prod_est_year, 0)), 2)      AS pk_year,
  ROUND(SUM(COALESCE(s.pome_prod_est_year, 0)), 2)    AS pome_year,
  ROUND(SUM(COALESCE(s.shell_prod_est_year, 0)), 2)   AS shell_year,
  STRING_AGG(DISTINCT s.province, ', ' ORDER BY s.province) AS provinces,
  STRING_AGG(DISTINCT s.island, ', ' ORDER BY s.island)     AS islands,
  (ARRAY_AGG(s.latitude  ORDER BY s.mill_code))[1]   AS latitude,
  (ARRAY_AGG(s.longitude ORDER BY s.mill_code))[1]   AS longitude,
  -- loading_method: mode transport unik dari contracts non-cancelled
  (SELECT STRING_AGG(DISTINCT c.transport_mode, ' / ' ORDER BY c.transport_mode)
   FROM contracts c
   WHERE c.group_name = s.group_id
     AND c.transport_mode IS NOT NULL
     AND c.status NOT IN ('Cancelled','CANCELLED'))   AS loading_method,
  -- fleet metrics dari shipments
  (SELECT COUNT(sh.id)::int FROM shipments sh
   JOIN contracts c ON c.id = sh.contract_id
   WHERE c.group_name = s.group_id
     AND sh.status NOT IN ('CANCELLED'))              AS total_voyages,
  (SELECT ROUND(COALESCE(SUM(sh.quantity_shipped),0)::numeric,2)
   FROM shipments sh JOIN contracts c ON c.id = sh.contract_id
   WHERE c.group_name = s.group_id
     AND sh.status NOT IN ('CANCELLED'))              AS total_volume_shipped,
  (SELECT COUNT(DISTINCT sh.vessel_name)::int
   FROM shipments sh JOIN contracts c ON c.id = sh.contract_id
   WHERE c.group_name = s.group_id
     AND sh.vessel_name IS NOT NULL
     AND sh.status NOT IN ('CANCELLED'))              AS unique_vessels,
  (SELECT ROUND(AVG(sh.total_lead_time_days)::numeric,1)
   FROM shipments sh JOIN contracts c ON c.id = sh.contract_id
   WHERE c.group_name = s.group_id
     AND sh.total_lead_time_days IS NOT NULL
     AND sh.status NOT IN ('CANCELLED'))              AS avg_lead_time_days,
  -- profil dari supplier_groups
  sg.land_bank, sg.estimated_loading_rate, sg.pic,
  sg.company_type, sg.annual_turnover, sg.credit_rating,
  sg.credit_limit, sg.other_assets
FROM suppliers s
LEFT JOIN supplier_groups sg ON sg.group_id = s.group_id
[WHERE s.group_id ILIKE $1 OR s.mills ILIKE $1 ...]
GROUP BY s.group_id, sg.land_bank, sg.estimated_loading_rate,
         sg.pic, sg.company_type, sg.annual_turnover,
         sg.credit_rating, sg.credit_limit, sg.other_assets
ORDER BY s.group_id
LIMIT $N OFFSET $M
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 85,
    "page": 1,
    "limit": 500
  }
}
```

### 3.3 Controller — `upsertSupplierGroup`

**Method:** PUT `/:group_id`  
**Body fields:** `land_bank`, `loading_method`, `estimated_loading_rate`, `pic`, `company_type`, `annual_turnover`, `credit_rating`, `credit_limit`, `other_assets`

```sql
INSERT INTO supplier_groups (group_id, land_bank, ...) VALUES ($1, $2, ...)
ON CONFLICT (group_id) DO UPDATE SET
  land_bank = EXCLUDED.land_bank,
  ...,
  updated_at = NOW()
RETURNING *
```

---

## 4. Frontend

### 4.1 State Management

```typescript
// Data
const [allGroups, setAllGroups]   = useState<SupplierGroup[]>([])
const [childMills, setChildMills] = useState<Mill[]>([])

// UI
const [search, setSearch]             = useState('')
const [selectedGroup, setSelectedGroup] = useState<SupplierGroup | null>(null)
const [showMillList, setShowMillList]   = useState(false)
```

### 4.2 Interface Types

```typescript
interface SupplierGroup {
  group_id: string
  parent_company: string | null
  group_type: string | null
  group_scale: string | null
  integrated_status: string | null
  jumlah_pks: number | null
  total_cap: number | null
  cpo_month: number | null;  pk_month: number | null
  pome_month: number | null; shell_month: number | null
  cpo_year: number | null;   pk_year: number | null
  pome_year: number | null;  shell_year: number | null
  provinces: string | null;  islands: string | null
  latitude: number | null;   longitude: number | null
  loading_method: string | null
  total_voyages: number | null
  total_volume_shipped: number | null
  unique_vessels: number | null
  avg_lead_time_days: number | null
  land_bank: number | null
  pic: string | null
  credit_rating: string | null
  // ...
}

interface Mill {
  id: string
  mill_code: string | null
  mills: string | null
  province: string | null
  island: string | null
  cap: string | null
  rspo: string | null;  rspo_type: string | null
  ispo: string | null;  iscc: string | null;  ggl: string | null
}
```

### 4.3 Data Fetching

```typescript
// Load 1: semua grup (saat mount)
useEffect(() => {
  api.get('/supplier-groups?page=1&limit=500')
    .then(res => setAllGroups(res.data.data.items || []))
}, [])

// Load 2: mills per grup (saat selectedGroup berubah)
useEffect(() => {
  if (!selectedGroup?.group_id) return
  api.get(`/suppliers?search=${encodeURIComponent(selectedGroup.group_id)}&page=1&limit=5000`)
    .then(res => {
      const all = res.data.data.items || []
      // Filter client-side untuk memastikan kecocokan exact
      setChildMills(all.filter(m => m.group_id === selectedGroup.group_id))
    })
}, [selectedGroup])
```

### 4.4 Search Logic

```typescript
const searchResults = useMemo(() => {
  const q = search.trim().toLowerCase()
  if (!q) return []
  return allGroups
    .filter(g => (g.group_id || '').toLowerCase().includes(q))
    .slice(0, 25)    // maks. 25 hasil
}, [allGroups, search])
```

### 4.5 Logika Sertifikasi Aktif (Mill List Modal)

```typescript
// Nilai dianggap bersertifikasi jika bukan kosong / NO / N/A / -
const isCertified = (v: string | null) =>
  !!v && v.trim() !== '' && !['NO', 'N/A', '-'].includes(v.trim().toUpperCase())

// Kolom sertifikasi hanya render jika ada minimal 1 mill yang certified
const activeCertCols = useMemo(() => ({
  rspo: childMills.some(m => isCertified(m.rspo)),
  ispo: childMills.some(m => isCertified(m.ispo)),
  iscc: childMills.some(m => isCertified(m.iscc)),
  ggl:  childMills.some(m => isCertified(m.ggl)),
}), [childMills])
```

### 4.6 Map Embed

```typescript
const mapSrc = lat && lon
  ? `https://www.openstreetmap.org/export/embed.html` +
    `?bbox=${lon-0.05},${lat-0.05},${lon+0.05},${lat+0.05}` +
    `&layer=mapnik&marker=${lat},${lon}`
  : null
```

- Provider: OpenStreetMap (gratis, tanpa API key)
- Koordinat: `latitude`/`longitude` dari mill pertama dalam grup (`ORDER BY mill_code ASC`)
- Bbox: ±0.05 derajat dari titik tengah
- Render: `<iframe>` dengan `loading="lazy"`

---

## 5. API Contract Lengkap

### GET `/api/supplier-groups`

| Parameter | Tipe | Default | Keterangan |
|---|---|---|---|
| `search` | string | `''` | Filter ILIKE pada group_id, mills, parent_company, province |
| `page` | integer | `1` | Halaman |
| `limit` | integer | `50` | Max 200 per request |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "items": [ { ...SupplierGroup } ],
    "total": 85,
    "page": 1,
    "limit": 500
  }
}
```

### GET `/api/supplier-groups/:group_id`

**Response 200:** `{ "success": true, "data": { ...supplier_groups row } }`  
**Response 404:** `{ "success": false, "error": { "message": "..." } }`

### PUT `/api/supplier-groups/:group_id`

**Auth:** ADMIN, LOGISTICS, MANAGEMENT

**Request body:**
```json
{
  "land_bank": 15000,
  "loading_method": "LAND",
  "estimated_loading_rate": 500,
  "pic": "John Doe",
  "company_type": "PKS",
  "annual_turnover": null,
  "credit_rating": "A",
  "credit_limit": null,
  "other_assets": null
}
```

**Response 200:** `{ "success": true, "data": { ...updated row } }`

### GET `/api/suppliers`

| Parameter | Tipe | Keterangan |
|---|---|---|
| `search` | string | Filter ILIKE pada plant_code, mills, mill_code, group_id, island, province |
| `page` | integer | Halaman |
| `limit` | integer | Max 5000 |

---

## 6. Aturan Bisnis Teknis

| Aturan | Detail |
|---|---|
| Koordinat map | Diambil dari mill pertama per `ARRAY_AGG(latitude ORDER BY mill_code)[1]` |
| jumlah_pks | COUNT contracts WHERE `group_name = group_id AND status NOT IN ('Cancelled','CANCELLED')` |
| loading_method | `STRING_AGG(DISTINCT transport_mode, ' / ')` dari contracts yang sama |
| fleet metrics | JOIN shipments → contracts berdasarkan `contract_id`, filter `status NOT IN ('CANCELLED')` |
| avg_lead_time_days | Hanya row dengan `total_lead_time_days IS NOT NULL` yang masuk ke AVG |
| Filter mill client-side | Response `/suppliers?search=X` difilter ulang di frontend: `m.group_id === selectedGroup.group_id` |
| Sertifikasi aktif | `isCertified()`: nilai harus non-null, non-empty, dan bukan `NO`/`N/A`/`-` |

---

## 7. Error Handling

| Kondisi | Response |
|---|---|
| DB error di listSupplierGroups | HTTP 500, `{ "success": false, "error": { "message": "Failed to list supplier groups" } }` |
| group_id tidak ditemukan (GET /:id) | HTTP 404 |
| Unauthorized (role tidak ada di authorize list) | HTTP 403 |
| Token tidak valid / tidak ada | HTTP 401 |
