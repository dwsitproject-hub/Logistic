# KLIP — Hubungkan folder lokal ke GitHub

| Item | Nilai |
|------|--------|
| Repository | [github.com/dwsitproject-hub/Logistic](https://github.com/dwsitproject-hub/Logistic) |
| Branch SIT | [github.com/dwsitproject-hub/Logistic/tree/SIT](https://github.com/dwsitproject-hub/Logistic/tree/SIT) |
| Remote HTTPS | `https://github.com/dwsitproject-hub/Logistic.git` |
| Deploy SIT | Lihat **`docs/DEPLOY-SIT-GITHUB.md`** |

## 1. Install Git

Windows: [https://git-scm.com/download/win](https://git-scm.com/download/win)

```powershell
git --version
git config --global user.name "Nama Anda"
git config --global user.email "email@github.com"
```

## 2. Clone (disarankan jika `D:\Project\Klip` belum punya `.git`)

```powershell
cd D:\Project
git clone https://github.com/dwsitproject-hub/Logistic.git Klip
cd Klip
git checkout SIT
git pull origin SIT
```

Buka folder `D:\Project\Klip` (clone) di Cursor.

## 3. Login GitHub

**HTTPS + Personal Access Token**

1. GitHub → Settings → Developer settings → Personal access tokens
2. Buat token dengan scope `repo`
3. Saat `git push`, password = token

Atau:

```powershell
winget install GitHub.cli
gh auth login
gh auth setup-git
```

## 4. Push ke SIT

```powershell
cd D:\Project\Klip
.\docs\scripts\push-to-sit.ps1
```

Deploy server manual: `docs/scripts/staging-deploy-putty.txt` (STEP 2 PuTTY).

## 5. Cek remote

```powershell
git remote -v
git branch -a
```

Harus menampilkan `origin` → `github.com/dwsitproject-hub/Logistic.git` dan branch `SIT`.

## 6. Update remote (jika masih pakai URL lama)

Repo dipindah ke organisasi `dwsitproject-hub`. URL lama (`jerrypra0906/Logistic`) masih redirect, tapi disarankan update:

```powershell
cd D:\Project\Klip
git remote set-url origin https://github.com/dwsitproject-hub/Logistic.git
git remote -v
```

Di server SIT (`/opt/klip`):

```bash
cd /opt/klip
git remote set-url origin https://github.com/dwsitproject-hub/Logistic.git
git remote -v
```
