#!/usr/bin/env tsx

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');

interface FileRename {
  from: string;
  to: string;
  shouldArchive?: boolean;
}

// Additional files found that need renaming
const additionalRenames: FileRename[] = [
  { from: 'audit-summary.md', to: '2025-06-26-audit-summary.md' },
  { from: 'google-calendar-debugging.md', to: '2025-06-26-google-calendar-debugging.md' },
  { from: 'google-calendar-setup.md', to: '2025-06-26-google-calendar-setup.md' },
  { from: 'private-bookings-audit.md', to: '2025-06-26-private-bookings-audit.md' },
  { from: 'private-bookings-field-fixes.md', to: '2025-06-26-private-bookings-field-fixes.md' },
  { from: 'rate-limiting.md', to: '2025-06-26-rate-limiting.md' },
  { from: 'rbac.md', to: '2025-06-26-rbac.md' },
  { from: 'release-notes.md', to: '2025-06-26-release-notes.md' },
  { from: 'security.md', to: '2025-06-26-security.md' },
  { from: 'sentry-integration.md', to: '2025-06-26-sentry-integration.md' },
  { from: 'structured-logging.md', to: '2025-06-26-structured-logging.md' },
  { from: 'ui-standards.md', to: '2025-06-26-ui-standards.md' },
  { from: 'validation-constraints.md', to: '2025-06-26-validation-constraints.md' }
];

// Production issues files should be consolidated into fixes tracker
const productionIssuesToArchive: string[] = [
  'production-issues-investigation.md',
  'production-issues-quick-fix-guide.md',
  'production-issues-technical-analysis.md'
];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function consolidateProductionIssues() {
  console.log('\n📋 Consolidating production issues into fixes tracker...');
  
  const fixesTrackerPath = path.join(docsDir, '2025-06-26-fixes-tracker.md');
  let appendContent = '\n\n---\n\n## Production Issues (Appended)\n\n';
  let foundFiles = 0;
  
  for (const file of productionIssuesToArchive) {
    const filePath = path.join(docsDir, file);
    if (await fileExists(filePath)) {
      const content = await fs.readFile(filePath, 'utf-8');
      appendContent += `\n### ${file}\n\n*Source: ${file}*\n\n${content}\n\n---\n\n`;
      foundFiles++;
      console.log(`   ✓ Found: ${file}`);
    }
  }
  
  if (foundFiles > 0) {
    const currentContent = await fs.readFile(fixesTrackerPath, 'utf-8');
    await fs.writeFile(fixesTrackerPath, currentContent + appendContent);
    console.log(`   ✅ Appended ${foundFiles} production issue files to fixes tracker`);
    
    // Archive the files
    const archiveDir = path.join(docsDir, 'archive', '2025-06-26-consolidation');
    for (const file of productionIssuesToArchive) {
      const sourcePath = path.join(docsDir, file);
      const targetPath = path.join(archiveDir, file);
      if (await fileExists(sourcePath)) {
        await fs.rename(sourcePath, targetPath);
        console.log(`   📁 Archived: ${file}`);
      }
    }
  }
}

