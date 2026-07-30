import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

import { requireModulePermission } from '@/lib/api/permissions'
import type { VoucherBatchRow } from '@/types/vouchers'

const VOUCHER_BUCKET = 'vouchers'
const SIGNED_URL_TTL_SECONDS = 600

// GET /api/vouchers/batches/[id]/download
// Default: 302 redirect to a 10-minute signed URL for the batch PDF (batch
// must be 'ready', spec F42).
// With ?info=1: returns { deadCount } = vouchers in the batch that are no
// longer 'generated', so the UI can warn before re-downloading an old batch
// PDF ("this file contains N cards that have since been issued/cancelled",
// spec F28).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params

  const auth = await requireModulePermission('vouchers', 'manage')
  if (!auth.ok) return auth.response
  const supabase = auth.supabase

  const { data: batch, error: batchError } = await supabase
    .from('voucher_batches')
    .select('id, pdf_status, pdf_path')
    .eq('id', batchId)
    .maybeSingle<Pick<VoucherBatchRow, 'id' | 'pdf_status' | 'pdf_path'>>()

  if (batchError) {
    console.error('Failed to load voucher batch for download:', batchError)
    return NextResponse.json({ error: 'Failed to load batch' }, { status: 500 })
  }
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  if (request.nextUrl.searchParams.get('info') === '1') {
    const { count, error: countError } = await supabase
      .from('vouchers')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .neq('status', 'generated')

    if (countError) {
      console.error('Failed to count non-generated vouchers for batch:', countError)
      return NextResponse.json({ error: 'Failed to load batch info' }, { status: 500 })
    }

    return NextResponse.json({ deadCount: count ?? 0, pdfStatus: batch.pdf_status })
  }

  if (batch.pdf_status !== 'ready' || !batch.pdf_path) {
    return NextResponse.json(
      { error: 'Batch PDF is not ready', status: batch.pdf_status },
      { status: 409 }
    )
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(VOUCHER_BUCKET)
    .createSignedUrl(batch.pdf_path, SIGNED_URL_TTL_SECONDS, {
      download: `voucher-batch-${batch.id.slice(0, 8)}.pdf`,
    })

  if (signError || !signed?.signedUrl) {
    console.error('Failed to sign voucher batch PDF URL:', signError)
    return NextResponse.json({ error: 'Failed to create download link' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl, 302)
}
