# Panduan deploy KLIP ke production

Panduan ini untuk rilis `main` **b09353ed** (2026-11-16, merge SIT `9d449cc0` di atas `6ddc356f`). Langkah umumnya berlaku untuk rilis berikutnya; bagian "Khusus rilis ini" perlu diganti.

Production terdiri dari **dua host**, satu skrip per host:

| Host | Alamat | SSH | Skrip | Isi |
|---|---|---|---|---|
| ECS-DB | 8.215.56.98 | 1819 | `docs/scripts/deploy-prod-backend.sh` | backend + migration |
| ECS-App | 147.139.176.70 | 1818 | `docs/scripts/deploy-prod-frontend.sh` | frontend (Next.js) |

**Urutan: backend dulu, baru frontend.** Kedua skrip menolak berjalan di host yang salah, meminta konfirmasi, dan berhenti di cek pertama yang gagal. Skrip tidak mengubah `.env` dan tidak menjalankan migration manual.

---

## 0. Sebelum mulai

- [ ] **Jam deploy:** jangan antara 06:00 dan 10:00 WIB (import SAP otomatis berjalan di jam itu).
- [ ] Tidak ada import SAP yang sedang berjalan (cek halaman SAP Imports; tunggu sampai selesai).
- [ ] `origin/main` sudah `b09353ed`:
  ```bash
  git ls-remote origin main
  ```
- [ ] **Migration:** bandingkan dengan yang sudah berjalan di production, bukan dengan `origin/main` sebelumnya. Production tertinggal dari main sejak rilis 12 November, jadi rilis 16 November membawa migration 264, 266, 267. Migration 266 menghapus baris `dhm_push_state` tertentu; tabel itu dicadangkan dulu (langkah 1b).

## 1. Backup database (ECS-DB)

Dari server database (172.28.92.60), dari `/opt/klip-db`:

```bash
bash /opt/klip/docs/scripts/backup-pre-merge-remote.sh
```

Hasilnya `/opt/klip-db/backups/klip_pre_merge_<waktu>.dump`. Skrip gagal kalau ukuran dump di bawah 1 KB. Catat nama file-nya.

### 1b. Cadangkan tabel yang akan dihapus migration (hanya kalau rilis membawa migration yang `DELETE`/`DROP`)

Untuk rilis 16 November: `dhm_push_state` (migration 266). Di ECS-DB:

```bash
docker exec -i klip-backend node - <<'EOF'
const p = require('/app/dist/database/connection').default;
(async () => {
  await p.query("CREATE TABLE IF NOT EXISTS dhm_push_state_bak_20261116 AS SELECT * FROM dhm_push_state");
  const a = await p.query("SELECT count(*)::int n FROM dhm_push_state_bak_20261116");
  const b = await p.query("SELECT to_regclass('product_materials') AS t");
  console.log('backup rows:', a.rows[0].n, '| product_materials exists:', b.rows[0].t);
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
EOF
```

### 1c. Cek status git di kedua server sebelum deploy

```bash
cd /opt/klip && git fetch origin main --quiet && git status -sb | head -3 && git log --oneline -1
```

Hanya `[behind N]` yang normal. `ahead` atau `diverged` berarti `git pull --ff-only` akan gagal; lihat "Kalau ada masalah".

## 2. Deploy backend (ECS-DB)

Login SSH ke ECS-DB (port 1819), lalu:

```bash
cd /opt/klip
git fetch origin main --quiet
git show origin/main:docs/scripts/deploy-prod-backend.sh > /tmp/deploy-prod-backend.sh
bash /tmp/deploy-prod-backend.sh
```

Skrip diambil dari `origin/main` lebih dulu supaya versi terbarunya yang berjalan, bukan salinan lama di checkout.

Yang dilakukan skrip, dan yang perlu Anda baca di layar:

