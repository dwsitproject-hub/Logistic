const { SapMasterV2ImportService } = require('./dist/services/sapMasterV2Import.service');
const XLSX = require('xlsx');
const path = require('path');

async function testFix() {
  try {
    console.log('Testing the fix...');
    
    const filePath = path.join(process.cwd(), '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
    console.log('Reading Excel file:', filePath);
    
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets['MASTER v2'];
    
    if (!worksheet) {
      console.log('Sheet "MASTER v2" not found');
      return;
    }
    
    // Convert to JSON array
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: false
    });
    
    console.log('Testing parseFieldMetadata...');
    const metadata = SapMasterV2ImportService.parseFieldMetadata(jsonData);
    
    console.log('Metadata length:', metadata.length);
    console.log('First 10 metadata entries:');
    for (let i = 0; i < 10; i++) {
      const field = metadata[i];
      console.log(`  ${i}: ${field.headerName} (index: ${field.columnIndex})`);
    }
    
    console.log('\nTesting parseDataRow...');
    const dataRow = jsonData[8] || []; // Row 9 (0-indexed)
    console.log('Data row length:', dataRow.length);
    console.log('First 10 data values:', dataRow.slice(0, 10));
    
    const parsed = SapMasterV2ImportService.parseDataRow(dataRow, metadata);
    console.log('\nParsed raw object keys (first 20):');
    const keys = Object.keys(parsed.raw);
    for (let i = 0; i < Math.min(20, keys.length); i++) {
      console.log(`  "${keys[i]}": ${parsed.raw[keys[i]]}`);
    }
    
    // Check if we have the expected field names
    const hasGroup = 'Group' in parsed.raw;
    const hasSupplier = 'Supplier\r\n(vendor -> name 1))' in parsed.raw;
    const hasProduct = 'Product\r\n(material desc)' in parsed.raw;
    
    console.log('\n=== FIX VERIFICATION ===');
    console.log('Has "Group" field:', hasGroup);
    console.log('Has "Supplier" field:', hasSupplier);
    console.log('Has "Product" field:', hasProduct);
    
    if (hasGroup && hasSupplier && hasProduct) {
      console.log('✅ FIX IS WORKING! Field names are correctly mapped.');
      console.log('Sample values:');
      console.log(`  Group: ${parsed.raw['Group']}`);
      console.log(`  Supplier: ${parsed.raw['Supplier\r\n(vendor -> name 1))']}`);
      console.log(`  Product: ${parsed.raw['Product\r\n(material desc)']}`);
    } else {
      console.log('❌ FIX IS NOT WORKING! Field names are still incorrect.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

testFix();
