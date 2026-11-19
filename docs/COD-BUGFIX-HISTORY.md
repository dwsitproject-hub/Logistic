# Riwayat bugfix — Commercial Documents (frontend)

Catatan ini khusus aplikasi **COD** (`frontend-commdocs/`). Backend tetap KLIP. Tiap temuan production (Sentinel, user, atau log) ditambah sebagai entri baru di bawah, yang terbaru di atas.

Perbaikan di sini tidak menutup backend. Deploy image COD tetap lewat `docs/scripts/deploy-commdocs.sh`. Perubahan `docs/nginx/*.conf.example` baru aktif setelah vhost di host di-copy dan `nginx` di-reload (itu langkah manual, bukan bagian dari image).

## Cara menambah entri

Salin blok ini ke atas daftar (di bawah judul bagian "Entri"). Isi hanya yang terbukti dari report, kode, atau log. Kalau HTTP status chunk tidak ketahuan, tulis begitu.

```markdown
## YYYY-MM-DD — judul singkat

- **Severity:**
- **Halaman:**
- **Rilis:** (git SHA / image yang dilaporkan Sentinel)
- **Pengguna / jumlah:**
- **Gejala:**
- **Penyebab:**
- **Perbaikan:** file yang diubah, dan perilaku baru
- **Di luar perbaikan ini:** (ops, backend, atau hal yang sengaja tidak diubah)
- **Cara cek:**
```

## Entri

## 2026-11-18 — `ChunkLoadError` chunk 626, report sumber (08.14)

- **Severity:** Low. Satu kejadian, satu pengguna. Bukan defect baru.
- **Halaman:** `http://commercial-docs.kpndomain.com/login`
- **Rilis:** `83c5065e`
- **Pengguna / jumlah:** febrianto.rahmawan@energi-up.com. Report Sentinel `07ad0940-f554-4b4f-9cd1-58df492a216a`, dilaporkan 18 Nov 2026, 08.14.22. Waktu yang sama dengan #423 `036717b9-a15f-498d-82b5-aa7d84e0d465`.
- **Gejala:** `Uncaught ChunkLoadError: Loading chunk 626 failed.` dengan `(error: .../app/login/page-d098570194a3dd10.js)`. Stack `webpack-f46d9bddd56fc7e3.js` `d.f.j` → `d.e`, lalu router `117-48a2f1a945f634b1.js`. Breadcrumb 01:14:20 UTC, #423 di sesi yang sama pada 01:14:22.722. Satu page view.
- **Penyebab:** Ini `ChunkLoadError` asli sesi itu. Akhiran `(error:)` berarti script gagal di-fetch (404 atau jaringan), bukan timeout seperti chunk 148. #423 dua milidetik kemudian adalah gejalanya. Report `6a0c9825` (19 Nov, 08.11) menyalin analisis ini.
- **Perbaikan:** sudah di `b4e1abdf`. Tidak ada perubahan kode.
- **Cara cek:** satukan `07ad0940` dengan `036717b9`, `6a0c9825`, dan `c8bbe323`. Pisahkan dari chunk 148.

## 2026-11-18 — `/documents` chunk 148 timeout (penyebab #423 yustinus)

