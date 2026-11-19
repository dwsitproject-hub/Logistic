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

## 2026-11-19 — `/documents` React #423 (report 18 Nov, analisis Sentinel disalin)

- **Severity:** Medium
- **Halaman:** `http://commercial-docs.kpndomain.com/documents`
- **Rilis:** `83c5065e`
- **Pengguna / jumlah:** yustinus.refiano@energi-up.com. Report Sentinel `a1426191-8c8f-4d80-beb8-b8b49e2af87c`, dilaporkan 18 Nov 2026, 09.37.
- **Gejala:** Stack yang dikirim sama persis dengan kejadian `/login`: `Minified React error #423` di `fd9d1056-b9b281d6c2728617.js` dan scheduler `117-48a2f1a945f634b1.js` (`MessagePort.M`). Tidak ada frame dari kode halaman Documents.
- **Penyebab:** Sentinel menulis "same error as an earlier report; this analysis was made for that occurrence". Isi analisis (chunk 626, `page-d098570194a3dd10.js`, jam 01:14 UTC, pengguna febrianto, halaman `/login`) disalin dari report login, bukan dari sesi `/documents` ini. Halaman Documents dicek di kode: preferensi kolom dan page size dibaca dari `localStorage` setelah mount, sesi mulai sebagai `loading` di server dan client, dan tidak ada cabang `typeof window` di render pertama. Tidak ada bug hydration terpisah di halaman itu. Kegagalan yang cocok dengan stack ini tetap chunk route yang gagal dimuat, lalu React #423. Recovery di root layout menutup `/documents` sama seperti `/login`.
- **Perbaikan:** tidak ada perubahan kode tambahan. Tertutup oleh entri 19 Nov di bawah.
- **Di luar perbaikan ini:** breadcrumb sesi yustinus (apakah ada `Loading chunk … failed`, dan hash file-nya) tidak ada di report ini. Kalau Sentinel nanti mengirim breadcrumb yang bukan chunk, entri baru perlu dibuka.
- **Cara cek:** setelah deploy, buka `/documents` dari tab yang sudah login. Hard refresh bila halaman kosong.

## 2026-11-19 — `/login` blank: ChunkLoadError lalu React #423

- **Severity:** Medium (1 pengguna, 1 kejadian dalam 30 hari)
- **Halaman:** `http://commercial-docs.kpndomain.com/login`
- **Rilis:** `83c5065e`
- **Pengguna / jumlah:** febrianto.rahmawan@energi-up.com, satu sesi. Report Sentinel `c8bbe323-27fc-44a3-9396-82b897440939` (analisis 18 Nov 2026, 08.14). Kejadian yang sama dengan report sebelumnya di rilis itu.
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
