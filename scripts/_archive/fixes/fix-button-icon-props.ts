#!/usr/bin/env tsx

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Pattern to fix Button and LinkButton components back to leftIcon
const fixes = [
  // Fix Button components
  {
    pattern: /<Button\s+([^>]*?)icon={/g,
    replacement: '<Button $1leftIcon={'
  },
  // Fix LinkButton components
  {
    pattern: /<LinkButton\s+([^>]*?)icon={/g,
    replacement: '<LinkButton $1leftIcon={'
  },
  // Fix multiline Button
  {
    pattern: /(\s+)icon={\s*([^}]+)\s*}/g,
    match: (line: string) => line.includes('Button') && !line.includes('Stat'),
    replacement: '$1leftIcon={$2}'
  }
];

function processFile(filePath: string): boolean {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) {
    return false;
  }

  try {
    let content = readFileSync(filePath, 'utf-8');
    let modified = false;

    // Apply simple regex fixes
    for (const fix of fixes.slice(0, 2)) {
      const originalContent = content;
      content = content.replace(fix.pattern as RegExp, fix.replacement);
      if (content !== originalContent) {
        modified = true;
        console.log(`Fixed in ${filePath}: ${fix.pattern}`);
      }
    }

    // Apply line-by-line fix for multiline
    const lines = content.split('\n');
    const modifiedLines: string[] = [];
    let inButtonComponent = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if we're starting a Button or LinkButton component
      if (line.includes('<Button') || line.includes('<LinkButton')) {
        inButtonComponent = true;
      }
      
      // Check if we're ending a component
      if (inButtonComponent && (line.includes('/>') || line.includes('</Button') || line.includes('</LinkButton'))) {
        inButtonComponent = false;
      }
      
      // Apply fix if we're in a Button component and line has icon=
      if (inButtonComponent && line.includes('icon={') && !line.includes('Stat')) {
        const modifiedLine = line.replace(/(\s+)icon={/, '$1leftIcon={');
        if (modifiedLine !== line) {
          modified = true;
          console.log(`Fixed multiline in ${filePath}`);
        }
        modifiedLines.push(modifiedLine);
      } else {
        modifiedLines.push(line);
      }
    }

    if (modified) {
      content = modifiedLines.join('\n');
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
console.log('Fixing Button icon props...');
const fixedFiles = processDirectory(srcDir);
console.log(`\nFixed ${fixedFiles} files.`);