require('dotenv').config();
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs'
  }
});

const { seedFieldMappings } = require('./src/database/seed-field-mappings.ts');

console.log('========================================');
console.log('SAP Field Mappings Seeder');
console.log('========================================\n');

seedFieldMappings()
  .then(() => {
    console.log('\n========================================');
    console.log('✅ Field mappings seeded successfully!');
    console.log('========================================\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n========================================');
    console.error('❌ Field mappings seed failed:', error.message);
    console.error('========================================\n');
    process.exit(1);
  });

