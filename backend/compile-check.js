// Quick compile check for TypeScript files
const { exec } = require('child_process');

console.log('Checking TypeScript compilation...\n');

exec('npx tsc --noEmit', (error, stdout, stderr) => {
  if (error) {
    console.log('TypeScript Errors Found:\n');
    console.log(stdout);
    console.log(stderr);
    process.exit(1);
  } else {
    console.log('✅ No TypeScript errors! All files compile successfully.\n');
    process.exit(0);
  }
});

