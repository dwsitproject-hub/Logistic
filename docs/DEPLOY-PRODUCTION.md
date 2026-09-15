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

**`OIDC_DISCOVERY_URL` produksi** (terverifikasi dari host backend 2026-09-11):

```
https://dwshub.kpndomain.com/api/sso/.well-known/openid-configuration
```

`issuer`-nya `https://dwshub.kpndomain.com` (bukan `test-dwshub`), dan
`token_endpoint_auth_methods_supported` adalah `["none"]` - public client dengan PKCE, jadi
memang tidak ada client secret yang perlu diminta. Varian HTTP menjawab `301` ke HTTPS; pakai
yang HTTPS.

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

## STEP 9 — SAP auto-import dari share IT

Terbukti di SIT 2026-09-14: hanya file terbaru yang diimpor, sumber tidak tersentuh, hasil
ditulis ke volume lokal.

### Prasyarat yang harus diperiksa lebih dulu

Host backend produksi (`172.28.80.51`) belum tentu punya share Synology yang ter-mount. Ini
berbeda dari host SIT, dan tidak bisa diasumsikan:

```bash
mount | grep -i -E "synology|cifs|172.30.1.94"
ls -la "/mnt/synology/dev/KLIP/IMPORT DATA/LOGISTICS REPORT/ORIGINAL"
```

**Titik mount produksi berbeda dari SIT** (diperiksa 2026-09-14). Jangan menyalin path SIT:

| | Mount point | Opsi |
|---|---|---|
| SIT | `/mnt/synology-apps` | `ro`, uid/gid 1001, dir_mode 0550 |
| Produksi | `/mnt/synology` | `rw`, uid/gid 0, dir_mode 0755 |

Konsekuensinya di produksi: izin bukan masalah (0755 terbaca semua user, termasuk `nodejs`
uid 1001), dan mount-nya `rw` - tapi KLIP tetap tidak punya jalur tulis ke folder sumber, jadi
file IT tetap aman.

Kalau `mount` kosong, share-nya harus diminta ke tim infra dulu - tidak ada konfigurasi KLIP yang
bisa menggantikan mount yang tidak ada.

### `.env`

```env
KLIP_SAP_IMPORT_MOUNT=/mnt/synology/dev/KLIP/IMPORT DATA/LOGISTICS REPORT
SAP_AUTO_IMPORT_ROOT=/mnt/sap-import
SAP_AUTO_IMPORT_RESULTS_ROOT=/app/uploads/SAP Data
```

Nilainya sama persis dengan SIT, termasuk `SAP_AUTO_IMPORT_RESULTS_ROOT`. Itu bukan salah ketik:
keduanya menunjuk volume Docker masing-masing host, jadi hasilnya tidak pernah bertabrakan.
Justru menulis hasil ke share yang **dipakai bersama** itulah yang akan saling menimpa.

Catatan folder `dev` pada path: IT menempatkan export di subtree `dev`, dan produksi membaca
folder yang sama. Itu keputusan yang sudah diambil - SIT untuk pengujian, produksi untuk
operasional. Registry checksum-nya per-database, jadi keduanya mengimpor secara independen.

### Deploy

```bash
cd /opt/klip && git pull origin main
docker compose -f docker-compose.backend.yml                -f docker-compose.backend.remote-db.yml                -f docker-compose.backend.sap-share.yml up -d --build backend
```

### Verifikasi, berurutan

```bash
docker exec klip-backend id
docker exec klip-backend ls -la /mnt/sap-import/ORIGINAL
```

User container harus `uid=1001`; folder share bermode `0550` milik uid/gid 1001, dan kalau tidak
cocok setiap pembacaan ditolak - muncul sebagai folder kosong, bukan error izin.

```bash
docker logs klip-backend 2>&1 | grep -i "auto-import cron"
```

Harus `scheduled: 0 6 * * * (Asia/Jakarta)`, bukan `disabled`.

### Menjalankan manual (opsional)

Cron akan berjalan sendiri jam 06:00. Untuk menguji lebih dulu, dari browser sebagai ADMIN:

```javascript
await (await fetch('/api/sap-master-v2/auto-import/run', {method:'POST', credentials:'include'})).json()
```

Ini import sungguhan: data masuk, email terkirim ke semua ADMIN, dan rebuild snapshot berjalan
4-27 menit sesudahnya. Pilih jendela waktu yang sepi.

### Yang tidak perlu dikhawatirkan

File di `ORIGINAL` tidak pernah dihapus, dipindah, atau diubah oleh KLIP - mount read-only dan
kode tidak punya jalur tulis ke sana. `SUCCEED`/`FAILED` milik IT juga tidak disentuh; hasil KLIP
ada di `/app/uploads/SAP Data/{Success,Failed}` di dalam container.

