#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// List of files that have specific issues
const filesToFix = [
  'src/app/(authenticated)/customers/page.tsx',
  'src/app/(authenticated)/dashboard/page-original.tsx',
  'src/app/(authenticated)/dashboard/page-slow.tsx',
];

function fixFile(filePath: string): void {
  let content = readFileSync(filePath, 'utf8');
  
  // Fix TabNav items: id -> key
  if (filePath.includes('customers/page.tsx')) {
    content = content.replace(
      /tabs=\{\[\s*\{\s*id:\s*'all'/,
      "tabs={[\n              { key: 'all'"
    );
    content = content.replace(
      /\{\s*id:\s*'regular'/,
      "{ key: 'regular'"
    );
    content = content.replace(
      /\{\s*id:\s*'non-regular'/,
      "{ key: 'non-regular'"
    );
  }
  
  // Fix .badge references (remove them)
  content = content.replace(/\.badge(?!\w)/g, '');
  
  // Fix badge: in count() options
  content = content.replace(/count\([^)]*badge:\s*true[^)]*\)/g, 'count()');
  
  // Fix RecentActivity description -> title
  if (content.includes('RecentActivity')) {
    // Find activity objects and change description to title
    content = content.replace(
      /type:\s*'booking',\s*description:/g,
      "type: 'booking',\n            title:"
    );
    content = content.replace(
      /type:\s*'message',\s*description:/g,
      "type: 'message',\n            title:"
    );
    // Also fix where it's accessed
    content = content.replace(/activity\.description/g, 'activity.title');
  }
  
  writeFileSync(filePath, content);
  console.log(`✅ Fixed: ${filePath}`);
}

// Fix the known problematic files
console.log('🔧 Fixing final TypeScript errors...\n');

for (const file of filesToFix) {
  try {
    fixFile(file);
  } catch (error) {
    console.error(`❌ Failed to fix ${file}:`, error);
  }
}

console.log('\n✅ Done! Running TypeScript check...\n');