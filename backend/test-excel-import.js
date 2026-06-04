const { ExcelImportService } = require('./dist/services/excelImport.service');
const path = require('path');

async function testExcelImport() {
  try {
    console.log('🧪 Testing Excel Import Service...');
    
    // Test file path
    const filePath = path.join(__dirname, '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
    
    console.log('📁 File path:', filePath);
    
    // Test validation
    console.log('\n📋 Validating Excel structure...');
    const validation = ExcelImportService.validateExcelStructure(filePath);
    console.log('Validation result:', JSON.stringify(validation, null, 2));
    
    if (validation.isValid) {
      console.log('\n📊 Getting sheet names...');
      const sheetNames = ExcelImportService.getSheetNames(filePath);
      console.log('Available sheets:', sheetNames);
      
      console.log('\n👀 Previewing data...');
      const preview = ExcelImportService.previewExcelData(filePath, sheetNames[0], 5);
      console.log('Preview data:', JSON.stringify(preview, null, 2));
      
      console.log('\n✅ Excel import service is working correctly!');
    } else {
      console.log('\n❌ Excel file validation failed:', validation.errors);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testExcelImport();
