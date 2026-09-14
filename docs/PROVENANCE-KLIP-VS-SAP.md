# Mana yang diisi user, mana yang dari SAP

Hasil pemetaan 2026-09-14, dibuat untuk memutuskan data mana yang layak dibawa ke produksi.

---

## Masalahnya, dalam satu kalimat

Sebagian besar field yang di UI diberi label "KLIP" **disimpan di kolom yang sama dengan nilai dari
SAP**, tanpa penanda apa pun tentang siapa yang menulisnya.

Aturan penggabungannya "isi yang kosong saja": nilai yang sudah diketik user tidak pernah ditimpa,
tapi field yang masih kosong akan diisi SAP — dan setelah itu tidak ada cara membedakannya dari
ketikan user.

Satu detail yang memperburuk: keputusan "lindungi nilai KLIP" diambil **per baris, bukan per
field** (`hasKlipShipmentActivity`). Satu field yang pernah disentuh user akan melindungi enam
field lain yang tidak pernah ia buka — dan flag itu dihitung ulang setiap import, tidak pernah
disimpan.

---

## Yang provenance-nya masih utuh — ini yang aman dibawa

| Data | Penanda | Keterangan |
|---|---|---|
| WB daily actuals | `trucking_daily_actuals.source` = `manual` / `wb_rekap` | SAP tidak pernah menulis tabel ini sama sekali |
| Realization trucking | `trucking_realizations.source = 'manual'` | Penanda paling bersih di sistem |
| ATA manual (single-port) | baris di `shipment_ata_overrides` | Punya `source` dan `updated_by`; berlaku sejak migrasi 091 |
| Daily planning | `daily_deliverables` (jsonb) | KLIP-only secara konstruksi |
| Pre-planned group buatan user | `pre_planned_groups.source = 'MANUAL'` | |
| SFAL/SFBD trucking | `trucking_operations.sfal_qty` / `sfbd_qty` | SAP tidak pernah menulisnya |
| Metrik T/C kapal | `fuel_consumption`, `freight`, `pump_rate`, `sailing_speed`, `shortage` | KLIP-only |
| Cargo readiness | `contracts.cargo_readiness_klip_edited` | Satu-satunya boolean provenance eksplisit di skema |

**Ini adalah daftar lengkap** field yang bisa kita jamin asalnya. Kebetulan ia juga memuat data
yang paling berharga dan paling tidak mungkin diketik ulang user: timbangan harian WB.

---

## Yang provenance-nya hilang dan tidak bisa dipulihkan

| Data | Kenapa |
|---|---|
| **Qty Receive KLIP** (`shipments.actual_vessel_qty_receive`) | Kasus terburuk: field berlabel KLIP di UI, tapi **tidak ada kolom KLIP-nya** — nama `quantity_receive_klip` hanya alias SQL atas kolom yang juga ditulis SAP. Tidak ada snapshot, tidak ada `updated_by` |
| ATA & Quality sebelum migrasi 130 | Backfill migrasi 130 menyalin nilai efektif ke kolom `sap_*`, sehingga keduanya identik selamanya |
| Quality yang user isi `0` | Penggabungan memperlakukan `0` tersimpan sebagai "kosong", jadi SAP menimpanya |
| Lokasi & qty trucking | `loading_location`, `unloading_location`, `quantity_delivered` — tiga penulis, satu kolom, tanpa penanda |
| SFAL/SFBD shipment | SAP **menimpa langsung**, bahkan tidak sekadar mengisi yang kosong |
| ETA shipment, tanggal planning trucking | Migrasi 026 dan 057 mengisinya dari sumber SAP tanpa penanda |

`shipments`, `trucking_operations`, dan `vessel_loading_ports` **tidak punya kolom `updated_by`
maupun `created_by`** — hanya `updated_at`, yang ikut berubah setiap import SAP. Jadi tidak bisa
dipakai bahkan untuk mengetahui kapan terakhir seorang manusia menyentuh baris itu.

Satu-satunya rekaman per-field per-user adalah **`audit_logs`**, yang mencatat apa yang dikirim
user beserta `user_id` dan waktunya. Ia tidak lengkap (hanya berjalan sejak `auditLog` dipasang di
tiap route, dan tidak mencatat nilai sebelumnya), tapi itulah satu-satunya jalan rekonstruksi yang
ada.

---

## Konsekuensi untuk migrasi

Aturannya menjadi konkret, bukan lagi soal selera: **bawa hanya field yang ada di tabel pertama.**

Untuk field di tabel kedua, produksi tidak kehilangan apa pun dengan tidak membawanya — import SAP
akan mengisinya sendiri dengan nilai SAP, yang memang itulah isinya selama ini.

---

## Kenapa menghapus ATA di produksi bukan jawabannya

Diperiksa terpisah, dan hasilnya tegas:

**Tidak ada fallback ke `sap_ata_*`.** Kolom snapshot hanya dipakai sebagai chip pembanding di
modal edit. Menghapus kolom efektif berarti nilainya hilang di semua halaman.

**Tabel `shipments` tidak punya snapshot SAP sama sekali** — sembilan kolom ATA-nya tidak punya
cadangan di database. Penghapusan tidak bisa dipulihkan dari dalam KLIP.

**ATA dipakai sebagai penanda boolean di sekitar 14 tempat.** Menghapusnya tidak sekadar
mengosongkan kolom: status shipment runtuh ke PLANNED, kontrak yang sudah Close kembali Open,
Cycle Time kontrak SEA hilang, dan dasar perhitungan Late/On-Time berpindah diam-diam dari ATA ke
ETA di Shipments, Contract Performance, dan Dashboard.

**Dan ia akan terisi lagi.** Import SAP menulis ATA dengan `COALESCE(EXCLUDED.ata_x, ata_x)`, jadi
penghapusan akan dibatalkan import berikutnya — kecuali kita juga menghentikan SAP menulis kolom
itu, yang berarti seluruh akibat di atas menjadi permanen.

---

## Usulan: hentikan pendarahannya, jangan bedah lukanya

**1. Perbaiki label yang menyesatkan.** "Qty Receive KLIP" bukan field KLIP — itu kolom yang sama
dengan yang ditulis SAP. Menamainya apa adanya menyelesaikan sebagian besar kebingungan tanpa
menyentuh satu baris data pun.

**2. Tandai asal nilai di UI.** Untuk field yang punya snapshot `sap_*`, nilai yang sama persis
dengan snapshot ditampilkan sebagai berasal dari SAP. User langsung bisa membedakan.

**3. Tambahkan provenance untuk data baru.** Kolom snapshot `sap_*` pada `shipments` (meniru yang
sudah ada di `vessel_loading_ports`), atau flag `*_klip_edited` per field seperti yang sudah
dipakai untuk cargo readiness. Setelah itu pertanyaan "ini dari mana" dijawab oleh struktur, bukan
tebakan — untuk seterusnya.

**4. Untuk migrasi, pakai daftar di tabel pertama.** Tidak ada yang perlu dihapus di produksi.

**5. Perbaiki SFAL/SFBD shipment.** SAP menimpanya langsung, jadi angka yang diketik user hilang
pada import berikutnya. Itu bug tersendiri, terlepas dari urusan provenance.
