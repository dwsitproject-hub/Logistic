# Deploy KLIP ke Production (deployment pertama)

| Item | Nilai |
|------|-------|
| Repository | https://github.com/dwsitproject-hub/Logistic |
| Branch | `main` |
| Server Backend | `172.28.80.51` |
| Server Frontend | `172.28.80.50` |
| Database | `pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com:5432` (Aliyun RDS) |
| Repo di server | `/opt/klip` (sama seperti staging) |
| Port backend | **belum ditentukan** — lihat STEP 0 |
| Port frontend | **belum ditentukan** — lihat STEP 0 |

Urutan: **tentukan port → buat direktori → isi `.env` → deploy backend → deploy frontend →
verifikasi → amankan akun default**.

---

## ⚠️ Tiga hal yang harus dibaca sebelum menyentuh server

### 1. `DB_HOST` wajib diisi eksplisit — kalau tidak, produksi menulis ke database SIT

`docker-compose.backend.remote-db.yml` punya nilai default:

```yaml
DB_HOST: ${DB_HOST:-pgm-d9jx9o06qae8gf3h.pgsql.ap-southeast-5.rds.aliyuncs.com}
```

Host itu **RDS SIT**, bukan produksi. Kalau `/opt/klip/.env` tidak memuat `DB_HOST`, backend
produksi akan tersambung ke database SIT dan **mulai menulis ke sana tanpa error apa pun** —
migrasi jalan, aplikasi hidup, dan datanya masuk ke tempat yang salah.

Karena itu STEP 4 memverifikasi `DB_HOST` di dalam container **sebelum** menganggap deploy
berhasil. Jangan lewati langkah itu.

> Rekomendasi perbaikan kode (belum dikerjakan): hapus nilai default itu sehingga Compose gagal
> saat `DB_HOST` kosong. Fallback yang menunjuk environment lain lebih berbahaya daripada error.

### 2. Container start akan men-seed akun dengan password yang diketahui umum

`backend/docker-entrypoint.sh` menjalankan migrasi lalu **seed tanpa syarat**:

```sh
node dist/database/migrate.js
node dist/database/seed.js      # admin/admin123, trading/trading123, logistics/logistics123,
                                # finance/finance123, management/management123
```

Seed memakai `ON CONFLICT (username) DO NOTHING`, jadi akun dibuat sekali lalu dibiarkan. Di
database produksi yang kosong, artinya **lima akun dengan password yang tertulis di repo publik
akan ada begitu backend pertama kali hidup.** STEP 7 wajib dikerjakan di hari yang sama.

### 3. Menit-menit pertama setelah deploy akan lambat, dan itu normal

- Snapshot trucking dibangun ulang saat stale: **150–240 detik**.
- Antrian warm-up delapan job: **±550 detik**, Oil Loss sendiri ±233 detik.
- Selama itu halaman bisa 20–90 detik. Jangan menilai performa sebelum keduanya selesai
  (cara memastikannya ada di STEP 6).

---

## STEP 0 — Tentukan port, lalu minta ke tim infra

Saya **tidak bisa** memeriksa port di `172.28.80.50/51` dari luar (keduanya tidak terjangkau dari
jaringan saya), jadi skrip ini dijalankan **di masing-masing server**.

```bash
# di 172.28.80.51 (backend)
bash docs/scripts/prod-check-ports.sh backend

# di 172.28.80.50 (frontend)
bash docs/scripts/prod-check-ports.sh frontend
```

Skripnya read-only, dan membedakan tiga keadaan — karena "tidak ada yang listening" belum berarti
bebas:

| status | arti |
| --- | --- |
| `LISTENING` | ada proses memakainya sekarang |
| `DOCKER` | ada container yang mem-publish port itu (bisa sedang mati lalu hidup lagi) |
| `FREE` | keduanya tidak |

Kalau repo belum ada di server, jalankan skripnya langsung:

```bash
curl -fsSL https://raw.githubusercontent.com/dwsitproject-hub/Logistic/main/docs/scripts/prod-check-ports.sh \
  | bash -s backend
```

### Kandidat port, urut prioritas

| peran | kandidat | alasan |
| --- | --- | --- |
| Backend | **5001**, lalu 5011, 5021, 5101, 8081, 8091 | 5001 adalah default compose (`${BACKEND_PORT:-5001}`) dan dipakai staging — menyamakannya mengurangi satu perbedaan antar environment |
| Frontend | **80**, lalu 3001, 3011, 3021, 8080, 8090 | 80 membuat URL tanpa `:port`; kalau sudah dipakai Nginx, pakai 3001 dan biarkan Nginx proxy ke `127.0.0.1:3001` |

