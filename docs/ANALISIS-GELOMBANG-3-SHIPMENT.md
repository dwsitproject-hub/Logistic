# Gelombang 3 — haruskah baris shipment dimigrasikan?

Analisis 2026-09-14. Ditulis sebelum skripnya dibuat, karena jawabannya mungkin "sebagian besar tidak".

---

## Pertanyaannya

Setelah Gelombang 2, tersisa **195 baris ETA** yang tidak bisa dimuat karena shipment-nya tidak ada
di produksi — 86 di grain port, 109 di grain shipment. Untuk membawanya, baris `shipments`-nya
harus ada lebih dulu.

Tapi baris shipment berbeda sifatnya dari apa pun yang sudah kita pindahkan. Dua gelombang
sebelumnya hanya mengisi kolom pada baris yang sudah ada. Ini **menciptakan baris yang dilihat
semua user**.

---

## Temuan yang mengubah arah

Di database dev, dari 2.636 shipment:

| Asal | Jumlah |
|---|---|
| Bernomor STO — dibuat import SAP | 2.576 (97,7%) |
| `MNL-` — dibuat user di KLIP | 60 (2,3%) |

**Produksi akan membuat sendiri yang 97,7% itu.** Import SAP menciptakan shipment lewat
`ensureSeaShipmentIfEligible` begitu baris SAP-nya memenuhi syarat. Memigrasikannya berarti
mendahului pekerjaan yang memang akan dikerjakan importer — dengan tiga risiko nyata di bawah.

Yang 2,3% itu cerita lain: produksi **tidak akan pernah** membuatnya, karena tidak ada padanannya
di data SAP. Itu shipment yang diketik user, dan 55 dari 60 punya baris port, 52 punya ETA.

---

## Tiga risiko kalau shipment bernomor SAP ikut dibawa

**1. Ia akan mengunci import SAP dari kolomnya sendiri.**

`hasKlipShipmentActivity` menganggap sebuah shipment "disentuh KLIP" bila `operation_id`-nya terisi
— dan baris hasil migrasi akan membawanya. Setelah itu `klipSapFieldMerge` beralih ke mode
"lindungi KLIP", sehingga enam kolom yang seharusnya dimiliki SAP (`vessel_code`, `vessel_name`,
`port_of_loading`, `port_of_discharge`, `quantity_delivered`, `actual_vessel_qty_receive`) berhenti
menerima koreksi dari import.

Jadi membawa shipment SAP dari staging justru membuat produksi lebih sulit dikoreksi SAP, bukan
lebih mudah.

**2. Ia menghilangkan kontrak lain dari kartu Unplanned.**

Jalur backlog mengecualikan kontrak yang STO numeriknya sudah dipakai shipment aktif
(`sqlContractSharesNumericStoWithActiveSeaShipmentExpr`). Menambah satu shipment karena itu bisa
**mengeluarkan kontrak saudara dari halaman** — efek yang tidak terlihat saat menulis skrip dan
baru muncul sebagai "kok PO saya hilang".

**3. Statusnya akan runtuh ke PLANNED.**

Status shipment diturunkan dari keberadaan ATA. Kita sengaja tidak memindahkan ATA (asalnya tidak
bisa dipertanggungjawabkan — lihat [PROVENANCE-KLIP-VS-SAP.md](PROVENANCE-KLIP-VS-SAP.md)), jadi
shipment yang dibawa tanpa ATA akan tampil PLANNED meski di staging sudah SAILED atau COMPLETED.
Baris baru yang statusnya salah lebih buruk daripada baris yang belum ada.

---

## Rekomendasi

**Bawa hanya shipment buatan KLIP (`MNL-` / `MSEA-`). Jangan bawa yang bernomor STO.**

Untuk yang bernomor STO, jawaban yang benar adalah menunggu import SAP produksi. Kalau STO-nya
memang ada di data SAP produksi, shipment-nya akan muncul sendiri — beserta vessel, port, dan
kuantitas yang benar, bukan salinan lama dari staging. ETA-nya lalu bisa dimuat dengan menjalankan
ulang loader Gelombang 2, yang memang idempoten.

Kalau STO-nya **tidak** ada di data SAP produksi, itu temuan tersendiri dan lebih penting daripada
migrasi ini: berarti ada STO yang hilang dari import, dan menyalinnya diam-diam dari staging akan
menutupi masalahnya alih-alih menunjukkannya.

---

## Angka yang masih dibutuhkan

Semua di atas dari database dev. Yang menentukan keputusan ada di produksi:

```bash
bash docs/scripts/diag-missing-shipments.sh /opt/klip/backups/klip-eta-2026-09-14-1558.csv
```

Read-only. Ia memecah 195 baris yang terhalang itu menjadi dua, dan untuk yang bernomor STO ia
memeriksa apakah STO-nya sudah ada di `sap_processed_data` produksi.

Tiga kemungkinan hasil, dan masing-masing mengarah ke tindakan berbeda:

| Hasil | Artinya | Tindakan |
|---|---|---|
| Mayoritas `MNL-` | Data user sungguhan | Gelombang 3 terbatas: bawa shipment KLIP saja |
| Mayoritas bernomor STO, STO ada di SAP produksi | Import belum sempat | Tunggu import, lalu ulangi loader ETA |
| Mayoritas bernomor STO, STO **tidak** ada di SAP produksi | STO hilang dari import | Selidiki import-nya — jangan ditambal migrasi |

---

## Kalau Gelombang 3 jadi dijalankan

Bentuknya akan mengikuti dua gelombang sebelumnya, dengan dua batasan tambahan:

- hanya `shipment_id` berawalan `MNL-`/`MSEA-`, difilter di ekspor sehingga yang lain tidak mungkin
  ikut terbawa karena kelalaian
- `status` tidak dibawa apa adanya; ia diturunkan ulang di produksi dari data yang benar-benar ada
  di sana, supaya tidak ada baris yang mengklaim tahap yang tidak didukung tanggalnya
