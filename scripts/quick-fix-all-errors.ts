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
  
  // Fix 1: Alert message prop -> children
  // Handle both {expression} and "string" formats
  content = content.replace(
    /(<Alert[^>]*?)message=(\{[^}]+\}|"[^"]+")([^>]*>)(\s*)(.*?)(<\/Alert>)/gs,
    (match, before, messageValue, afterProps, whitespace, existingChildren, closing) => {
      // Remove quotes if it's a string literal
      const cleanValue = messageValue.startsWith('"') ? messageValue.slice(1, -1) : messageValue;
      
      // If there are existing children, append the message
      if (existingChildren.trim()) {
        return `${before}${afterProps}${whitespace}${existingChildren}\n            ${cleanValue}${closing}`;
      } else {
        return `${before}${afterProps}${cleanValue}${closing}`;
      }
    }
  );
  
  // Fix 2: CollapsibleSection message -> description
  content = content.replace(/(<CollapsibleSection[^>]*?)message=/g, '$1description=');
  
  // Fix 3: CollapsibleSection leftIcon -> icon
  content = content.replace(/(<CollapsibleSection[^>]*?)leftIcon=/g, '$1icon=');
  
  // Fix 4: Button icon -> leftIcon (careful not to affect IconButton)
  content = content.replace(/(<Button[^>]*?)icon=/g, '$1leftIcon=');
  
  // Fix 5: Modal isOpen -> open
  content = content.replace(/(<Modal[^>]*?)isOpen=/g, '$1open=');
  
  // Fix 6: ConfirmDialog description -> message
  content = content.replace(/(<ConfirmDialog[^>]*?)description=/g, '$1message=');
  
  // Fix 7: ConfirmDialog isOpen -> open
  content = content.replace(/(<ConfirmDialog[^>]*?)isOpen=/g, '$1open=');
  
  // Fix 8: FormGroup hint/helperText -> help
  content = content.replace(/(<FormGroup[^>]*?)hint=/g, '$1help=');
  content = content.replace(/(<FormGroup[^>]*?)helperText=/g, '$1help=');
  
  // Fix 9: SearchInput onChange -> onSearch
  content = content.replace(/(<SearchInput[^>]*?)onChange=/g, '$1onSearch=');
  
  // Fix 10: Badge size="xs" -> size="sm"
  content = content.replace(/(<Badge[^>]*?size=)"xs"/g, '$1"sm"');
  
  // Fix 11: Badge variant="destructive" -> variant="error"
  content = content.replace(/(<Badge[^>]*?variant=)"destructive"/g, '$1"error"');
  
  // Fix 12: TabNav items -> tabs AND count -> badge
  content = content.replace(/(<TabNav[^>]*?)items=\{/g, '$1tabs={');
  content = content.replace(/count:\s*(\d+|[^,}]+)/g, 'badge: $1');
  
  // Fix 13: Tabs tabs -> items AND id -> key
  content = content.replace(/(<Tabs[^>]*?)tabs=\{/g, '$1items={');
  content = content.replace(/(\{\s*)id:\s*(['"`])([^'"`]+)\2/g, '$1key: $2$3$2');
  
  // Fix 14: Checkbox onChange signature
  content = content.replace(
    /onChange=\{(\(checked\))\s*=>\s*/g,
    'onChange={(e) => '
  );
  // Update references to 'checked' to 'e.target.checked'
  content = content.replace(
    /onChange=\{\(e\)\s*=>\s*([^}]*)\bchecked\b/g,
    'onChange={(e) => $1e.target.checked'
  );
  
  if (content !== originalContent) {
    writeFileSync(filePath, content);
    return true;
  }
  
  return false;
}

async function main() {
  console.log('🚀 Ultra-Fast TypeScript Error Fix Tool');
  console.log('=====================================\n');
  
  console.log('📂 Scanning for TypeScript files...');
  const files = getAllFiles('src');
  console.log(`📋 Found ${files.length} files to check\n`);
  
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
  
  if (fixedFiles.length > 0) {
    console.log('\n📝 Files that were modified:');
    fixedFiles.forEach(f => console.log(`  - ${f}`));
  }
  
  console.log('\n🔍 Running build to check remaining errors...\n');
}

main().catch(console.error);