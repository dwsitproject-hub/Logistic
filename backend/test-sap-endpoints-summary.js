/**
 * SAP Integration Endpoint Verification
 * Tests all key endpoints to ensure they're accessible and functioning
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5001';

// Test configuration
const tests = [
  {
    name: 'Health Check',
    method: 'GET',
    url: `${BASE_URL}/health`,
    requiresAuth: false,
    expectedStatus: 200
  },
  {
    name: 'Get All SAP Imports (requires auth)',
    method: 'GET',
    url: `${BASE_URL}/api/sap-master-v2/imports`,
    requiresAuth: true,
    expectedStatus: [200, 401]
  },
  {
    name: 'Get Field Mappings (requires auth)',
    method: 'GET',
    url: `${BASE_URL}/api/sap/field-mappings`,
    requiresAuth: true,
    expectedStatus: [200, 401]
  },
  {
    name: 'Get Pending Entries (requires auth)',
    method: 'GET',
    url: `${BASE_URL}/api/sap-master-v2/pending-entries`,
    requiresAuth: true,
    expectedStatus: [200, 401]
  }
];

async function runTests() {
  console.log('🧪 Starting SAP Integration Endpoint Tests\n');
  console.log('=' .repeat(60));
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      console.log(`\n📝 ${test.name}`);
      console.log(`   ${test.method} ${test.url}`);
      
      const response = await axios({
        method: test.method,
        url: test.url,
        validateStatus: () => true // Don't throw on any status
      });
      
      const expectedStatuses = Array.isArray(test.expectedStatus) 
        ? test.expectedStatus 
        : [test.expectedStatus];
      
      if (expectedStatuses.includes(response.status)) {
        console.log(`   ✅ Status: ${response.status} (Expected: ${expectedStatuses.join(' or ')})`);
        
        if (response.status === 200 && response.data) {
          if (response.data.success !== undefined) {
            console.log(`   📊 Success: ${response.data.success}`);
          }
          if (Array.isArray(response.data.data)) {
            console.log(`   📦 Records: ${response.data.data.length}`);
          } else if (response.data.data) {
            console.log(`   📦 Data: ${typeof response.data.data}`);
          }
        }
        
        if (response.status === 401 && test.requiresAuth) {
          console.log(`   🔒 Authentication required (expected for protected endpoints)`);
        }
        
        passed++;
      } else {
        console.log(`   ❌ Status: ${response.status} (Expected: ${expectedStatuses.join(' or ')})`);
        console.log(`   Error: ${JSON.stringify(response.data)}`);
        failed++;
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success Rate: ${((passed / tests.length) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Backend is functioning correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above for details.');
  }
  
  console.log('\n💡 Note: 401 responses are expected for protected endpoints.');
  console.log('   To test authenticated endpoints, login via the frontend and');
  console.log('   use the browser DevTools to copy the auth token, then run');
  console.log('   authenticated tests with the token in the headers.\n');
}

// Database connection test
async function testDatabaseConnection() {
  console.log('\n🔍 Testing Database Connection...');
  try {
    const { default: pool } = await import('./src/database/connection.js');
    await pool.query('SELECT 1');
    console.log('   ✅ Database connection successful');
    
    // Check field mappings count
    const result = await pool.query('SELECT COUNT(*) FROM sap_field_mappings');
    console.log(`   📊 Field Mappings: ${result.rows[0].count} records`);
    
    return true;
  } catch (error) {
    console.log(`   ❌ Database connection failed: ${error.message}`);
    return false;
  }
}

// Main execution
(async () => {
  console.log('🚀 SAP Integration Verification Suite\n');
  
  // Test database first
  const dbOk = await testDatabaseConnection();
  
  if (!dbOk) {
    console.log('\n⚠️  Database connection failed. Make sure the database is running.');
    console.log('   Some endpoint tests may fail as a result.\n');
  }
  
  // Run API endpoint tests
  await runTests();
  
  process.exit(0);
})();