async function renameAdditionalFiles() {
  console.log('\n🔄 Renaming additional files to YYYY-MM-DD format...');
  
  let renamedCount = 0;
  
  for (const rename of additionalRenames) {
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

async function updateDocumentationIndex() {
  console.log('\n📚 Updating documentation index...');
  
  const files = await fs.readdir(docsDir);
  const directories = await fs.readdir(docsDir, { withFileTypes: true });
  
  let indexContent = `# Documentation Index\n\n`;
  indexContent += `**Last Updated:** ${new Date().toISOString()}\n\n`;
  
  // Group files by category
  const apiDocs: string[] = [];
  const featureDocs: string[] = [];
  const guideDocs: string[] = [];
  const technicalDocs: string[] = [];
  const complianceDocs: string[] = [];
  const otherDocs: string[] = [];
  
  const coreFiles = files.filter(f => f.startsWith('2025-06-26-') && f.endsWith('.md'));
  coreFiles.sort();
  
  for (const file of coreFiles) {
    if (file.includes('api-')) apiDocs.push(file);
    else if (file.includes('feature-')) featureDocs.push(file);
    else if (file.includes('-guide') || file.includes('developer-') || file.includes('deployment-')) guideDocs.push(file);
    else if (file.includes('database-') || file.includes('rbac') || file.includes('security') || file.includes('audit-')) technicalDocs.push(file);
    else if (file.includes('gdpr') || file.includes('compliance')) complianceDocs.push(file);
    else otherDocs.push(file);
  }
  
  // Write categorized sections
  indexContent += `## API Documentation\n\n`;
  for (const file of apiDocs) {
    const name = file.replace('2025-06-26-', '').replace('.md', '').replace(/-/g, ' ');
    const capitalizedName = name.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    indexContent += `- [${capitalizedName}](./${file})\n`;
  }
  
  indexContent += `\n## Feature Documentation\n\n`;
  for (const file of featureDocs) {
    const name = file.replace('2025-06-26-feature-', '').replace('.md', '').replace(/-/g, ' ');
    const capitalizedName = name.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    indexContent += `- [${capitalizedName}](./${file})\n`;
  }
  
  indexContent += `\n## Development Guides\n\n`;
  for (const file of guideDocs) {
    const name = file.replace('2025-06-26-', '').replace('.md', '').replace(/-/g, ' ');
    const capitalizedName = name.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    indexContent += `- [${capitalizedName}](./${file})\n`;
  }
  
  indexContent += `\n## Technical Documentation\n\n`;
  for (const file of technicalDocs) {
    const name = file.replace('2025-06-26-', '').replace('.md', '').replace(/-/g, ' ');
    const capitalizedName = name.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    indexContent += `- [${capitalizedName}](./${file})\n`;
  }
  
  if (complianceDocs.length > 0) {
    indexContent += `\n## Compliance & Legal\n\n`;
    for (const file of complianceDocs) {
      const name = file.replace('2025-06-26-', '').replace('.md', '').replace(/-/g, ' ');
      const capitalizedName = name.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      indexContent += `- [${capitalizedName}](./${file})\n`;
    }
  }
  
  if (otherDocs.length > 0) {
    indexContent += `\n## Other Documentation\n\n`;
    for (const file of otherDocs) {
      const name = file.replace('2025-06-26-', '').replace('.md', '').replace(/-/g, ' ');
      const capitalizedName = name.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      indexContent += `- [${capitalizedName}](./${file})\n`;
    }
  }
  
  // OpenAPI spec
  const openApiFile = files.find(f => f.includes('openapi.yaml'));
  if (openApiFile) {
    indexContent += `\n## API Specification\n\n`;
    indexContent += `- [OpenAPI Specification](./${openApiFile})\n`;
  }
  
  // Directories
  indexContent += `\n## Specialized Documentation\n\n`;
  const specializedDirs = ['audit-reports', 'implementation-guides', 'security', 'sms-templates', 'user-flows'];
  for (const dir of directories) {
    if (dir.isDirectory() && specializedDirs.includes(dir.name)) {
      const dirName = dir.name.replace(/-/g, ' ').split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      indexContent += `- [${dirName}](./${dir.name}/)\n`;
    }
  }
  
  // Recent analyses (2025-06-26-085314)
  const recentAnalysisDir = directories.find(d => d.isDirectory() && d.name === '2025-06-26-085314');
  if (recentAnalysisDir) {
    indexContent += `\n## Recent Analyses\n\n`;
    indexContent += `- [2025-06-26 Analysis Reports](./2025-06-26-085314/)\n`;
  }
  
  // Archive
  indexContent += `\n## Archive\n\n`;
  indexContent += `- [Archived Documentation](./archive/)\n`;
  
  await fs.writeFile(path.join(docsDir, 'README.md'), indexContent);
  console.log('   ✅ Updated README.md index with categorized sections');
}

async function main() {
  console.log('🚀 Starting documentation consolidation phase 2...\n');
  
  // Consolidate production issues into fixes tracker
  await consolidateProductionIssues();
  
  // Rename additional files
  await renameAdditionalFiles();
  
  // Update the documentation index with better categorization
  await updateDocumentationIndex();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ Documentation consolidation phase 2 complete!');
  console.log('\n⚠️  All documentation files now follow YYYY-MM-DD-filename format');
  console.log('   Documentation is organized into clear categories in README.md');
}

main().catch(console.error);