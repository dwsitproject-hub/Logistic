const { ExcelImportService } = require('./dist/services/excelImport.service');
const { SchedulerService } = require('./dist/services/scheduler.service');
const path = require('path');

async function testExcelFunctionality() {
  console.log('🧪 Testing Excel Import and Scheduler Functionality...\n');
  
  try {
    // Test 1: Validate Excel file structure
    console.log('📋 Test 1: Validating Excel file structure...');
    const filePath = path.join(__dirname, '..', 'docs', 'Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
    
    const validation = ExcelImportService.validateExcelStructure(filePath);
    console.log('✅ Validation Result:', {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      sheetCount: validation.sheetNames.length
    });
    
    if (validation.isValid) {
      // Test 2: Get sheet names
      console.log('\n📊 Test 2: Getting available sheets...');
      const sheetNames = ExcelImportService.getSheetNames(filePath);
      console.log('✅ Available sheets:', sheetNames);
      
      // Test 3: Preview data
      console.log('\n👀 Test 3: Previewing Excel data...');
      const preview = ExcelImportService.previewExcelData(filePath, sheetNames[0], 3);
      console.log('✅ Preview data (first 3 rows):');
      preview.forEach((row, index) => {
        console.log(`  Row ${index + 1}:`, row);
      });
      
      // Test 4: Test scheduler service
      console.log('\n⏰ Test 4: Testing scheduler service...');
      const scheduledImports = SchedulerService.getScheduledImports();
      console.log('✅ Scheduled imports:', scheduledImports.length);
      
      scheduledImports.forEach((schedule, index) => {
        console.log(`  Schedule ${index + 1}:`, {
          name: schedule.name,
          schedule: schedule.schedule,
          isActive: schedule.isActive,
          nextRun: schedule.nextRun
        });
      });
      
      // Test 5: Test scheduler status
      console.log('\n📈 Test 5: Testing scheduler status...');
      const status = {
        totalSchedules: scheduledImports.length,
        activeSchedules: scheduledImports.filter(s => s.isActive).length,
        inactiveSchedules: scheduledImports.filter(s => !s.isActive).length
      };
      console.log('✅ Scheduler status:', status);
      
      console.log('\n🎉 All tests completed successfully!');
      console.log('\n📝 Summary:');
      console.log('  - Excel file validation: ✅');
      console.log('  - Sheet detection: ✅');
      console.log('  - Data preview: ✅');
      console.log('  - Scheduler service: ✅');
      console.log('  - Status monitoring: ✅');
      
    } else {
      console.log('\n❌ Excel file validation failed. Cannot proceed with other tests.');
      console.log('Errors:', validation.errors);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testExcelFunctionality();
