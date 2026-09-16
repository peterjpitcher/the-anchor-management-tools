import { describe, expect, it } from 'vitest'
import { buildPeriodPresets, CUSTOM_PRESET_VALUE, presetValueFor } from '@/lib/mileage/period-presets'

const groups = buildPeriodPresets({ today: '2026-09-15', firstTripDate: '2025-12-20', lastTripDate: '2026-04-10' })

describe('buildPeriodPresets', () => {
  it('offers quick picks, the periods the trips span, and custom dates', () => {
    expect(groups.map((group) => group.label)).toEqual([
      'Quick picks',
      'Quarters with trips',
      'Financial years with trips',
      'Tax years with trips',
      'Other',
    ])
    expect(groups[0].presets).toEqual([
      { value: 'all', label: 'All time', from: null, to: null },
      { value: 'this-2026-Q3', label: 'This quarter (Q3 2026)', from: '2026-07-01', to: '2026-09-30' },
      { value: 'this-FY2026', label: 'This financial year (2026)', from: '2026-01-01', to: '2026-12-31' },
    ])
    expect(groups[1].presets.map((preset) => preset.value)).toEqual(['2026-Q2', '2026-Q1', '2025-Q4'])
    expect(groups[2].presets.map((preset) => preset.value)).toEqual(['FY2026', 'FY2025'])
    expect(groups[3].presets.map((preset) => preset.value)).toEqual(['TY2026-27', 'TY2025-26'])
    expect(groups[4].presets).toEqual([{ value: 'custom', label: 'Custom dates', from: null, to: null }])
  })

  it('offers only quick picks and custom dates when there are no trips', () => {
    const empty = buildPeriodPresets({ today: '2026-09-15', firstTripDate: null, lastTripDate: null })
    expect(empty.map((group) => group.label)).toEqual(['Quick picks', 'Other'])
  })

  it('names the quarter and financial year that today falls in, at a year boundary', () => {
    const newYear = buildPeriodPresets({ today: '2027-01-01', firstTripDate: null, lastTripDate: null })
    expect(newYear[0].presets.slice(1)).toEqual([
      { value: 'this-2027-Q1', label: 'This quarter (Q1 2027)', from: '2027-01-01', to: '2027-03-31' },
      { value: 'this-FY2027', label: 'This financial year (2027)', from: '2027-01-01', to: '2027-12-31' },
    ])
  })
})

describe('presetValueFor', () => {
  it('matches all time or a listed period, and otherwise falls back to custom', () => {
    expect(presetValueFor(groups, null, null)).toBe('all')
    expect(presetValueFor(groups, '2025-10-01', '2025-12-31')).toBe('2025-Q4')
    expect(presetValueFor(groups, '2026-04-03', '2026-04-20')).toBe(CUSTOM_PRESET_VALUE)
    expect(presetValueFor(groups, '2026-04-03', null)).toBe(CUSTOM_PRESET_VALUE)
  })

  it('prefers the quick pick when a listed period has the same dates', () => {
    const current = buildPeriodPresets({ today: '2026-09-15', firstTripDate: '2026-07-02', lastTripDate: '2026-09-14' })
    expect(presetValueFor(current, '2026-07-01', '2026-09-30')).toBe('this-2026-Q3')
  })
})