### Template permintaan ke tim infra

```
Aplikasi: KLIP (Logistic) — production

1. Inbound TCP
   - 172.28.80.51  port <PORT_BE>   : diakses oleh 172.28.80.50 (dan admin internal)
   - 172.28.80.50  port <PORT_FE>   : diakses oleh user internal / reverse proxy

2. Outbound TCP
   - 172.28.80.51 -> pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com:5432
     (whitelist IP 172.28.80.51 di security group Aliyun RDS)
   - 172.28.80.50 -> 172.28.80.51:<PORT_BE>

3. Kedua server perlu akses outbound HTTPS (443) untuk pull image dasar dan npm install saat build.
```

Baris outbound ke RDS itu bukan formalitas: skrip di STEP 0 ikut mengetes koneksi ke RDS dan akan
memberi tahu kalau belum di-whitelist. Port lokal yang bebas tidak ada gunanya kalau backend tidak
bisa mencapai database.

---

## STEP 1 — Buat struktur direktori

Direktori `/opt/klip` belum ada di kedua server.

```bash
# di 172.28.80.51 (backend)
sudo bash docs/scripts/prod-bootstrap-dirs.sh backend

# di 172.28.80.50 (frontend)
sudo bash docs/scripts/prod-bootstrap-dirs.sh frontend
```

Kalau repo belum ada:

```bash
curl -fsSL https://raw.githubusercontent.com/dwsitproject-hub/Logistic/main/docs/scripts/prod-bootstrap-dirs.sh \
  | sudo bash -s backend
```

Yang dibuat:

| path | untuk |
| --- | --- |
| `/opt/klip` | root repo, dimiliki user SSH Anda supaya `git pull` tidak perlu sudo |
| `/opt/klip/backend/uploads` | bind mount upload (SAP Data, documents, claim-mutu) — **backend saja** |
| `/opt/klip/backend/logs` | bind mount log — **backend saja** |
| `/opt/klip/backups` | dump sebelum deploy, mode 0750 |
| `/opt/klip/.env` | dibuat **kosong**, mode 0600 |

`.env` sengaja dibuat kosong, bukan dari template: template mengundang placeholder credential
tertinggal atau ikut ter-commit.

---

## STEP 2 — Clone repository

```bash
cd /opt/klip
git clone https://github.com/dwsitproject-hub/Logistic.git .
git checkout main
git log --oneline -1        # catat commit ini untuk rollback
```

Kalau `git clone` menolak karena `/opt/klip` tidak kosong (sudah ada `.env`, `backups`):

```bash
cd /opt/klip
git init
git remote add origin https://github.com/dwsitproject-hub/Logistic.git
git fetch origin main
git checkout -b main origin/main
```

---

## STEP 3 — Isi `/opt/klip/.env`

Compose membaca `${DB_HOST}` dari **`/opt/klip/.env`**, bukan dari `backend/.env` saja. Ini file
yang menentukan.

### Backend (`172.28.80.51`)

```ini
# --- Database (WAJIB eksplisit - lihat peringatan #1) ---
DB_HOST=pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com
DB_PORT=5432
DB_NAME=<nama database produksi>
DB_USER=<user produksi>
DB_PASSWORD=<dari tim infra / secret manager - jangan pernah di-commit>

# Menolak start kalau DB_HOST ternyata menunjuk postgres lokal. Nyalakan di produksi.
KLIP_FAIL_ON_LOCAL_DB=true

# --- Port ---
BACKEND_PORT=<PORT_BE dari STEP 0>

# --- Secrets ---
JWT_SECRET=<acak, minimal 32 karakter>
SESSION_SECRET=<acak, minimal 32 karakter>

# --- SSO / OIDC (nilai produksi, bukan test-dwshub) ---
OIDC_DISCOVERY_URL=<...>/api/sso/.well-known/openid-configuration
OIDC_CLIENT_ID=logistic
OIDC_REDIRECT_URI=<URL produksi>/auth/oidc/callback
OIDC_SCOPES=openid email profile
FRONTEND_URL=<URL produksi>
SESSION_COOKIE_SAMESITE=Lax
SESSION_COOKIE_SECURE=<true kalau HTTPS, false kalau HTTP>
TRUST_PROXY=1
SSO_LEGACY_BRIDGE=false
```

Buat secret acak:

```bash
openssl rand -base64 48
```

### Frontend (`172.28.80.50`)

