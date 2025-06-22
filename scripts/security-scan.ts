#!/usr/bin/env tsx

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

interface SecurityIssue {
  file: string
  line: number
  issue: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  content: string
}

const secretPatterns = [
  // API Keys and tokens
  { pattern: /api[_-]?key\s*[:=]\s*["']([^"']+)["']/gi, name: 'API Key' },
  { pattern: /token\s*[:=]\s*["']([^"']+)["']/gi, name: 'Token' },
  { pattern: /secret\s*[:=]\s*["']([^"']+)["']/gi, name: 'Secret' },
  { pattern: /password\s*[:=]\s*["']([^"']+)["']/gi, name: 'Password' },
  
  // Supabase specific
  { pattern: /supabase[_-]?key\s*[:=]\s*["']([^"']+)["']/gi, name: 'Supabase Key' },
  { pattern: /service[_-]?role[_-]?key\s*[:=]\s*["']([^"']+)["']/gi, name: 'Service Role Key' },
  
  // Database URLs
  { pattern: /postgres:\/\/[^@]+@[^/]+/gi, name: 'Database URL' },
  { pattern: /mysql:\/\/[^@]+@[^/]+/gi, name: 'Database URL' },
  
  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key' },
  
  // Private keys
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, name: 'Private Key' },
]

const sqlInjectionPatterns = [
  { pattern: /\$\{[^}]+\}/g, name: 'String interpolation in SQL' },
  { pattern: /\+\s*['"].*SELECT.*FROM/gi, name: 'Concatenated SQL query' },
  { pattern: /query\([^)]*\+[^)]*\)/g, name: 'Dynamic SQL query' },
]

const xssPatterns = [
  { pattern: /dangerouslySetInnerHTML/g, name: 'Dangerous HTML injection' },
  { pattern: /innerHTML\s*=/g, name: 'Direct innerHTML assignment' },
  { pattern: /document\.write/g, name: 'document.write usage' },
]

function scanFile(filePath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = []
  
  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    
    // Skip if it's a test file or mock
    if (filePath.includes('test') || filePath.includes('mock') || filePath.includes('.env.example')) {
      return issues
    }
    
    lines.forEach((line, index) => {
      // Check for hardcoded secrets
      for (const { pattern, name } of secretPatterns) {
        const matches = line.matchAll(pattern)
        for (const match of matches) {
          // Skip if it's using environment variables
          if (!line.includes('process.env') && !line.includes('import.meta.env')) {
            issues.push({
              file: filePath,
              line: index + 1,
              issue: `Potential hardcoded ${name}`,
              severity: 'critical',
              content: line.trim()
            })
          }
        }
      }
      
      // Check for SQL injection vulnerabilities
      for (const { pattern, name } of sqlInjectionPatterns) {
        if (pattern.test(line) && (line.includes('query') || line.includes('sql'))) {
          issues.push({
            file: filePath,
            line: index + 1,
            issue: `Potential SQL injection: ${name}`,
            severity: 'high',
            content: line.trim()
          })
        }
      }
      
      // Check for XSS vulnerabilities
      for (const { pattern, name } of xssPatterns) {
        if (pattern.test(line)) {
          issues.push({
            file: filePath,
            line: index + 1,
            issue: `Potential XSS vulnerability: ${name}`,
            severity: 'high',
            content: line.trim()
          })
        }
      }
      
      // Check for console.log with sensitive data
      if (line.includes('console.log') && (line.includes('password') || line.includes('token') || line.includes('key'))) {
        issues.push({
          file: filePath,
          line: index + 1,
          issue: 'Logging potentially sensitive data',
          severity: 'medium',
          content: line.trim()
        })
      }
    })
  } catch (error) {
    // Ignore read errors
  }
  
  return issues
}

function scanDirectory(dirPath: string, extensions: string[]): SecurityIssue[] {
  const issues: SecurityIssue[] = []
  
  try {
    const items = readdirSync(dirPath)
    
    for (const item of items) {
      const fullPath = join(dirPath, item)
      const stat = statSync(fullPath)
      
      // Skip node_modules, .next, .git
      if (item === 'node_modules' || item === '.next' || item === '.git') {
        continue
      }
      
      if (stat.isDirectory()) {
        issues.push(...scanDirectory(fullPath, extensions))
      } else if (stat.isFile()) {
        const ext = item.split('.').pop()
        if (ext && extensions.includes(ext)) {
          issues.push(...scanFile(fullPath))
        }
      }
    }
  } catch (error) {
    // Ignore directory read errors
  }
  
  return issues
}

// Main execution
console.log('🔍 PHASE 1: STATIC ANALYSIS - Security Scan\n')

const projectRoot = process.cwd()
const issues = scanDirectory(projectRoot, ['ts', 'tsx', 'js', 'jsx'])

// Group issues by severity
const critical = issues.filter(i => i.severity === 'critical')
const high = issues.filter(i => i.severity === 'high')
const medium = issues.filter(i => i.severity === 'medium')
const low = issues.filter(i => i.severity === 'low')

console.log('📊 Security Scan Summary:')
console.log(`Total issues found: ${issues.length}`)
console.log(`  🔴 Critical: ${critical.length}`)
console.log(`  🟠 High: ${high.length}`)
console.log(`  🟡 Medium: ${medium.length}`)
console.log(`  🟢 Low: ${low.length}`)

if (critical.length > 0) {
  console.log('\n🔴 CRITICAL Issues:')
  critical.forEach(issue => {
    console.log(`\n  File: ${issue.file}:${issue.line}`)
    console.log(`  Issue: ${issue.issue}`)
    console.log(`  Code: ${issue.content.substring(0, 80)}...`)
  })
}

if (high.length > 0) {
  console.log('\n🟠 HIGH Priority Issues:')
  high.forEach(issue => {
    console.log(`\n  File: ${issue.file}:${issue.line}`)
    console.log(`  Issue: ${issue.issue}`)
    console.log(`  Code: ${issue.content.substring(0, 80)}...`)
  })
}

if (medium.length > 0) {
  console.log('\n🟡 MEDIUM Priority Issues:')
  medium.slice(0, 5).forEach(issue => {
    console.log(`\n  File: ${issue.file}:${issue.line}`)
    console.log(`  Issue: ${issue.issue}`)
  })
  if (medium.length > 5) {
    console.log(`\n  ... and ${medium.length - 5} more medium priority issues`)
  }
}

console.log('\n✅ Security scan complete!')