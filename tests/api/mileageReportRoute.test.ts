// @vitest-environment node
// tests/api/mileageReportRoute.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkUserPermission: vi.fn(),
  rpc: vi.fn(),
  renderMileageReportPdf: vi.fn(),
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/mileage/report/pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mileage/report/pdf')>()),
  renderMileageReportPdf: mocks.renderMileageReportPdf,
}))

import { GET } from '@/app/api/mileage/report/route'
import { MileageReportError } from '@/lib/mileage/report/errors'
import { buildDatasetJson, DRIVER_B_ID } from '../fixtures/mileage/reportDataset'

const Q2 = 'from=2026-04-01&to=2026-06-30'

function get(query: string) {
  return GET(new Request(`http://localhost/api/mileage/report?${query}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@example.com' } } })
  mocks.checkUserPermission.mockResolvedValue(true)
  mocks.rpc.mockResolvedValue({ data: buildDatasetJson(), error: null })
  mocks.renderMileageReportPdf.mockResolvedValue(Buffer.from('%PDF-1.7'))
  mocks.logAuditEvent.mockResolvedValue(undefined)
})

describe('GET /api/mileage/report', () => {
  it('returns a private PDF attachment and records the export', async () => {
    const response = await get(`${Q2}&driver=all`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="Mileage_Report_2026-Q2.pdf"')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-1.7')
    expect(mocks.checkUserPermission).toHaveBeenCalledWith('mileage', 'view', 'user-1')
    expect(mocks.rpc).toHaveBeenCalledWith('mileage_report_dataset_v01', { p_from: '2026-04-01', p_to: '2026-06-30' })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'export',
        resource_type: 'mileage_report',
        operation_status: 'success',
        additional_info: expect.objectContaining({
          from: '2026-04-01',
          to: '2026-06-30',
          driver_scope: 'all',
          trip_count: 3,
          delivery_confirmed: false,
        }),
      })
    )
  })

  it('names a one-person report after that person', async () => {
    const response = await get(`${Q2}&driver=${DRIVER_B_ID}`)
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="Mileage_Report_2026-Q2_Driver_B.pdf"')
  })

  it('refuses without permission before reading any mileage data', async () => {
    mocks.checkUserPermission.mockResolvedValue(false)

    const response = await get(`${Q2}&driver=all`)

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ code: 'MILEAGE_FORBIDDEN', error: "You don't have access to mileage reports." })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('refuses a request with no signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const response = await get(`${Q2}&driver=all`)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'MILEAGE_FORBIDDEN', error: "You don't have access to mileage reports." })
    expect(mocks.checkUserPermission).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns a coded private error when the sign-in check itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getUser.mockRejectedValue(new Error('auth service unavailable'))

    const response = await get(`${Q2}&driver=all`)

    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      code: 'MILEAGE_REPORT_QUERY_FAILED',
      error: "Couldn't load the mileage data. Nothing was downloaded. Try again.",
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['from=2026-06-30&to=2026-04-01&driver=all', 'The start date must be on or before the end date.'],
    ['from=2020-01-01&to=2026-06-30&driver=all', 'Choose dates no more than five years apart.'],
    ['from=2026-02-30&to=2026-06-30&driver=all', 'Choose a valid start and end date.'],
    [Q2, 'Choose the dates and driver for the report.'],
    [`${Q2}&driver=all&q=shop`, 'Choose the dates and driver for the report.'],
    [`${Q2}&driver=all&driver=all`, 'Choose the dates and driver for the report.'],
    [`${Q2}&driver=00000000-0000-4000-8000-00000000ffff`, 'Choose a driver from the list.'],
  ])('rejects %s', async (query, message) => {
    const response = await get(query)

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ code: 'MILEAGE_REPORT_INVALID_RANGE', error: message })
    expect(mocks.renderMileageReportPdf).not.toHaveBeenCalled()
  })

  it('returns 413 when the dates hold more trips than one report allows', async () => {
    const trip = buildDatasetJson().trips[0]
    mocks.rpc.mockResolvedValue({ data: buildDatasetJson({ trips: Array.from({ length: 5001 }, () => trip) }), error: null })

    const response = await get(`${Q2}&driver=all`)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      code: 'MILEAGE_REPORT_TOO_LARGE',
      error: 'This period is too large for one report. Choose shorter dates.',
    })
  })

  it('returns 500 and records the failed stage when the database fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null },
    })

    const response = await get(`${Q2}&driver=all`)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      code: 'MILEAGE_REPORT_QUERY_FAILED',
      error: "Couldn't load the mileage data. Nothing was downloaded. Try again.",
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_status: 'failure',
        error_message: 'MILEAGE_REPORT_QUERY_FAILED',
        additional_info: expect.objectContaining({ failed_stage: 'query' }),
      })
    )
  })

  it('returns 500 when the PDF cannot be built, without logging names', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.renderMileageReportPdf.mockRejectedValue(new MileageReportError('MILEAGE_REPORT_RENDER_FAILED'))

    const response = await get(`${Q2}&driver=all`)

    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      code: 'MILEAGE_REPORT_RENDER_FAILED',
      error: "Couldn't build the PDF. Nothing was downloaded. Try again.",
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ additional_info: expect.objectContaining({ failed_stage: 'render' }) })
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/Driver [AB]/)
  })

  it('still returns the PDF when the audit write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.logAuditEvent.mockRejectedValue(new Error('audit table unavailable'))
    const response = await get(`${Q2}&driver=all`)
    expect(response.status).toBe(200)
  })
})
