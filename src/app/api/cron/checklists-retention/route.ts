import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { jobQueue } from '@/lib/unified-job-queue'

// Vercel Cron: 0 3 1 * * (03:00 UTC on the 1st). Enqueues the 24-month retention purge
// (decision 27). A no-op until mid-2028 since no row can reach 24 months old before then.
export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const res = await jobQueue.enqueue('checklist_retention_purge', {}, { unique: `checklist_retention:${new Date().toISOString().slice(0, 7)}` })
  return NextResponse.json({ ok: true, jobId: res.jobId ?? null })
}
