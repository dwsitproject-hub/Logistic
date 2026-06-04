const { SapMasterV2ImportService } = require('./dist/services/sapMasterV2Import.service');
const XLSX = require('xlsx');
const path = require('path');

async function debugParsedData() {
  try {
    console.log('=== DEBUG PARSED DATA ===');
    
    const filePath = path.join(process.cwd(), '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
    console.log('Reading Excel file:', filePath);
    
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets['MASTER v2'];
    
    // Convert to JSON array
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: false
    });
    
    const config = {
      legendRow1: 1,  // Row 2 in Excel (0-indexed)
      legendRow2: 2,  // Row 3
      headerRow: 4,   // Row 5
      sapFieldRow1: 6, // Row 7
      sapFieldRow2: 7, // Row 8
      dataStartRow: 8  // Row 9
    };
    
    const headerRow = jsonData[config.headerRow] || [];
    const dataRow = jsonData[config.dataStartRow] || [];
    
    console.log('Header row length:', headerRow.length);
    console.log('Data row length:', dataRow.length);
    
    // Parse field metadata
    const metadata = SapMasterV2ImportService.parseFieldMetadata(jsonData);
    console.log('Metadata length:', metadata.length);
    
    // Parse data row
    const parsed = SapMasterV2ImportService.parseDataRow(dataRow, metadata);
    
    console.log('\n=== PARSED CONTRACT DATA ===');
    console.log('Contract object:', JSON.stringify(parsed.contract, null, 2));
    
    console.log('\n=== PARSED RAW DATA (first 20) ===');
    const rawKeys = Object.keys(parsed.raw);
    for (let i = 0; i < Math.min(20, rawKeys.length); i++) {
      const key = rawKeys[i];
      const value = parsed.raw[key];
      console.log(`"${key}": "${value}"`);
    }
    
    // Check specific fields we need
    console.log('\n=== KEY FIELDS ===');
    console.log('Group:', parsed.contract.group || 'NULL');
    console.log('Supplier:', parsed.contract.supplier || 'NULL');
    console.log('Product:', parsed.contract.product || 'NULL');
    console.log('Contract No:', parsed.contract.contract_no || 'NULL');
    console.log('PO No:', parsed.contract.po_no || 'NULL');
    
    // Check raw data for supplier
    const supplierKey = rawKeys.find(key => key.toLowerCase().includes('supplier'));
    if (supplierKey) {
      console.log(`Supplier from raw (${supplierKey}):`, parsed.raw[supplierKey] || 'NULL');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

debugParsedData();
