import { NextResponse } from 'next/server'
import { requireFohVoucherPermission, getLondonDateIso } from '@/lib/foh/api-auth'

// Counts strip for the FOH voucher page (spec section 4):
// in stock (generated + batch ready), out (issued), redeemed today (London date).
export async function GET() {
  const auth = await requireFohVoucherPermission('view')
  if (!auth.ok) {
    return auth.response
  }

  const londonToday = getLondonDateIso()
  // 48h is comfortably wider than any London/UTC offset, so the JS London-date
  // filter below never misses a redemption from earlier today.
  const redeemedSince = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const [inStockResult, outResult, redeemedResult] = await Promise.all([
    auth.supabase
      .from('vouchers')
      .select('id, voucher_batches!inner(pdf_status)', { count: 'exact', head: true })
      .eq('status', 'generated')
      .eq('voucher_batches.pdf_status', 'ready'),
    auth.supabase
      .from('vouchers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'issued'),
    auth.supabase
      .from('vouchers')
      .select('redeemed_at')
      .eq('status', 'redeemed')
      .gte('redeemed_at', redeemedSince)
  ])

  if (inStockResult.error || outResult.error || redeemedResult.error) {
    return NextResponse.json({ error: 'Failed to load voucher counts' }, { status: 500 })
  }

  const redeemedToday = ((redeemedResult.data ?? []) as Array<{ redeemed_at: string | null }>)
    .filter((row) => row.redeemed_at && getLondonDateIso(new Date(row.redeemed_at)) === londonToday)
    .length

  return NextResponse.json({
    success: true,
    data: {
      inStock: inStockResult.count ?? 0,
      out: outResult.count ?? 0,
      redeemedToday
    }
  })
}