```ini
FRONTEND_PORT=<PORT_FE dari STEP 0>

# Same-origin kalau ada Nginx yang proxy /api ke backend:
NEXT_PUBLIC_API_URL=/api
# Kalau TIDAK ada Nginx, Next.js yang me-rewrite /api - arahkan ke backend:
BACKEND_INTERNAL_URL=http://172.28.80.51:<PORT_BE>
```

**`NEXT_PUBLIC_*` di-bake saat build image**, jadi setiap perubahannya wajib disertai `--build`.
Mengubahnya lalu `up -d` saja tidak berefek.

Amankan:

```bash
chmod 600 /opt/klip/.env
```

---

## STEP 4 — Deploy backend (`172.28.80.51`)

```bash
cd /opt/klip
git pull origin main

docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml up -d --build
```

### Verifikasi wajib — jangan lanjut sebelum ketiganya benar

```bash
# 1. DB_HOST di dalam container harus RDS PRODUKSI (bukan pgm-d9jx9o06qae8gf3h = SIT)
docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml \
  exec -T backend printenv DB_HOST DB_PORT DB_NAME

# 2. Migrasi selesai tanpa error
docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml \
  logs --tail=120 backend | grep -iE "migration|error"

# 3. Health
curl -s http://127.0.0.1:<PORT_BE>/health
```

Kalau `DB_HOST` menunjukkan `pgm-d9jx9o06qae8gf3h`: **hentikan container sekarang**, perbaiki
`/opt/klip/.env`, lalu ulangi. Backend sedang menulis ke database SIT.

```bash
docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml down
```

> Satu hal yang bisa membuat start terasa macet: `ensureUserStoContractAssignmentsTable`
> menjalankan `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` yang pernah terukur **menunggu 69.818 ms**
> untuk lock di belakang query lain. Itu no-op yang menunggu, bukan kegagalan — beri waktu sebelum
> menyimpulkan deploy gagal.

---

## STEP 5 — Deploy frontend (`172.28.80.50`)

Pastikan backend sudah sehat dan terjangkau dari server frontend:

```bash
curl -s http://172.28.80.51:<PORT_BE>/health
```

Kalau ini gagal, hentikan di sini — masalahnya jaringan/firewall, bukan frontend.

```bash
cd /opt/klip
git pull origin main
docker compose -f docker-compose.frontend.yml up -d --build
docker compose -f docker-compose.frontend.yml ps
docker compose -f docker-compose.frontend.yml logs --tail=50 frontend
```

`--build` wajib setiap kali, karena `NEXT_PUBLIC_API_URL` ikut ter-bake.

---

## STEP 6 — Verifikasi, dengan sabar

| cek | cara |
| --- | --- |
| API health | `curl -s http://172.28.80.51:<PORT_BE>/health` |
| Frontend hidup | buka `http://172.28.80.50:<PORT_FE>` |
| Login | coba login (SSO atau akun lokal) |
| Halaman berat | buka Trucking, Shipments, Contract Performance |

**Tunggu warm-up selesai sebelum menilai performa:**

```bash
docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml \
  logs backend | grep "warm-up"
```

Delapan job harus muncul `done`. Lalu pastikan snapshot sudah fresh:

```sql
-- psql ke RDS produksi
SELECT module, is_stale, refreshed_at FROM pipeline_summary_refresh_meta ORDER BY module;
```

`is_stale` harus `false` untuk `trucking` dan `shipment`. Kalau masih `true`, rebuild-nya belum
selesai atau gagal — cek log, dan **angka performa apa pun sebelum itu tidak mencerminkan kondisi
normal**.

---

## STEP 7 — Amankan akun default (hari yang sama)

Wajib, lihat peringatan #2.

```sql
-- Lihat akun yang ter-seed
SELECT username, email, role, created_at FROM users ORDER BY created_at LIMIT 10;
```

Pilih salah satu:

- **Kalau SSO sudah jadi jalur login satu-satunya:** nonaktifkan kelima akun itu.
- **Kalau masih perlu login lokal:** ganti password kelimanya sekarang, lewat UI admin atau
  update `password_hash` dengan bcrypt cost 10.

Jangan tunda ke "nanti setelah UAT". Password-nya ada di repo.

---

## STEP 8 — SSO / OIDC

### Prasyarat dari sisi Hub

Didaftarkan di **DWS Hub Admin → Applications** (sudah dilakukan 2026-09-11):

| Field | Value |
|---|---|
| SSO Mode | `OIDC (strict)` |
| OAuth Client ID | `logistic` |
| Client type | public client / PKCE — **tidak ada client secret** |
| Target URL | `https://klip.kpndomain.com/login` |
| OIDC Redirect URIs | `https://klip.kpndomain.com/auth/oidc/callback`<br>`http://172.28.80.50:3001/auth/oidc/callback` (sementara, untuk uji lewat IP) |