- **Severity:** Low. Satu pengguna, satu kejadian. Bersama chunk 626 di `/login` sekitar 1,5 jam sebelumnya: 2 pengguna, 2 kegagalan chunk dalam 14 hari.
- **Halaman:** `http://commercial-docs.kpndomain.com/documents`
- **Rilis:** `83c5065e`
- **Pengguna / jumlah:** yustinus.refiano@energi-up.com. Report Sentinel `b3fcf3bd-530c-49be-9250-cbf689eb9201`, dilaporkan 18 Nov 2026, 09.37.59. Pasangannya #423 `a1426191-8c8f-4d80-beb8-b8b49e2af87c` pada waktu, halaman, dan pengguna yang sama.
- **Gejala:** `Uncaught ChunkLoadError: Loading chunk 148 failed.` dengan `(timeout: .../148-a399183382e2b28e.js)`, bukan `(error:)`. Stack sama: `webpack-f46d9bddd56fc7e3.js` `d.f.j` → `d.e`, dipanggil dari router `117-48a2f1a945f634b1.js`. Halaman dibuka 02:35:25 UTC, error 02:37:59 UTC (sekitar 2,5 menit, sesuai timeout script webpack 120 detik). #423 menyusul pada milidetik yang sama.
- **Penyebab:** Request script tidak selesai, bukan 404. 404 pada kejadian `/login` tertulis `(error:)`. Timeout lebih cocok dengan koneksi, VPN, proxy, atau asset `/_next/static` yang menggantung. Kemungkinan hash basi lebih kecil. `148-*.js` adalah chunk webpack bernomor (chunk bersama), bukan `app/documents/page-*.js`. Id 148 hanya ada di build `83c5065e`; repo tidak menyimpan peta chunk itu, jadi modul di dalamnya tidak bisa disebut dari source. `xlsx` di halaman Documents hanya di-import saat Export, jadi bukan kandidat untuk request yang mulai saat halaman dibuka.
- **Perbaikan:** `isChunkLoadError` sudah mengenali pesan `Loading chunk 148 failed` termasuk akhiran `(timeout:)`. Reload sekali dari `b4e1abdf` menutup sesi ini. Test ditambah dengan kalimat production itu. Tidak ada perubahan perilaku.
- **Di luar perbaikan ini:** log Nginx/proxy 02:35–02:38 UTC 18 Nov 2026 untuk URL chunk itu (lambat, timeout, atau koneksi putus). Analisis Sentinel pada report #423 `a1426191` yang menyalin chunk 626 `/login` tidak menggambarkan sesi ini.
- **Cara cek:** triage: satukan `b3fcf3bd` dengan `a1426191`. Jangan digabung dengan trio `/login` (chunk 626).

## 2026-11-19 — `ChunkLoadError` chunk 626 (penyebab #423, sesi yang sama)

- **Severity:** Low (Sentinel). Satu kejadian, satu pengguna, tidak ada `ChunkLoadError` lain dalam 14 hari. 81 page view pada 11–17 Nov.
- **Halaman:** `http://commercial-docs.kpndomain.com/login`
- **Rilis:** `83c5065e`
- **Pengguna / jumlah:** febrianto.rahmawan@energi-up.com. Report Sentinel `6a0c9825-8223-4214-aadf-51875194d927`, dilaporkan 19 Nov 2026, 08.11. Catatan Sentinel: analisis dibuat untuk kejadian sebelumnya. Sumbernya report `07ad0940-f554-4b4f-9cd1-58df492a216a` (18 Nov, 08.14.22). Lihat entri teratas.
- **Gejala:** `Uncaught ChunkLoadError: Loading chunk 626 failed.` File-nya `/_next/static/chunks/app/login/page-d098570194a3dd10.js`. Stack di webpack runtime `webpack-f46d9bddd56fc7e3.js` (`d.f.j` → `Array.reduce` → `d.e`), lalu router Next di `117-48a2f1a945f634b1.js`. Breadcrumb: buka `/login` pukul 01:14:20 UTC, lalu console `Loading chunk 626 failed`. Report #423 di sesi yang sama pada 01:14:22.722.
- **Penyebab:** Ini error primernya. Fetch script gagal. #423 dua milidetik kemudian adalah gejala lanjutannya. Bukan exception logic aplikasi. Sentinel tidak bisa membedakan jaringan putus dan hash chunk yang sudah tidak ada, karena status HTTP tidak tertangkap. Hanya rilis `83c5065e` yang muncul di report.
- **Perbaikan:** sudah tertangani di `b4e1abdf`. `isChunkLoadError` mengenali `name === 'ChunkLoadError'` dan pesan `Loading chunk 626 failed`, lalu me-reload sekali. Tidak ada perubahan kode untuk report ini.
- **Cara cek:** di triage Sentinel, gabungkan `07ad0940`, `6a0c9825`, #423 `036717b9`, dan `c8bbe323`. Jangan buka tiket terpisah.

## 2026-11-18 — `/login` React #423, report sumber (breadcrumb asli)

