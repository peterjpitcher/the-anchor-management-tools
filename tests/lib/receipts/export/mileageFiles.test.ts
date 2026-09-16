import { beforeEach, describe, expect, it, vi } from 'vitest'

const renderMileageReportPdf = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mileage/report/pdf', () => ({ renderMileageReportPdf }))

import { buildDatasetJson } from '../../../fixtures/mileage/reportDataset'
import { buildQuarterMileageFiles } from '@/lib/receipts/export/mileage-files'

function fakeDb(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { db: { rpc } as never, rpc }
}

describe('buildQuarterMileageFiles', () => {
  beforeEach(() => {
    renderMileageReportPdf.mockReset()
    vi.restoreAllMocks()
  })

  it('builds the CSV, the report PDF and the claim figures from one dataset call', async () => {
    renderMileageReportPdf.mockResolvedValue(Buffer.from('%PDF-1.7'))
    const { db, rpc } = fakeDb({ data: buildDatasetJson(), error: null })

    const files = await buildQuarterMileageFiles(db, 2026, 2)

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('mileage_report_dataset_v01', { p_from: '2026-04-01', p_to: '2026-06-30' })
    expect(files.csv.name).toBe('Mileage_Q2_2026.csv')
    expect(files.csv.content.toString('utf8')).toContain('Total claim (£),31.01')
    expect(files.pdf).toEqual({ name: 'Mileage_Report_Q2_2026.pdf', content: Buffer.from('%PDF-1.7') })
    expect(renderMileageReportPdf.mock.calls[0][0].scope.driverId).toBeNull()
    expect(files.summary).toMatchObject({
      trips: 3,
      milesTenths: 570,
      amountPence: 3101,
      vatPence: 130,
      vatComplete: true,
      reportFileName: 'Mileage_Report_Q2_2026.pdf',
      csvFileName: 'Mileage_Q2_2026.csv',
    })
    expect(files.summary.byDriver.map((driver) => [driver.driverName, driver.amountPence])).toEqual([
      ['Driver A', 2353],
      ['Driver B', 748],
    ])
  })

  it('fails instead of returning partial files when the data cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb({ data: null, error: { code: '57014', message: 'timeout', details: null, hint: null } })
    await expect(buildQuarterMileageFiles(db, 2026, 2)).rejects.toMatchObject({ code: 'MILEAGE_REPORT_QUERY_FAILED' })
    expect(renderMileageReportPdf).not.toHaveBeenCalled()
  })

  it('fails when the report PDF cannot be built', async () => {
    renderMileageReportPdf.mockRejectedValue(Object.assign(new Error('render failed'), { code: 'MILEAGE_REPORT_RENDER_FAILED' }))
    const { db } = fakeDb({ data: buildDatasetJson(), error: null })
    await expect(buildQuarterMileageFiles(db, 2026, 2)).rejects.toMatchObject({ code: 'MILEAGE_REPORT_RENDER_FAILED' })
  })
})