Yang harus diminta balik dari admin Hub: **`OIDC_DISCOVERY_URL` produksi**, berbentuk
`https://<host-hub-produksi>/api/sso/.well-known/openid-configuration`. Staging memakai
`test-dwshub.kpndomain.com`; host produksinya jangan ditebak.

### Mengisi env di backend produksi

```bash
bash /opt/klip/docs/scripts/prod-set-oidc.sh
```

Script itu menanyakan discovery URL dan redirect URI, lalu **memverifikasi lebih dulu** sebelum
menulis apa pun: discovery harus terambil **dari host backend** (bukan dari laptop — token
exchange dilakukan server-to-server), harus JSON dan bukan HTML UI Hub, harus memuat `issuer` /
`authorization_endpoint` / `token_endpoint` / `jwks_uri`, dan `jwks_uri` harus mengembalikan
`keys`. Gagal di salah satu titik itu berarti `.env` tidak disentuh sama sekali.

Penulisannya **merge**, bukan tulis-ulang: key lain di `.env` tetap, dan ada backup bertimestamp.
`SESSION_COOKIE_SECURE` diturunkan dari skema redirect URI (`https` → `true`), karena cookie
`Secure` di atas HTTP akan di-set lalu tidak pernah dikirim balik dan login berputar diam-diam.

> `prod-set-db-credentials.sh` menulis ulang `.env` dari daftar key tetap. Menjalankannya
> **setelah** script ini akan menghapus seluruh blok OIDC. Jalankan yang OIDC paling akhir.

### Verifikasi

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:5001/auth/oidc/login
```

`302` ke authorization endpoint Hub = konfigurasi terbaca. `503` = salah satu dari
`OIDC_DISCOVERY_URL` / `OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` kosong (ini perilaku yang
disengaja — rute mati dengan aman, bukan error yang membingungkan).

Login sungguhan harus lewat **browser**, pada origin yang sama persis dengan redirect URI.
Session-nya cookie `HttpOnly` yang terikat host, jadi tidak bisa diuji dengan `curl`.

### Yang menentukan siapa bisa masuk

Pemetaan user bersifat **invite-only berdasarkan email** — akun tidak pernah dibuat otomatis.
User Hub yang emailnya tidak ada di tabel `users` ditolak ke `/login?error=sso_no_access`.
41 akun sudah dibawa dari staging; siapa pun di luar itu harus dibuat lebih dulu.

---

## Rollback

```bash
cd /opt/klip
git log --oneline -5
git checkout <commit-sebelumnya>

# backend
docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml up -d --build
# frontend
docker compose -f docker-compose.frontend.yml up -d --build
```

**Migrasi tidak ikut ter-rollback.** Skema database akan tetap di versi yang lebih baru. Untuk
rilis ini itu aman (migrasi 164 dan 165 hanya menambah kolom nullable dan satu index), tapi jangan
menganggap itu berlaku umum — periksa migrasi baru sebelum berjanji bisa rollback.

Backup sebelum deploy besar:

```bash
pg_dump -h pgm-d9jn3khh0b3907w4.pgsql.ap-southeast-5.rds.aliyuncs.com -U <user> -d <db> \
  -Fc -f /opt/klip/backups/prod-$(date +%F-%H%M).dump
```

---

## Catatan khusus rilis ini (migrasi 164 & 165)

Kalau produksi dideploy dari `main` per 2026-09-11, dua migrasi ini ikut:

- **164** — kolom `region_site` di `trucking_list_stage_snapshot`
- **165** — kolom `late_due_date` / `late_ata_date` / `late_eta_date`, **dan men-DROP** tiga kolom
  dari revisi sebelumnya

Keduanya menandai snapshot trucking `is_stale = TRUE`. **Urutannya penting:** antara migrasi
berjalan dan backend memuat kode baru, refresh akan gagal dengan `42703` dan halaman jatuh ke
jalur live (lambat). Karena `docker compose up -d --build` menjalankan migrasi lalu server dari
image yang sama, urutannya sudah benar dengan sendirinya — tapi **jangan menjalankan migrasi
manual lebih dulu** lalu deploy kode belakangan.

Satu perubahan perilaku yang perlu diberitahukan ke user: Late Indicator kini dihitung dari due
date vs ATA (SAP Trucking Last Receive Date atau last date WB), fallback ke ETA (last date daily
planning deliverables). Sebelumnya ketiga tempat memakai tanggal yang berbeda, dan koreksi ini
memindahkan **2.908 dari 7.485 baris YTD** antara Late dan On Time.