- **Severity:** Medium
- **Halaman:** `http://commercial-docs.kpndomain.com/login`
- **Rilis:** `83c5065e`
- **Pengguna / jumlah:** febrianto.rahmawan@energi-up.com, satu sesi, satu page view (`/login`). Report Sentinel `036717b9-a15f-498d-82b5-aa7d84e0d465`, dilaporkan 18 Nov 2026, 08.14.22 (sama dengan 01:14:22 UTC di breadcrumb).
- **Gejala:** 01:14:20 UTC `Loading chunk 626 failed` untuk `/_next/static/chunks/app/login/page-d098570194a3dd10.js`. `ChunkLoadError` lewat `webpack-f46d9bddd56fc7e3.js` (`d.f.j` → `d.e`). Sekitar 2 ms kemudian (01:14:22.722) `Minified React error #423` di scheduler (`MessagePort.M` di `117-48a2f1a945f634b1.js`). Halaman login kosong untuk sesi itu.
- **Penyebab:** Ini kejadian yang analisisnya kemudian disalin Sentinel ke report lain. Chunk route `/login` gagal di-fetch (HTML/tab basi setelah deploy, atau request terputus). React 18.3.1 melempar #423 karena kegagalan itu di luar Suspense saat hydration. Bukan bug form login, backend tidak terlibat. Status HTTP chunk tidak tertangkap.
- **Perbaikan:** sudah ada di commit `b4e1abdf` (`origin/SIT`). Tidak ada perubahan kode untuk report ini.
- **Report yang menunjuk ke analisis ini:**
  - `07ad0940-f554-4b4f-9cd1-58df492a216a` — `ChunkLoadError` chunk 626, dilaporkan 18 Nov 2026, 08.14.22, sesi yang sama. Ini error primernya.
  - `6a0c9825-8223-4214-aadf-51875194d927` — `ChunkLoadError` yang sama, dilaporkan 19 Nov 2026, 08.11. Analisis disalin dari `07ad0940`.
  - `c8bbe323-27fc-44a3-9396-82b897440939` — #423, dilaporkan 19 Nov 2026, 08.11, halaman `/login`, pengguna yang sama. Catatan Sentinel: analisis dibuat untuk kejadian sebelumnya.
- **Cara cek:** setelah deploy `b4e1abdf`, hard refresh `/login`. Kelompokkan report `/login` ini sebagai satu defect. Sesi `/documents` (chunk 148) adalah defect terpisah.

## 2026-11-19 — `/documents` React #423 (report 18 Nov, analisis Sentinel disalin)

- **Severity:** Medium
- **Halaman:** `http://commercial-docs.kpndomain.com/documents`
- **Rilis:** `83c5065e`
- **Pengguna / jumlah:** yustinus.refiano@energi-up.com. Report Sentinel `a1426191-8c8f-4d80-beb8-b8b49e2af87c`, dilaporkan 18 Nov 2026, 09.37.
- **Gejala:** Stack yang dikirim sama persis dengan kejadian `/login`: `Minified React error #423` di `fd9d1056-b9b281d6c2728617.js` dan scheduler `117-48a2f1a945f634b1.js` (`MessagePort.M`). Tidak ada frame dari kode halaman Documents.
- **Penyebab:** Teks analisis report ini menyalin kejadian `/login` (chunk 626). Bukti sesi yustinus ada di report `b3fcf3bd`: chunk 148 timeout, lalu #423 pada waktu yang sama. Lihat entri teratas. Bukan bug hydration halaman Documents.
- **Perbaikan:** tidak ada perubahan kode tambahan. Reload sekali di `b4e1abdf` menutup `ChunkLoadError` ini.
- **Cara cek:** satukan dengan `b3fcf3bd`. Jangan digabung dengan chunk 626.

## 2026-11-19 — `/login` blank: ChunkLoadError lalu React #423

