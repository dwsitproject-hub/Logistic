const http = require('http');

console.log('Testing which routes are registered...\n');

// Test various route paths
const routes = [
  '/health',
  '/api/auth/login',
  '/api/sap/imports',
  '/api/sap-master-v2/imports',
  '/api/excel-import/upload'
];

routes.forEach(route => {
  const options = {
    hostname: 'localhost',
    port: 5001,
    path: route,
    method: 'GET'
  };
  
  const req = http.request(options, (res) => {
    const status = res.statusCode;
    const icon = status === 404 ? '❌' : status === 401 ? '🔒' : '✅';
    console.log(`${icon} ${route} - Status: ${status}`);
  });
  
  req.on('error', (error) => {
    console.log(`❌ ${route} - Error: ${error.message}`);
  });
  
  req.end();
});

setTimeout(() => {
  console.log('\n✅ = Route exists');
  console.log('🔒 = Route exists but requires auth');
  console.log('❌ = Route not found\n');
}, 1000);

