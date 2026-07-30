import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

import { requireModulePermission } from '@/lib/api/permissions'

// GET /api/vouchers/batches/[id]/manifest
// CSV manifest of the batch: number,type,status,generatedAt (spec 3.2).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: batchId } = await params

  const auth = await requireModulePermission('vouchers', 'manage')
  if (!auth.ok) return auth.response
  const supabase = auth.supabase

  const { data: batch, error: batchError } = await supabase
    .from('voucher_batches')
    .select('id')
    .eq('id', batchId)
    .maybeSingle<{ id: string }>()

  if (batchError) {
    console.error('Failed to load voucher batch for manifest:', batchError)
    return NextResponse.json({ error: 'Failed to load batch' }, { status: 500 })
  }
  if (!batch) {
    return NextResponse.json({ error: 'Batch not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const { data: vouchers, error: vouchersError } = await supabase
    .from('vouchers')
    .select('voucher_number, type_id, status, created_at')
    .eq('batch_id', batchId)
    .order('voucher_number', { ascending: true })

  if (vouchersError) {
    console.error('Failed to load vouchers for manifest:', vouchersError)
    return NextResponse.json({ error: 'Failed to load vouchers' }, { status: 500 })
  }

  const rows = (vouchers ?? []) as Array<{
    voucher_number: string
    type_id: string
    status: string
    created_at: string
  }>

  const lines = ['number,type,status,generatedAt']
  for (const row of rows) {
    lines.push(
      [row.voucher_number, row.type_id, row.status, row.created_at].map(csvField).join(',')
    )
  }

  return new NextResponse(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="voucher-manifest-${batch.id.slice(0, 8)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