1. **where we are:** host harus `ECS-DB`, branch `main`.
2. **local changes to tracked files:** harus "none". Kalau ada file ter-modifikasi atau staged, skrip berhenti. Jangan pakai `git stash`; cari tahu penyebabnya dulu.
3. **fetching:** daftar commit yang masuk dan `--stat` file. Harus berisi commit rilis ini.
4. **migrations:** daftar migration yang akan berjalan di production. Baca bagian "MIGRATIONS THAT DELETE OR DROP DATA" kalau ada: skrip mencetak satu perintah backup per tabel, dan meminta `BACKED-UP` atau `SKIP-BACKUP`. Cadangkan tabelnya dulu (langkah 1b), baru jawab.
5. **database this backend will write to:** `DB_HOST (.env)` tidak boleh kosong dan harus host database production.
6. **integration secrets key:** fingerprint harus **berbeda** dengan SIT.
7. **Konfirmasi:** ketik `backend` lalu Enter.
8. **SAP share:** rute ke NAS tidak boleh lewat bridge Docker, dan folder share harus terbaca.
9. **upload share:** harus ke Synology (`/mnt/synology/dev/KLIP`).
10. `git pull --ff-only`, lalu build dan start (beberapa menit).
11. **did the image actually change:** harus `changed`.
12. **checks:** semua `[ OK ]`:
    - container is running
    - uploads are on Synology
    - no migration errors this boot
    - SAP auto-import cron registered
    - SAP share mounted and readable
    - container has the integration secrets key

Hasil akhir yang benar: `all checks passed`. Kalau ada `[FAIL]`, **jangan lanjut ke frontend**; lihat bagian "Kalau ada masalah".

### Cek setelah backend (masih di ECS-DB)

Semua read-only (tidak menulis apa pun). Di production skripnya dibaca dari `origin/main`:

```bash
cd /opt/klip
git show origin/main:docs/scripts/diag-cp-ata-rule-smoke.cjs | docker exec -i klip-backend node -
```
Harapan: semua `ok`, kecuali satu baris `getLatePerformance` (endpoint lama yang memang tidak dipakai frontend; error `base.sto_count` itu sudah ada sejak sebelumnya).

```bash
git show origin/main:docs/scripts/diag-cp-close-by-first-atc.cjs | docker exec -i klip-backend node - | tail -80
```
Harapan: 0 kontrak yang berpindah (aturan sudah berlaku di production).

```bash
git show origin/main:docs/scripts/diag-cp-vs-contracts-po.cjs | docker exec -i -e PO=1001032275 klip-backend node -
```
Harapan: PO 1001032275 muncul di tab **Open** Contract Performance, OS 622 MT.

## 3. Deploy frontend (ECS-App)

Login SSH ke **ECS-App** (port 1818), bukan ECS-DB, lalu:

```bash
cd /opt/klip
git fetch origin main --quiet
git show origin/main:docs/scripts/deploy-prod-frontend.sh > /tmp/deploy-prod-frontend.sh
bash /tmp/deploy-prod-frontend.sh
```

Yang perlu diperhatikan:

1. **host** harus ECS-App. Kalau skrip bilang "this is ECS-DB", Anda salah host; keluar.
2. **local changes:** harus "none".
3. **NEXT_PUBLIC_\* wiring:** harus lolos. Nilai `NEXT_PUBLIC_*` ditanam saat build; kalau tidak terhubung, build tampak sukses tetapi tidak mengubah apa pun.
4. **Konfirmasi:** ketik `frontend`.
5. **did the image actually change:** harus `changed`. Kalau `unchanged` padahal ada commit yang ditarik, ada yang salah di build.
6. **checks:** `container is running` harus `[ OK ]`, hasil akhir `all checks passed`.

Buktikan bundle baru benar-benar terpasang (ganti teks dengan string yang hanya ada di kode baru):

```bash
docker compose -f docker-compose.frontend.yml exec -T frontend sh -c "grep -rl 'Delivered Qty (Klip) and Received Qty (Klip) can be edited directly' .next | head -3"
```
Harapan: minimal satu file muncul.

## 4. Cek di aplikasi (browser)

Buka production dengan **hard refresh** (Ctrl+Shift+R) supaya bundle lama tidak terpakai.

