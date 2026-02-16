#!/usr/bin/env tsx

/**
 * Check for Supabase client creation patterns across the codebase.
 *
 * Notes:
 * - Strictly read-only; this script only reads files from disk.
 * - Output is capped to avoid dumping thousands of lines into logs.
 */

import fs from 'node:fs'
import path from 'node:path'
import { assertScriptCompletedWithoutFailures } from '../../src/lib/script-mutation-safety'

const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build'])
const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

type ClientUsageType = 'direct-import' | 'createClient' | 'useSupabase'

type ClientUsage = {
  file: string
  line: number
  type: ClientUsageType
  context: string
}

const HARD_CAP = 500

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

function parseBoundedInt(params: {
  argv: string[]
  flag: string
  defaultValue: number
  hardCap: number
}): number {
  const idx = params.argv.indexOf(params.flag)
  if (idx === -1) {
    return params.defaultValue
  }

  const raw = params.argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${params.flag} must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > params.hardCap) {
    throw new Error(`${params.flag} too high (got ${parsed}, hard cap ${params.hardCap})`)
  }
  return parsed
}

function checkFile(filePath: string, usages: ClientUsage[]) {
  if (!FILE_EXTENSIONS.some((ext) => filePath.endsWith(ext))) {
    return
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    if (
      line.match(
        /import.*from\s+['"]@\/lib\/supabase['"]|import.*from\s+['"]\.\..*\/lib\/supabase['"]/
      )
    ) {
      usages.push({
        file: filePath,
        line: index + 1,
        type: 'direct-import',
        context: line.trim()
      })
    }

    if (
      line.includes('createClient') &&
      !line.includes('createServerComponentClient') &&
      !line.includes('createClientComponentClient')
    ) {
      usages.push({
        file: filePath,
        line: index + 1,
        type: 'createClient',
        context: line.trim()
      })
    }

    if (line.includes('useSupabase()')) {
      usages.push({
        file: filePath,
        line: index + 1,
        type: 'useSupabase',
        context: line.trim()
      })
    }
  })
}

function walkDir(dir: string, usages: ClientUsage[], failures: string[]) {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    failures.push(`Unable to read directory ${dir}`)
    return
  }

  entries.forEach((entry) => {
    const name = entry.name
    if (IGNORE_DIRS.has(name)) {
      return
    }

    const filePath = path.join(dir, name)
    if (entry.isSymbolicLink()) {
      return
    }

    if (entry.isDirectory()) {
      walkDir(filePath, usages, failures)
      return
    }

    if (!entry.isFile()) {
      return
    }

    try {
      checkFile(filePath, usages)
    } catch (error) {
      failures.push(`Unable to read ${filePath}`)
    }
  })
}

function printUsages(label: string, usages: ClientUsage[], limit: number) {
  if (usages.length === 0) {
    return
  }

  console.log(`${label}: ${usages.length}`)
  usages.slice(0, limit).forEach((usage) => {
    console.log(`  - ${usage.file}:${usage.line}`)
    console.log(`    ${usage.context}`)
  })
  if (usages.length > limit) {
    console.log(`  ... (${usages.length - limit} more)`)
  }
  console.log('')
}

async function main() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-supabase-clients is strictly read-only; do not pass --confirm.')
  }

  const maxPerType = parseBoundedInt({ argv, flag: '--max-per-type', defaultValue: 100, hardCap: HARD_CAP })
  const rootDir = path.join(process.cwd(), 'src')

  console.log('Supabase client usage analysis\n')
  console.log(`Root: ${rootDir}`)
  console.log(`Max per type: ${maxPerType} (hard cap ${HARD_CAP})\n`)

  if (!fs.existsSync(rootDir)) {
    throw new Error(`Missing directory: ${rootDir}`)
  }

  const usages: ClientUsage[] = []
  const failures: string[] = []
  walkDir(rootDir, usages, failures)

  const directImports = usages.filter((u) => u.type === 'direct-import')
  const createClientCalls = usages.filter((u) => u.type === 'createClient')
  const useSupabaseCalls = usages.filter((u) => u.type === 'useSupabase')

  printUsages('Direct imports from lib/supabase (prefer provider hook)', directImports, maxPerType)
  printUsages('createClient calls', createClientCalls, maxPerType)
  console.log(`useSupabase() hook usages: ${useSupabaseCalls.length}\n`)

  if (directImports.length > 0) {
    console.log('Recommendations:')
    console.log('- Replace direct client imports with the provider hook in client components.')
    console.log('- Example:')
    console.log('  import { useSupabase } from \"@/components/providers/SupabaseProvider\"')
    console.log('  const supabase = useSupabase()')
  }

  assertScriptCompletedWithoutFailures({
    scriptName: 'check-supabase-clients',
    failureCount: failures.length,
    failures
  })
}

void main().catch((error) => {
  markFailure('check-supabase-clients failed.', error)
})
