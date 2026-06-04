const fs = require('fs');
const path = require('path');

// Read the analysis file
const analysisPath = path.join(__dirname, 'sap-field-analysis.json');
const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));

console.log('=== Detailed SAP Field Analysis ===\n');

// Display first 50 field mappings with all details
console.log('First 50 columns with headers:\n');
const fieldMapping = analysis.fieldMapping.slice(0, 50);

fieldMapping.forEach((field, index) => {
  if (field.header || field.sapField1 || field.sapField2) {
    console.log(`\n--- Column ${field.columnIndex} ---`);
    console.log(`Header (Row 5): ${field.header || 'N/A'}`);
    console.log(`SAP Field Row 7: ${field.sapField1 || 'N/A'}`);
    console.log(`SAP Field Row 8: ${field.sapField2 || 'N/A'}`);
    console.log(`Legend Row 2: ${field.colorLegend1 || 'N/A'}`);
    console.log(`Legend Row 3: ${field.colorLegend2 || 'N/A'}`);
    console.log(`Sample Data: ${field.sampleData || 'N/A'}`);
  }
});

// Show where headers actually start
console.log('\n\n=== Headers Analysis ===');
const headers = analysis.headers.filter(h => h);
console.log(`Total non-empty headers: ${headers.length}`);
console.log('\nFirst 30 headers:');
headers.slice(0, 30).forEach((h, i) => console.log(`${i + 1}. ${h}`));

// SAP Field Names from Row 7
console.log('\n\n=== SAP Field Names (Row 7) ===');
const sapFields1 = analysis.sapFieldsRow7.filter(f => f && f.trim() !== '');
console.log(`Total non-empty SAP fields (Row 7): ${sapFields1.length}`);
console.log('\nFirst 20 SAP fields from Row 7:');
sapFields1.slice(0, 20).forEach((f, i) => console.log(`${i + 1}. ${f.substring(0, 100)}`));

// SAP Field Names from Row 8
console.log('\n\n=== SAP Field Names (Row 8) ===');
const sapFields2 = analysis.sapFieldsRow8.filter(f => f && f.trim() !== '');
console.log(`Total non-empty SAP fields (Row 8): ${sapFields2.length}`);
console.log('\nFirst 20 SAP fields from Row 8:');
sapFields2.slice(0, 20).forEach((f, i) => console.log(`${i + 1}. ${f.substring(0, 100)}`));

// Color Legend Row 2
console.log('\n\n=== Color Legend (Row 2) ===');
const legend1 = analysis.colorLegendRow2.filter(l => l && l.trim() !== '');
console.log(`Total non-empty legend items (Row 2): ${legend1.length}`);
legend1.forEach((l, i) => console.log(`${i + 1}. ${l}`));

// Color Legend Row 3
console.log('\n\n=== Color Legend (Row 3) ===');
const legend2 = analysis.colorLegendRow3.filter(l => l && l.trim() !== '');
console.log(`Total non-empty legend items (Row 3): ${legend2.length}`);
legend2.forEach((l, i) => console.log(`${i + 1}. ${l}`));

// Sample data rows
console.log('\n\n=== Sample Data (First Record) ===');
if (analysis.sampleDataRows && analysis.sampleDataRows[0]) {
  const firstRow = analysis.sampleDataRows[0];
  firstRow.forEach((value, index) => {
    if (value && value !== '') {
      const header = analysis.headers[index] || `Column ${index}`;
      console.log(`${header}: ${value}`);
    }
  });
}

