const XLSX = require('xlsx');
const path = require('path');

// Read the Excel file
const excelPath = path.join(__dirname, '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
console.log('Reading Excel file from:', excelPath);

try {
  const workbook = XLSX.readFile(excelPath);
  console.log('\n=== Available Sheets ===');
  console.log(workbook.SheetNames);
  
  // Look for MASTER v2 sheet
  const masterV2Sheet = workbook.Sheets['MASTER v2'];
  
  if (!masterV2Sheet) {
    console.log('\n"MASTER v2" sheet not found. Available sheets:', workbook.SheetNames);
    process.exit(1);
  }
  
  console.log('\n=== MASTER v2 Sheet Found ===');
  
  // Convert to JSON with header row
  const jsonData = XLSX.utils.sheet_to_json(masterV2Sheet, {
    header: 1,
    defval: null,
    raw: false
  });
  
  console.log('\n=== Row Analysis ===');
  console.log(`Total rows: ${jsonData.length}`);
  
  // Row 2 and 3: Color coding legend
  console.log('\n=== Row 2 (Legend/Color Coding) ===');
  if (jsonData[1]) {
    console.log(jsonData[1].filter(cell => cell !== null && cell !== ''));
  }
  
  console.log('\n=== Row 3 (Legend/Color Coding) ===');
  if (jsonData[2]) {
    console.log(jsonData[2].filter(cell => cell !== null && cell !== ''));
  }
  
  // Row 5: Table headers
  console.log('\n=== Row 5 (Table Headers) ===');
  if (jsonData[4]) {
    const headers = jsonData[4];
    headers.forEach((header, index) => {
      if (header && header !== null) {
        console.log(`Column ${index}: ${header}`);
      }
    });
  }
  
  // Row 7 and 8: SAP Field Names
  console.log('\n=== Row 7 (SAP Field Names Part 1) ===');
  if (jsonData[6]) {
    const sapFields1 = jsonData[6];
    sapFields1.forEach((field, index) => {
      if (field && field !== null && field !== '') {
        console.log(`Column ${index}: ${field}`);
      }
    });
  }
  
  console.log('\n=== Row 8 (SAP Field Names Part 2) ===');
  if (jsonData[7]) {
    const sapFields2 = jsonData[7];
    sapFields2.forEach((field, index) => {
      if (field && field !== null && field !== '') {
        console.log(`Column ${index}: ${field}`);
      }
    });
  }
  
  // Sample data (rows 9-33)
  console.log('\n=== Sample Data (Rows 9-15 preview) ===');
  for (let i = 8; i < Math.min(14, jsonData.length); i++) {
    if (jsonData[i]) {
      const rowData = jsonData[i].filter(cell => cell !== null && cell !== '');
      if (rowData.length > 0) {
        console.log(`\nRow ${i + 1}:`, rowData.slice(0, 5), rowData.length > 5 ? `... (${rowData.length} total fields)` : '');
      }
    }
  }
  
  // Create a comprehensive field mapping
  console.log('\n=== Comprehensive Field Mapping ===');
  console.log('Creating field mapping from Row 5 (headers), Row 7 & 8 (SAP field names)...\n');
  
  const headers = jsonData[4] || [];
  const sapFields1 = jsonData[6] || [];
  const sapFields2 = jsonData[7] || [];
  const colorLegend1 = jsonData[1] || [];
  const colorLegend2 = jsonData[2] || [];
  
  const fieldMapping = [];
  const maxColumns = Math.max(headers.length, sapFields1.length, sapFields2.length);
  
  for (let i = 0; i < maxColumns; i++) {
    if (headers[i] || sapFields1[i] || sapFields2[i]) {
      fieldMapping.push({
        columnIndex: i,
        header: headers[i] || '',
        sapField1: sapFields1[i] || '',
        sapField2: sapFields2[i] || '',
        colorLegend1: colorLegend1[i] || '',
        colorLegend2: colorLegend2[i] || '',
        sampleData: jsonData[8] ? jsonData[8][i] : null
      });
    }
  }
  
  console.table(fieldMapping);
  
  // Export to JSON for further analysis
  const fs = require('fs');
  const outputPath = path.join(__dirname, 'sap-field-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    sheetName: 'MASTER v2',
    totalRows: jsonData.length,
    colorLegendRow2: jsonData[1],
    colorLegendRow3: jsonData[2],
    headers: jsonData[4],
    sapFieldsRow7: jsonData[6],
    sapFieldsRow8: jsonData[7],
    sampleDataRows: jsonData.slice(8, 33),
    fieldMapping: fieldMapping
  }, null, 2));
  
  console.log(`\n=== Field analysis exported to: ${outputPath} ===`);
  
} catch (error) {
  console.error('Error reading Excel file:', error);
  process.exit(1);
}

