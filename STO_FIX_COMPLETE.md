# STO Number and Quantity Fix - Complete! ✅

## 🐛 Issues Found
1. **STO Numbers not appearing** in contract details
2. **Total STO Quantity was wrong** due to incorrect data source

## 🔍 Root Cause Analysis

### Data Storage Discovery:
- **`contracts` table**: Has `sto_quantity` column (✅) but `sto_number` is NULL (❌)
- **`sap_processed_data` table**: Has `sto_number` column with actual STO numbers (✅)
- **Problem**: The query was trying to get STO numbers from contracts table where they don't exist

### Example Data Found:
```
Contract "5120395862" in sap_processed_data:
- STO Numbers: 2123958141, 2123958142, 2123958143, 2123958144, 2123958145, 2123958146
- Total: 6 STO numbers

Contract "5120395862" in contracts table:
- sto_number: NULL
- sto_quantity: 1,250,000 MT (split across 2 contract rows)
```

## ⚠️ JOIN Problem

### Initial Attempt (FAILED):
```sql
FROM contracts c
LEFT JOIN sap_processed_data s ON c.contract_id = s.contract_number
```

**Problem**: This JOIN created duplicate rows, causing `sto_quantity` to be summed incorrectly:
- Expected: 1,250,000 MT
- Got: 7,500,000 MT (multiplied by 6 SAP records)

## ✅ Solution: Subqueries

Instead of JOINing (which duplicates rows), use **correlated subqueries** to fetch STO numbers:

```sql
SELECT 
  c.contract_id,
  -- ... other fields ...
  (SELECT STRING_AGG(DISTINCT sto_number, ', ' ORDER BY sto_number) 
   FROM sap_processed_data 
   WHERE contract_number = c.contract_id 
   AND sto_number IS NOT NULL AND sto_number != '') as sto_numbers,
  COALESCE(SUM(c.sto_quantity), 0) as total_sto_quantity,
  (SELECT COUNT(DISTINCT sto_number) 
   FROM sap_processed_data 
   WHERE contract_number = c.contract_id 
   AND sto_number IS NOT NULL) as sto_count
FROM contracts c
GROUP BY c.contract_id
```

### Why This Works:
- ✅ **No row duplication**: Contracts table aggregation remains correct
- ✅ **STO numbers fetched separately**: Subquery runs once per contract
- ✅ **Accurate quantities**: `sto_quantity` summed correctly from contracts table
- ✅ **All STO numbers shown**: Fetched from `sap_processed_data` where they exist

## 📊 Final Results

### Contract "5120395862":
```
Product: CPO
Quantity Ordered: 2,500,000 MT
STO Numbers: 2123958141, 2123958142, 2123958143, 2123958144, 2123958145, 2123958146
STO Count: 6
Total STO Quantity: 1,250,000 MT ✅
Outstanding: 1,250,000 MT ✅
```

### Contract " 500,000 ":
```
Product: CPO
Quantity Ordered: 500,000 MT
STO Numbers: (none)
STO Count: 0
Total STO Quantity: 250,000 MT ✅
Outstanding: 250,000 MT ✅
```

## 🔧 Technical Implementation

### Files Modified:
- `backend/src/controllers/contract.controller.ts`

### Key Changes:
1. **Removed faulty LEFT JOIN** that was duplicating rows
2. **Added subquery for `sto_numbers`**: Fetches from `sap_processed_data`
3. **Added subquery for `sto_count`**: Counts distinct STO numbers
4. **Kept `sto_quantity` aggregation**: From contracts table (correct source)

### Query Structure:
```typescript
// STO Numbers via subquery (from sap_processed_data)
(SELECT STRING_AGG(DISTINCT sto_number, ', ' ORDER BY sto_number) 
 FROM sap_processed_data 
 WHERE contract_number = c.contract_id 
 AND sto_number IS NOT NULL AND sto_number != '') as sto_numbers

// STO Quantity via SUM (from contracts table)
COALESCE(SUM(c.sto_quantity), 0) as total_sto_quantity

// STO Count via subquery (from sap_processed_data)
(SELECT COUNT(DISTINCT sto_number) 
 FROM sap_processed_data 
 WHERE contract_number = c.contract_id 
 AND sto_number IS NOT NULL) as sto_count
```

## ✅ Status: FIXED!

Both issues are now resolved:
1. ✅ **STO Numbers now appear** in contract details
2. ✅ **Total STO Quantity is correct** (not duplicated by JOIN)
3. ✅ **STO Count shows accurate number** of distinct STO numbers
4. ✅ **Outstanding Quantity calculated correctly** (Contract Qty - STO Qty)

## 🎯 Data Flow Summary

**STO Numbers**:
- Source: `sap_processed_data.sto_number`
- Method: Correlated subquery with STRING_AGG
- Display: Comma-separated list (e.g., "2123958141, 2123958142, ...")

**STO Quantity**:
- Source: `contracts.sto_quantity`
- Method: Direct SUM from contracts table
- Calculation: Sum all sto_quantity for same contract_id

**Outstanding Quantity**:
- Formula: `Contract Quantity - Total STO Quantity`
- Both values from contracts table (no JOIN interference)

**The contract details now display complete and accurate STO information! 🎉**
