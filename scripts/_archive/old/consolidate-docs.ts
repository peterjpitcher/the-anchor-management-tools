#!/usr/bin/env tsx

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');

interface ConsolidationPlan {
  targetFile: string;
  sourceFiles: string[];
  description: string;
}

const consolidationPlans: ConsolidationPlan[] = [
  {
    targetFile: '2025-06-26-api-documentation.md',
    sourceFiles: [
      'api-reference.md',
      'api-index.md',
      'api-public-documentation.md',
      'api-quick-reference.md',
      'api-integration-guide.md',
      'api-troubleshooting.md'
    ],
    description: 'Comprehensive API Documentation'
  },
  {
    targetFile: '2025-06-26-fixes-tracker.md',
    sourceFiles: [
      'fixes-required-overview.md',
      'fixes-completed-summary.md',
      'fixes-remaining-summary.md',
      'fixes-status-update.md',
      'fixes-critical-bugs.md',
      'fixes-database-schema.md',
      'fixes-eslint-issues.md',
      'fixes-form-fields.md',
      'fixes-typescript-types.md',
      'private-bookings-fixes-completed.md',
      'production-issues-and-resolutions.md',
      'production-issues-critical-for-launch.md',
      'production-issues-priority-list.md'
    ],
    description: 'Consolidated Fixes and Issues Tracker'
  },
  {
    targetFile: '2025-06-26-database-documentation.md',
    sourceFiles: [
      'database-schema.md',
      'database-field-usage-report.md',
      'database-schema-analysis-report.md',
      'private-bookings-field-mapping.md',
      'migration-cleanup-guide.md',
      'fixes-migration-guide.md'
    ],
    description: 'Complete Database Documentation'
  },
  {
    targetFile: '2025-06-26-deployment-guide.md',
    sourceFiles: [
      'deployment.md',
      'staging-deployment.md',
      'configuration.md',
      'vercel-environment-variables.md',
      'installation.md',
      'monitoring.md'
    ],
    description: 'Deployment and Configuration Guide'
  },
  {
    targetFile: '2025-06-26-developer-guide.md',
    sourceFiles: [
      'development.md',
      'architecture.md',
      'ai-assistant-guide.md',
      'testing-strategy.md',
      'troubleshooting.md'
    ],
    description: 'Developer Guide and Architecture'
  }
];

// Files to archive (not delete)
const filesToArchive = [
  'api-events-external.md', // Original planning document
  'APPLICATION_EVALUATION_REPORT.md',
  'FIXES_IMPLEMENTATION_PLAN.md',
  'FIXES_IMPLEMENTATION_PLAN_V2.md',
  'MIGRATION_RESET_NOTES.md'
];

// Directories to handle specially
const directoriesToPreserve = [
  'audit-reports', // Contains valuable audit findings
  'implementation-guides', // Keep as-is, well organized
  'security', // Important security docs
  'sms-templates', // JSON exports
  'user-flows' // User flow documentation
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

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    if (await fileExists(filePath)) {
      return await fs.readFile(filePath, 'utf-8');
    }
    return null;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return null;
  }
}

async function consolidateFiles(plan: ConsolidationPlan) {
  console.log(`\n📋 Consolidating: ${plan.targetFile}`);
  console.log(`   Description: ${plan.description}`);
  
  let consolidatedContent = `# ${plan.description}\n\n`;
  consolidatedContent += `**Generated on:** ${new Date().toISOString()}\n`;
  consolidatedContent += `**Consolidated from:** ${plan.sourceFiles.length} files\n\n`;
  consolidatedContent += `---\n\n`;
  
  let foundFiles = 0;
  
  for (const sourceFile of plan.sourceFiles) {
    const sourcePath = path.join(docsDir, sourceFile);
    const content = await readFileContent(sourcePath);
    
    if (content) {
      foundFiles++;
      // Extract title from first line if it's a heading
      const firstLine = content.split('\n')[0];
      const title = firstLine.startsWith('#') ? firstLine : `## ${sourceFile}`;
      
      consolidatedContent += `\n${title}\n\n`;
      consolidatedContent += `*Source: ${sourceFile}*\n\n`;
      consolidatedContent += content;
      consolidatedContent += `\n\n---\n\n`;
      
      console.log(`   ✓ Added: ${sourceFile}`);
    } else {
      console.log(`   ⚠️  Not found: ${sourceFile}`);
    }
  }
  
  if (foundFiles > 0) {
    const targetPath = path.join(docsDir, plan.targetFile);
    await fs.writeFile(targetPath, consolidatedContent);
    console.log(`   ✅ Created: ${plan.targetFile} (consolidated ${foundFiles} files)`);
    return foundFiles;
  } else {
    console.log(`   ❌ No source files found, skipping consolidation`);
    return 0;
  }
}

async function archiveFiles() {
  const archiveDir = path.join(docsDir, 'archive', '2025-06-26-consolidation');
  await ensureDirectory(archiveDir);
  
  console.log('\n📦 Archiving files...');
  
  // Archive all source files that were consolidated
  const allSourceFiles = new Set<string>();
  consolidationPlans.forEach(plan => {
    plan.sourceFiles.forEach(file => allSourceFiles.add(file));
  });
  
  // Add additional files to archive
  filesToArchive.forEach(file => allSourceFiles.add(file));
  
  let archivedCount = 0;
  
  for (const file of allSourceFiles) {
    const sourcePath = path.join(docsDir, file);
    const targetPath = path.join(archiveDir, file);
    
    if (await fileExists(sourcePath)) {
      // Ensure subdirectory exists if file has path
      const targetDir = path.dirname(targetPath);
      await ensureDirectory(targetDir);
      
      await fs.rename(sourcePath, targetPath);
      console.log(`   📁 Archived: ${file}`);
      archivedCount++;
    }
  }
  
  console.log(`   ✅ Archived ${archivedCount} files to archive/2025-06-26-consolidation/`);
}

