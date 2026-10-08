import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import {
  isRecruitmentRetentionApplyEnabled,
  runRecruitmentRetentionCleanup,
} from '@/services/recruitment-retention'

/**
 * Nightly. Removes nothing unless RECRUITMENT_RETENTION_APPLY is `true`.
 *
 * With the switch off this is a dry run: it counts what would be removed and
 * answers with the figures, and writes nothing. `?dry_run=1` forces a dry run
 * even with the switch on, for checking the numbers by hand.
 *
 * A run in which any candidate could not be cleared answers 500, so the cron
 * shows as failed rather than passing quietly with somebody's CV still held.
 * No name, email or phone is ever in the answer or the log: candidates are
 * named by id only.
 */
export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const forcedDryRun = ['1', 'true'].includes(request.nextUrl.searchParams.get('dry_run') ?? '')
  const dryRun = forcedDryRun || !isRecruitmentRetentionApplyEnabled()

  try {
    const result = await runRecruitmentRetentionCleanup({ dryRun })

    if (result.failed.length > 0) {
      console.error('Recruitment retention could not clear every candidate', {
        failed: result.failed,
        cleared: result.cleared,
        remaining: result.remaining,
      })
      return NextResponse.json(
        { success: false, error: 'Recruitment retention could not clear every candidate', result },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, result })
  } catch (error) {
    console.error('Recruitment retention cron failed', error)
    return NextResponse.json({ error: 'Recruitment retention cleanup failed' }, { status: 500 })
  }
}
