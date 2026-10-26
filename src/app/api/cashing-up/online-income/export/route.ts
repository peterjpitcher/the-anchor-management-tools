import { NextRequest, NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { buildOnlineIncomeCsv, loadOnlineIncome } from '@/lib/finance/online-income'
import { resolveOnlineIncomeRange } from '@/lib/finance/online-income-range'
import { logger } from '@/lib/logger'

/** CSV of money taken online between two London dates (BK-117), for the accountant. */
export async function GET(request: NextRequest) {
  const canView = await checkUserPermission('cashing_up', 'view')
  if (!canView) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const range = resolveOnlineIncomeRange(
    request.nextUrl.searchParams.get('from'),
    request.nextUrl.searchParams.get('to')
  )
  if (range.adjusted) {
    return NextResponse.json({ error: 'Choose a date range of no more than 400 days, oldest date first.' }, { status: 400 })
  }

  try {
    const rows = await loadOnlineIncome(range)
    const csv = buildOnlineIncomeCsv(rows)
    return new NextResponse(new Uint8Array(csv), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="online-income-${range.from}-to-${range.to}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logger.error('Failed to export online income', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: range,
    })
    return NextResponse.json({ error: 'Failed to export online income.' }, { status: 500 })
  }
}
