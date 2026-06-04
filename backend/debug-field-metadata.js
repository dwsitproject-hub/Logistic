const XLSX = require('xlsx');
const path = require('path');

async function debugFieldMetadata() {
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
    
    const legendRow1 = jsonData[config.legendRow1] || [];
    const legendRow2 = jsonData[config.legendRow2] || [];
    const headerRow = jsonData[config.headerRow] || [];
    const sapFieldRow1 = jsonData[config.sapFieldRow1] || [];
    const sapFieldRow2 = jsonData[config.sapFieldRow2] || [];
    const dataRow = jsonData[config.dataStartRow] || [];
    
    console.log('\nHeader Row (Row 5, index 4):');
    console.log('Length:', headerRow.length);
    console.log('First 20 headers:', headerRow.slice(0, 20));
    
    console.log('\nData Row (Row 9, index 8):');
    console.log('Length:', dataRow.length);
    console.log('First 20 values:', dataRow.slice(0, 20));
    
    console.log('\nField Metadata (first 20 columns):');
    for (let i = 0; i < Math.min(20, headerRow.length); i++) {
      const header = headerRow[i];
      const value = dataRow[i];
      const legend1 = legendRow1[i] || '';
      const legend2 = legendRow2[i] || '';
      
      console.log(`\nColumn ${i}:`);
      console.log(`  Legend 1: ${legend1}`);
      console.log(`  Legend 2: ${legend2}`);
      console.log(`  Header: ${header}`);
      console.log(`  Data Value: ${value}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

debugFieldMetadata();
