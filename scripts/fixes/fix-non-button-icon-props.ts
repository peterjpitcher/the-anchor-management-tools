#!/usr/bin/env tsx

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Components that use icon, not leftIcon
const componentsWithIcon = ['Alert', 'EmptyState', 'Stat', 'Badge', 'Dropdown'];

function processFile(filePath: string): boolean {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) {
    return false;
  }

  try {
    let content = readFileSync(filePath, 'utf-8');
    let modified = false;

    // For each component that uses icon (not leftIcon)
    for (const component of componentsWithIcon) {
      const pattern = new RegExp(`<${component}\\s+([^>]*?)leftIcon=`, 'g');
      const replacement = `<${component} $1icon=`;
      
      const originalContent = content;
      content = content.replace(pattern, replacement);
      
      if (content !== originalContent) {
        modified = true;
        console.log(`Fixed ${component} in ${filePath}`);
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
console.log('Fixing non-Button component icon props...');
const fixedFiles = processDirectory(srcDir);
console.log(`\nFixed ${fixedFiles} files.`);