# Manual Setup Guide - Run These Commands One by One

Follow these steps in your PowerShell terminal at your own pace.

## Step 1: Install Frontend Dependencies (2-3 minutes)

Open PowerShell and run:

```powershell
cd "D:\Cursor\Logistic SAP\frontend"
npm install
```

Wait for it to complete. You'll see "added XXX packages" when done.

## Step 2: Install Backend Dependencies (1-2 minutes)

```powershell
cd "D:\Cursor\Logistic SAP\backend"
npm install
```

Wait for completion.

## Step 3: Create PostgreSQL Database

Open PostgreSQL command line (psql):

```powershell
psql -U postgres
```

Then in psql:

```sql
CREATE DATABASE klip_db;
\q
```

## Step 4: Database is Already Configured!

The `.env` files are already created for you:
- ✅ `backend/.env` - Backend configuration
- ✅ `frontend/.env.local` - Frontend configuration

**Just verify** the password in `backend/.env` matches your PostgreSQL password. If not, edit the file and change `DB_PASSWORD`.

## Step 5: Initialize Database

```powershell
cd "D:\Cursor\Logistic SAP\backend"
npm run db:migrate
npm run db:seed
```

## Step 6: Start the Application

Open **TWO** PowerShell windows:

**Terminal 1 - Backend:**
```powershell
cd "D:\Cursor\Logistic SAP\backend"
npm run dev
```

**Terminal 2 - Frontend:**
```powershell
cd "D:\Cursor\Logistic SAP\frontend"
npm run dev
```

## Step 7: Access the Application

Open your browser:
- **Frontend**: http://localhost:3001
- **Login**: admin / admin123

---

## That's It!

Just follow these 7 steps at your own pace. Each command is independent.

If you get stuck, see INSTALLATION.md for troubleshooting.

