#!/usr/bin/env tsx

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

function getAllFiles(dir: string, extension: string[] = ['.ts', '.tsx']): string[] {
  const files: string[] = [];
  
  function walk(currentDir: string) {
    const entries = readdirSync(currentDir);
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (!entry.includes('node_modules') && !entry.startsWith('.')) {
          walk(fullPath);
        }
      } else if (extension.some(ext => entry.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

function fixFile(filePath: string): boolean {
  let content = readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  // Fix 1: Page component message -> description
  content = content.replace(/(<Page[^>]*?)message=/g, '$1description=');
  
  // Fix 2: EmptyState message -> description
  content = content.replace(/(<EmptyState[^>]*?)message=/g, '$1description=');
  
  // Fix 3: Section component message -> description
  content = content.replace(/(<Section[^>]*?)message=/g, '$1description=');
  
  // Fix 4: Button/LinkButton variant="bordered" -> variant="secondary"
  content = content.replace(/(<(?:Button|LinkButton|IconButton)[^>]*?variant=)"bordered"/g, '$1"secondary"');
  
  // Fix 5: Badge variant="bordered" -> variant="secondary"
  content = content.replace(/(<Badge[^>]*?variant=)"bordered"/g, '$1"secondary"');
  
  // Fix 6: StatsCard leftIcon -> icon
  content = content.replace(/(<StatsCard[^>]*?)leftIcon=/g, '$1icon=');
  
  // Fix 7: Remove .badge from Supabase query results
  content = content.replace(/\.badge\b/g, '');
  
  // Fix 8: In TabNav tab objects, rename 'key' to 'id'
  // This is more complex, needs careful regex
  if (content.includes('TabNav') && content.includes('tabs={[')) {
    // Find TabNav tabs arrays and fix key -> id
    content = content.replace(
      /tabs=\{(\[[^\]]*\])\}/g,
      (match, arrayContent) => {
        const fixedArray = arrayContent.replace(/\bkey:/g, 'id:');
        return `tabs={${fixedArray}}`;
      }
    );
  }
  
  // Fix 9: Checkbox double e.target.checked
  content = content.replace(/e\.target\.e\.target\.checked/g, 'e.target.checked');
  
  // Fix 10: Activity items key -> id
  if (content.includes('activity') || content.includes('Activity')) {
    // In activity arrays, rename key to id
    content = content.replace(
      /(\{[^}]*?)key:\s*(['"`][^'"`]+['"`]|[^,}]+)([^}]*\})/g,
      (match, before, value, after) => {
        // Only replace if it looks like an activity object
        if (match.includes('type:') || match.includes('title:') || match.includes('timestamp:')) {
          return `${before}id: ${value}${after}`;
        }
        return match;
      }
    );
  }
  
  if (content !== originalContent) {
    writeFileSync(filePath, content);
    return true;
  }
  
  return false;
}

async function main() {
  console.log('🚀 Final TypeScript Error Fix\n');
  console.log('Fixing remaining patterns...\n');
  
  const files = getAllFiles('src');
  let fixedCount = 0;
  const fixedFiles: string[] = [];
  
  for (const file of files) {
    if (fixFile(file)) {
      fixedCount++;
      fixedFiles.push(file);
      console.log(`✅ Fixed: ${file}`);
    }
  }
  
  console.log(`\n🎉 Fixed ${fixedCount} files!`);
  
  console.log('\n🔍 Running final build check...\n');
}

main().catch(console.error);