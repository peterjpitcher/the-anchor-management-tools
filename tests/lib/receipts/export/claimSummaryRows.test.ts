// @vitest-environment node
// tests/lib/receipts/export/claimSummaryRows.test.ts
import { describe, expect, it } from 'vitest'
import { claimedForQuarterRows, mileageSummaryRows } from '@/lib/receipts/export/claim-summary-pdf'

const MILEAGE = {
  trips: 3,
  milesTenths: 570,
  amountPence: 3101,
  byDriver: [
    { driverId: 'a', driverName: 'Driver A', trips: 2, milesTenths: 434, amountPence: 2353 },
    { driverId: 'b', driverName: 'Driver B', trips: 1, milesTenths: 136, amountPence: 748 },
  ],
  vatPence: 130,
  vatComplete: true,
  reportFileName: 'Mileage_Report_Q2_2026.pdf',
  csvFileName: 'Mileage_Q2_2026.csv',
}

describe('claim summary mileage rows', () => {
  it('shows trips, miles and the claim per person, the VAT figure and where the trips are', () => {
    expect(mileageSummaryRows(MILEAGE)).toEqual([
      { label: 'Total trips', value: '3' },
      { label: 'Total miles', value: '57.0' },
      { label: 'Driver A: 2 trips, 43.4 miles', value: '£23.53' },
      { label: 'Driver B: 1 trip, 13.6 miles', value: '£7.48' },
      { label: 'VAT reclaimable on fuel', value: '£1.30' },
      { label: 'Mileage claim total', value: '£31.01', bold: true },
      { label: 'Trip detail', value: 'Mileage_Report_Q2_2026.pdf' },
    ])
  })

  it('flags an incomplete VAT figure', () => {
    expect(mileageSummaryRows({ ...MILEAGE, vatComplete: false })).toContainEqual({
      label: 'VAT reclaimable on fuel (incomplete, see the report)',
      value: '£1.30',
    })
  })

  it('says when mileage is not in the pack', () => {
    expect(mileageSummaryRows(null)).toEqual([{ label: 'Mileage', value: 'Not included (no mileage access)' }])
  })
})

describe('claimed for this quarter', () => {
  it('lists mileage per person and expenses, and adds them up in pence', () => {
    expect(claimedForQuarterRows(MILEAGE, 12.3)).toEqual({
      rows: [
        { label: 'Mileage: Driver A', value: '£23.53' },
        { label: 'Mileage: Driver B', value: '£7.48' },
        { label: 'Expenses', value: '£12.30' },
      ],
      total: 'Total claimed: £43.31',
    })
  })

  it('totals expenses alone when mileage is not in the pack', () => {
    expect(claimedForQuarterRows(null, 0.1 + 0.2)).toEqual({
      rows: [{ label: 'Expenses', value: '£0.30' }],
      total: 'Total claimed: £0.30',
    })
  })
})