async function renameExistingFiles() {
  console.log('\n🔄 Renaming existing files to YYYY-MM-DD format...');
  
  const files = await fs.readdir(docsDir);
  const today = '2025-06-26';
  let renamedCount = 0;
  
  const filesToRename = [
    { from: 'overview.md', to: `${today}-overview.md` },
    { from: 'README.md', to: `${today}-readme.md` },
    { from: 'style-guide.md', to: `${today}-style-guide.md` },
    { from: 'openapi.yaml', to: `${today}-openapi.yaml` },
    { from: 'rbac-permissions.md', to: `${today}-rbac-permissions.md` },
    { from: 'security-guidelines.md', to: `${today}-security-guidelines.md` },
    { from: 'gdpr-compliance.md', to: `${today}-gdpr-compliance.md` },
    { from: 'performance-analysis-report.md', to: `${today}-performance-analysis-report.md` },
    { from: 'security-analysis-report.md', to: `${today}-security-analysis-report.md` }
  ];
  
  // Feature files
  const featureFiles = files.filter(f => f.startsWith('feature-') && f.endsWith('.md'));
  featureFiles.forEach(file => {
    filesToRename.push({ from: file, to: `${today}-${file}` });
  });
  
  for (const rename of filesToRename) {
    const sourcePath = path.join(docsDir, rename.from);
    const targetPath = path.join(docsDir, rename.to);
    
    if (await fileExists(sourcePath)) {
      await fs.rename(sourcePath, targetPath);
      console.log(`   ✏️  Renamed: ${rename.from} → ${rename.to}`);
      renamedCount++;
    }
  }
  
  console.log(`   ✅ Renamed ${renamedCount} files`);
}

async function cleanupEmptyDirectories() {
  console.log('\n🧹 Cleaning up empty directories...');
  
  const emptyDirs = ['2025-06-26-085130'];
  let cleanedCount = 0;
  
  for (const dir of emptyDirs) {
    const dirPath = path.join(docsDir, dir);
    try {
      const files = await fs.readdir(dirPath);
      if (files.length === 0) {
        await fs.rmdir(dirPath);
        console.log(`   🗑️  Removed empty directory: ${dir}`);
        cleanedCount++;
      }
    } catch (error) {
      // Directory doesn't exist or couldn't be removed
    }
  }
  
  console.log(`   ✅ Cleaned ${cleanedCount} empty directories`);
}

async function generateIndex() {
  console.log('\n📚 Generating new documentation index...');
  
  const files = await fs.readdir(docsDir);
  const directories = await fs.readdir(docsDir, { withFileTypes: true });
  
  let indexContent = `# Documentation Index\n\n`;
  indexContent += `**Last Updated:** ${new Date().toISOString()}\n\n`;
  
  // Main documentation files
  indexContent += `## Core Documentation\n\n`;
  const coreFiles = files.filter(f => f.startsWith('2025-06-26-') && f.endsWith('.md'));
  coreFiles.sort();
  
  for (const file of coreFiles) {
    const name = file.replace('2025-06-26-', '').replace('.md', '').replace(/-/g, ' ');
    const capitalizedName = name.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    indexContent += `- [${capitalizedName}](./${file})\n`;
  }
  
  // Directories
  indexContent += `\n## Specialized Documentation\n\n`;
  for (const dir of directories) {
    if (dir.isDirectory() && directoriesToPreserve.includes(dir.name)) {
      const dirName = dir.name.replace(/-/g, ' ').split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      indexContent += `- [${dirName}](./${dir.name}/)\n`;
    }
  }
  
  // Archive
  indexContent += `\n## Archive\n\n`;
  indexContent += `- [Archived Documentation](./archive/)\n`;
  
  await fs.writeFile(path.join(docsDir, 'README.md'), indexContent);
  console.log('   ✅ Generated new README.md index');
}

async function main() {
  console.log('🚀 Starting documentation consolidation...\n');
  
  // Create archive directory
  await ensureDirectory(path.join(docsDir, 'archive', '2025-06-26-consolidation'));
  
  // Consolidate files according to plans
  let totalConsolidated = 0;
  for (const plan of consolidationPlans) {
    const count = await consolidateFiles(plan);
    totalConsolidated += count;
  }
  
  // Archive consolidated source files
  await archiveFiles();
  
  // Rename existing files
  await renameExistingFiles();
  
  // Cleanup empty directories
  await cleanupEmptyDirectories();
  
  // Generate new index
  await generateIndex();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ Documentation consolidation complete!');
  console.log(`   - Consolidated ${totalConsolidated} files into ${consolidationPlans.length} documents`);
  console.log(`   - Archived source files to archive/2025-06-26-consolidation/`);
  console.log(`   - Renamed files to YYYY-MM-DD format`);
  console.log(`   - Generated new documentation index`);
  console.log('\n⚠️  Next steps:');
  console.log('   1. Review consolidated documents for accuracy');
  console.log('   2. Check that no important information was lost');
  console.log('   3. Update any references in code or other docs');
  console.log('   4. Commit changes with appropriate message');
}

main().catch(console.error);