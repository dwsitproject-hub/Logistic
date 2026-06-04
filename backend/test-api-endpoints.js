const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:5001';
const TEST_TOKEN = 'your-test-jwt-token-here'; // Replace with actual token

async function testAPIEndpoints() {
  console.log('🧪 Testing Excel Import API Endpoints...\n');
  
  const headers = {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'Content-Type': 'application/json'
  };
  
  try {
    // Test 1: Health check
    console.log('🏥 Test 1: Health check...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check:', healthResponse.data);
    
    // Test 2: Get scheduler status
    console.log('\n📈 Test 2: Get scheduler status...');
    try {
      const statusResponse = await axios.get(`${BASE_URL}/api/excel-import/scheduler/status`, { headers });
      console.log('✅ Scheduler status:', statusResponse.data);
    } catch (error) {
      console.log('⚠️  Scheduler status (auth required):', error.response?.status, error.response?.data?.error?.message);
    }
    
    // Test 3: Get scheduled imports
    console.log('\n⏰ Test 3: Get scheduled imports...');
    try {
      const schedulesResponse = await axios.get(`${BASE_URL}/api/excel-import/schedules`, { headers });
      console.log('✅ Scheduled imports:', schedulesResponse.data);
    } catch (error) {
      console.log('⚠️  Scheduled imports (auth required):', error.response?.status, error.response?.data?.error?.message);
    }
    
    // Test 4: Validate Excel structure
    console.log('\n📋 Test 4: Validate Excel structure...');
    try {
      const filePath = encodeURIComponent('docs/Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
      const validateResponse = await axios.get(`${BASE_URL}/api/excel-import/validate?filePath=${filePath}`, { headers });
      console.log('✅ Excel validation:', validateResponse.data);
    } catch (error) {
      console.log('⚠️  Excel validation (auth required):', error.response?.status, error.response?.data?.error?.message);
    }
    
    // Test 5: Get sheet names
    console.log('\n📊 Test 5: Get sheet names...');
    try {
      const filePath = encodeURIComponent('docs/Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
      const sheetsResponse = await axios.get(`${BASE_URL}/api/excel-import/sheets?filePath=${filePath}`, { headers });
      console.log('✅ Sheet names:', sheetsResponse.data);
    } catch (error) {
      console.log('⚠️  Sheet names (auth required):', error.response?.status, error.response?.data?.error?.message);
    }
    
    // Test 6: Preview Excel data
    console.log('\n👀 Test 6: Preview Excel data...');
    try {
      const filePath = encodeURIComponent('docs/Logistics Overview 13.10.2025 (Logic) - from IT.xlsx');
      const previewResponse = await axios.get(`${BASE_URL}/api/excel-import/preview?filePath=${filePath}&maxRows=3`, { headers });
      console.log('✅ Excel preview:', previewResponse.data);
    } catch (error) {
      console.log('⚠️  Excel preview (auth required):', error.response?.status, error.response?.data?.error?.message);
    }
    
    console.log('\n🎉 API endpoint tests completed!');
    console.log('\n📝 Note: Some endpoints require authentication.');
    console.log('   To test with authentication, replace TEST_TOKEN with a valid JWT token.');
    
  } catch (error) {
    console.error('\n❌ API test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get(`${BASE_URL}/health`);
    return true;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  console.log('🔍 Checking if server is running...');
  const serverRunning = await checkServer();
  
  if (serverRunning) {
    console.log('✅ Server is running, proceeding with tests...\n');
    await testAPIEndpoints();
  } else {
    console.log('❌ Server is not running. Please start the server first:');
    console.log('   cd backend && npm run dev');
  }
}

main();