- **Severity:** Medium (1 pengguna, 1 kejadian dalam 30 hari)
- **Halaman:** `http://commercial-docs.kpndomain.com/login`
- **Rilis:** `83c5065e`
- **Pengguna / jumlah:** febrianto.rahmawan@energi-up.com, satu sesi. Report `c8bbe323-27fc-44a3-9396-82b897440939` (19 Nov 2026, 08.11) memakai analisis report sumber `036717b9-a15f-498d-82b5-aa7d84e0d465` (18 Nov 2026, 08.14). Lihat entri di atas.
- **Gejala:** Halaman login kosong. Console: `Loading chunk 626 failed` untuk `/_next/static/chunks/app/login/page-d098570194a3dd10.js`, lalu `ChunkLoadError` dari webpack runtime (`webpack-f46d9bddd56fc7e3.js`), sekitar 2 ms kemudian `Minified React error #423`.
- **Penyebab:** Browser meminta chunk route yang tidak ter-fetch (tab/HTML basi setelah deploy, gangguan jaringan, atau file hash sudah tidak ada di container baru). React 18.3.1 melempar #423 karena kegagalan itu terjadi di luar Suspense saat hydration, lalu seluruh root di-render ulang di client. #423 adalah gejala lanjutan, bukan bug form login. Backend KLIP tidak terlibat. Status HTTP request chunk tidak tertangkap Sentinel, jadi 404 vs reset jaringan tidak bisa dipisahkan dari satu kejadian ini.
- **Perbaikan:**
  - `frontend-commdocs/src/components/ChunkErrorRecovery.tsx` memasang listener saat modul di-load, sebelum hydration. Sebelumnya listener baru dipasang di `useEffect`, yaitu setelah window tempat chunk `/login` gagal dan #423 terlempar.
  - `frontend-commdocs/src/lib/chunkReload.ts` juga mengenali skew webpack runtime (tab lama bertemu modul yang tidak ada di runtime lama: `reading 'call'` dari frame `webpack-*.js` / `__webpack_require__`). Satu reload per 30 detik (`sessionStorage` key `cd.chunkReloadAt`). Pesan #423 saja tidak memicu reload, supaya hydration mismatch yang asli tidak di-refresh terus.
  - `frontend-commdocs/src/app/error.tsx` dan `global-error.tsx` menampilkan "New version available" plus tombol Reload bila error boundary yang menerima kegagalan itu. Reload otomatis tetap sekali; tombol tetap ada bila reload otomatis sudah terpakai.
  - `frontend-commdocs/src/middleware.ts` mengirim `Cache-Control: private, no-cache, no-store` untuk dokumen dan payload RSC. `/_next/static/*` tetap `public, max-age=31536000, immutable` lewat `next.config.js`.
  - `docs/nginx/commdocs.conf.example` dan `commdocs-production.conf.example`: location `/_next/static/` tidak mengganti 404 JS menjadi halaman HTML (`proxy_intercept_errors off`), dan location `/` tidak menyimpan cache proxy.
- **Di luar perbaikan ini:** Image Docker mengganti isi container, jadi hash chunk rilis sebelumnya memang hilang. Reload client mengambil HTML baru. Log akses Nginx/CDN untuk URL chunk itu sekitar 2026-11-18 01:14 UTC masih perlu dicek bila kejadiannya naik (404 = HTML basi atau rollover; 5xx/reset = infra). Vhost production yang sudah terpasang tidak berubah sampai file contoh di-copy manual. Sentinel sebaiknya mengelompokkan #423 bersama `ChunkLoadError` supaya tidak jadi tiket terpisah.
- **Cara cek:** `npm test` di `frontend-commdocs` (detector chunk, skew webpack, dan #423). Setelah deploy COD: buka `/login`, hard refresh sekali. Workaround untuk user yang masih kena rilis lama: Ctrl+F5.
- **Cek lokal 19 Nov 2026:** image `klip-commdocs` di-rebuild. `GET /login` mengembalikan 200 dengan `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`. Chunk webpack yang ada mengembalikan `public, max-age=31536000, immutable`. Halaman login tampil (email, password, Sign in). Hash yang tidak ada tetap 404 dari Next sendiri (halaman not-found, `nosniff`); yang dicegah di Nginx adalah mengganti 404 itu dengan error page Nginx.

## 2026-10-27 — `/login` ChunkLoadError (satu pengguna)

- **Severity:** Medium, satu pengguna
- **Halaman:** `/login`
- **Rilis:** tidak tercatat di catatan ini
- **Gejala:** Chunk login gagal dimuat setelah deploy; halaman tidak selesai di-render.
- **Penyebab:** Klien meminta nama file hash yang build baru sudah tidak punya.
- **Perbaikan (sudah ada sebelum 19 Nov):** `chunkReload.ts` + `ChunkErrorRecovery` di root layout, satu kali `location.reload()`. Entri 19 Nov menutup celah waktu pasang listener dan menambah tampilan cadangan plus header cache.
- **Cara cek:** sama dengan entri 19 Nov.
