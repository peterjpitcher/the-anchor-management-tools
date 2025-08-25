#!/usr/bin/env tsx

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

interface FileMove {
  from: string;
  to: string;
  type: 'move' | 'rename' | 'delete';
  reason: string;
}

const fileMoves: FileMove[] = [
  // Delete temporary and log files
  {
    from: 'discovery-20250626-033942.log',
    to: '',
    type: 'delete',
    reason: 'Temporary discovery log'
  },
  {
    from: 'discovery-20250626-081117.log',
    to: '',
    type: 'delete',
    reason: 'Temporary discovery log'
  },
  {
    from: 'discovery-20250626-112322.log',
    to: '',
    type: 'delete',
    reason: 'Temporary discovery log'
  },
  {
    from: 'discovery-20250626-130151.log',
    to: '',
    type: 'delete',
    reason: 'Temporary discovery log'
  },
  {
    from: 'discovery-20250626-142907.log',
    to: '',
    type: 'delete',
    reason: 'Temporary discovery log'
  },
  {
    from: 'lint-output.txt',
    to: '',
    type: 'delete',
    reason: 'Temporary lint output'
  },
  {
    from: 'lint-results.txt',
    to: '',
    type: 'delete',
    reason: 'Temporary lint output'
  },
  {
    from: 'build-analysis.txt',
    to: '',
    type: 'delete',
    reason: 'Temporary build analysis'
  },
  {
    from: 'analyze-output.txt',
    to: '',
    type: 'delete',
    reason: 'Temporary analysis output'
  },
  {
    from: '.DS_Store',
    to: '',
    type: 'delete',
    reason: 'macOS system file'
  },
  {
    from: 'public/.DS_Store',
    to: '',
    type: 'delete',
    reason: 'macOS system file'
  },
  
  // Fix naming conventions
  {
    from: 'docs/SMS Templates',
    to: 'docs/sms-templates',
    type: 'rename',
    reason: 'Remove space from directory name'
  },
  {
    from: 'supabase/dumps/2025-05-17-Schame.sql',
    to: 'supabase/dumps/2025-05-17-schema.sql',
    type: 'rename',
    reason: 'Fix typo: Schame -> schema'
  },
  {
    from: 'supabase/dumps/2025-05-17a-Schame.sql',
    to: 'supabase/dumps/2025-05-17a-schema.sql',
    type: 'rename',
    reason: 'Fix typo: Schame -> schema'
  },
  {
    from: 'supabase/dumps/2025-06-18-Schema.sql',
    to: 'supabase/dumps/2025-06-18-schema.sql',
    type: 'rename',
    reason: 'Standardize casing to lowercase'
  },
  {
    from: 'public/README_LOGO.md',
    to: 'public/logo-readme.md',
    type: 'rename',
    reason: 'Follow kebab-case convention for documentation'
  },
  {
    from: 'supabase/migrations/archive_20250625/already run',
    to: 'supabase/migrations/archive_20250625/already-run',
    type: 'rename',
    reason: 'Remove space from directory name'
  },
  
  // Move SQL files to appropriate locations
  {
    from: 'add_reminder_logging.sql',
    to: 'supabase/sql-scripts/add_reminder_logging.sql',
    type: 'move',
    reason: 'SQL utility script belongs in dedicated directory'
  },
  {
    from: 'check_booking_discount.sql',
    to: 'supabase/sql-scripts/check_booking_discount.sql',
    type: 'move',
    reason: 'SQL utility script belongs in dedicated directory'
  },
  {
    from: 'check_phone_formats.sql',
    to: 'supabase/sql-scripts/check_phone_formats.sql',
    type: 'move',
    reason: 'SQL utility script belongs in dedicated directory'
  },
  {
    from: 'debug_reminder_system.sql',
    to: 'supabase/sql-scripts/debug_reminder_system.sql',
    type: 'move',
    reason: 'SQL utility script belongs in dedicated directory'
  },
  {
    from: 'fix_reminder_timing_function.sql',
    to: 'supabase/sql-scripts/fix_reminder_timing_function.sql',
    type: 'move',
    reason: 'SQL utility script belongs in dedicated directory'
  },
  {
    from: 'schema-updated.sql',
    to: 'supabase/dumps/schema-updated.sql',
    type: 'move',
    reason: 'Schema dump belongs with other dumps'
  },
  {
    from: 'data.sql',
    to: 'supabase/dumps/data.sql',
    type: 'move',
    reason: 'Data dump belongs with other dumps'
  },
  {
    from: 'schema.sql',
    to: 'supabase/dumps/schema.sql',
    type: 'move',
    reason: 'Schema dump belongs with other dumps'
  },
  {
    from: 'backup_20250625_223155.sql',
    to: 'supabase/backups/backup_20250625_223155.sql',
    type: 'move',
    reason: 'Backup file belongs in dedicated directory'
  }
];

