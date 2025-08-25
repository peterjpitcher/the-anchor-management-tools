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
  createdDate: string;
}

async function getFileCreationDate(filePath: string): Promise<string> {
  try {
    const stats = await fs.stat(filePath);
    // Use birthtime (creation time) if available, otherwise mtime (modification time)
    const date = stats.birthtime || stats.mtime;
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  } catch (error) {
    console.error(`Error getting date for ${filePath}:`, error);
    return new Date().toISOString().split('T')[0];
  }
}

async function findFilesToRename(): Promise<FileRename[]> {
  const files = await fs.readdir(docsDir);
  const renames: FileRename[] = [];
  
  // Pattern to match files that start with 2025-06-26-
  const todayPattern = /^2025-06-26-(.+)/;
  
  for (const file of files) {
    const match = file.match(todayPattern);
    if (match) {
      const filePath = path.join(docsDir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isFile()) {
        const createdDate = await getFileCreationDate(filePath);
        const baseName = match[1]; // Everything after 2025-06-26-
        
        // Only rename if the date is different
        if (createdDate !== '2025-06-26') {
          renames.push({
            from: file,
            to: `${createdDate}-${baseName}`,
            createdDate
          });
        }
      }
    }
  }
  
  return renames;
}

async function main() {
  console.log('🔍 Analyzing file creation dates...\n');
  
  const renames = await findFilesToRename();
  
  if (renames.length === 0) {
    console.log('✅ All files already have their correct creation dates!');
    return;
  }
  
  console.log(`Found ${renames.length} files to rename based on creation date:\n`);
  
  // Group by date for better visualization
  const byDate = renames.reduce((acc, rename) => {
    if (!acc[rename.createdDate]) {
      acc[rename.createdDate] = [];
    }
    acc[rename.createdDate].push(rename);
    return acc;
  }, {} as Record<string, FileRename[]>);
  
  // Display what will be renamed
  for (const [date, files] of Object.entries(byDate)) {
    console.log(`📅 Files created on ${date}:`);
    for (const file of files) {
      console.log(`   ${file.from} → ${file.to}`);
    }
    console.log();
  }
  
  // Ask for confirmation
  console.log('📝 Proceeding with renaming...\n');
  
  // Execute renames
  let successCount = 0;
  for (const rename of renames) {
    try {
      const fromPath = path.join(docsDir, rename.from);
      const toPath = path.join(docsDir, rename.to);
      
      // Check if target already exists
      try {
        await fs.access(toPath);
        console.log(`⚠️  Skipping ${rename.from} - target ${rename.to} already exists`);
        continue;
      } catch {
        // Target doesn't exist, proceed
      }
      
      await fs.rename(fromPath, toPath);
      console.log(`✅ Renamed: ${rename.from} → ${rename.to}`);
      successCount++;
    } catch (error) {
      console.error(`❌ Error renaming ${rename.from}:`, error);
    }
  }
  
  // Update README.md to reflect new dates
  if (successCount > 0) {
    console.log('\n📚 Updating documentation index...');
    await updateReadmeLinks(renames);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Renaming complete! ${successCount} files renamed to use actual creation dates.`);
}

async function updateReadmeLinks(renames: FileRename[]) {
  const readmePath = path.join(docsDir, 'README.md');
  let content = await fs.readFile(readmePath, 'utf-8');
  
  // Replace old filenames with new ones in links
  for (const rename of renames) {
    const oldLink = `(./${rename.from})`;
    const newLink = `(./${rename.to})`;
    content = content.replace(oldLink, newLink);
  }
  
  // Update the last updated date
  content = content.replace(
    /\*\*Last Updated:\*\* .+/,
    `**Last Updated:** ${new Date().toISOString()}`
  );
  
  await fs.writeFile(readmePath, content);
  console.log('✅ Updated README.md with new file links');
}

main().catch(console.error);