#!/usr/bin/env tsx

import { execSync } from 'child_process';

console.log('🚀 Running final build verification...\n');

try {
  execSync('npm run build', { 
    encoding: 'utf8', 
    stdio: 'inherit' 
  });
  
  console.log('\n✅ BUILD SUCCESSFUL! No TypeScript errors found! 🎉\n');
  console.log('🏆 All TypeScript errors have been fixed!');
  
} catch (error) {
  console.log('\n❌ Build still has errors. Check the output above.');
  process.exit(1);
}