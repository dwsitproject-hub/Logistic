# Runbook: share SAP (Synology) tidak terbaca di ECS-DB

Berlaku untuk server backend production (ECS-DB). Terakhir terjadi **2026-10-07 s/d 2026-10-08**, sebelumnya 2026-09-30.

## Gejala

- Email admin: **"KLIP SAP Auto Import: the SAP share cannot be read - nothing was imported"**.
- Halaman SAP Imports: run terakhir bertanda *Folder not reachable*, dan file terbaru di share tidak masuk.
- Deploy backend gagal start: `error while creating mount source path '/mnt/synology-apps/...': mkdir /mnt/synology-apps: file exists`. Container berstatus `Created` tanpa log, **seluruh API mati**, karena share adalah bind mount.
- Sebelum 2026-10-08 gejalanya diam-diam: folder yang tidak terbaca dianggap kosong dan job melaporkan "no new files".

## Penyebab yang pernah terjadi

Rute dari server ke NAS (`172.30.1.94`) dibajak oleh **bridge Docker** yang mengambil subnet `172.30.0.0/16`, yaitu LAN kantor tempat NAS berada. Host lalu mengirim lalu lintas NAS ke bridge itu, dan semua mount NAS di host mati (bukan hanya KLIP: PM, EXIM, dan aplikasi lain ikut).

| Tanggal | Jaringan | Pemilik |
|---|---|---|
| 2026-09-30 | `klip_klip-network` | KLIP (menjalankan `docker compose` penuh di production) |
| 2026-10-07 17:45 WIB | `tas-production_tas_production_network` | aplikasi TAS, bukan KLIP |

Docker memilih subnet bebas pertama setiap kali jaringan baru dibuat tanpa subnet tetap. Itu sebabnya kejadian ini bisa datang dari aplikasi mana pun di host.

## Cek cepat (hanya membaca)

```bash
ip route get 172.30.1.94
```

- Lewat `dev eth0` → rute sehat.
- Lewat `dev br-...` → dibajak bridge Docker.

```bash
timeout 10 ls /mnt/synology-apps; echo "exit=$?"
```

- `exit=0` dan isi tampil → mount sehat.
- `Host is down`, `Stale file handle`, atau `exit=124` → mount mati. Kalau rute sehat tetapi `ls` gagal, kirim hasil `mount | grep -i synology` sebelum melakukan `umount` atau remount.

Nama dan pemilik bridge yang membajak (angka setelah `br-` adalah ID jaringan):

```bash
docker network inspect <ID setelah br-> --format '{{.Name}} subnet={{range .IPAM.Config}}{{.Subnet}}{{end}} containers={{len .Containers}} dibuat={{.Created}}'
```

**Jangan `docker network rm` jaringan yang berisi container atau milik aplikasi lain.** Menghapusnya mematikan aplikasi itu.

## Perbaikan segera (tidak menyentuh aplikasi lain)

Rute khusus untuk NAS lebih spesifik daripada `/16` milik bridge, jadi rute ini yang dipakai:

```bash
ip route show default
ip route add 172.30.1.94/32 via <gateway dari baris di atas> dev eth0
```

Batalkan dengan `ip route del 172.30.1.94/32`. Rute ini hilang saat reboot; lihat bagian berikut.

## Perbaikan permanen di host (sudah diterapkan di ECS-DB, 2026-10-08)

Ubuntu 24.04 dengan netplan. `50-cloud-init.yaml` dikelola cloud-init dan bisa ditimpa saat reboot, jadi rute ditaruh di file terpisah, yang digabung berdasarkan nama interface (`eth0`):

```yaml
# /etc/netplan/60-klip-nas-route.yaml  (chmod 600)
network:
  version: 2
  ethernets:
    eth0:
      routes:
        - to: 172.30.1.94/32
          via: 172.28.95.253
```

Periksa tanpa menerapkan, lalu terapkan dengan pengaman (membatalkan sendiri dalam 120 detik kalau tidak dikonfirmasi):

```bash
netplan generate && grep -B1 -A3 '\[Route\]' /run/systemd/network/10-netplan-eth0.network
netplan try
```

Ganti `via` dengan gateway dari `ip route show default` kalau gateway VPC berubah.

## Pencegahan yang belum dikerjakan

1. **Pemilik TAS** memindahkan jaringannya dari `172.30.0.0/16` dan mengunci subnet di compose-nya (`ipam`).
2. **`default-address-pools`** di `/etc/docker/daemon.json` (misalnya `10.250.0.0/16`, ukuran `/24`) agar jaringan baru dari aplikasi mana pun menjauhi 172.x. Docker harus di-restart, jadi lakukan di jendela pemeliharaan dan koordinasikan dengan pemilik aplikasi lain.

## Yang dilakukan KLIP sekarang

- Cron import yang tidak bisa membaca folder berhenti dan mengirim email di atas, bukan "no new files". Setiap run dicatat di tabel `sap_auto_import_runs` dan tampil di halaman SAP Imports.
- Tombol **Sync** di halaman SAP Imports menarik file terbaru (hanya file terbaru, hanya kalau isinya belum ada di KLIP) tanpa menunggu cron.
- `docs/scripts/deploy-prod-backend.sh` memeriksa rute ke NAS dan keterbacaan share **sebelum** build. Kalau bermasalah, skrip berhenti dengan pesan jelas dan belum mengganti apa pun. Untuk tetap menyalakan API tanpa import SAP: `DEPLOY_WITHOUT_SHARE=1 bash docs/scripts/deploy-prod-backend.sh` (import harian dan Sync tidak bisa membaca folder sampai share diperbaiki dan skrip dijalankan lagi tanpa opsi itu).
- Diagnosis tanpa deploy: `docs/scripts/diag-sap-auto-import.cjs` (hanya membaca).

Setelah share pulih, tekan **Sync** untuk mengejar file yang terlewat. Hanya file terbaru yang diimpor, file lama tidak diputar ulang.
