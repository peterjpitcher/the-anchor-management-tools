/**
 * Period presets for the trips page (spec 7.1): all time, this quarter, this financial year, each
 * quarter, financial year and tax year from the first trip to the latest, and custom dates.
 * A period inside that span with no trips still appears and shows an empty table.
 */

import { financialYearOptions, quarterOptions, taxYearOptions } from './period-options'

type PeriodOption = ReturnType<typeof quarterOptions>[number]

const ALL_TIME_PRESET_VALUE = 'all'
export const CUSTOM_PRESET_VALUE = 'custom'

interface PeriodPreset {
  value: string
  label: string
  from: string | null
  to: string | null
}

export interface PeriodPresetGroup {
  label: string
  presets: PeriodPreset[]
}

function toPreset(option: PeriodOption): PeriodPreset {
  return { value: option.value, label: option.label, from: option.period.from, to: option.period.to }
}

export function buildPeriodPresets(input: {
  /** Today's London date as YYYY-MM-DD. */
  today: string
  firstTripDate: string | null
  lastTripDate: string | null
}): PeriodPresetGroup[] {
  const [thisQuarter] = quarterOptions(input.today, input.today)
  const [thisFinancialYear] = financialYearOptions(input.today, input.today)

  const groups: PeriodPresetGroup[] = [
    {
      label: 'Quick picks',
      presets: [
        { value: ALL_TIME_PRESET_VALUE, label: 'All time', from: null, to: null },
        {
          value: `this-${thisQuarter.value}`,
          // The value is "2026-Q3", shown as "Q3 2026".
          label: `This quarter (${thisQuarter.value.slice(5)} ${thisQuarter.value.slice(0, 4)})`,
          from: thisQuarter.period.from,
          to: thisQuarter.period.to,
        },
        {
          value: `this-${thisFinancialYear.value}`,
          // The value is "FY2026", shown as "2026".
          label: `This financial year (${thisFinancialYear.value.slice(2)})`,
          from: thisFinancialYear.period.from,
          to: thisFinancialYear.period.to,
        },
      ],
    },
  ]

  if (input.firstTripDate && input.lastTripDate) {
    groups.push(
      { label: 'Quarters with trips', presets: quarterOptions(input.firstTripDate, input.lastTripDate).map(toPreset) },
      {
        label: 'Financial years with trips',
        presets: financialYearOptions(input.firstTripDate, input.lastTripDate).map(toPreset),
      },
      { label: 'Tax years with trips', presets: taxYearOptions(input.firstTripDate, input.lastTripDate).map(toPreset) }
    )
  }

  groups.push({ label: 'Other', presets: [{ value: CUSTOM_PRESET_VALUE, label: 'Custom dates', from: null, to: null }] })
  return groups
}

/** The first preset with exactly these dates, so a quick pick wins over the same listed period. */
export function presetValueFor(groups: PeriodPresetGroup[], from: string | null, to: string | null): string {
  for (const group of groups) {
    for (const preset of group.presets) {
      if (preset.value !== CUSTOM_PRESET_VALUE && preset.from === from && preset.to === to) return preset.value
    }
  }
  return CUSTOM_PRESET_VALUE
}
