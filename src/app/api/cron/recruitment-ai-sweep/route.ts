import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { sendRecruitmentManagerAlert } from '@/lib/recruitment/communications'
import { createAdminClient } from '@/lib/supabase/admin'
import { processRecruitmentApplicationAi } from '@/services/recruitment'

// Safety net for the recruitment intake route: its after() hook normally runs AI
// extraction/scoring and the manager alert post-response, but that work dies silently if the
// invocation is killed. This sweep catches up any application the hook missed.
export const maxDuration = 300

const SWEEP_WINDOW_HOURS = 48
// Leave the intake route's after() hook time to finish before treating work as missed.
const MIN_AGE_MINUTES = 10
const SCORING_BATCH_LIMIT = 5
const ALERT_BATCH_LIMIT = 10

type SweepApplication = {
  id: string
  ai_score: number | null
  ai_recommendation: string | null
  candidate: { first_name: string | null; last_name: string | null; email: string | null } | null
  job_posting: { title: string | null } | null
}

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

    // Website applications are alerted by the intake route's after() hook; resend any alert
    // that never made it into recruitment_communications.
    const { data: websiteAppsData, error: websiteError } = await supabase
      .from('recruitment_applications')
      .select('id, ai_score, ai_recommendation, candidate:recruitment_candidates(first_name, last_name, email), job_posting:recruitment_job_postings(title)')
      .eq('source', 'website')
      .gte('created_at', oldestIso)
      .lte('created_at', newestIso)
      .order('created_at', { ascending: true })

    if (websiteError) throw websiteError

    const websiteApps = (websiteAppsData ?? []) as unknown as SweepApplication[]
    let missingAlerts: SweepApplication[] = []
    if (websiteApps.length) {
      const { data: alerts, error: alertsError } = await supabase
        .from('recruitment_communications')
        .select('application_id')
        .eq('type', 'manager_alert')
        .in('application_id', websiteApps.map((app) => app.id))

      if (alertsError) throw alertsError

      const alerted = new Set((alerts ?? []).map((alert) => alert.application_id))
      missingAlerts = websiteApps.filter((app) => !alerted.has(app.id)).slice(0, ALERT_BATCH_LIMIT)
    }

    const alertsSent: string[] = []
    const alertFailures: Array<{ id: string; error: string }> = []

    for (const app of missingAlerts) {
      const name =
        `${app.candidate?.first_name ?? ''} ${app.candidate?.last_name ?? ''}`.trim() ||
        app.candidate?.email ||
        'A candidate'

      try {
        await sendRecruitmentManagerAlert({
          applicationId: app.id,
          alertType: app.ai_recommendation === 'fast_track' ? 'fast-track' : 'new application',
          alertBody: [
            name,
            app.job_posting?.title ? `applied for ${app.job_posting.title}.` : 'joined the recruitment talent pool.',
            app.ai_score != null ? `AI score: ${app.ai_score}.` : '',
          ].filter(Boolean).join(' '),
        }, supabase)
        alertsSent.push(app.id)
      } catch (error) {
        alertFailures.push({
          id: app.id,
          error: error instanceof Error ? error.message : 'Manager alert failed',
        })
      }
    }

    if (scoringFailures.length || alertFailures.length) {
      console.error('Recruitment AI sweep encountered failures', { scoringFailures, alertFailures })
    }

    return NextResponse.json({
      success: true,
      scored,
      scoringFailures,
      alertsSent,
      alertFailures,
    })
  } catch (error) {
    console.error('Recruitment AI sweep cron failed', error)
    return NextResponse.json({ error: 'Recruitment AI sweep failed' }, { status: 500 })
  }
}
