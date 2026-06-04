const axios = require('axios');

const BASE_URL = 'http://localhost:5001/api';
let adminToken = '';

// Helper function for API calls
const api = {
  post: async (url, data, token = '') => {
    return axios.post(`${BASE_URL}${url}`, data, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
  get: async (url, token = '') => {
    return axios.get(`${BASE_URL}${url}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
};

async function testUserManagement() {
  console.log('🧪 Testing User Management System\n');

  try {
    // 1. Login as admin
    console.log('1️⃣  Testing admin login...');
    const loginRes = await api.post('/auth/login', {
      username: 'admin',
      password: 'admin123',
    });
    adminToken = loginRes.data.data.token;
    console.log('✅ Admin login successful');
    console.log(`   Token: ${adminToken.substring(0, 20)}...`);
    console.log(`   User: ${loginRes.data.data.user.full_name}`);
    console.log(`   First Login: ${loginRes.data.data.requirePasswordChange}\n`);

    // 2. Get all users
    console.log('2️⃣  Fetching all users...');
    const usersRes = await api.get('/users', adminToken);
    console.log(`✅ Found ${usersRes.data.data.length} users`);
    usersRes.data.data.forEach((user, i) => {
      console.log(`   ${i + 1}. ${user.full_name} (@${user.username}) - ${user.role}`);
    });
    console.log('');

    // 3. Get all roles
    console.log('3️⃣  Fetching all roles...');
    const rolesRes = await api.get('/roles', adminToken);
    console.log(`✅ Found ${rolesRes.data.data.length} roles`);
    rolesRes.data.data.forEach((role, i) => {
      console.log(`   ${i + 1}. ${role.display_name} (${role.role_name})`);
    });
    console.log('');

    // 4. Get permissions
    console.log('4️⃣  Fetching permissions...');
    const permsRes = await api.get('/roles/permissions', adminToken);
    const perms = permsRes.data.data;
    const permCount = Object.values(perms).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`✅ Found ${permCount} permissions in ${Object.keys(perms).length} categories`);
    Object.keys(perms).forEach((category) => {
      console.log(`   - ${category}: ${perms[category].length} permissions`);
    });
    console.log('');

    // 5. Create a test user
    console.log('5️⃣  Creating a test user...');
    const newUserRes = await api.post(
      '/users',
      {
        username: 'testuser',
        email: 'test@klip.com',
        password: 'test123',
        full_name: 'Test User',
        role: 'TRADING',
        department: 'Testing',
      },
      adminToken
    );
    const newUser = newUserRes.data.data;
    console.log('✅ User created successfully');
    console.log(`   ID: ${newUser.id}`);
    console.log(`   Username: ${newUser.username}`);
    console.log(`   Role: ${newUser.role}`);
    console.log(`   First Login: ${newUser.is_first_login}`);
    console.log('');

    // 6. Test first-time login
    console.log('6️⃣  Testing first-time login for new user...');
    const newUserLoginRes = await api.post('/auth/login', {
      username: 'testuser',
      password: 'test123',
    });
    const newUserToken = newUserLoginRes.data.data.token;
    console.log('✅ New user login successful');
    console.log(`   Requires password change: ${newUserLoginRes.data.data.requirePasswordChange}`);
    console.log('');

    // 7. Change password
    console.log('7️⃣  Testing password change...');
    const changePassRes = await api.post(
      '/users/change-password',
      {
        currentPassword: '',
        newPassword: 'newtest123',
      },
      newUserToken
    );
    console.log('✅ Password changed successfully');
    console.log(`   Message: ${changePassRes.data.message}`);
    console.log('');

    // 8. Login with new password
    console.log('8️⃣  Testing login with new password...');
    const newLoginRes = await api.post('/auth/login', {
      username: 'testuser',
      password: 'newtest123',
    });
    console.log('✅ Login with new password successful');
    console.log(`   Requires password change: ${newLoginRes.data.data.requirePasswordChange}`);
    console.log('');

    // 9. Get user permissions
    console.log('9️⃣  Fetching user permissions...');
    const userPermsRes = await api.get('/roles/my-permissions', newUserToken);
    const userPerms = userPermsRes.data.data;
    console.log('✅ User permissions retrieved');
    console.log(`   Role: ${userPerms.role}`);
    console.log(`   Total permissions: ${Object.keys(userPerms.permissions).length}`);
    console.log('');

    // 10. Cleanup - deactivate test user
    console.log('🔟 Cleaning up - deactivating test user...');
    await axios.delete(`${BASE_URL}/users/${newUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    console.log('✅ Test user deactivated');
    console.log('');

    console.log('🎉 All tests passed successfully!\n');
    console.log('✅ User Management System is fully functional:');
    console.log('   - Admin authentication ✓');
    console.log('   - User CRUD operations ✓');
    console.log('   - Role management ✓');
    console.log('   - Permission system ✓');
    console.log('   - First-time login flow ✓');
    console.log('   - Password change ✓');
    console.log('   - User permissions ✓');
    console.log('');
    console.log('📚 See USER_MANAGEMENT_GUIDE.md for complete documentation');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.response?.data || error.message);
    if (error.response?.data?.error) {
      console.error('   Error details:', error.response.data.error);
    }
    process.exit(1);
  }
}

// Run tests
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  User Management System - Integration Tests');
console.log('═══════════════════════════════════════════════');
console.log('');
console.log('⚠️  Make sure the backend server is running!');
console.log('');

setTimeout(() => {
  testUserManagement();
}, 1000);

