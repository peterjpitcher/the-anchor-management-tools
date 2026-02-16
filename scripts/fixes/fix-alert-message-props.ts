#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import * as path from 'path';

async function fixAlertMessageProps() {
  console.log('🔧 Fixing Alert message props...');
  
  // Find all TypeScript/TSX files
  const files = await glob('src/**/*.{ts,tsx}', {
    ignore: ['**/node_modules/**', '**/build/**', '**/dist/**']
  });
  
  let totalFixed = 0;
  
  for (const file of files) {
    let content = readFileSync(file, 'utf8');
    let modified = false;
    
    // Pattern 1: Alert with message prop - convert to children
    // Match <Alert ... message={...} ...>
    const alertMessagePattern = /(<Alert[^>]*?)message=\{([^}]+)\}([^>]*>)/g;
    if (alertMessagePattern.test(content)) {
      content = content.replace(alertMessagePattern, (match, before, messageContent, after) => {
        modified = true;
        // If there's already content after the tag, we need to be careful
        const closingTag = '</Alert>';
        const afterTagIndex = content.indexOf(after) + after.length;
        const closingTagIndex = content.indexOf(closingTag, afterTagIndex);
        
        if (closingTagIndex !== -1) {
          const existingContent = content.substring(afterTagIndex, closingTagIndex).trim();
          if (existingContent) {
            // There's already content, append the message
            return `${before}${after}\n            {${messageContent}}`;
          } else {
            // No existing content, just add the message
            return `${before}${after}{${messageContent}}`;
          }
        }
        return match; // Fallback if we can't find closing tag
      });
    }
    
    // Pattern 2: Alert with message prop as string - convert to children
    const alertMessageStringPattern = /(<Alert[^>]*?)message="([^"]+)"([^>]*>)/g;
    if (alertMessageStringPattern.test(content)) {
      content = content.replace(alertMessageStringPattern, (match, before, messageContent, after) => {
        modified = true;
        return `${before}${after}${messageContent}`;
      });
    }
    
    if (modified) {
      writeFileSync(file, content);
      console.log(`✅ Fixed: ${file}`);
      totalFixed++;
    }
  }
  
  console.log(`\n🎉 Fixed ${totalFixed} files with Alert message props`);
}

// Also fix CollapsibleSection props while we're at it
async function fixCollapsibleSectionProps() {
  console.log('\n🔧 Fixing CollapsibleSection props...');
  
  const files = await glob('src/**/*.{ts,tsx}', {
    ignore: ['**/node_modules/**', '**/build/**', '**/dist/**']
  });
  
  let totalFixed = 0;
  
  for (const file of files) {
    let content = readFileSync(file, 'utf8');
    let modified = false;
    
    // Fix message -> description
    if (content.includes('<CollapsibleSection') && content.includes('message=')) {
      content = content.replace(/(<CollapsibleSection[^>]*?)message=/g, '$1description=');
      modified = true;
    }
    
    // Fix leftIcon -> icon
    if (content.includes('<CollapsibleSection') && content.includes('leftIcon=')) {
      content = content.replace(/(<CollapsibleSection[^>]*?)leftIcon=/g, '$1icon=');
      modified = true;
    }
    
    if (modified) {
      writeFileSync(file, content);
      console.log(`✅ Fixed: ${file}`);
      totalFixed++;
    }
  }
  
  console.log(`\n🎉 Fixed ${totalFixed} files with CollapsibleSection props`);
}

async function main() {
  console.log('🚀 Smart TypeScript Fix Tool');
  console.log('===========================\n');
  
  await fixAlertMessageProps();
  await fixCollapsibleSectionProps();
  
  console.log('\n✅ All fixes completed!');
  console.log('🔍 Run npm run build to check for remaining errors');
}

main().catch((error) => { console.error(error); process.exitCode = 1 });