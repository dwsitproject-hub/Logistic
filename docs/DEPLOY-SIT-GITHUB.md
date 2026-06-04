# Deploy KLIP ke SIT (GitHub + PuTTY)

| Item | Nilai |
|------|--------|
| Repository | [https://github.com/jerrypra0906/Logistic](https://github.com/jerrypra0906/Logistic) |
| Branch | `SIT` |
| URL aplikasi SIT | http://8.215.6.189 |
| Repo di server | `/opt/klip` |

**Urutan:** push ke GitHub dulu → deploy backend → deploy frontend → verifikasi browser.

---

## STEP 1 — Push dari laptop (Windows)

### Prasyarat

- Git for Windows terpasang (`git --version`)
- Akses write ke repo GitHub (HTTPS token atau SSH key)

### Clone pertama kali (jika belum punya folder dengan `.git`)

```powershell
cd D:\Project
git clone https://github.com/jerrypra0906/Logistic.git Klip
cd Klip
git checkout SIT
```

### Update & push (folder sudah terhubung Git)

```powershell
cd D:\Project\Klip
git checkout SIT
git pull origin SIT
# ... edit code ...
git add -u backend/src frontend/src docs
git status
git commit -m "deskripsi perubahan"
git push origin SIT
```

### Script otomatis (opsional)

```powershell
cd D:\Project\Klip
Set-ExecutionPolicy -Scope Process Bypass -Force
.\docs\scripts\push-to-sit.ps1
```

### Login GitHub (HTTPS)

1. GitHub → **Settings → Developer settings → Personal access tokens**
2. Buat token (classic) dengan scope **repo**
3. Saat `git push`, password = **token** (bukan password login GitHub)

Atau: `gh auth login` lalu `gh auth setup-git`

### Cek push berhasil

Buka: [https://github.com/jerrypra0906/Logistic/tree/SIT](https://github.com/jerrypra0906/Logistic/tree/SIT) — commit terbaru harus muncul.

---

## STEP 2A — Deploy backend (PuTTY → `172.28.92.57`)

Login SSH ke server backend, jalankan:

```bash
cd /opt/klip
git fetch origin
git checkout SIT
git pull origin SIT
docker compose -f docker-compose.backend.yml up -d --build
docker compose -f docker-compose.backend.yml ps
docker compose -f docker-compose.backend.yml logs --tail=50 backend
curl -s http://127.0.0.1:5001/health
```

**Script:**

```bash
cd /opt/klip && bash docs/scripts/staging-deploy-backend.sh
```

Tunggu `/health` OK sebelum lanjut ke frontend.

---

## STEP 2B — Deploy frontend (PuTTY → `172.28.92.56`)

Login SSH ke server frontend:

```bash
curl -s http://172.28.92.57:5001/health

cd /opt/klip
git fetch origin
git checkout SIT
git pull origin SIT
docker compose -f docker-compose.frontend.yml up -d --build
docker compose -f docker-compose.frontend.yml ps
docker compose -f docker-compose.frontend.yml logs --tail=50 frontend
```

**Script:**

```bash
cd /opt/klip && bash docs/scripts/staging-deploy-frontend.sh
```

**Penting:** frontend wajib `--build` setelah pull (`NEXT_PUBLIC_*` di-bake saat build).

---

## STEP 3 — Verifikasi

| Cek | URL / tindakan |
|-----|----------------|
| API health | http://8.215.6.189/api/health |
| Aplikasi | http://8.215.6.189 |
| Contract Performance | `/contract-performance` + **Ctrl+Shift+R** |

**Contract Performance (release terbaru):**

- Section 1 Avg DP / Avg Log: `- days` jika tidak ada kontrak dengan cycle valid
- Cash/DP/Log: Payoff & DP hanya dari SAP; Today hanya untuk ETA kosong (Open)
- Section 2 ↔ Section 3: linked tree & `contract_perf_in_tree`
- Tab produk (mis. Shell Palm): filter case-insensitive

---

## Rebuild hanya frontend (tanpa pull)

Di server **172.28.92.56**:

```bash
cd /opt/klip
docker compose -f docker-compose.frontend.yml up -d --build
```

Di laptop (Docker lokal):

```powershell
cd D:\Project\Klip
docker compose up -d --build frontend
```

---

## Rollback

```bash
cd /opt/klip
git log -5 --oneline
git checkout <commit-hash-lama>
# Backend (.57):
docker compose -f docker-compose.backend.yml up -d --build
# Frontend (.56):
docker compose -f docker-compose.frontend.yml up -d --build
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `git pull` conflict di server | `git stash` → pull → `git stash pop`, atau koordinasi dengan tim |
| `GET /contracts` 500 | `docker compose -f docker-compose.backend.yml logs --tail=100 backend` |
| UI tidak berubah setelah deploy | Hard refresh; pastikan frontend di-build ulang (`--build`) |
| Push ditolak | `git pull --rebase origin SIT` lalu `git push origin SIT` |

---

## Referensi

- `docs/scripts/staging-deploy-putty.txt` — ringkas PuTTY
- `docs/GIT-SETUP-GITHUB.md` — setup Git lokal
- `docs/scripts/push-to-sit.ps1` — push otomatis
