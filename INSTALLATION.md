# KLIP Installation Guide

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 18.0 or higher
- **npm**: Version 8.0 or higher (comes with Node.js)
- **PostgreSQL**: Version 14 or higher
- **Git**: For version control

## Step 1: Clone the Repository

```bash
git clone <repository-url>
cd "Logistic SAP"
```

## Step 2: Install Dependencies

Install all dependencies for both frontend and backend:

```bash
npm run install:all
```

This command will install:
- Root dependencies
- Frontend dependencies (Next.js, React, UI components)
- Backend dependencies (Express, PostgreSQL, JWT, etc.)

## Step 3: Set Up PostgreSQL Database

### Create the Database

```bash
# Login to PostgreSQL
psql -U postgres

# Create the database
CREATE DATABASE klip_db;

# Exit PostgreSQL
\q
```

### Configure Database Connection

Create a `.env` file in the `backend` directory:

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with your database credentials:

```env
PORT=5000
NODE_ENV=development

# Database Configuration
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/klip_db
DB_HOST=localhost
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760
```

**Important**: Replace `YOUR_PASSWORD` with your actual PostgreSQL password!

## Step 4: Run Database Migration

Create all required tables:

```bash
# From the backend directory
npm run db:migrate
```

This will create all the database tables including:
- users
- contracts
- shipments
- quality_surveys
- payments
- documents
- remarks
- audit_logs
- ai_insights
- alerts

## Step 5: Seed the Database

Create default users for testing:

```bash
# From the backend directory
npm run db:seed
```

This creates the following test users:

| Username    | Password      | Role       |
|-------------|---------------|------------|
| admin       | admin123      | ADMIN      |
| trading     | trading123    | TRADING    |
| logistics   | logistics123  | LOGISTICS  |
| finance     | finance123    | FINANCE    |
| management  | management123 | MANAGEMENT |

## Step 6: Configure Frontend

Create environment file for frontend:

```bash
cd frontend
cp .env.local.example .env.local
```

The default configuration should work:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

## Step 7: Start the Application

### Option A: Start Both Frontend and Backend Together (Recommended)

From the root directory:

```bash
npm run dev
```

This will start:
- Backend API on http://localhost:5001
- Frontend on http://localhost:3001

### Option B: Start Frontend and Backend Separately

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

## Step 8: Access the Application

Open your browser and navigate to:

**Frontend Application**: http://localhost:3001

**API Documentation**: http://localhost:5001/api-docs

**Health Check**: http://localhost:5001/health

## Step 9: Login

Use any of the seeded user credentials to login:

For example:
- **Username**: admin
- **Password**: admin123

## Troubleshooting

### Database Connection Error

If you see database connection errors:

1. Ensure PostgreSQL is running:
   ```bash
   # Windows
   pg_ctl status
   
   # Linux/Mac
   sudo systemctl status postgresql
   ```

2. Verify your database credentials in `backend/.env`

3. Test the connection:
   ```bash
   psql -U postgres -d klip_db
   ```

### Port Already in Use

If port 5001 or 3001 is already in use:

1. Change the port in `backend/.env`:
   ```env
   PORT=5002
   ```

2. Update the frontend API URL in `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:5002/api
   ```

3. Update the frontend port in `frontend/package.json`:
   ```json
   "dev": "next dev -p 3002"
   ```

### Module Not Found Errors

If you encounter module errors:

```bash
# Clean install
rm -rf node_modules frontend/node_modules backend/node_modules
rm package-lock.json frontend/package-lock.json backend/package-lock.json
npm run install:all
```

### Database Migration Fails

If migration fails:

1. Drop and recreate the database:
   ```bash
   psql -U postgres
   DROP DATABASE klip_db;
   CREATE DATABASE klip_db;
   \q
   ```

2. Run migration again:
   ```bash
   cd backend
   npm run db:migrate
   npm run db:seed
   ```

## Production Deployment

### Backend

1. Build the backend:
   ```bash
   cd backend
   npm run build
   ```

2. Set production environment variables

3. Start the production server:
   ```bash
   npm start
   ```

### Frontend

1. Build the frontend:
   ```bash
   cd frontend
   npm run build
   ```

2. Start the production server:
   ```bash
   npm start
   ```

### Recommended Hosting Platforms

- **Backend**: AWS EC2, Azure App Service, DigitalOcean
- **Frontend**: Vercel, Netlify, AWS Amplify
- **Database**: AWS RDS, Azure Database, DigitalOcean Managed Database

## Environment Variables Reference

### Backend (.env)

```env
# Server
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:pass@host:port/db
DB_HOST=localhost
DB_PORT=5432
DB_NAME=klip_db
DB_USER=postgres
DB_PASSWORD=your_password

# Authentication
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760

# SAP Integration (Optional)
SAP_API_URL=http://sap-server/odata/v2
SAP_USERNAME=
SAP_PASSWORD=

# Email (Optional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@klip.com

# Scheduled Jobs
DAILY_SYNC_CRON=0 7 * * *
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

## Next Steps

1. **Explore the Application**: Login and explore all the modules
2. **Add Sample Data**: Create test contracts and shipments
3. **Customize**: Modify the code to match your specific requirements
4. **SAP Integration**: Configure SAP API connections for real data sync
5. **Deploy**: Deploy to your production environment

## Support

For issues or questions:
- Check the troubleshooting section above
- Review the main README.md file
- Check API documentation at http://localhost:5000/api-docs

## Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Express.js Documentation](https://expressjs.com/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

