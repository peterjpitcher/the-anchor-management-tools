import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { performReceiptStorageSweep } from '@/services/receipts/receiptSweep'

/**
 * Sweeps receipt uploads that were started and never finished, and reports what it will not
 * touch: stored files nothing refers to, and payments completed with no receipt and no reason.
 *
 * Anything short of a clean sweep returns a non-200, so the cron failure alerting picks it up.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Each abandoned upload is a database call and a storage call, and the bucket is listed in full.
export const maxDuration = 300

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await performReceiptStorageSweep()

    if (result.removeFailed > 0) {
      console.error(`[receipts-sweep] ${result.removeFailed} abandoned file(s) could not be removed from storage`)
      return NextResponse.json({ error: 'Some abandoned files could not be removed', ...result }, { status: 500 })
    }

    if (result.unreferencedObjects > 0) {
      // Not removed: something stored with no record may still be wanted. Loud, so it is looked at.
      console.warn(
        `[receipts-sweep] ${result.unreferencedObjects} stored file(s) have no record: ${result.unreferencedSample.join(', ')}`
      )
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[receipts-sweep] the sweep did not complete:', error)
    return NextResponse.json({ error: 'Receipts sweep failed' }, { status: 500 })
  }
}
