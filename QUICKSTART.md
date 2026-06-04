# KLIP Quick Start Guide

Get the KPN Logistics Intelligence Platform running in 5 minutes!

## Prerequisites Check

Run these commands to verify your system:

```bash
node --version   # Should be v18.0.0 or higher
npm --version    # Should be v8.0.0 or higher
psql --version   # Should be 14.0 or higher
```

If any are missing, install them first.

## Quick Installation (5 Steps)

### Step 1: Create the Database (1 minute)

```bash
# Open PostgreSQL command line
psql -U postgres

# Create database and exit
CREATE DATABASE klip_db;
\q
```

### Step 2: Install Dependencies (2 minutes)

```bash
# Install all dependencies
npm run install:all
```

### Step 3: Configure Environment (30 seconds)

**Backend Configuration:**

Create `backend/.env`:

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` and update the database password:

```env
DB_PASSWORD=YOUR_POSTGRES_PASSWORD
JWT_SECRET=my-secret-key-12345
```

**Frontend Configuration:**

Create `frontend/.env.local`:

```bash
cd frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:5001/api" > .env.local
```

### Step 4: Initialize Database (30 seconds)

```bash
cd backend
npm run db:migrate
npm run db:seed
```

### Step 5: Start the Application (1 minute)

```bash
# From the root directory
npm run dev
```

## Access the Application

- **Frontend**: http://localhost:3001
- **API Docs**: http://localhost:5001/api-docs

## Login

Use any of these demo accounts:

```
Admin:      admin      / admin123
Trading:    trading    / trading123
Logistics:  logistics  / logistics123
Finance:    finance    / finance123
Management: management / management123
```

## What's Next?

1. **Explore the Dashboard**: View KPIs and AI insights
2. **Create a Contract**: Go to Contracts → New Contract
3. **Add a Shipment**: Track shipments linked to contracts
4. **Upload Documents**: Add supporting files
5. **Check Audit Logs**: See system activity

## Common Issues

### Issue: Database Connection Failed

**Solution**:
```bash
# Verify PostgreSQL is running
# Windows:
pg_ctl status

# Linux/Mac:
sudo systemctl status postgresql

# Start if not running
# Windows:
pg_ctl start

# Linux/Mac:
sudo systemctl start postgresql
```

### Issue: Port 3000 or 5000 Already in Use

**Solution**: Kill the process using the port

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

### Issue: Module Not Found

**Solution**: Reinstall dependencies

```bash
rm -rf node_modules frontend/node_modules backend/node_modules
npm run install:all
```

## Project Structure

```
Logistic SAP/
├── backend/              # Node.js Express API
│   ├── src/
│   │   ├── controllers/  # Business logic
│   │   ├── routes/       # API endpoints
│   │   ├── middleware/   # Auth, error handling
│   │   ├── database/     # DB connection, schema
│   │   └── utils/        # Helper functions
│   └── package.json
├── frontend/             # Next.js React App
│   ├── src/
│   │   ├── app/          # Pages (Dashboard, Contracts, etc.)
│   │   ├── components/   # Reusable components
│   │   └── lib/          # Utilities, API client
│   └── package.json
├── docs/                 # Documentation
├── README.md             # Main documentation
├── INSTALLATION.md       # Detailed installation guide
├── FEATURES.md           # Feature documentation
├── DATABASE.md           # Database documentation
└── package.json          # Root package file
```

## Key Features

✅ **Dashboard**: Real-time KPIs and analytics
✅ **Contract Management**: Track all logistics contracts
✅ **Shipment Tracking**: Monitor shipment lifecycle
✅ **Gain/Loss Calculation**: Automatic weight variance tracking
✅ **Finance Tracking**: Payment and invoice management
✅ **Document Management**: Centralized document repository
✅ **AI Insights**: Intelligent alerts and recommendations
✅ **Audit Logs**: Complete activity tracking
✅ **Role-based Access**: Secure multi-user access

## Technology Stack

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL
- **Authentication**: JWT with bcrypt password hashing
- **UI Components**: shadcn/ui (Radix UI primitives)

## Development Tips

1. **Hot Reload**: Both frontend and backend support hot reloading during development

2. **API Testing**: Use the Swagger UI at http://localhost:5000/api-docs

3. **Database Changes**: Edit `backend/src/database/schema.sql` and re-run migrations

4. **Adding New Routes**: 
   - Backend: Create controller in `backend/src/controllers/` and route in `backend/src/routes/`
   - Frontend: Create page in `frontend/src/app/[pagename]/page.tsx`

## Production Checklist

Before deploying to production:

- [ ] Change JWT_SECRET to a strong random string
- [ ] Update database credentials
- [ ] Enable HTTPS/SSL
- [ ] Set NODE_ENV=production
- [ ] Configure backup strategy
- [ ] Set up monitoring and logging
- [ ] Review and update CORS settings
- [ ] Configure SAP integration endpoints
- [ ] Set up email SMTP for alerts

## Need Help?

Refer to the detailed guides:
- **INSTALLATION.md**: Complete installation instructions
- **FEATURES.md**: Detailed feature documentation
- **DATABASE.md**: Database schema and queries
- **README.md**: Project overview

## Contributing

To contribute to the project:
1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

---

**You're all set!** The KLIP platform is now running and ready to use. 🚀

