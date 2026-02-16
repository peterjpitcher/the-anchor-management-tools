#!/usr/bin/env tsx

import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'analyze-performance'
const PAYLOAD_SAMPLE_LIMIT = 100
const SCAN_ROOT = path.join(process.cwd(), 'src/app/actions')

type Severity = 'critical' | 'high' | 'medium' | 'low'

type PerformanceIssue = {
  component: string
  issue: string
  severity: Severity
  impact: string
  recommendation: string
}

const issues: PerformanceIssue[] = []

function assertReadOnly(argv: string[]): void {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] read-only script does not support --confirm`)
  }
}

function addIssue(issue: PerformanceIssue): void {
  issues.push(issue)
}

function listActionFiles(scanRoot: string): string[] {
  const entries = fs.readdirSync(scanRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => path.join(scanRoot, entry.name))
}

function analyzeActionSourceContent(filePath: string, content: string): void {
  const component = path.basename(filePath)

  if (content.includes('.select(') && !content.includes('.limit(') && !content.includes('.single(')) {
    addIssue({
      component,
      issue: 'Potential unpaginated query',
      severity: 'medium',
      impact: 'Query may return large datasets and slow requests.',
      recommendation: 'Add explicit pagination (`.limit/.range`) where large lists are possible.',
    })
  }

  if (content.includes('for (') && content.includes('await') && content.includes('.select(')) {
    addIssue({
      component,
      issue: 'Potential N+1 query pattern',
      severity: 'high',
      impact: 'Sequential reads inside loops can amplify latency under load.',
      recommendation: 'Use batched reads, joins, or map/reduce preloading patterns.',
    })
  }

  if (content.includes('sendBulkSMS') || content.includes('rebuildCustomerCategoryStats')) {
    addIssue({
      component,
      issue: 'Potential expensive synchronous action path',
      severity: 'high',
      impact: 'Heavy work in request path can timeout and block workers.',
      recommendation: 'Prefer queue/background job execution and return early.',
    })
  }
}

async function analyzeDatabaseQueries(supabase: ReturnType<typeof createAdminClient>): Promise<void> {
  console.log('Analyzing database query surfaces...')

  const { data: indexData, error: indexError } = await (supabase as any).rpc('get_table_indexes', {})
  assertScriptQuerySucceeded({
    operation: 'Load table index metadata via get_table_indexes RPC',
    error: indexError,
    data: indexData as unknown[] | null,
    allowMissing: true,
  })

  const actionFiles = listActionFiles(SCAN_ROOT)
  for (const filePath of actionFiles) {
    const content = fs.readFileSync(filePath, 'utf8')
    analyzeActionSourceContent(filePath, content)
  }
}

async function analyzePayloadSizes(supabase: ReturnType<typeof createAdminClient>): Promise<void> {
  console.log('Analyzing payload sample sizes...')

  const tables = ['events', 'customers', 'bookings', 'messages'] as const
  for (const table of tables) {
    const { data, error } = await (supabase.from(table) as any)
      .select('id')
      .limit(PAYLOAD_SAMPLE_LIMIT)

    const rows =
      (assertScriptQuerySucceeded({
        operation: `Load payload sample for ${table}`,
        error,
        data: data as Array<{ id: string }> | null,
        allowMissing: true,
      }) ?? []) as Array<{ id: string }>

    console.log(`- ${table}: sampled ${rows.length} row(s)`)
  }
}

function analyzeSecurityPostureNotes(): void {
  console.log('Collecting static security posture notes...')

  addIssue({
    component: 'api',
    issue: 'No explicit custom rate-limit scan in this diagnostic',
    severity: 'high',
    impact: 'High-volume endpoints may be abuse-prone during incident scenarios.',
    recommendation: 'Ensure route-level rate limits exist on high-fanout mutation/send paths.',
  })
}

function analyzeDependencyMetadata(): void {
  console.log('Inspecting package metadata...')

  const packageJsonPath = path.join(process.cwd(), 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  }

  if (typeof deps.next === 'string') {
    console.log(`- next: ${deps.next}`)
  } else {
    addIssue({
      component: 'package.json',
      issue: 'Next.js dependency not found in package manifest',
      severity: 'critical',
      impact: 'Build/runtime assumptions may be invalid.',
      recommendation: 'Verify package.json dependency integrity.',
    })
  }
}

function printSummary(): void {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  }

  for (const issue of issues) {
    counts[issue.severity] += 1
  }

  console.log('\nIssues summary:')
  console.log(`- critical: ${counts.critical}`)
  console.log(`- high: ${counts.high}`)
  console.log(`- medium: ${counts.medium}`)
  console.log(`- low: ${counts.low}`)

  const prioritized: Severity[] = ['critical', 'high', 'medium', 'low']
  for (const severity of prioritized) {
    const severityIssues = issues.filter((issue) => issue.severity === severity)
    if (severityIssues.length === 0) continue

    console.log(`\n${severity.toUpperCase()} issues:`)
    for (const issue of severityIssues) {
      console.log(`- [${issue.component}] ${issue.issue}`)
      console.log(`  Impact: ${issue.impact}`)
      console.log(`  Recommendation: ${issue.recommendation}`)
    }
  }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  assertReadOnly(process.argv)

  if (!fs.existsSync(SCAN_ROOT)) {
    throw new Error(`[${SCRIPT_NAME}] missing scan root: ${SCAN_ROOT}`)
  }

  const supabase = createAdminClient()

  console.log('Performance and security diagnostic scan\n')

  await analyzeDatabaseQueries(supabase)
  await analyzePayloadSizes(supabase)
  analyzeSecurityPostureNotes()
  analyzeDependencyMetadata()
  printSummary()
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