Konsekuensinya: kalau IT mengharapkan workbook hasil muncul di share, itu belum terjadi dan perlu
keputusan terpisah (mount `rw` untuk subtree KLIP, hanya untuk produksi).

---

## STEP 10 — Domain klip.kpndomain.com (HTTP dulu)

HTTPS sengaja ditunda. Bagian ini seluruhnya di sisi kita: tidak ada tiket infra, dan tidak ada
perubahan pada aplikasi lain yang sudah jalan di host frontend.

### Prasyarat: DNS — sudah beres

```bash
getent hosts klip.kpndomain.com
```

Harus `172.28.80.50`. Diperiksa 2026-09-15: sudah resolve di resolver internal (172.30.1.5).
Ini yang sebelumnya `NXDOMAIN` dan memblokir langkah ini.

### 0. Inspeksi dulu — read-only, tidak mengubah apa pun

```bash
sudo bash /opt/klip/docs/scripts/prod-inspect-nginx.sh 2>&1 | tee /tmp/klip-nginx-inspect.txt
```

Script ini tidak menulis, tidak reload, tidak menjalankan apa pun. Yang dicari ada di **bagian 4**:
siapa pemilik `default_server`.

- **Ada blok yang deklarasi `default_server`** → aman. Nama file kita bebas; nginx mencocokkan
  `server_name` lebih dulu, jadi trafik dwshub dkk tidak tersentuh.
- **Tidak ada sama sekali** → nginx menjadikan blok **pertama yang di-parse** sebagai default, dan
  `sites-enabled/*` dibaca berurutan alfabet. Beri nama file kita supaya urut **setelah** file
  pertama yang ada sekarang, mis. `zz-klip.kpndomain.com.conf`. Kalau tidak, semua request dengan
  Host tak dikenal jatuh ke KLIP — itu satu-satunya cara vhost ini bisa mengganggu tetangganya.

Bagian 8 memastikan host frontend memang bisa menjangkau backend 172.28.80.51:5001. Kalau tidak,
`/api` akan 502 begitu vhost aktif — perbaiki dulu sebelum lanjut.

### 1. Pasang vhost

```bash
sudo cp /opt/klip/docs/nginx/klip-kpndomain.conf /etc/nginx/sites-available/klip.kpndomain.com.conf
sudo ln -s /etc/nginx/sites-available/klip.kpndomain.com.conf /etc/nginx/sites-enabled/
sudo nginx -t
```

**`nginx -t` wajib lulus sebelum reload.** Perintah itu mem-parse seluruh konfigurasi gabungan;
kalau gagal, jangan reload — konfigurasi yang sedang berjalan tetap hidup dan tidak ada yang rusak.

```bash
sudo systemctl reload nginx
```

`reload` bukan `restart`: nginx memuat konfigurasi baru untuk koneksi berikutnya dan membiarkan
koneksi yang sedang berjalan selesai. Aplikasi lain tidak terputus.

### 2. Buktikan tetangganya masih hidup — sebelum menyentuh KLIP

Ini langkah yang paling sering dilewati, dan justru ini yang menjawab kekhawatiran "jangan sampai
merusak aplikasi yang sudah ada":

```bash
curl -sS -o /dev/null -w 'dwshub -> %{http_code}\n' https://dwshub.kpndomain.com/
```

Ulangi untuk setiap `server_name` yang muncul di bagian 5 hasil inspeksi. Semua harus sama seperti
sebelum reload. Kalau ada yang berubah, langsung rollback:

```bash
sudo rm /etc/nginx/sites-enabled/klip.kpndomain.com.conf && sudo nginx -t && sudo systemctl reload nginx
```

### 3. Verifikasi KLIP lewat domain

```bash
curl -sI http://klip.kpndomain.com/ | head -3
curl -s -o /dev/null -w '%{http_code}\n' http://klip.kpndomain.com/api/health
```

### 4. Frontend: kemungkinan besar tidak perlu diapa-apakan

Periksa dulu `/opt/klip/.env` di 172.28.80.50:

```bash
grep -E 'NEXT_PUBLIC_API_URL|BACKEND_INTERNAL_URL|FRONTEND_PORT' /opt/klip/.env
```

Kalau `NEXT_PUBLIC_API_URL=/api` (relatif), **tidak ada rebuild yang diperlukan**. Browser
memanggil `/api` pada origin mana pun yang sedang dipakai, dan Nginx sudah mencegat `/api` serta
`/auth` sebelum sampai ke Next — rewrite Next tidak pernah terpakai untuk trafik domain.

