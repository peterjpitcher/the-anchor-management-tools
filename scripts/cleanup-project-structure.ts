#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const DRY_RUN = process.argv.includes('--dry-run');

interface CleanupAction {
  type: 'delete' | 'move';
  source: string;
  destination?: string;
  reason: string;
}

const actions: CleanupAction[] = [];

// Temporary files to delete
const tempFiles = [
  'discovery-20250625-201556.log',
  'discovery-20250625-205316.log',
  'discovery-20250626-085614.log',
  'discovery-20250626-085635.log',
  'discovery-20250626-095148.log',
  'eslint-output.txt',
  'full-lint.log',
  'lint-unused.txt',
  'security-analysis-20250626-094153.log'
];

// SQL files to organize
const sqlFilesToMove = [
  { file: 'add_reminder_logging.sql', dest: 'supabase/sql-archive/' },
  { file: 'backup_20250625_223155.sql', dest: 'supabase/backups/' },
  { file: 'check_booking_discount.sql', dest: 'supabase/sql-archive/' },
  { file: 'check_phone_formats.sql', dest: 'supabase/sql-archive/' },
  { file: 'data.sql', dest: 'supabase/dumps/' },
  { file: 'debug_reminder_system.sql', dest: 'supabase/sql-archive/' },
  { file: 'fix_reminder_timing_function.sql', dest: 'supabase/sql-archive/' },
  { file: 'schema-updated.sql', dest: 'supabase/dumps/' },
  { file: 'schema.sql', dest: 'supabase/dumps/' }
];

// Add temporary files to delete
tempFiles.forEach(file => {
  if (fs.existsSync(file)) {
    actions.push({
      type: 'delete',
      source: file,
      reason: 'Temporary log/output file'
    });
  }
});

// Add SQL files to move
sqlFilesToMove.forEach(({ file, dest }) => {
  if (fs.existsSync(file)) {
    actions.push({
      type: 'move',
      source: file,
      destination: path.join(dest, file),
      reason: 'SQL file in root directory'
    });
  }
});

// Check for other cleanup opportunities
function checkAdditionalCleanup() {
  // Check for .DS_Store files
  const findDSStore = execSync('find . -name ".DS_Store" -not -path "./node_modules/*" -not -path "./.git/*"', { encoding: 'utf8' });
  findDSStore.split('\n').filter(Boolean).forEach(file => {
    actions.push({
      type: 'delete',
      source: file,
      reason: 'macOS system file'
    });
  });

  // Check for editor backup files
  const patterns = ['*.swp', '*.swo', '*.bak', '*.orig', '*~'];
  patterns.forEach(pattern => {
    try {
      const files = execSync(`find . -name "${pattern}" -not -path "./node_modules/*" -not -path "./.git/*"`, { encoding: 'utf8' });
      files.split('\n').filter(Boolean).forEach(file => {
        actions.push({
          type: 'delete',
          source: file,
          reason: 'Editor backup/temporary file'
        });
      });
    } catch (e) {
      // No files found
    }
  });
}

// Execute cleanup actions
function executeCleanup() {
  console.log(`Found ${actions.length} items to clean up\n`);

  if (actions.length === 0) {
    console.log('✅ Project structure is already clean!');
    return;
  }

  // Group actions by type
  const deleteActions = actions.filter(a => a.type === 'delete');
  const moveActions = actions.filter(a => a.type === 'move');

  if (deleteActions.length > 0) {
    console.log(`\n📝 Files to delete (${deleteActions.length}):`);
    deleteActions.forEach(action => {
      console.log(`  - ${action.source} (${action.reason})`);
    });
  }

  if (moveActions.length > 0) {
    console.log(`\n📂 Files to move (${moveActions.length}):`);
    moveActions.forEach(action => {
      console.log(`  - ${action.source} → ${action.destination} (${action.reason})`);
    });
  }

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be made');
    console.log('Run without --dry-run to execute cleanup');
    return;
  }

  console.log('\n🔧 Executing cleanup...\n');

  // Create necessary directories
  const dirsToCreate = new Set<string>();
  moveActions.forEach(action => {
    if (action.destination) {
      dirsToCreate.add(path.dirname(action.destination));
    }
  });

  dirsToCreate.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });

  // Execute moves
  moveActions.forEach(action => {
    try {
      if (action.destination) {
        fs.renameSync(action.source, action.destination);
        console.log(`✅ Moved: ${action.source} → ${action.destination}`);
      }
    } catch (error) {
      console.error(`❌ Failed to move ${action.source}: ${error}`);
    }
  });

  // Execute deletes
  deleteActions.forEach(action => {
    try {
      fs.unlinkSync(action.source);
      console.log(`✅ Deleted: ${action.source}`);
    } catch (error) {
      console.error(`❌ Failed to delete ${action.source}: ${error}`);
    }
  });

  console.log('\n✨ Cleanup complete!');
}

// Generate cleanup report
function generateReport() {
  const timestamp = new Date().toISOString();
  const report = `# Project Cleanup Report
Generated: ${timestamp}

## Summary
- Files to delete: ${actions.filter(a => a.type === 'delete').length}
- Files to move: ${actions.filter(a => a.type === 'move').length}
- Total actions: ${actions.length}

## Actions

### Files to Delete
${actions.filter(a => a.type === 'delete').map(a => `- ${a.source} (${a.reason})`).join('\n')}

### Files to Move
${actions.filter(a => a.type === 'move').map(a => `- ${a.source} → ${a.destination} (${a.reason})`).join('\n')}

## Recommendations

1. **Regular Cleanup**: Run this script periodically to keep the project organized
2. **Git Ignore**: Ensure temporary files are in .gitignore
3. **SQL Organization**: Keep SQL files in appropriate subdirectories
4. **Documentation**: Update docs when moving files

## Next Steps

1. Review the actions above
2. Run \`tsx scripts/cleanup-project-structure.ts\` to execute cleanup
3. Commit the changes with a descriptive message
`;

  const reportPath = `documentation/cleanup-report-${Date.now()}.md`;
  fs.writeFileSync(reportPath, report);
  console.log(`\n📄 Cleanup report saved to: ${reportPath}`);
}

// Main execution
console.log('🔍 Analyzing project structure for cleanup...\n');

checkAdditionalCleanup();

if (process.argv.includes('--report')) {
  generateReport();
} else {
  executeCleanup();
}