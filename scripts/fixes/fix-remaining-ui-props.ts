#!/usr/bin/env tsx

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Patterns to fix
const fixes = [
  // Stat component: leftIcon -> icon
  {
    pattern: /<Stat\s+([^>]*?)leftIcon=/g,
    replacement: '<Stat $1icon='
  },
  // Any component with leftIcon in JSX
  {
    pattern: /(\s+)leftIcon={/g,
    replacement: '$1icon={'
  },
  // Fix EmptyState that was missed
  {
    pattern: /<EmptyState\s+([^>]*?)message=/g,
    replacement: '<EmptyState $1description='
  }
];

function processFile(filePath: string): boolean {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) {
    return false;
  }

  try {
    let content = readFileSync(filePath, 'utf-8');
    let modified = false;

    for (const fix of fixes) {
      const originalContent = content;
      content = content.replace(fix.pattern, fix.replacement);
      if (content !== originalContent) {
        modified = true;
        console.log(`Fixed in ${filePath}: ${fix.pattern}`);
      }
    }

    if (modified) {
      writeFileSync(filePath, content);
      return true;
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }

  return false;
}

function processDirectory(dir: string): number {
  let fixedCount = 0;

  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and other non-source directories
      if (!item.startsWith('.') && item !== 'node_modules' && item !== 'build' && item !== 'dist') {
        fixedCount += processDirectory(fullPath);
      }
    } else if (stat.isFile()) {
      if (processFile(fullPath)) {
        fixedCount++;
      }
    }
  }

  return fixedCount;
}

// Process the src directory
const srcDir = join(process.cwd(), 'src');
console.log('Fixing remaining UI component prop issues...');
const fixedFiles = processDirectory(srcDir);
console.log(`\nFixed ${fixedFiles} files.`);