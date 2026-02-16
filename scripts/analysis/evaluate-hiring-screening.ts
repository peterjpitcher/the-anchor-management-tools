#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'evaluate-hiring-screening'
const DEFAULT_SINCE_DAYS = 90

function readOptionalFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

function parseSinceIso(argv: string[]): string {
  const raw = readOptionalFlagValue(argv, '--since')
  const sinceDate = raw
    ? new Date(raw)
    : new Date(Date.now() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000)
  if (!Number.isFinite(sinceDate.getTime())) {
    throw new Error(`[${SCRIPT_NAME}] Invalid --since value: ${raw}`)
  }
  return sinceDate.toISOString()
}

function groupCount<T>(items: T[], keyFn: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = keyFn(item)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  if (process.argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] read-only script does not support --confirm`)
  }

  const argv = process.argv.slice(2)
  const jobId = readOptionalFlagValue(argv, '--jobId') ?? readOptionalFlagValue(argv, '--job-id')
  const sinceIso = parseSinceIso(argv)

  const supabase = createAdminClient()
  const query = supabase
    .from('hiring_applications')
    .select('id, job_id, ai_score, ai_recommendation, outcome_status, created_at')
    .gte('created_at', sinceIso)

  if (jobId) {
    query.eq('job_id', jobId)
  }

  const { data, error } = await query
  const rows =
    assertScriptQuerySucceeded({
      operation: 'Load applications',
      error,
      data: data as Array<any> | null,
      allowMissing: true,
    }) ?? []
  const withOutcome = rows.filter((row) => row.outcome_status)
  const byRecommendation = groupCount(withOutcome, (row) => row.ai_recommendation || 'none')
  const byOutcome = groupCount(withOutcome, (row) => row.outcome_status || 'none')

  const hired = withOutcome.filter((row) => row.outcome_status === 'hired')
  const rejected = withOutcome.filter((row) => row.outcome_status === 'rejected')

  const avgScore = (list: typeof rows) => {
    const scores = list.map((row) => row.ai_score).filter((score): score is number => typeof score === 'number')
    if (scores.length === 0) return null
    return scores.reduce((sum, score) => sum + score, 0) / scores.length
  }

  const invitePred = withOutcome.filter((row) => row.ai_recommendation === 'invite')
  const inviteHired = invitePred.filter((row) => row.outcome_status === 'hired')
  const inviteRejected = invitePred.filter((row) => row.outcome_status === 'rejected')

  const { data: overridesData, error: overridesError } = await (supabase as any)
    .from('hiring_application_overrides')
    .select('override_type, reason, created_at')
    .gte('created_at', sinceIso)
  const overrides =
    assertScriptQuerySucceeded({
      operation: 'Load application overrides',
      error: overridesError,
      data: overridesData as Array<any> | null,
      allowMissing: true,
    }) ?? []

  console.log('Hiring screening evaluation')
  console.log(`Since: ${sinceIso}`)
  if (jobId) console.log(`Job ID: ${jobId}`)
  console.log(`Total applications: ${rows.length}`)
  console.log(`With outcomes: ${withOutcome.length}`)
  console.log('---')
  console.log('Outcome breakdown:', byOutcome)
  console.log('Recommendation breakdown:', byRecommendation)
  console.log('---')
  console.log(`Avg score (hired): ${avgScore(hired)?.toFixed(2) ?? 'n/a'}`)
  console.log(`Avg score (rejected): ${avgScore(rejected)?.toFixed(2) ?? 'n/a'}`)
  console.log('---')
  console.log(`Invite predictions: ${invitePred.length}`)
  console.log(`Invite -> hired: ${inviteHired.length}`)
  console.log(`Invite -> rejected: ${inviteRejected.length}`)
  if (overrides.length > 0) {
    const byType = groupCount(overrides, (row) => row.override_type || 'unknown')
    console.log('---')
    console.log(`Overrides: ${overrides.length}`)
    console.log('Overrides by type:', byType)
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
