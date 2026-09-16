// @vitest-environment node
// tests/api/receiptsExportMileage.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  function resolvedChain(data: unknown) {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'gte', 'lte', 'order', 'eq']) chain[method] = vi.fn(() => chain)
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject)
    return chain
  }
  return {
    resolvedChain,
    roles: [] as Array<{ roles: { name: string } }>,
    checkUserPermission: vi.fn(),
    getUser: vi.fn(),
    buildQuarterMileageFiles: vi.fn(),
    appendClaimSummaryPdf: vi.fn(),
  }
})

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => mocks.resolvedChain(table === 'user_roles' ? mocks.roles : []),
  }),
}))
vi.mock('@/lib/receipts/export/oj-project-invoices', () => ({
  loadOjProjectInvoicesPaidInQuarter: vi.fn().mockResolvedValue([]),
  appendOjProjectInvoices: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/receipts/export', () => ({
  buildQuarterMileageFiles: mocks.buildQuarterMileageFiles,
  buildExpensesCsv: vi.fn().mockResolvedValue({
    csv: Buffer.from('expenses'),
    summary: { totalEntries: 0, grossTotal: 0, vatTotal: 0, expenseIds: [] },
    rows: [],
  }),
  buildMgdCsv: vi.fn().mockResolvedValue({ csv: Buffer.from('mgd'), fileName: 'MGD_Q2_2026.csv', summary: {}, rows: [] }),
  appendExpenseImages: vi.fn().mockResolvedValue(0),
  appendClaimSummaryPdf: mocks.appendClaimSummaryPdf,
}))

import { GET } from '@/app/api/receipts/export/route'

const SUMMARY = {
  trips: 3,
  milesTenths: 570,
  amountPence: 3101,
  byDriver: [],
  vatPence: 130,
  vatComplete: true,
  reportFileName: 'Mileage_Report_Q2_2026.pdf',
  csvFileName: 'Mileage_Q2_2026.csv',
}

function get() {
  return GET(new Request('http://localhost/api/receipts/export?year=2026&quarter=2') as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  mocks.roles = [{ roles: { name: 'super_admin' } }]
  mocks.checkUserPermission.mockResolvedValue(true)
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mocks.appendClaimSummaryPdf.mockResolvedValue(undefined)
  mocks.buildQuarterMileageFiles.mockResolvedValue({
    csv: { name: 'Mileage_Q2_2026.csv', content: Buffer.from('csv') },
    pdf: { name: 'Mileage_Report_Q2_2026.pdf', content: Buffer.from('%PDF-1.7') },
    summary: SUMMARY,
  })
})

describe('receipts pack mileage files', () => {
  it('adds the mileage CSV and report PDF and gives the claim summary the figures', async () => {
    const response = await get()

    expect(response.status).toBe(200)
    // Zip entries store their names uncompressed, so the raw bytes contain them.
    const zip = Buffer.from(await response.arrayBuffer())
    expect(zip.includes('Mileage_Q2_2026.csv')).toBe(true)
    expect(zip.includes('Mileage_Report_Q2_2026.pdf')).toBe(true)
    expect(mocks.buildQuarterMileageFiles).toHaveBeenCalledWith(expect.anything(), 2026, 2)
    expect(mocks.appendClaimSummaryPdf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mileage: SUMMARY }))
  })

  it('gives someone with mileage access but no super admin role the mileage files and no claim summary', async () => {
    mocks.roles = [{ roles: { name: 'manager' } }]

    const response = await get()

    expect(response.status).toBe(200)
    const zip = Buffer.from(await response.arrayBuffer())
    expect(zip.includes('Mileage_Q2_2026.csv')).toBe(true)
    expect(zip.includes('Mileage_Report_Q2_2026.pdf')).toBe(true)
    expect(zip.includes('README.txt')).toBe(false)
    expect(mocks.appendClaimSummaryPdf).not.toHaveBeenCalled()
  })

  it('leaves mileage out for someone without mileage access', async () => {
    mocks.checkUserPermission.mockImplementation(async (moduleName: string) => moduleName !== 'mileage')

    const response = await get()

    expect(response.status).toBe(200)
    expect(mocks.buildQuarterMileageFiles).not.toHaveBeenCalled()
    expect(Buffer.from(await response.arrayBuffer()).includes('Mileage_Report_Q2_2026.pdf')).toBe(false)
    expect(mocks.appendClaimSummaryPdf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mileage: null }))
  })

  it('fails the whole pack when a mileage file fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.buildQuarterMileageFiles.mockRejectedValue(new Error('render failed'))

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to generate receipts export.' })
  })
})
