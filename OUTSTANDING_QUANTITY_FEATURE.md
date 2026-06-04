# Outstanding Quantity Feature - Complete ✅

## What Was Added

Added **Outstanding Quantity** calculation and display to the Contracts page.

## Formula

```
Outstanding Quantity = Contract Quantity - SUM(Total STO Quantities)
```

Where:
- **Contract Quantity**: The total ordered quantity in the contract
- **Total STO Quantities**: Sum of all shipment quantities (quantity_shipped) related to this contract
- **Outstanding Quantity**: The remaining quantity to be shipped

## Backend Changes

### File: `backend/src/controllers/contract.controller.ts`

Updated the `getContracts` function to:
1. **JOIN with shipments table** to get all related STOs
2. **Calculate total_sto_quantity**: `SUM(shipments.quantity_shipped)`
3. **Calculate outstanding_quantity**: `contract.quantity_ordered - SUM(shipments.quantity_shipped)`
4. **Use COALESCE** to handle contracts with no shipments yet

**SQL Query Enhancement:**
```sql
SELECT 
  c.*,
  COALESCE(SUM(s.quantity_shipped), 0) as total_sto_quantity,
  COALESCE(c.quantity_ordered - SUM(s.quantity_shipped), c.quantity_ordered) as outstanding_quantity
FROM contracts c
LEFT JOIN shipments s ON s.contract_id = c.id
GROUP BY c.id
```

## Frontend Changes

### File: `frontend/src/app/contracts/page.tsx`

**1. Updated Contract Interface**
Added new fields:
```typescript
total_sto_quantity: number
outstanding_quantity: number
```

**2. Contract List View**
Enhanced the secondary info grid to show:
- Contract Quantity
- Total STO Quantity
- **Outstanding Quantity** (highlighted in blue)
- Unit Price

**3. Detail Modal View**
Added prominent display in the "Product & Quantity" section:
- Highlighted Outstanding Quantity with:
  - Blue background (`bg-blue-50`)
  - Blue border (`border-blue-200`)
  - Larger, bold text
  - Blue color for emphasis

## Visual Presentation

### In Contract List
```
┌─────────────────────────────────────────────────────┐
│ Contract Quantity: 2,500,000 MT                     │
│ Total STO Quantity: 1,500,000 MT                    │
│ Outstanding Quantity: 1,000,000 MT  [Blue highlight]│
│ Unit Price: USD 1,055                               │
└─────────────────────────────────────────────────────┘
```

### In Detail Modal
```
┌────────────────────────────────────────┐
│ Product & Quantity                     │
├────────────────────────────────────────┤
│ Product: CPO                           │
│ Contract Quantity: 2,500,000 MT        │
│ ┌──────────────────────────────────┐   │
│ │ Total STO Quantity:              │   │
│ │ 1,500,000 MT                     │   │
│ └──────────────────────────────────┘   │
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓   │
│ ┃ OUTSTANDING QUANTITY           ┃   │
│ ┃ 1,000,000 MT                   ┃   │ [Emphasized]
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛   │
│ Unit Price: USD 1,055                  │
│ Contract Value: USD 2,637,500,000      │
└────────────────────────────────────────┘
```

## Use Cases

### 1. Track Fulfillment Progress
Monitor how much of the contract has been shipped vs. what remains:
- Contract: 2,500,000 MT
- Shipped (STOs): 1,500,000 MT
- Outstanding: 1,000,000 MT (40% remaining)

### 2. Identify Completed Contracts
Contracts with Outstanding Quantity = 0 are fully fulfilled

### 3. Plan Future Shipments
Know exactly how much more needs to be shipped to fulfill the contract

### 4. Contract Management
- Spot contracts nearing completion
- Alert when outstanding quantity is low
- Track partial deliveries

## Example Data

| Contract ID | Contract Qty | Total STO Qty | Outstanding Qty | Status |
|-------------|-------------|---------------|-----------------|---------|
| 5120395862 | 2,500,000 MT | 1,000,000 MT | **1,500,000 MT** | Active |
| 5120395863 | 1,000,000 MT | 1,000,000 MT | **0 MT** | Completed |
| 5120395864 | 3,000,000 MT | 500,000 MT | **2,500,000 MT** | Active |

## Benefits

✅ **Real-time tracking** of contract fulfillment
✅ **Automatic calculation** - no manual tracking needed
✅ **Visual emphasis** - easy to spot at a glance
✅ **Accurate data** - based on actual shipment records
✅ **Multi-STO support** - handles multiple shipments per contract

## Technical Details

### Data Flow
1. Contract created with `quantity_ordered`
2. Multiple shipments (STOs) created linked to contract
3. Each shipment has `quantity_shipped`
4. Backend aggregates all shipment quantities
5. Calculates outstanding: `ordered - sum(shipped)`
6. Frontend displays with formatting

### Handling Edge Cases
- **No shipments yet**: Outstanding = Contract Quantity (full amount)
- **Multiple shipments**: Sums all related STO quantities
- **Overshipped**: Would show negative (rare, but mathematically correct)
- **Null values**: COALESCE ensures 0 instead of NULL

## Testing

To verify the feature:

1. **Refresh browser** at http://localhost:3001/contracts
2. **Check contract list** - each contract should show:
   - Contract Quantity
   - Total STO Quantity  
   - Outstanding Quantity (in blue)
3. **Open contract details** - Outstanding Quantity should be prominently displayed
4. **Verify calculation**:
   - Outstanding = Contract Qty - Total STO Qty
   - Numbers should match and make sense

## Future Enhancements

Potential additions:
- [ ] Fulfillment percentage (Shipped / Ordered * 100)
- [ ] Visual progress bar
- [ ] Alert when outstanding < threshold
- [ ] Filter contracts by outstanding quantity
- [ ] Export outstanding quantities report

---

**Status**: ✅ **COMPLETE**

Outstanding Quantity is now calculated and displayed throughout the Contracts page with proper emphasis and formatting!

