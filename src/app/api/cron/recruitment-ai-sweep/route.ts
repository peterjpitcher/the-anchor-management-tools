import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { processRecruitmentApplicationAi } from '@/services/recruitment'

// Safety net for the recruitment intake route: its after() hook normally runs AI
// extraction/scoring post-response, but that work dies silently if the invocation is killed.
// This sweep catches up any application the hook missed. It no longer sends manager alerts:
// new and waiting applications are covered by the recruitment section of the weekly
// insights report.
export const maxDuration = 300

const SWEEP_WINDOW_HOURS = 48
// Leave the intake route's after() hook time to finish before treating work as missed.
const MIN_AGE_MINUTES = 10
const SCORING_BATCH_LIMIT = 5

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = Date.now()
  const newestIso = new Date(now - MIN_AGE_MINUTES * 60 * 1000).toISOString()
  const oldestIso = new Date(now - SWEEP_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  try {
    const { data: unscored, error: unscoredError } = await supabase
      .from('recruitment_applications')
      .select('id')
      .eq('status', 'new')
      .is('ai_score', null)
      .is('duplicate_of_application_id', null)
      .not('job_posting_id', 'is', null)
      .gte('created_at', oldestIso)
      .lte('created_at', newestIso)
      .order('created_at', { ascending: true })
      .limit(SCORING_BATCH_LIMIT)

    if (unscoredError) throw unscoredError

    const scored: string[] = []
    const scoringFailures: Array<{ id: string; error: string }> = []

    for (const row of unscored ?? []) {
      try {
        const processed = await processRecruitmentApplicationAi(row.id, supabase)
        if (processed.scoringError) {
          scoringFailures.push({ id: row.id, error: processed.scoringError })
        } else {
          scored.push(row.id)
        }
      } catch (error) {
        scoringFailures.push({
          id: row.id,
          error: error instanceof Error ? error.message : 'AI processing failed',
        })
      }
    }

    if (scoringFailures.length) {
      console.error('Recruitment AI sweep encountered failures', { scoringFailures })
    }

    return NextResponse.json({
      success: true,
      scored,
      scoringFailures,
    })
  } catch (error) {
    console.error('Recruitment AI sweep cron failed', error)
    return NextResponse.json({ error: 'Recruitment AI sweep failed' }, { status: 500 })
  }
}
