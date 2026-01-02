#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const args = new Map(process.argv.slice(2).map((entry) => {
  const [key, value] = entry.replace(/^--/, '').split('=')
  return [key, value ?? '']
}))

const sinceArg = args.get('since')
const sinceDate = sinceArg ? new Date(sinceArg) : new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
const sinceIso = sinceDate.toISOString()

type ScoreRow = {
  job_id: string
  ai_score: number | null
  outcome_status: string | null
  job: { title: string }
}

function average(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

async function run() {
  const { data, error } = await supabase
    .from('hiring_applications')
    .select('job_id, ai_score, outcome_status, job:hiring_jobs(title)')
    .gte('created_at', sinceIso)

  if (error) {
    console.error('Failed to load application scores:', error)
    process.exit(1)
  }

  const rows = (data || []) as ScoreRow[]
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

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
