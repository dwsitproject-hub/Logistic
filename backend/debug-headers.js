const XLSX = require('xlsx');
const path = require('path');

async function debugHeaders() {
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
    
    console.log('Total rows:', jsonData.length);
    
    // Show header rows (rows 2-8, indices 1-7)
    for (let i = 1; i <= 8; i++) {
      if (jsonData[i]) {
        console.log(`\nRow ${i + 1} (index ${i}):`);
        console.log(jsonData[i].slice(0, 20)); // First 20 columns
      }
    }
    
    // Show first data row (row 9, index 8)
    if (jsonData[8]) {
      console.log('\nFirst data row (row 9):');
      console.log(jsonData[8].slice(0, 20)); // First 20 columns
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

debugHeaders();
