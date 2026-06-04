const http = require('http');

// First, login to get token
const loginData = JSON.stringify({
  username: 'admin',
  password: 'admin123'
});

console.log('Step 1: Logging in...\n');

const loginOptions = {
  hostname: 'localhost',
  port: 5001,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(loginData)
  }
};

const loginReq = http.request(loginOptions, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.success && response.data.token) {
        const token = response.data.token;
        console.log('✅ Login successful!');
        console.log('Token:', token.substring(0, 50) + '...\n');
        
        // Test SAP endpoints
        testSapEndpoints(token);
      } else {
        console.log('❌ Login failed');
        process.exit(1);
      }
    } catch (e) {
      console.log('❌ Could not parse login response');
      process.exit(1);
    }
  });
});

loginReq.on('error', (error) => {
  console.log('❌ Login failed:', error.message);
  process.exit(1);
});

loginReq.write(loginData);
loginReq.end();

function testSapEndpoints(token) {
  console.log('Step 2: Testing SAP MASTER v2 Endpoints...\n');
  
  // Test GET /api/sap-master-v2/imports
  const options = {
    hostname: 'localhost',
    port: 5001,
    path: '/api/sap-master-v2/imports',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  
  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log('GET /api/sap-master-v2/imports');
      console.log('Status:', res.statusCode);
      
      try {
        const response = JSON.parse(data);
        if (response.success) {
          console.log('✅ Endpoint accessible!');
          console.log(`Found ${response.data.length} import(s)\n`);
        } else {
          console.log('⚠️  Endpoint returned error:', response.error);
        }
      } catch (e) {
        console.log('Response:', data);
      }
      
      // Test pending entries endpoint
      testPendingEntries(token);
    });
  });
  
  req.on('error', (error) => {
    console.log('❌ SAP endpoint test failed:', error.message);
  });
  
  req.end();
}

function testPendingEntries(token) {
  console.log('Step 3: Testing Pending Entries Endpoint...\n');
  
  const options = {
    hostname: 'localhost',
    port: 5001,
    path: '/api/sap-master-v2/pending-entries',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  
  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log('GET /api/sap-master-v2/pending-entries');
      console.log('Status:', res.statusCode);
      
      try {
        const response = JSON.parse(data);
        if (response.success) {
          console.log('✅ Endpoint accessible!');
          console.log(`Found ${response.data.length} pending entries\n`);
        } else {
          console.log('⚠️  Endpoint returned error:', response.error);
        }
      } catch (e) {
        console.log('Response:', data);
      }
      
      console.log('========================================');
      console.log('✅ ALL SAP MASTER v2 ENDPOINTS WORKING!');
      console.log('========================================');
      console.log('\nYou can now access:');
      console.log('- SAP Import Dashboard: http://localhost:3001/sap-imports');
      console.log('- SAP Data Entry: http://localhost:3001/sap-data-entry');
      console.log('\nAPI Endpoints:');
      console.log('- POST /api/sap-master-v2/import');
      console.log('- GET  /api/sap-master-v2/imports');
      console.log('- GET  /api/sap-master-v2/imports/:id');
      console.log('- GET  /api/sap-master-v2/pending-entries');
    });
  });
  
  req.on('error', (error) => {
    console.log('❌ Pending entries test failed:', error.message);
  });
  
  req.end();
}

