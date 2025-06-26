#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';

interface FileAnalysis {
  sourceCode: {
    typescript: string[];
    javascript: string[];
    tsx: string[];
    jsx: string[];
    css: string[];
    scss: string[];
  };
  documentation: string[];
  configuration: string[];
  database: string[];
  scripts: string[];
  tests: string[];
  assets: string[];
  temporary: string[];
  misplaced: string[];
  other: string[];
}

const analysis: FileAnalysis = {
  sourceCode: {
    typescript: [],
    javascript: [],
    tsx: [],
    jsx: [],
    css: [],
    scss: []
  },
  documentation: [],
  configuration: [],
  database: [],
  scripts: [],
  tests: [],
  assets: [],
  temporary: [],
  misplaced: [],
  other: []
};

const excludeDirs = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vercel'
]);

const tempPatterns = [
  /^discovery-\d{8}-\d{6}\.log$/,
  /\.tmp$/,
  /\.temp$/,
  /\.cache$/,
  /^~\$/,
  /\.swp$/,
  /\.swo$/,
  /\.bak$/,
  /\.orig$/
];

function shouldExclude(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  return parts.some(part => excludeDirs.has(part));
}

function categorizeFile(filePath: string): void {
  if (shouldExclude(filePath)) return;
  
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const relPath = path.relative('.', filePath);
  
  // Check for temporary files
  if (tempPatterns.some(pattern => pattern.test(fileName))) {
    analysis.temporary.push(relPath);
    return;
  }
  
  // Source code files
  if (ext === '.ts' && !filePath.includes('.d.ts')) {
    if (filePath.includes('/scripts/') || filePath.includes('scripts/')) {
      analysis.scripts.push(relPath);
    } else if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      analysis.tests.push(relPath);
    } else {
      analysis.sourceCode.typescript.push(relPath);
    }
  } else if (ext === '.tsx') {
    analysis.sourceCode.tsx.push(relPath);
  } else if (ext === '.js') {
    analysis.sourceCode.javascript.push(relPath);
  } else if (ext === '.jsx') {
    analysis.sourceCode.jsx.push(relPath);
  } else if (ext === '.css') {
    analysis.sourceCode.css.push(relPath);
  } else if (ext === '.scss' || ext === '.sass') {
    analysis.sourceCode.scss.push(relPath);
  }
  // Documentation
  else if (ext === '.md' || ext === '.mdx' || fileName === 'README') {
    analysis.documentation.push(relPath);
  }
  // Configuration files
  else if (
    ext === '.json' || 
    ext === '.yaml' || 
    ext === '.yml' || 
    ext === '.toml' ||
    fileName.startsWith('.') && !fileName.startsWith('.git') ||
    fileName === 'vercel.json' ||
    fileName === 'package.json' ||
    fileName === 'tsconfig.json' ||
    fileName === 'tailwind.config.js' ||
    fileName === 'next.config.js' ||
    fileName.includes('config')
  ) {
    analysis.configuration.push(relPath);
  }
  // Database files
  else if (
    ext === '.sql' || 
    filePath.includes('/migrations/') ||
    filePath.includes('/seeds/')
  ) {
    analysis.database.push(relPath);
  }
  // Test files
  else if (
    filePath.includes('__tests__') ||
    filePath.includes('test/') ||
    ext === '.test.js' ||
    ext === '.spec.js'
  ) {
    analysis.tests.push(relPath);
  }
  // Assets
  else if (
    ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'].includes(ext) ||
    ['.woff', '.woff2', '.ttf', '.eot'].includes(ext)
  ) {
    analysis.assets.push(relPath);
  }
  // Other files
  else {
    analysis.other.push(relPath);
  }
  
  // Check for misplaced files
  checkMisplaced(relPath, fileName);
}

function checkMisplaced(filePath: string, fileName: string): void {
  // Check for test files outside test directories
  if ((fileName.includes('.test.') || fileName.includes('.spec.')) && 
      !filePath.includes('__tests__') && 
      !filePath.includes('/test/')) {
    analysis.misplaced.push(`${filePath} - Test file outside test directory`);
  }
  
  // Check for SQL files outside migrations/seeds
  if (filePath.endsWith('.sql') && 
      !filePath.includes('/migrations/') && 
      !filePath.includes('/seeds/')) {
    analysis.misplaced.push(`${filePath} - SQL file outside migrations/seeds`);
  }
  
  // Check for scripts outside scripts directory
  if (fileName.includes('script') && 
      !filePath.includes('/scripts/') &&
      filePath.endsWith('.ts')) {
    analysis.misplaced.push(`${filePath} - Script file outside scripts directory`);
  }
}

