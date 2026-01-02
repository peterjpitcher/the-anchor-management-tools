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

const jobId = args.get('jobId') || null
const sinceArg = args.get('since')
const sinceDate = sinceArg ? new Date(sinceArg) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
const sinceIso = sinceDate.toISOString()

function groupCount<T>(items: T[], keyFn: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = keyFn(item)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

async function run() {
  const query = supabase
    .from('hiring_applications')
    .select('id, job_id, ai_score, ai_recommendation, outcome_status, created_at')
    .gte('created_at', sinceIso)

  if (jobId) {
    query.eq('job_id', jobId)
  }

  const { data, error } = await query
  if (error) {
    console.error('Failed to load applications:', error)
    process.exit(1)
  }

  const rows = data || []
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

  const { data: overrides } = await supabase
    .from('hiring_application_overrides')
    .select('override_type, reason, created_at')
    .gte('created_at', sinceIso)

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
  if (overrides && overrides.length > 0) {
    const byType = groupCount(overrides, (row) => row.override_type || 'unknown')
    console.log('---')
    console.log(`Overrides: ${overrides.length}`)
    console.log('Overrides by type:', byType)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
