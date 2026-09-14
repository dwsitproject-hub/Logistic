# Migrasi data operasional staging → produksi

Analisis dan rekomendasi. Ditulis 2026-09-14, setelah memetakan seluruh tabel operasional dan
mengukur isinya.

---

## Jawaban singkat

**Ya, mungkin — dan lebih aman daripada yang terlihat.** Alasannya bukan optimisme, melainkan dua
hal yang sudah ada di sistem:

1. **Data kotor sudah ditandai oleh aplikasi sendiri.** Duplikat trucking tidak dihapus, melainkan
   ditandai `deduped_at` (migrasi 137), dengan `deduped_into_operation_id` yang menunjuk pemenangnya.
   Realization yang berasal dari SAP ditandai `source='sap'`. Baris WB blank-STO yang dulu
   menyebabkan penggandaan kuantitas sudah dibersihkan migrasi 124. Jadi "mana yang kotor" bukan
   tebakan — itu kolom yang bisa di-`WHERE`.

2. **Identitas kontrak stabil antar lingkungan.** Migrasi 119 menjadikan `TRIM(po_number)` sebagai
   identitas utama, dengan unique index. Itulah kunci yang memetakan baris staging ke kontrak
   produksi — bukan UUID, yang memang berbeda di kedua server.

**Tapi** rekomendasi saya bukan "migrasikan semua yang valid". Justru sebaliknya: migrasikan
sesedikit mungkin, yaitu hanya fakta yang **tidak bisa dibuat ulang oleh import SAP**.

---

## Prinsip: apa yang SAP tidak tahu

Produksi sudah punya seluruh kontrak dari SAP, dan import berikutnya akan memperbaruinya. Yang SAP
**tidak** punya hanyalah apa yang user ketik di KLIP:

| Benar-benar milik user | Dibuat ulang oleh SAP — jangan dibawa |
|---|---|
| WB daily actuals (`trucking_daily_actuals`) | `contracts`, `contract_stos` |
| Daily planning (`daily_deliverables`) | `payments`, `quality_surveys` |
| ETA kapal (`vessel_loading_ports.eta_*`) | Realization dengan `source='sap'` |
| Realization manual (`source='manual'`) | Seluruh tabel snapshot dan `sap_*` |
| Override ATA manual | Status dan kuantitas yang berasal dari SAP |
| Claim susut / claim mutu, dokumen komersial | |

Membawa yang sebelah kanan bukan hanya sia-sia — ia berisiko bertabrakan dengan hasil import
produksi dan menghasilkan angka yang tidak bisa dijelaskan.

---

## Seberapa kotor sebenarnya

Inventory dijalankan pada database dev (salinan bergaya staging, **bukan** staging itu sendiri —
angka staging harus diukur sendiri dengan skrip yang sama).

**Trucking, 16.552 operasi:**

| | Jumlah |
|---|---|
| Layak bawa | 15.451 |
| Duplikat soft-dedupe | 603 |
| Cancelled | 380 |
| Kontrak SEA (harusnya tidak punya trucking) | 41 |
| Bukan FRC/LCO — perlu diputuskan | 77 |

Kotorannya **6,7%**, dan seluruhnya sudah bertanda. Itu bukan "data kotor yang tidak diketahui" —
itu data yang sistem sudah tahu harus diabaikan.

**Tapi angka yang lebih penting:** dari 15.451 operasi layak bawa, yang benar-benar berisi
pekerjaan user hanya:

- **811** operasi punya WB daily actuals (4.323 baris)
- **301** operasi punya daily planning
- **9** realization manual — sisanya 15.361 berasal dari SAP

Sisanya hanya punya lokasi, yang juga diisi import SAP.

**Sea, 5.694 baris `vessel_loading_ports`:**

- **204** punya ETA — ini murni entri user, SAP tidak mengirim ETA
- **122** punya ATA yang berbeda dari nilai SAP-nya
- 5.671 punya data quality, tapi itu juga dari SAP

Jadi muatan sea yang nyata juga ratusan baris, bukan ribuan.

**Kesimpulan dari angka ini:** yang perlu dipindahkan berukuran **ratusan hingga seribuan baris**,
bukan puluhan ribu. Itu cukup kecil untuk diverifikasi satu per satu kalau perlu — dan itulah yang
mengubah migrasi ini dari "berisiko" menjadi "bisa dikendalikan".

---

## Rekomendasi: empat gelombang

Setiap gelombang berdiri sendiri, punya verifikasinya sendiri, dan bisa dihentikan tanpa merusak
yang sebelumnya.

### Gelombang 0 — ukur staging (wajib, sebelum memutuskan)

```bash
psql "$CONN_STAGING" -f docs/scripts/sql/inventory-operational-migration.sql
```

Read-only. Hasilnya menggantikan dugaan dengan angka. Kalau proporsi kotor di staging jauh lebih
besar daripada dev, keputusannya bisa berubah — dan lebih baik ketahuan sekarang.

### Gelombang 1 — WB daily actuals

Yang paling berharga dan paling tidak tergantikan: user tidak bisa mengetik ulang timbangan
harian. Filternya:

```
operasi: deduped_at IS NULL AND status <> 'CANCELLED' AND kontrak ketemu di produksi by PO
baris  : bukan blank-STO yang tertutup baris STO, kuantitas tidak negatif
```

Verifikasi: total kuantitas per PO di staging harus sama persis dengan di produksi setelah muat.
Kalau ada satu PO yang berbeda, hentikan dan periksa — jangan lanjutkan.

