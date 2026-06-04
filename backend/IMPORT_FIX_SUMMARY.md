# SAP Import Issue - Root Cause Analysis

## Problem
The imported data shows as "successful" but all display fields are NULL:
- Contract/PO: NULL
- Supplier: NULL  
- Product: NULL
- Vessel: NULL

## Root Cause
The `parseDataRow` function is storing cell VALUES as keys instead of FIELD NAMES:

**Current raw object (WRONG):**
```
{
  'TAP': 'TAP',
  'CPO': 'CPO',
  'PT Etam Bersama Lestari': 'PT Etam Bersama Lestari'
}
```

**Expected raw object (CORRECT):**
```
{
  'Group': 'TAP',
  'Product\r\n(material desc)': 'CPO',
  'Supplier\r\n(vendor -> name 1))': 'PT Etam Bersama Lestari'
}
```

## The Fix
The fieldMetadata is being parsed, but the mapping between array indices and field names is broken. Need to ensure:
1. Field metadata correctly maps column index to header name
2. parseDataRow uses the correct field name for each value
3. Handle empty/null header values properly

## Solution
Debug and fix the field metadata mapping in `parseFieldMetadata` function.