function walkDirectory(dir: string): void {
  try {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        if (!excludeDirs.has(file)) {
          walkDirectory(filePath);
        }
      } else {
        categorizeFile(filePath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
}

function generateReport(): string {
  const timestamp = new Date().toISOString();
  let report = `# File Structure Analysis Report
Generated: ${timestamp}

## Summary Statistics
- Total TypeScript files: ${analysis.sourceCode.typescript.length}
- Total TSX files: ${analysis.sourceCode.tsx.length}
- Total JavaScript files: ${analysis.sourceCode.javascript.length}
- Total CSS/SCSS files: ${analysis.sourceCode.css.length + analysis.sourceCode.scss.length}
- Documentation files: ${analysis.documentation.length}
- Configuration files: ${analysis.configuration.length}
- Database files: ${analysis.database.length}
- Script files: ${analysis.scripts.length}
- Test files: ${analysis.tests.length}
- Asset files: ${analysis.assets.length}
- Temporary files: ${analysis.temporary.length}
- Misplaced files: ${analysis.misplaced.length}

## Source Code Files

### TypeScript Files (${analysis.sourceCode.typescript.length})
${analysis.sourceCode.typescript.map(f => `- ${f}`).join('\n')}

### TSX Files (${analysis.sourceCode.tsx.length})
${analysis.sourceCode.tsx.map(f => `- ${f}`).join('\n')}

### JavaScript Files (${analysis.sourceCode.javascript.length})
${analysis.sourceCode.javascript.length > 0 ? analysis.sourceCode.javascript.map(f => `- ${f}`).join('\n') : 'None'}

### JSX Files (${analysis.sourceCode.jsx.length})
${analysis.sourceCode.jsx.length > 0 ? analysis.sourceCode.jsx.map(f => `- ${f}`).join('\n') : 'None'}

### CSS Files (${analysis.sourceCode.css.length})
${analysis.sourceCode.css.length > 0 ? analysis.sourceCode.css.map(f => `- ${f}`).join('\n') : 'None'}

### SCSS Files (${analysis.sourceCode.scss.length})
${analysis.sourceCode.scss.length > 0 ? analysis.sourceCode.scss.map(f => `- ${f}`).join('\n') : 'None'}

## Documentation Files (${analysis.documentation.length})
${analysis.documentation.map(f => `- ${f}`).join('\n')}

## Configuration Files (${analysis.configuration.length})
${analysis.configuration.map(f => `- ${f}`).join('\n')}

## Database Files (${analysis.database.length})
${analysis.database.map(f => `- ${f}`).join('\n')}

## Script Files (${analysis.scripts.length})
${analysis.scripts.map(f => `- ${f}`).join('\n')}

## Test Files (${analysis.tests.length})
${analysis.tests.length > 0 ? analysis.tests.map(f => `- ${f}`).join('\n') : 'None'}

## Asset Files (${analysis.assets.length})
${analysis.assets.map(f => `- ${f}`).join('\n')}

## Temporary Files (${analysis.temporary.length})
${analysis.temporary.length > 0 ? analysis.temporary.map(f => `- ${f}`).join('\n') : 'None'}

## Misplaced Files (${analysis.misplaced.length})
${analysis.misplaced.length > 0 ? analysis.misplaced.map(f => `- ${f}`).join('\n') : 'None'}

## Other Files (${analysis.other.length})
${analysis.other.map(f => `- ${f}`).join('\n')}

## Recommendations

### Files to Clean Up
`;

  if (analysis.temporary.length > 0) {
    report += `\n#### Temporary Files
The following temporary files should be removed:
${analysis.temporary.map(f => `- rm ${f}`).join('\n')}
`;
  }

  if (analysis.misplaced.length > 0) {
    report += `\n#### Misplaced Files
The following files appear to be in the wrong location:
${analysis.misplaced.map(f => `- ${f}`).join('\n')}
`;
  }

  report += `\n### Directory Structure Observations
`;

  // Check for proper structure
  const hasSrcDir = fs.existsSync('./src');
  const hasScriptsDir = fs.existsSync('./scripts');
  const hasSupabaseDir = fs.existsSync('./supabase');
  
  if (hasSrcDir) {
    report += `- ✓ Source code properly organized in src/ directory\n`;
  } else {
    report += `- ⚠️  No src/ directory found - consider organizing source code\n`;
  }
  
  if (hasScriptsDir) {
    report += `- ✓ Scripts properly organized in scripts/ directory\n`;
  } else {
    report += `- ⚠️  No scripts/ directory found - consider organizing utility scripts\n`;
  }
  
  if (hasSupabaseDir) {
    report += `- ✓ Database migrations properly organized in supabase/ directory\n`;
  } else {
    report += `- ⚠️  No supabase/ directory found\n`;
  }

  return report;
}

// Main execution
console.log('Analyzing file structure...');
walkDirectory('.');

const report = generateReport();
const outputPath = `documentation/file-structure-analysis-${new Date().toISOString().split('T')[0]}-${Date.now()}.md`;

fs.writeFileSync(outputPath, report);
console.log(`Analysis complete! Report saved to: ${outputPath}`);

// Also save a JSON version for programmatic access
const jsonPath = outputPath.replace('.md', '.json');
fs.writeFileSync(jsonPath, JSON.stringify(analysis, null, 2));
console.log(`JSON data saved to: ${jsonPath}`);