### Gelombang 2 — daily planning dan realization manual

301 operasi planning, 9 realization manual. Kecil, dan mudah diperiksa.

Satu hal yang harus divalidasi di sini karena **aplikasi tidak pernah memvalidasinya**: tidak ada
pemeriksaan `realization_end >= realization_start` di mana pun — tidak di database, tidak di
service. Pasangan tanggal yang terbalik akan lolos tanpa perlawanan kalau tidak dicegat di migrasi.

### Gelombang 3 — shipments dan vessel_loading_ports

Ini yang menjawab keluhan PO 1001031325 (lihat bagian berikutnya).

Bahaya khususnya: **`vessel_loading_ports` tidak punya unique constraint sama sekali.** Kunci
de-facto `(shipment_id, port_sequence, is_discharge_port)` hanya dijaga di kode. Konsekuensinya dua:
duplikat mungkin sudah ada di staging (di dev ada 910 baris yang berbagi kunci itu), dan menjalankan
migrasi dua kali akan menambah duplikat baru tanpa error apa pun.

Karena itu gelombang ini **harus** memakai kunci eksplisit dan idempoten, bukan INSERT polos.

### Gelombang 4 — tabel berkunci teks

`claim_susut_rows`, `claim_mutu_rows`, `commercial_document_files`, `settlement_invoice_summaries`,
`user_sto_contract_assignments`. Semuanya berkunci PO/Contract Ext No — tidak perlu pemetaan UUID
sama sekali, jadi risikonya paling rendah. Bisa dikerjakan kapan saja.

**Jangan dibawa:** `surveyors` dan `loading_ports` — dua tabel ini tidak dibaca maupun ditulis oleh
kode mana pun (sudah digantikan `vessel_loading_ports`), meskipun keduanya masih ada di skrip dump
lama.

---

## Hubungannya dengan PO 1001031325 — dan pilihan yang lebih murah

PO itu tidak muncul di Shipment produksi karena: tidak ada baris `shipments`, dan GR-nya sudah
Close — sementara jalur backlog (satu-satunya jalur yang tersisa saat tidak ada baris shipments)
mengecualikan kontrak GR-Close.

Ada **dua cara** memperbaikinya, dan keduanya sah:

**A. Migrasi shipments (gelombang 3).** Memperbaiki PO yang di staging memang sudah dikerjakan
user. Tidak memperbaiki PO yang di staging pun tidak punya baris shipment.

**B. Longgarkan aturan GR-Close pada jalur backlog.** Perubahan kode kecil, memperbaiki **semua**
PO sea yang GR-nya sudah tutup, termasuk yang tidak pernah disentuh siapa pun.

Keduanya tidak saling menggantikan. B menyelesaikan gejala secara menyeluruh dan murah; A
mengembalikan pekerjaan user yang sesungguhnya. Kalau harus memilih satu lebih dulu, **B** —
karena ia tidak memindahkan data apa pun, bisa diuji di SIT dalam hitungan menit, dan bisa
dibatalkan dengan satu commit.

Tapi B mengubah apa yang dilihat semua pengguna: kontrak sea yang sudah selesai akan mulai muncul
di halaman Shipment. Itu keputusan produk, bukan keputusan teknis — dan karena itu saya tidak
mengerjakannya tanpa persetujuan Anda.

---

## Risiko yang tidak bisa saya hilangkan

Saya lebih berguna dengan menyebutkannya daripada menutupinya.

**Kontrak staging tanpa PO number.** Kontrak yang dibuat manual di KLIP tidak pernah mengisi
`po_number`. Baris operasional di bawahnya hanya bisa dipetakan lewat `contract_id`, dan kalau itu
pun tidak ada di produksi, seluruh cabangnya tidak bisa dibawa. Ini akan muncul sebagai angka di
inventory, dan setiap barisnya perlu keputusan manusia.

**Invariant satu operasi aktif per kontrak.** Produksi sudah punya operasi trucking hasil import
SAP. Memuat operasi staging ke kontrak yang sama akan melanggar
`trucking_operations_one_active_per_contract_uidx`. Jadi migrasi trucking **tidak boleh menyisipkan
operasi baru** — ia harus menempelkan WB dan planning ke operasi yang sudah ada di produksi. Ini
perbedaan penting dan menentukan bentuk skripnya.

**Duplikat `vessel_loading_ports`** seperti dijelaskan di atas.

**Data uji yang menyamar sebagai data asli.** Tidak ada penanda "ini data testing" di skema. Kalau
selama pengembangan ada yang mengisi nama kapal atau kuantitas asal-asalan di staging, tidak ada
kolom yang bisa membedakannya dari data sungguhan. Satu-satunya pertahanan adalah review manusia
atas daftar yang akan dibawa — dan karena jumlahnya ratusan, itu benar-benar bisa dilakukan.

---

## Yang saya sarankan Anda putuskan sekarang

1. Jalankan inventory di staging (read-only, aman, beberapa detik).
2. Putuskan soal aturan GR-Close pada halaman Shipment — itu memblokir keluhan user hari ini.
3. Setelah melihat angka staging, putuskan gelombang mana yang dijalankan dan dalam urutan apa.

Saya belum menulis satu baris pun skrip migrasi yang menulis data. Itu disengaja: bentuk skripnya
ditentukan oleh angka staging, bukan sebaliknya.
