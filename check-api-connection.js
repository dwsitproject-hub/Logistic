/**
 * Quick API Connection Checker
 * Run this script to diagnose API connection issues
 * Usage: node check-api-connection.js
 */

const http = require('http');

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';
const HEALTH_URL = 'http://localhost:5001/health';

console.log('🔍 KLIP API Connection Diagnostic\n');
console.log('='.repeat(50));
console.log(`Expected API URL: ${API_URL}`);
console.log(`Health Check URL: ${HEALTH_URL}`);
console.log('='.repeat(50));
console.log('');

// Test 1: Health Check
console.log('1️⃣ Testing Backend Health Endpoint...');
testHealthCheck()
  .then(() => {
    console.log('   ✅ Backend is running!\n');
    return testAPIEndpoint();
  })
  .then(() => {
    console.log('\n✅ All checks passed!');
    console.log('\nIf data still doesn\'t load:');
    console.log('1. Check browser console (F12) for errors');
    console.log('2. Verify you are logged in');
    console.log('3. Check Network tab for failed requests');
    console.log('4. See TROUBLESHOOTING_DATA_LOADING.md for more help');
  })
  .catch((error) => {
    console.error('\n❌ Diagnostic failed:', error.message);
    console.error('\nCommon issues:');
    console.error('1. Backend server not running - run: cd backend && npm run dev');
    console.error('2. Wrong port - check backend/.env for PORT setting');
    console.error('3. Firewall blocking port 5001');
    console.error('\nSee TROUBLESHOOTING_DATA_LOADING.md for detailed help');
    process.exit(1);
  });

function testHealthCheck() {
  return new Promise((resolve, reject) => {
    const url = new URL(HEALTH_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 5001,
      path: url.pathname,
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            console.log(`   Response: ${JSON.stringify(json)}`);
            resolve();
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else {
          reject(new Error(`Health check returned status ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Cannot connect to backend: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timeout - backend may not be running'));
    });

    req.end();
  });
}

function testAPIEndpoint() {
  return new Promise((resolve, reject) => {
    console.log('2️⃣ Testing API Endpoint Structure...');
    const url = new URL(API_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 5001,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      // Even if login fails, if we get a response, the API is reachable
      if (res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 200) {
        console.log(`   ✅ API endpoint is reachable (status: ${res.statusCode})`);
        resolve();
      } else {
        reject(new Error(`API endpoint returned unexpected status: ${res.statusCode}`));
      }
    });

    req.on('error', (error) => {
      reject(new Error(`Cannot reach API endpoint: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('API endpoint timeout'));
    });

    // Send empty body to test endpoint
    req.write(JSON.stringify({}));
    req.end();
  });
}





















