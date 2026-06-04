const XLSX = require('xlsx');
const path = require('path');

async function simpleTest() {
  try {
    console.log('=== SIMPLE FIX TEST ===');
    
    const filePath = path.join(process.cwd(), '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
    console.log('Reading Excel file...');
    
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
    
    // Test the OLD way (buggy)
    console.log('\n=== OLD WAY (BUGGY) ===');
    const oldMetadata = [];
    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i];
      if (!header) continue; // This was the bug - skipping null headers
      oldMetadata.push({
        columnIndex: i,
        headerName: header,
      });
    }
    
    console.log('Old metadata length:', oldMetadata.length);
    console.log('First 10 old metadata:', oldMetadata.slice(0, 10).map(m => `${m.columnIndex}: ${m.headerName}`));
    
    // Test the NEW way (fixed)
    console.log('\n=== NEW WAY (FIXED) ===');
    const newMetadata = [];
    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i];
      newMetadata.push({
        columnIndex: i,
        headerName: header || `Column_${i}`, // Fixed: don't skip, use placeholder
      });
    }
    
    console.log('New metadata length:', newMetadata.length);
    console.log('First 10 new metadata:', newMetadata.slice(0, 10).map(m => `${m.columnIndex}: ${m.headerName}`));
    
    // Test parsing with both approaches
    console.log('\n=== PARSING COMPARISON ===');
    
    // Old way parsing
    const oldParsed = { raw: {} };
    for (let index = 0; index < dataRow.length; index++) {
      const value = dataRow[index];
      if (index >= oldMetadata.length) continue;
      const field = oldMetadata[index];
      if (!field) continue;
      oldParsed.raw[field.headerName] = value;
    }
    
    // New way parsing
    const newParsed = { raw: {} };
    for (let index = 0; index < dataRow.length; index++) {
      const value = dataRow[index];
      if (index >= newMetadata.length) continue;
      const field = newMetadata[index];
      if (!field) continue;
      newParsed.raw[field.headerName] = value;
    }
    
    console.log('Old parsed keys (first 10):', Object.keys(oldParsed.raw).slice(0, 10));
    console.log('New parsed keys (first 10):', Object.keys(newParsed.raw).slice(0, 10));
    
    // Check for expected fields
    const hasGroup = 'Group' in newParsed.raw;
    const hasSupplier = 'Supplier\r\n(vendor -> name 1))' in newParsed.raw;
    const hasProduct = 'Product\r\n(material desc)' in newParsed.raw;
    
    console.log('\n=== RESULTS ===');
    console.log('Has "Group" field:', hasGroup);
    console.log('Has "Supplier" field:', hasSupplier);
    console.log('Has "Product" field:', hasProduct);
    
    if (hasGroup && hasSupplier && hasProduct) {
      console.log('✅ FIX IS WORKING!');
      console.log('Sample values:');
      console.log(`  Group: ${newParsed.raw['Group']}`);
      console.log(`  Supplier: ${newParsed.raw['Supplier\r\n(vendor -> name 1))']}`);
      console.log(`  Product: ${newParsed.raw['Product\r\n(material desc)']}`);
    } else {
      console.log('❌ FIX IS NOT WORKING!');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

simpleTest();
