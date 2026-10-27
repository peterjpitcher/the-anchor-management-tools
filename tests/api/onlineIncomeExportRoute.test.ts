import { beforeEach, describe, expect, it, vi } from 'vitest'

/** BK-117: the accountant's CSV of money taken online, behind the cash-up permission. */

const state = vi.hoisted(() => ({ canView: true, rows: [] as unknown[], fail: false }))

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.canView) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/finance/online-income', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance/online-income')>()
  return {
    ...actual,
    loadOnlineIncome: vi.fn(async () => {
      if (state.fail) throw new Error('view unreadable')
      return state.rows
    }),
  }
})

import { GET } from '@/app/api/cashing-up/online-income/export/route'
import { loadOnlineIncome } from '@/lib/finance/online-income'

function get(query: string) {
  const url = `https://management.example.test/api/cashing-up/online-income/export${query}`
  const built = new Request(url)
  return GET(Object.assign(built, { nextUrl: new URL(url) }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.canView = true
  state.fail = false
  state.rows = [{
    source: 'event_ticket', sourceId: 'b1', moneyDate: '2026-10-01', reference: 'Quiz night', visitDate: '2026-10-07',
    gross: 40, refunded: 0, net: 40, method: 'paypal', captureId: 'CAP-T', paypalFee: null, status: 'earned', isBookingMoney: true,
  }]
})

describe('online income CSV export', () => {
  it('needs the cash-up permission', async () => {
    state.canView = false
    const response = await get('?from=2026-10-01&to=2026-10-31')
    expect(response.status).toBe(403)
    expect(loadOnlineIncome).not.toHaveBeenCalled()
  })

  it('refuses dates it cannot use', async () => {
    const response = await get('?from=2026-10-31&to=2026-10-01')
    expect(response.status).toBe(400)
    expect(loadOnlineIncome).not.toHaveBeenCalled()
  })

  it('downloads the payments as a CSV named for the dates', async () => {
    const response = await get('?from=2026-10-01&to=2026-10-31')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="online-income-2026-10-01-to-2026-10-31.csv"')
    expect(loadOnlineIncome).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-31', adjusted: false })
    const text = await response.text()
    expect(text).toContain('01/10/2026,Event tickets,Quiz night,07/10/2026,40.00,0.00,40.00,,PayPal,Earned (night has passed),Yes,CAP-T')
  })

  it('reports a failure instead of an empty file', async () => {
    state.fail = true
    const response = await get('?from=2026-10-01&to=2026-10-31')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to export online income.' })
  })
})
