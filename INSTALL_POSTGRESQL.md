# Installing PostgreSQL on Windows - Step by Step

## Step 1: Download PostgreSQL

1. **Open your web browser**
2. **Go to**: https://www.postgresql.org/download/windows/
3. **Click**: "Download the installer" 
4. **Or go directly to**: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
5. **Choose**: PostgreSQL 16.x for Windows x86-64
6. **Click**: Download button
7. **Save the file** (it's about 200-300 MB)

## Step 2: Run the Installer

1. **Find the downloaded file** (usually in Downloads folder)
   - File name: `postgresql-16.x-windows-x64.exe` (or similar)

2. **Right-click** the file → **Run as Administrator**

3. **Click "Yes"** when Windows asks for permission

## Step 3: Installation Wizard

Follow these steps carefully:

### 3.1 Setup Screen
- Click **"Next"**

### 3.2 Installation Directory
- Default: `C:\Program Files\PostgreSQL\16`
- Click **"Next"** (keep default)

### 3.3 Select Components
- ✅ PostgreSQL Server (checked)
- ✅ pgAdmin 4 (checked) - **IMPORTANT: Keep this checked!**
- ✅ Stack Builder (can uncheck)
- ✅ Command Line Tools (checked)
- Click **"Next"**

### 3.4 Data Directory
- Default: `C:\Program Files\PostgreSQL\16\data`
- Click **"Next"** (keep default)

### 3.5 Password ⚠️ **IMPORTANT!**
- Enter a password for the PostgreSQL "postgres" user
- **Remember this password!** You'll need it later
- **Suggestion**: Use a simple password for local development like: `postgres`
- Re-enter the same password
- Click **"Next"**

**📝 Write down your password**: postgres

### 3.6 Port
- Default: `5432`
- Click **"Next"** (keep default)

### 3.7 Locale
- Default: `[Default locale]`
- Click **"Next"**

### 3.8 Pre Installation Summary
- Review settings
- Click **"Next"**

### 3.9 Installation
- Click **"Next"** to start installation
- **Wait 3-5 minutes** for installation to complete
- You'll see progress bars

### 3.10 Completing Setup
- **Uncheck** "Launch Stack Builder at exit" (not needed)
- Click **"Finish"**

## Step 4: Verify Installation

1. **Search Windows Start Menu** for "pgAdmin"
2. **Click "pgAdmin 4"** to open it
3. **Wait** for it to open in your browser (it's a web app)
4. **Enter your master password** if prompted (create one, any password)
5. **Expand "Servers"** in the left panel
6. **Click "PostgreSQL 16"** (or your version)
7. **Enter the password** you set in Step 3.5
8. **You should see the PostgreSQL dashboard!** ✅

## Step 5: Create KLIP Database

### Using pgAdmin (GUI Method):

1. **In pgAdmin**, expand **Servers** → **PostgreSQL 16**
2. **Right-click** on **"Databases"**
3. **Select** "Create" → "Database..."
4. **In the dialog**:
   - **Database name**: `klip_db`
   - **Owner**: postgres (default)
5. **Click "Save"**
6. **Done!** You should see `klip_db` in the database list ✅

### Using Command Line (Alternative):

If you prefer command line:

```powershell
# Use the full path to psql
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE klip_db;"
```

Enter your password when prompted.

## Step 6: Update KLIP Configuration

Now update the backend configuration with your PostgreSQL password:

1. **Open** `backend\.env` file in your editor
2. **Find this line**:
   ```env
   DB_PASSWORD=postgres
   ```
3. **Change it** to your actual password from Step 3.5:
   ```env
   DB_PASSWORD=YOUR_ACTUAL_PASSWORD
   ```
4. **Save** the file

## Step 7: Continue KLIP Setup

Now you can continue with the KLIP installation:

```powershell
# 1. Install frontend dependencies (if not done)
cd "D:\Cursor\Logistic SAP\frontend"
npm install

# 2. Install backend dependencies (if not done)
cd "D:\Cursor\Logistic SAP\backend"
npm install

# 3. Run database migration
npm run db:migrate

# 4. Seed test data
npm run db:seed
```

## Step 8: Start the Application

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

## Step 9: Access KLIP

Open browser: **http://localhost:3001**

Login: **admin** / **admin123**

---

## Quick Installation Summary

1. ⬇️ Download PostgreSQL 16 from postgresql.org
2. 🔧 Run installer, set password
3. ✅ Verify with pgAdmin
4. 🗄️ Create database `klip_db` in pgAdmin
5. 📝 Update `backend\.env` with your password
6. 📦 Install frontend & backend npm packages
7. 🔄 Run migrations and seed
8. 🚀 Start the app
9. 🌐 Access http://localhost:3001

---

## Troubleshooting

### Can't find pgAdmin after installation
- Search Windows Start Menu for "pgAdmin"
- Or check: `C:\Program Files\PostgreSQL\16\pgAdmin 4\bin\pgAdmin4.exe`

### Forgot PostgreSQL password
You'll need to reset it. Search online for "reset postgres password windows" or reinstall PostgreSQL.

### Installation stuck
- Make sure you have administrator privileges
- Disable antivirus temporarily during installation
- Ensure you have at least 1GB free disk space

---

## Need Help?

If you get stuck:
1. Check what step you're on
2. Take a screenshot of any error
3. Ask for help with the specific step number

---

**Ready to install PostgreSQL? Start with Step 1!** 🚀

