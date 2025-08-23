#!/usr/bin/env tsx

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Patterns to fix
const fixes = [
  // Alert component: message -> description
  {
    pattern: /<Alert\s+([^>]*?)message=/g,
    replacement: '<Alert $1description='
  },
  // EmptyState component: leftIcon -> icon
  {
    pattern: /<EmptyState\s+([^>]*?)leftIcon=/g,
    replacement: '<EmptyState $1icon='
  },
  // EmptyState component: message -> description
  {
    pattern: /<EmptyState\s+([^>]*?)message=/g,
    replacement: '<EmptyState $1description='
  },
  // Badge component: leftIcon -> icon
  {
    pattern: /<Badge\s+([^>]*?)leftIcon=/g,
    replacement: '<Badge $1icon='
  },
  // Button/LinkButton variant: "bordered" -> "secondary"
  {
    pattern: /variant="bordered"/g,
    replacement: 'variant="secondary"'
  },
  // TabNav: id -> key in tab items
  {
    pattern: /\{\s*id:\s*'([^']+)'/g,
    replacement: '{ key: \'$1\''
  },
  // TabNav: id -> key (with double quotes)
  {
    pattern: /\{\s*id:\s*"([^"]+)"/g,
    replacement: '{ key: "$1"'
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
console.log('Starting UI component prop fixes...');
const fixedFiles = processDirectory(srcDir);
console.log(`\nFixed ${fixedFiles} files.`);