#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'calibrate-hiring-thresholds'
const DEFAULT_SINCE_DAYS = 180

type ScoreRow = {
  job_id: string
  ai_score: number | null
  outcome_status: string | null
  job: { title: string } | null
}

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

function average(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  if (process.argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] read-only script does not support --confirm`)
  }

  const sinceIso = parseSinceIso(process.argv.slice(2))
  const supabase = createAdminClient()
  const { data, error } = await (supabase.from('hiring_applications') as any)
    .select('job_id, ai_score, outcome_status, job:hiring_jobs(title)')
    .gte('created_at', sinceIso)

  const rows =
    (assertScriptQuerySucceeded({
      operation: 'Load application scores',
      error,
      data: data as ScoreRow[] | null,
      allowMissing: true,
    }) ?? []) as ScoreRow[]
  const byJob = new Map<string, ScoreRow[]>()

  for (const row of rows) {
    if (!row.job_id) continue
    const list = byJob.get(row.job_id) || []
    list.push(row)
    byJob.set(row.job_id, list)
  }

  console.log('Hiring screening calibration (suggested thresholds)')
  console.log(`Since: ${sinceIso}`)
  console.log('---')

  for (const [jobId, jobRows] of byJob.entries()) {
    const title = jobRows[0]?.job?.title || jobId
    const scores = jobRows.map((row) => row.ai_score).filter((score): score is number => typeof score === 'number')
    const hiredScores = jobRows
      .filter((row) => row.outcome_status === 'hired')
      .map((row) => row.ai_score)
      .filter((score): score is number => typeof score === 'number')
    const rejectedScores = jobRows
      .filter((row) => row.outcome_status === 'rejected')
      .map((row) => row.ai_score)
      .filter((score): score is number => typeof score === 'number')

    const avgAll = average(scores)
    const avgHired = average(hiredScores)
    const avgRejected = average(rejectedScores)

    const inviteSuggested = avgHired != null && avgRejected != null
      ? Math.round((avgHired + avgRejected) / 2)
      : null
    const clarifySuggested = avgRejected != null
      ? Math.max(0, Math.round(avgRejected))
      : null

    console.log(`${title}`)
    console.log(`  Total scored: ${scores.length}`)
    console.log(`  Avg score (all): ${avgAll?.toFixed(2) ?? 'n/a'}`)
    console.log(`  Avg score (hired): ${avgHired?.toFixed(2) ?? 'n/a'}`)
    console.log(`  Avg score (rejected): ${avgRejected?.toFixed(2) ?? 'n/a'}`)
    console.log(`  Suggested invite threshold: ${inviteSuggested ?? 'n/a'}`)
    console.log(`  Suggested clarify threshold: ${clarifySuggested ?? 'n/a'}`)
    console.log('')
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
