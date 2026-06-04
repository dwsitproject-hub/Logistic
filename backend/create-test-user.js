const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'klip_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function checkAndCreateUsers() {
  try {
    console.log('Checking database connection...');
    
    // Check existing users
    const result = await pool.query('SELECT username, email, role, is_active FROM users');
    
    console.log(`\nFound ${result.rows.length} user(s) in database:`);
    result.rows.forEach(user => {
      console.log(`  - ${user.username} (${user.email}) - Role: ${user.role} - Active: ${user.is_active}`);
    });
    
    if (result.rows.length === 0) {
      console.log('\nNo users found. Creating test users...');
      
      const testUsers = [
        {
          username: 'admin',
          email: 'admin@klip.com',
          password: 'admin123',
          fullName: 'Admin User',
          role: 'ADMIN'
        },
        {
          username: 'trading',
          email: 'trading@klip.com',
          password: 'trading123',
          fullName: 'Trading User',
          role: 'TRADING'
        },
        {
          username: 'logistics',
          email: 'logistics@klip.com',
          password: 'logistics123',
          fullName: 'Logistics User',
          role: 'LOGISTICS'
        },
        {
          username: 'quality',
          email: 'quality@klip.com',
          password: 'quality123',
          fullName: 'Quality User',
          role: 'QUALITY'
        },
        {
          username: 'finance',
          email: 'finance@klip.com',
          password: 'finance123',
          fullName: 'Finance User',
          role: 'FINANCE'
        }
      ];
      
      for (const user of testUsers) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        await pool.query(
          `INSERT INTO users (username, email, password_hash, full_name, role, is_active) 
           VALUES ($1, $2, $3, $4, $5, true)`,
          [user.username, user.email, hashedPassword, user.fullName, user.role]
        );
        console.log(`  ✅ Created user: ${user.username} (${user.role})`);
      }
      
      console.log('\n✅ Test users created successfully!');
      console.log('\nYou can now login with:');
      console.log('  Username: admin     Password: admin123     (Role: ADMIN)');
      console.log('  Username: trading   Password: trading123   (Role: TRADING)');
      console.log('  Username: logistics Password: logistics123 (Role: LOGISTICS)');
      console.log('  Username: quality   Password: quality123   (Role: QUALITY)');
      console.log('  Username: finance   Password: finance123   (Role: FINANCE)');
    } else {
      console.log('\n✅ Users exist. You can login with any of the users shown above.');
      console.log('\nIf you forgot your password, you can reset it or create new test users.');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure PostgreSQL is running');
    console.error('2. Check your .env file has correct database credentials');
    console.error('3. Make sure the klip_db database exists');
    console.error('4. Run the migration first: npm run db:migrate');
  } finally {
    await pool.end();
  }
}

checkAndCreateUsers();

