# Catatan rilis — Trucking, September 2026

Untuk disampaikan ke pengguna KLIP sebelum atau saat rilis produksi. Dua perubahan di bawah
mengubah angka yang selama ini mereka lihat. Keduanya adalah koreksi, bukan kerusakan — tapi kalau
tidak diberitahukan lebih dulu, yang sampai ke tim support adalah "angkanya berubah sendiri".

---

## 1. Late Indicator kini memakai tanggal yang benar

**Apa yang berubah.** Late / On Time dihitung dari **due date** dibandingkan dengan **ATA** —
tanggal terima aktual, yaitu *Trucking Last Receive Date* dari SAP atau tanggal terakhir WB. Kalau
ATA belum ada, perbandingannya memakai **ETA**, yaitu tanggal terakhir daily planning. Kalau
keduanya belum ada, dibandingkan dengan tanggal hari ini.

**Kenapa berubah.** Sebelumnya tiga tempat di aplikasi memakai tanggal yang berbeda untuk
pertanyaan yang sama, sehingga satu operasi bisa tampak Late di satu tampilan dan On Time di
tampilan lain.

**Dampaknya, dalam angka.** Pada data YTD, **2.908 dari 7.485 baris** berpindah antara Late dan
On Time. Ini besar, dan disengaja — angka lama tidak konsisten.

**Yang perlu disampaikan:** laporan Late/On Time yang sudah diekspor sebelum rilis ini tidak akan
cocok dengan tampilan setelah rilis. Itu bukan kesalahan salah satunya; yang baru yang benar.

Kolom tanggalnya kini juga ditampilkan, sehingga setiap baris bisa ditelusuri sendiri: due date,
ATA, dan ETA terlihat langsung dan bisa diperiksa terhadap SAP atau WB.

---

## 2. Hasil upload WB langsung terlihat

**Apa yang berubah.** Setelah Upload WB selesai, baris dan **sisa OS Qty** di halaman Trucking
langsung mencerminkan data yang baru diunggah — termasuk angka pada kartu ringkasan di atas.

**Sebelumnya.** Halaman masih menampilkan angka sebelum upload sampai refresh terjadwal berjalan.
Di produksi itu bisa berarti puluhan menit. Pengguna yang mengunggah WB lalu langsung memeriksa
sisa OS Qty — yang justru alasan mereka mengunggah — melihat angka lama tanpa penjelasan.

**Yang perlu disampaikan:** tidak perlu lagi menunggu atau me-refresh berulang setelah upload WB.

---

## 3. Keterangan "as of" pada kartu ringkasan

Kartu ringkasan menampilkan keterangan kapan angkanya dihitung. Sekarang keterangan itu juga muncul
**saat filter dipakai** (Region/Plant, Source, Status, Late Indicator) — sebelumnya menghilang
justru ketika filter aktif, padahal angkanya sama tuanya.

Kalau keterangan menyebut rebuild sedang berjalan, artinya import SAP terbaru mungkin belum
tercermin pada angka kartu. Angka per baris di tabel tetap aktual.

---

## Yang tidak berubah

Perhitungan kuantitas, Outstanding Qty, dan status operasi tidak diubah oleh rilis ini. Yang
berubah hanya tanggal pembanding pada Late Indicator, kecepatan munculnya hasil upload WB, dan
keterangan as-of.
