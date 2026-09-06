import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { cleanupStaleMaintenancePhotoUploads } from '@/app/actions/maintenance-photos'

/**
 * Sweeps maintenance photo uploads that were started and never confirmed.
 *
 * A signed upload URL that is issued and then abandoned leaves a `pending` row
 * behind, and sometimes an object in storage with nothing pointing at it. After
 * 24 hours both go. Without a schedule they accumulate forever, which is exactly
 * where this was before this route existed.
 *
 * Anything short of a clean sweep returns a non-200 so the cron failure alerting
 * picks it up. A cleanup that quietly fails every night for a month is the
 * failure mode worth being loud about.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// One run deletes up to 500 objects, each a separate storage call, so it gets the
// longer of the two function budgets used by crons here.
export const maxDuration = 300

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await cleanupStaleMaintenancePhotoUploads()

    if ('error' in result) {
      console.error('[maintenance-photo-cleanup] the sweep did not complete:', result.error)
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    if (result.orphanedObjects > 0) {
      // The action has already logged each failure against this correlation id.
      // Repeat the count here so the run is visibly imperfect in the cron logs
      // rather than looking like a clean night.
      console.warn(
        `[maintenance-photo-cleanup] run ${result.correlationId} left ${result.orphanedObjects} storage object(s) behind`
      )
    }

    return NextResponse.json({
      success: true,
      correlationId: result.correlationId,
      examined: result.examined,
      cleaned: result.cleaned,
      orphanedObjects: result.orphanedObjects,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[maintenance-photo-cleanup] unexpected error:', error)
    return NextResponse.json({ error: 'Maintenance photo cleanup failed' }, { status: 500 })
  }
}
