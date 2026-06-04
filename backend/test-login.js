const http = require('http');

// Test data
const testCredentials = {
  username: 'admin',
  password: 'admin123'
};

console.log('Testing login endpoint...\n');

const postData = JSON.stringify(testCredentials);

const options = {
  hostname: 'localhost',
  port: 5001,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    console.log('Response:', data);
    
    try {
      const response = JSON.parse(data);
      if (response.success && response.data.token) {
        console.log('\n✅ Login successful!');
        console.log('\nToken:', response.data.token);
        console.log('\nUser Info:');
        console.log('  Username:', response.data.user.username);
        console.log('  Email:', response.data.user.email);
        console.log('  Role:', response.data.user.role);
        console.log('\nYou can use this token for API requests.');
      } else {
        console.log('\n❌ Login failed:', response.error || 'Unknown error');
      }
    } catch (e) {
      console.log('\n❌ Could not parse response');
    }
  });
});

req.on('error', (error) => {
  console.log('❌ Connection Error:', error.message);
  console.log('\nPossible issues:');
  console.log('1. Backend server is not running');
  console.log('2. Backend is running on a different port');
  console.log('\nTo start the backend:');
  console.log('  cd backend');
  console.log('  npm run dev');
});

req.write(postData);
req.end();