`BACKEND_INTERNAL_URL` sengaja **dibiarkan**. Selama itu ada, `http://172.28.80.50:3001` tetap
berfungsi persis seperti hari ini, jadi domain baru bisa diuji tanpa membuang jalan kembali.
Menutup port 3001 (`FRONTEND_PORT=127.0.0.1:3001`) baru dilakukan setelah domain terbukti — dan
itu memang butuh rebuild.

### 5. Backend: hanya kalau SSO mau dipindah ke domain

Satu-satunya hal yang tidak bisa jalan di dua origin sekaligus adalah SSO: backend mengirim satu
`OIDC_REDIRECT_URI`. Daftarkan dulu di DWS Hub Admin (**tambah**, jangan ganti):

```
http://klip.kpndomain.com/auth/oidc/callback
```

Lalu di `/opt/klip/.env` host backend (172.28.80.51):

```ini
FRONTEND_URL=http://klip.kpndomain.com
OIDC_REDIRECT_URI=http://klip.kpndomain.com/auth/oidc/callback
TRUST_PROXY=1
```

`FRONTEND_URL` gampang terlewat karena namanya terdengar seperti urusan frontend, padahal ini
env **backend** dan efeknya justru paling terasa di SSO. `oidc.controller.ts` memakainya untuk
melempar browser kembali setelah callback (`${frontendUrl()}/sso/callback?t=...`) dan untuk
redirect saat error. Kalau masih berisi `http://172.28.80.50:3001`, user yang login di domain
akan dilempar ke origin lain - sementara cookie sesinya terikat host `klip.kpndomain.com`, jadi
ia mendarat di tempat yang salah. Nilai ini juga menjadi CORS origin (`server.ts`) dan dasar
tautan di email pengingat ETA maupun notifikasi SAP auto-import.

```bash
cd /opt/klip && docker compose -f docker-compose.backend.yml -f docker-compose.backend.remote-db.yml -f docker-compose.backend.sap-share.yml up -d backend
```

`TRUST_PROXY=1` diperlukan karena backend kini berada di belakang Nginx — tanpa itu Express
membaca IP dan protokol dari koneksi Nginx, bukan dari browser.

**`SESSION_COOKIE_SECURE` jangan disentuh.** Defaultnya `false` (`src/middleware/session.ts`
menyalakannya hanya kalau nilainya persis `'true'`), dan selama masih HTTP itulah yang benar.
Dinyalakan sekarang, cookie sesi dikirim browser lalu tidak pernah dikembalikan, dan login berputar
tanpa pesan error.

Login SSO harus diuji lewat browser sungguhan di `http://klip.kpndomain.com/login` — cookie sesinya
HttpOnly dan terikat host, jadi `curl` tidak membuktikan apa-apa.

Rollback SSO: kembalikan `OIDC_REDIRECT_URI` ke `http://172.28.80.50:3001/auth/oidc/callback`,
restart backend.

### 6. HTTPS — kenapa ditunda, dan apa yang menanti

Bukan sekadar `certbot --nginx`, meskipun situs lain di host ini punya sertifikat Let's Encrypt
sungguhan. `certbot --nginx` memakai tantangan HTTP-01, yang mengharuskan server Let's Encrypt
menghubungi host ini dari internet publik — sementara `klip.kpndomain.com` menunjuk ke
`172.28.80.50`, alamat privat RFC1918 yang tidak bisa dijangkau dari luar.

`dwshub.kpndomain.com` memegang sertifikat Let's Encrypt asli (issuer `C=US, O=Let's Encrypt,
CN=YE1`, berlaku 19 Agu – 17 Nov 2026) sambil resolve ke alamat privat yang sama. Artinya
sertifikat itu terbit lewat **DNS-01**, bukan HTTP-01. Zona `kpndomain.com` dilayani Cloudflare
(`decker.ns.cloudflare.com`, `meera.ns.cloudflare.com`), jadi alatnya adalah plugin DNS Cloudflare
milik certbot dengan API token. Bagian 6 hasil inspeksi melaporkan `authenticator=` dari renewal
config yang sudah ada — kalau di situ tertulis plugin Cloudflare, mekanismenya sudah terpasang di
box ini dan tinggal dipakai ulang.

Catatan tambahan: per 2026-09-15 `klip.kpndomain.com` baru resolve di resolver internal;
`dwshub` resolve publik juga. DNS-01 tidak butuh A record publik — hanya TXT `_acme-challenge`
yang dibuat sendiri oleh plugin — jadi ini bukan penghalang, tapi berguna diketahui sebelum
men-debug penerbitan yang gagal.



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
