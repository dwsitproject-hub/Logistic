# Reset PostgreSQL Password on Windows

## Method 1: Using pg_hba.conf (Recommended)

### Step 1: Find and Edit pg_hba.conf

1. **Navigate to PostgreSQL data directory**:
   ```
   C:\Program Files\PostgreSQL\16\data\
   ```

2. **Find the file**: `pg_hba.conf`

3. **Right-click** → "Open with" → "Notepad" (as Administrator)

4. **Find these lines** (near the bottom):
   ```
   # IPv4 local connections:
   host    all             all             127.0.0.1/32            scram-sha-256
   ```

5. **Change `scram-sha-256` to `trust`**:
   ```
   host    all             all             127.0.0.1/32            trust
   ```

6. **Save and close** the file

### Step 2: Restart PostgreSQL Service

1. **Press** `Windows Key + R`
2. **Type**: `services.msc` and press Enter
3. **Find**: "postgresql-x64-16" (or similar)
4. **Right-click** → "Restart"
5. **Wait** for service to restart

### Step 3: Connect Without Password

1. **Open Command Prompt as Administrator**
2. **Run**:
   ```cmd
   cd "C:\Program Files\PostgreSQL\16\bin"
   psql -U postgres
   ```
3. **You should connect without password!**

### Step 4: Change Password

In the psql prompt, type:
```sql
ALTER USER postgres WITH PASSWORD 'postgres123';
\q
```

### Step 5: Restore Security

1. **Open** `pg_hba.conf` again
2. **Change `trust` back to `scram-sha-256`**:
   ```
   host    all             all             127.0.0.1/32            scram-sha-256
   ```
3. **Save and close**

4. **Restart PostgreSQL service** again (Step 2)

### Step 6: Test New Password

1. **Open pgAdmin**
2. **Connect with**: `postgres123`
3. **Success!** ✅

---

## Method 2: Complete Reinstall (Easier)

See main recommendation above - just uninstall and reinstall!


