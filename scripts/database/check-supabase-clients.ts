#!/usr/bin/env node
/**
 * Script to check for duplicate Supabase client creations in the codebase
 * This helps identify where clients are being created outside of the SupabaseProvider
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const IGNORE_DIRS = ['node_modules', '.git', '.next', 'dist', 'build'];
const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

interface ClientUsage {
  file: string;
  line: number;
  type: 'direct-import' | 'createClient' | 'useSupabase';
  context: string;
}

const usages: ClientUsage[] = [];

function checkFile(filePath: string) {
  if (!FILE_EXTENSIONS.some(ext => filePath.endsWith(ext))) return;
  
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    // Check for direct imports from lib/supabase
    if (line.match(/import.*from\s+['"]@\/lib\/supabase['"]|import.*from\s+['"]\.\..*\/lib\/supabase['"]/)) {
      usages.push({
        file: filePath,
        line: index + 1,
        type: 'direct-import',
        context: line.trim()
      });
    }
    
    // Check for createClient calls
    if (line.includes('createClient') && !line.includes('createServerComponentClient') && !line.includes('createClientComponentClient')) {
      usages.push({
        file: filePath,
        line: index + 1,
        type: 'createClient',
        context: line.trim()
      });
    }
    
    // Check for useSupabase usage (good pattern)
    if (line.includes('useSupabase()')) {
      usages.push({
        file: filePath,
        line: index + 1,
        type: 'useSupabase',
        context: line.trim()
      });
    }
  });
}

function walkDir(dir: string) {
  const files = readdirSync(dir);
  
  files.forEach(file => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    
    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.includes(file)) {
        walkDir(filePath);
      }
    } else {
      checkFile(filePath);
    }
  });
}

// Start from src directory
const srcPath = join(process.cwd(), 'src');
walkDir(srcPath);

// Group by type
const directImports = usages.filter(u => u.type === 'direct-import');
const createClientCalls = usages.filter(u => u.type === 'createClient');
const useSupabaseCalls = usages.filter(u => u.type === 'useSupabase');

console.log('=== Supabase Client Usage Analysis ===\n');

if (directImports.length > 0) {
  console.log(`❌ Found ${directImports.length} direct imports from lib/supabase (should use useSupabase hook):`);
  directImports.forEach(usage => {
    console.log(`   ${usage.file}:${usage.line}`);
    console.log(`   → ${usage.context}\n`);
  });
}

if (createClientCalls.length > 0) {
  console.log(`⚠️  Found ${createClientCalls.length} createClient calls:`);
  createClientCalls.forEach(usage => {
    console.log(`   ${usage.file}:${usage.line}`);
    console.log(`   → ${usage.context}\n`);
  });
}

console.log(`✅ Found ${useSupabaseCalls.length} proper useSupabase() hook usages\n`);

// Recommendations
if (directImports.length > 0) {
  console.log('📋 Recommendations:');
  console.log('1. Replace direct imports with useSupabase hook in client components');
  console.log('2. Example fix:');
  console.log('   // Instead of:');
  console.log('   import { supabase } from "@/lib/supabase"');
  console.log('   ');
  console.log('   // Use:');
  console.log('   import { useSupabase } from "@/components/providers/SupabaseProvider"');
  console.log('   const supabase = useSupabase();');
}