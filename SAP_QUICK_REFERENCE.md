# SAP Integration - Quick Reference Card

## 🚀 Quick Start

### Run Import (Admin)
```bash
# Start backend
cd backend && npm run dev

# Access dashboard
http://localhost:3000/sap-imports

# Click "Start New Import"
```

### Enter Data (Users)
```bash
# Access data entry
http://localhost:3000/sap-data-entry

# Select record → Fill fields → Save
```

---

## 📋 Key Files

| File | Purpose |
|------|---------|
| `005_sap_integration_schema_extension.sql` | Database migration |
| `sapMasterV2Import.service.ts` | Import logic |
| `sapDataDistribution.service.ts` | Data distribution |
| `SapDataEntry.tsx` | User input form |
| `SapImportDashboard.tsx` | Admin dashboard |

---

## 🗄️ Database

### New Tables
- `vessel_master` - Vessel reference data
- `trucking_operations` - Trucking details (3 locations)
- `surveyors` - Surveyor info (4 per shipment)
- `loading_ports` - Multi-port loading (3 ports)

### Extended Tables
- `contracts` - +10 columns
- `shipments` - +30 columns
- `quality_surveys` - +5 columns
- `payments` - +3 columns

---

## 🔑 API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/api/sap-master-v2/import` | ADMIN | Start import |
| GET | `/api/sap-master-v2/imports` | ADMIN/MGMT | List imports |
| GET | `/api/sap-master-v2/imports/:id` | ADMIN/MGMT | Import details |
| GET | `/api/sap-master-v2/pending-entries` | All | Pending data |

---

## 👥 User Roles

| Role | Fields | Responsibilities |
|------|--------|------------------|
| TRADING | 15 | View contracts, minimal entry |
| LOGISTICS_TRUCKING | 14 | Trucking dates, locations, costs |
| LOGISTICS_SHIPPING | 25 | Vessel details, ETAs/ATAs, rates |
| QUALITY | 14 | Quality parameters, surveyors |
| FINANCE | 4 | Payment dates, confirmations |

---

## 📊 Data Flow

```
SAP Excel → Import → Raw Storage → Parse → Distribute → User Entry → Complete
```

---

## 🧪 Testing Commands

```bash
# Check imports
psql -U postgres -d klip_db -c "SELECT * FROM sap_data_imports;"

# Check processed records
psql -U postgres -d klip_db -c "SELECT COUNT(*) FROM sap_processed_data;"

# Check field mappings
psql -U postgres -d klip_db -c "SELECT user_role, COUNT(*) FROM sap_field_mappings GROUP BY user_role;"
```

---

## 🛠️ Maintenance

### Daily
- Monitor import dashboard
- Check error logs

### Weekly
- Review data completion rates
- Verify user entries

### Monthly
- Run `VACUUM ANALYZE`
- Archive old data (> 12 months)

---

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| Import fails | Check file path, Excel structure |
| No pending data | Verify role, check imports table |
| Slow performance | Run VACUUM, check indexes |
| Can't save data | Check auth, verify field mappings |

---

## 📞 Quick Help

**Import Dashboard**: `/sap-imports`
**Data Entry**: `/sap-data-entry`
**API Docs**: `http://localhost:5001/api-docs`
**Logs**: `backend/logs/error.log`

---

## ✅ Checklist

Before going live:
- [ ] Test with real SAP file
- [ ] Train users
- [ ] Configure auto-import
- [ ] Set up email notifications
- [ ] Review field mappings
- [ ] Test all user roles
- [ ] Verify data accuracy
- [ ] Check performance

---

**Version**: 1.0 | **Date**: Oct 15, 2025 | **Status**: ✅ Ready

