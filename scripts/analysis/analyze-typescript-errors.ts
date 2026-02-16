#!/usr/bin/env tsx

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';

interface BuildError {
  file: string;
  line: number;
  column: number;
  error: string;
  pattern?: string;
  fix?: string;
}

const ERROR_PATTERNS = [
  {
    pattern: /Property 'message' does not exist on type.*AlertProps/,
    name: 'Alert message prop',
    fix: 'Replace message= with children'
  },
  {
    pattern: /Property 'message' does not exist on type.*SectionProps/,
    name: 'CollapsibleSection message prop',
    fix: 'Replace message= with description='
  },
  {
    pattern: /Property 'leftIcon' does not exist on type.*SectionProps/,
    name: 'CollapsibleSection leftIcon prop',
    fix: 'Replace leftIcon= with icon='
  },
  {
    pattern: /Property 'icon' does not exist on type.*Button/,
    name: 'Button icon prop',
    fix: 'Replace icon= with leftIcon='
  },
  {
    pattern: /Property 'isOpen' does not exist on type.*Modal/,
    name: 'Modal isOpen prop',
    fix: 'Replace isOpen= with open='
  },
  {
    pattern: /Property 'description' does not exist on type.*ConfirmDialog/,
    name: 'ConfirmDialog description prop',
    fix: 'Replace description= with message='
  },
  {
    pattern: /Property 'tabs' does not exist on type.*TabNav/,
    name: 'TabNav tabs prop',
    fix: 'Replace items= with tabs='
  },
  {
    pattern: /Property 'items' does not exist on type.*Tabs/,
    name: 'Tabs items prop',
    fix: 'Replace tabs= with items='
  },
  {
    pattern: /Property 'hint' does not exist on type.*FormGroup/,
    name: 'FormGroup hint prop',
    fix: 'Replace hint= with help='
  },
  {
    pattern: /Property 'helperText' does not exist on type.*FormGroup/,
    name: 'FormGroup helperText prop',
    fix: 'Replace helperText= with help='
  },
  {
    pattern: /Property 'size' does not exist on type.*Badge/,
    name: 'Badge size prop',
    fix: 'Replace size="xs" with size="sm"'
  },
  {
    pattern: /Property 'onChange' does not exist on type.*SearchInput/,
    name: 'SearchInput onChange prop',
    fix: 'Replace onChange= with onSearch='
  },
  {
    pattern: /Property 'href' does not exist on type.*Button/,
    name: 'Button href prop',
    fix: 'Use LinkButton instead of Button when href is needed'
  },
  {
    pattern: /Type '.*' is not assignable to type '.*CheckboxProps/,
    name: 'Checkbox onChange signature',
    fix: 'Change onChange={(checked) => to onChange={(e) => and use e.target.checked'
  }
];

