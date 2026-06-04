const XLSX = require('xlsx');
const path = require('path');

async function debugImportFlow() {
  try {
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
    
    console.log('\n=== FIELD METADATA SIMULATION ===');
    const metadata = [];
    
    for (let i = 0; i < headerRow.length; i++) {
      const header = headerRow[i];
      metadata.push({
        columnIndex: i,
        headerName: header || `Column_${i}`,
      });
    }
    
    console.log('Metadata length:', metadata.length);
    console.log('First 10 metadata entries:');
    for (let i = 0; i < 10; i++) {
      console.log(`  ${i}: ${metadata[i].headerName}`);
    }
    
    console.log('\n=== DATA ROW SIMULATION ===');
    console.log('Data row length:', dataRow.length);
    console.log('First 10 data values:');
    for (let i = 0; i < 10; i++) {
      console.log(`  ${i}: ${dataRow[i]}`);
    }
    
    console.log('\n=== PARSED RESULT SIMULATION ===');
    const parsed = { raw: {} };
    
    for (let index = 0; index < dataRow.length; index++) {
      const value = dataRow[index];
      
      if (index >= metadata.length) continue;
      
      const field = metadata[index];
      if (!field || !field.headerName) continue;
      
      const fieldName = field.headerName;
      
      if (fieldName && fieldName.trim() !== '') {
        parsed.raw[fieldName] = value;
      }
    }
    
    console.log('Parsed raw object keys (first 20):');
    const keys = Object.keys(parsed.raw);
    for (let i = 0; i < Math.min(20, keys.length); i++) {
      console.log(`  ${keys[i]}: ${parsed.raw[keys[i]]}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

debugImportFlow();
