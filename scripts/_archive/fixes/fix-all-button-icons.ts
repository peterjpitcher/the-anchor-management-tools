#!/usr/bin/env tsx

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Simple pattern to replace icon= with leftIcon= 
const fix = {
  pattern: /\bicon=/g,
  replacement: 'leftIcon='
};

function processFile(filePath: string): boolean {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) {
    return false;
  }

  try {
    let content = readFileSync(filePath, 'utf-8');
    const originalContent = content;

    // Only replace if the file contains Button or LinkButton components
    if (content.includes('<Button') || content.includes('<LinkButton')) {
      content = content.replace(fix.pattern, fix.replacement);
      
      if (content !== originalContent) {
        writeFileSync(filePath, content);
        console.log(`Fixed in ${filePath}`);
        return true;
      }
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
console.log('Fixing all remaining Button icon props...');
const fixedFiles = processDirectory(srcDir);
console.log(`\nFixed ${fixedFiles} files.`);