| Cek | Harapan |
|---|---|
| Search di Contracts / Shipments | Outline saat dipilih tipis (1px), biru lembut |
| Contracts, PO 1011003087, Contract Details | `V 3,000 MT   T 3,008 MT` satu baris di samping Total STO Quantity |
| Shipping Performance | Baris teratas = `contract_date` terbaru |
| Shortage Claim, Quality Claim | Baris teratas = CR Date terbaru |
| Contract Performance, PO 1001032275 | Ada di tab Open, OS 622 MT |
| Edit Shipment > Add PO | Hint: "Delivered Qty (Klip) and Received Qty (Klip) can be edited directly on the row." |
| Shipments > modal lama (Edit pada baris vessel) | Tidak ada kartu Upload SLD/SDD; Received Qty bisa diisi |
| Header tabel (Contracts, Shipments, dll.) | Keterangan di samping judul, tanpa "Page x/y" |

## 5. Besok pagi setelah import SAP 06:00

- Pastikan import 06:00 selesai tanpa terpotong (halaman SAP Imports: status completed, failed rows rendah).
- Jalankan cek invarian OS lintas halaman (lihat catatan `klip-cross-page-os-invariants`) kalau ada perubahan data SAP besar.

---

## Kalau ada masalah

**Skrip berhenti sebelum build ("Nothing was changed")** : tidak ada yang berubah di server. Perbaiki penyebabnya lalu jalankan ulang.

**`cannot read ... on this host` / rute ke NAS lewat bridge Docker** : backend tidak bisa start tanpa share terbaca. Penyebab yang pernah terjadi: network Docker mengambil subnet 172.30.0.0/16, atau mount CIFS mati. Perbaiki rute ke NAS (`ip route get 172.30.1.94`; solusi: rute /32 lewat gateway kantor). Hanya sebagai jalan darurat: `DEPLOY_WITHOUT_SHARE=1 bash /tmp/deploy-prod-backend.sh` menjalankan API tanpa import SAP otomatis dan tombol Sync sampai share diperbaiki.

**`[FAIL] uploads are on Synology`** : dokumen yang diunggah akan masuk volume Docker, bukan Synology. Periksa mount `/mnt/synology/dev/KLIP`, lalu jalankan ulang skrip (jangan susun perintah `docker compose` manual; skrip yang menyusun tiga file compose dengan benar).

**`SAP auto-import cron registered` gagal** : biasanya compose tidak membawa overlay `sap-share`. Jalankan ulang lewat skrip, jangan lewat `docker compose` biasa.

**Frontend `unchanged`** : lihat apakah commit yang ditarik menyentuh `frontend/`; periksa juga wiring `NEXT_PUBLIC_*`.

**`fatal: Not possible to fast-forward` saat "pulling"** : checkout server menyimpang dari `origin/main` (terjadi 2026-11-16 di ECS-DB: HEAD `70e4cfdf` adalah merge yang tidak ada di GitHub). Nothing was changed. Periksa dulu apakah `origin/main` sudah memuat semua isi server: dari mesin development, `git merge-tree --write-tree origin/main <HEAD server>` harus menghasilkan tree yang sama dengan `origin/main`. Kalau sama, di server:
```bash
cd /opt/klip && git fetch origin main --quiet && git branch -f prod-before-<tanggal> HEAD && git reset --hard origin/main
```
lalu jalankan ulang skrip. Setelah reset skrip tidak lagi menampilkan daftar migration; migration tetap berjalan saat container start, jadi backup tabel harus sudah dibuat sebelumnya.

**Rollback** (kalau rilis tidak membawa migration yang menghapus data; rilis 16 November membawa migration 266, jadi tabel `dhm_push_state_bak_20261116` perlu dipulihkan manual kalau diperlukan). Jangan `git checkout` di server (skrip menolak kalau branch bukan `main`). Dari mesin development:
```bash
git checkout main && git pull
git revert -m 1 b09353ed
git push origin main
```
lalu deploy ulang dengan langkah 2 dan 3 (backend, lalu frontend).

## Aturan tetap

- Backend **sebelum** frontend, dan satu skrip per host.
- Jangan edit `.env` lewat skrip, jangan jalankan migration manual.
- Jangan `git stash` di server.
- Jangan deploy di jam 06:00 sampai 10:00 WIB.
- Berhenti di `[FAIL]` pertama; jangan lanjut ke langkah berikutnya.