function parseTypeScriptErrors(): BuildError[] {
  console.log('🔍 Running TypeScript build to capture errors...');
  
  try {
    execSync('npm run build', { encoding: 'utf8' });
    console.log('✅ No TypeScript errors found!');
    return [];
  } catch (error: any) {
    const output = error.stdout + error.stderr;
    const lines = output.split('\n');
    const errors: BuildError[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Match error pattern: ./path/to/file.tsx:line:column
      const match = line.match(/^\.\/(.+\.tsx?):(\d+):(\d+)$/);
      if (match) {
        const [, file, lineNum, colNum] = match;
        
        // Get error message from next lines
        let errorMessage = '';
        for (let j = i + 1; j < lines.length && j < i + 10; j++) {
          if (lines[j].match(/^\.\//) || lines[j].includes('Failed to compile')) break;
          if (lines[j].includes('Type error:')) {
            errorMessage = lines[j].replace('Type error:', '').trim();
          }
        }
        
        if (errorMessage) {
          const buildError: BuildError = {
            file,
            line: parseInt(lineNum),
            column: parseInt(colNum),
            error: errorMessage
          };
          
          // Match against known patterns
          for (const pattern of ERROR_PATTERNS) {
            if (pattern.pattern.test(errorMessage)) {
              buildError.pattern = pattern.name;
              buildError.fix = pattern.fix;
              break;
            }
          }
          
          errors.push(buildError);
        }
      }
    }
    
    return errors;
  }
}

function groupErrorsByPattern(errors: BuildError[]): Map<string, BuildError[]> {
  const grouped = new Map<string, BuildError[]>();
  
  for (const error of errors) {
    const pattern = error.pattern || 'Unknown';
    if (!grouped.has(pattern)) {
      grouped.set(pattern, []);
    }
    grouped.get(pattern)!.push(error);
  }
  
  return grouped;
}

function generateFixScript(pattern: string, errors: BuildError[]): string {
  const fixes: string[] = [];
  
  switch (pattern) {
    case 'Alert message prop':
      for (const error of errors) {
        fixes.push(`
# Fix Alert message prop in ${error.file}
sed -i '' 's/message=\\(.*\\)>/>{\\1}<\\/Alert>/g' "${error.file}"
`);
      }
      break;
      
    case 'CollapsibleSection message prop':
      for (const error of errors) {
        fixes.push(`
# Fix CollapsibleSection message prop in ${error.file}
sed -i '' 's/message=/description=/g' "${error.file}"
`);
      }
      break;
      
    case 'CollapsibleSection leftIcon prop':
      for (const error of errors) {
        fixes.push(`
# Fix CollapsibleSection leftIcon prop in ${error.file}
sed -i '' 's/leftIcon=/icon=/g' "${error.file}"
`);
      }
      break;
      
    case 'Button icon prop':
      for (const error of errors) {
        fixes.push(`
# Fix Button icon prop in ${error.file}
sed -i '' 's/<Button\\([^>]*\\)icon=/<Button\\1leftIcon=/g' "${error.file}"
`);
      }
      break;
      
    case 'Modal isOpen prop':
      for (const error of errors) {
        fixes.push(`
# Fix Modal isOpen prop in ${error.file}
sed -i '' 's/isOpen=/open=/g' "${error.file}"
`);
      }
      break;
      
    case 'Button href prop':
      for (const error of errors) {
        fixes.push(`
# Fix Button with href in ${error.file}
echo "⚠️  Manual fix needed in ${error.file}: Replace Button with LinkButton when href prop is used"
`);
      }
      break;
      
    default:
      for (const error of errors) {
        fixes.push(`
# Manual fix needed for ${pattern} in ${error.file}:${error.line}
echo "⚠️  ${error.fix || 'Manual intervention required'}"
`);
      }
  }
  
  return fixes.join('\n');
}

async function main() {
  console.log('🚀 TypeScript Error Analysis Tool');
  console.log('=================================\n');
  
  const errors = parseTypeScriptErrors();
  
  if (errors.length === 0) {
    console.log('🎉 No errors to fix!');
    return;
  }
  
  console.log(`\n📊 Found ${errors.length} TypeScript errors\n`);
  
  const grouped = groupErrorsByPattern(errors);
  
  // Display summary
  console.log('Error Summary by Pattern:');
  console.log('------------------------');
  for (const [pattern, patternErrors] of grouped) {
    console.log(`${pattern}: ${patternErrors.length} errors`);
    for (const error of patternErrors.slice(0, 3)) {
      console.log(`  - ${error.file}:${error.line}`);
    }
    if (patternErrors.length > 3) {
      console.log(`  ... and ${patternErrors.length - 3} more`);
    }
  }
  
  // Generate fix scripts
  console.log('\n📝 Generating fix scripts...\n');
  
  const scripts: string[] = [];
  let scriptIndex = 1;
  
  for (const [pattern, patternErrors] of grouped) {
    const fixScript = generateFixScript(pattern, patternErrors);
    const scriptName = `fix-${scriptIndex}-${pattern.toLowerCase().replace(/\s+/g, '-')}.sh`;
    const scriptPath = path.join(process.cwd(), 'scripts', scriptName);
    
    const scriptContent = `#!/bin/bash
# Auto-generated fix script for: ${pattern}
# Errors to fix: ${patternErrors.length}

echo "🔧 Fixing ${pattern} errors..."
${fixScript}
echo "✅ Done fixing ${pattern} errors"
`;
    
    writeFileSync(scriptPath, scriptContent);
    execSync(`chmod +x "${scriptPath}"`);
    scripts.push(scriptPath);
    
    console.log(`✅ Created: ${scriptName}`);
    scriptIndex++;
  }
  
  // Create master fix script
  const masterScript = `#!/bin/bash
# Master fix script - runs all fixes

echo "🚀 Running all TypeScript fixes..."
echo "================================="

${scripts.map(s => `bash "${s}"`).join('\n')}

echo ""
echo "✅ All fix scripts completed!"
echo "🔍 Running build to check remaining errors..."
npm run build
`;
  
  const masterPath = path.join(process.cwd(), 'scripts', 'fix-all-typescript-errors.sh');
  writeFileSync(masterPath, masterScript);
  execSync(`chmod +x "${masterPath}"`);
  
  console.log(`\n✅ Created master script: fix-all-typescript-errors.sh`);
  console.log('\n📋 Next steps:');
  console.log('1. Run individual fix scripts for specific patterns');
  console.log('2. Or run ./scripts/fix-all-typescript-errors.sh to fix everything');
  console.log('3. Review changes and test');
  
  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    totalErrors: errors.length,
    patterns: Object.fromEntries(
      Array.from(grouped.entries()).map(([pattern, errors]) => [
        pattern,
        {
          count: errors.length,
          files: errors.map(e => ({ file: e.file, line: e.line, fix: e.fix }))
        }
      ])
    ),
    scripts: scripts.map(s => path.basename(s))
  };
  
  writeFileSync(
    path.join(process.cwd(), 'typescript-error-report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log('\n📄 Detailed report saved to: typescript-error-report.json');
}

main().catch((error) => { console.error(error); process.exitCode = 1 });