async function ensureDirectory(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error(`Error creating directory ${dirPath}:`, error);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function executeMove(move: FileMove) {
  const fromPath = path.join(projectRoot, move.from);
  const toPath = move.to ? path.join(projectRoot, move.to) : '';
  
  if (!(await fileExists(fromPath))) {
    console.log(`⚠️  Skipping: ${move.from} (file not found)`);
    return;
  }
  
  try {
    switch (move.type) {
      case 'delete':
        await fs.unlink(fromPath);
        console.log(`🗑️  Deleted: ${move.from}`);
        console.log(`   Reason: ${move.reason}`);
        break;
        
      case 'rename':
        await fs.rename(fromPath, toPath);
        console.log(`✏️  Renamed: ${move.from} → ${move.to}`);
        console.log(`   Reason: ${move.reason}`);
        break;
        
      case 'move':
        // Ensure target directory exists
        await ensureDirectory(path.dirname(toPath));
        await fs.rename(fromPath, toPath);
        console.log(`📦 Moved: ${move.from} → ${move.to}`);
        console.log(`   Reason: ${move.reason}`);
        break;
    }
  } catch (error) {
    console.error(`❌ Error processing ${move.from}:`, error);
  }
}

async function main() {
  console.log('🧹 Starting file structure reorganization...\n');
  
  // Create necessary directories
  const directoriesToCreate = [
    'supabase/sql-scripts',
    'supabase/backups',
    'documentation',
    'docs/sms-templates'
  ];
  
  for (const dir of directoriesToCreate) {
    await ensureDirectory(path.join(projectRoot, dir));
  }
  
  // Execute all moves
  let deleteCount = 0;
  let renameCount = 0;
  let moveCount = 0;
  
  for (const move of fileMoves) {
    await executeMove(move);
    if (move.type === 'delete') deleteCount++;
    if (move.type === 'rename') renameCount++;
    if (move.type === 'move') moveCount++;
  }
  
  // Update .gitignore if needed
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
  const linesToAdd: string[] = [];
  
  if (!gitignoreContent.includes('discovery-*.log')) {
    linesToAdd.push('discovery-*.log');
  }
  if (!gitignoreContent.includes('lint-*.txt')) {
    linesToAdd.push('lint-*.txt');
  }
  if (!gitignoreContent.includes('*-analysis.txt')) {
    linesToAdd.push('*-analysis.txt');
  }
  if (!gitignoreContent.includes('analyze-*.txt')) {
    linesToAdd.push('analyze-*.txt');
  }
  
  if (linesToAdd.length > 0) {
    const updatedGitignore = gitignoreContent.trimEnd() + '\n\n# Temporary analysis files\n' + linesToAdd.join('\n') + '\n';
    await fs.writeFile(gitignorePath, updatedGitignore);
    console.log('\n✅ Updated .gitignore with temporary file patterns');
  }
  
  // Generate summary report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(projectRoot, 'documentation', `reorganization-report-${timestamp}.md`);
  
  const report = `# File Structure Reorganization Report

## Date: ${new Date().toISOString()}

## Summary
- Files deleted: ${deleteCount}
- Files renamed: ${renameCount}
- Files moved: ${moveCount}
- Total operations: ${fileMoves.length}

## Operations Performed

${fileMoves.map(move => {
    switch (move.type) {
      case 'delete':
        return `### Deleted: ${move.from}\n- Reason: ${move.reason}`;
      case 'rename':
        return `### Renamed: ${move.from} → ${move.to}\n- Reason: ${move.reason}`;
      case 'move':
        return `### Moved: ${move.from} → ${move.to}\n- Reason: ${move.reason}`;
    }
  }).join('\n\n')}

## New Directory Structure
- \`supabase/sql-scripts/\` - SQL utility scripts
- \`supabase/backups/\` - Database backup files
- \`docs/sms-templates/\` - SMS template exports (renamed from "SMS Templates")

## Git Commands
\`\`\`bash
# Stage all changes
git add -A

# Commit with detailed message
git commit -m "refactor: reorganize file structure and fix naming conventions

- Delete temporary log and analysis files
- Fix directory names with spaces (SMS Templates → sms-templates)
- Fix typos in SQL dump filenames (Schame → schema)
- Standardize SQL dump naming to lowercase
- Move SQL scripts from root to organized directories
- Update .gitignore for temporary files

See documentation/reorganization-report-${timestamp}.md for details"
\`\`\`
`;
  
  await fs.writeFile(reportPath, report);
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Reorganization complete!');
  console.log('\n📊 Summary:');
  console.log(`   - Deleted: ${deleteCount} files`);
  console.log(`   - Renamed: ${renameCount} files/directories`);
  console.log(`   - Moved: ${moveCount} files`);
  console.log(`\n📄 Report saved to: ${reportPath}`);
  console.log('\n⚠️  Next steps:');
  console.log('   1. Review the changes');
  console.log('   2. Run "npm run build" to verify everything works');
  console.log('   3. Commit the changes using the git commands in the report');
}

main().catch(console.error);