import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/services/financials', () => ({
  FinancialService: {
    getPlDashboardData: vi.fn(),
  },
}))

vi.mock('@/lib/pnl/report-view-model', () => ({
  buildPnlReportViewModel: vi.fn(),
}))

vi.mock('@/lib/pnl/report-template', () => ({
  generatePnlReportHTML: vi.fn(),
}))

vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(),
}))

import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { GET } from '@/app/api/receipts/pnl/export/route'
import { getCurrentUser } from '@/lib/audit-helpers'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { generatePnlReportHTML } from '@/lib/pnl/report-template'
import { buildPnlReportViewModel } from '@/lib/pnl/report-view-model'
import { FinancialService } from '@/services/financials'

const MOCK_DASHBOARD = {
  metrics: [],
  timeframes: [],
  actuals: { '1m': {}, '3m': {}, '12m': {} },
  targets: {},
  manualActuals: {},
  expenseTotals: { '1m': 0, '3m': 0, '12m': 0 },
}

const MOCK_VIEW_MODEL = {
  timeframe: '12m' as const,
  timeframeLabel: 'Last 365 days',
  generatedAtIso: '2026-02-23T12:00:00.000Z',
  generatedAtLabel: '23 Feb 2026, 12:00 UTC',
  sections: [],
  summary: {
    revenueActual: 0,
    revenueTarget: 0,
    revenueVariance: 0,
    expenseActual: 0,
    expenseTarget: 0,
    expenseVariance: 0,
    operatingProfitActual: 0,
    operatingProfitTarget: 0,
    operatingProfitVariance: 0,
  },
}

describe('receipts P&L export route', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-23T12:00:00.000Z'))
    vi.clearAllMocks()

    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(true)
    ;(FinancialService.getPlDashboardData as unknown as vi.Mock).mockResolvedValue(MOCK_DASHBOARD)
    ;(buildPnlReportViewModel as unknown as vi.Mock).mockImplementation((_, timeframe: '1m' | '3m' | '12m') => ({
      ...MOCK_VIEW_MODEL,
      timeframe,
    }))
    ;(generatePnlReportHTML as unknown as vi.Mock).mockReturnValue('<html><body>ok</body></html>')
    ;(generatePDFFromHTML as unknown as vi.Mock).mockResolvedValue(Buffer.from('fake-pdf-data'))
    ;(getCurrentUser as unknown as vi.Mock).mockResolvedValue({ user_id: 'user-1', user_email: 'user@example.com' })
    ;(logAuditEvent as unknown as vi.Mock).mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 400 for invalid timeframe query values', async () => {
    const request = new Request('http://localhost/api/receipts/pnl/export?timeframe=invalid')

    const response = await GET(request as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({ error: 'Invalid timeframe parameter.' })
    expect(FinancialService.getPlDashboardData).not.toHaveBeenCalled()
  })

  it('defaults timeframe to 12m when omitted', async () => {
    const request = new Request('http://localhost/api/receipts/pnl/export')

    const response = await GET(request as any)

    expect(response.status).toBe(200)
    expect(buildPnlReportViewModel).toHaveBeenCalledWith(MOCK_DASHBOARD, '12m', expect.any(Date))
  })

  it('returns 403 when export permission is missing', async () => {
    ;(checkUserPermission as unknown as vi.Mock).mockResolvedValue(false)

    const request = new Request('http://localhost/api/receipts/pnl/export?timeframe=1m')
    const response = await GET(request as any)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload).toEqual({ error: 'Permission denied' })
  })

  it('returns a generic 500 payload when permission checks throw unexpectedly', async () => {
    ;(checkUserPermission as unknown as vi.Mock).mockRejectedValue(
      new Error('sensitive permission backend diagnostics')
    )

    const request = new Request('http://localhost/api/receipts/pnl/export?timeframe=12m')
    const response = await GET(request as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Failed to generate P&L report export.' })
    expect('details' in payload).toBe(false)
  })

  it('returns a PDF attachment with timeframe and date in the filename', async () => {
    const request = new Request('http://localhost/api/receipts/pnl/export?timeframe=3m')

    const response = await GET(request as any)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toContain(
      'attachment; filename="pnl-shadow-report-3m-2026-02-23.pdf"'
    )

    const body = await response.arrayBuffer()
    expect(body.byteLength).toBeGreaterThan(0)

    expect(buildPnlReportViewModel).toHaveBeenCalledWith(MOCK_DASHBOARD, '3m', expect.any(Date))
    expect(logAuditEvent).toHaveBeenCalledTimes(1)
  })
})
