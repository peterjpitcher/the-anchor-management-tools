'use client'

import { useMemo, useState, useTransition, useRef, ChangeEvent } from 'react'
import { PNL_METRICS, PNL_TIMEFRAMES, MANUAL_METRIC_KEYS } from '@/lib/pnl/constants'
import type { PnlDashboardData, PnlTimeframeKey } from '@/app/actions/pnl'
import { savePlManualActualsAction, savePlTargetsAction } from '@/app/actions/pnl'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Card } from '@/components/ui-v2/layout/Card'
import { DocumentArrowDownIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

const GROUP_LABELS: Record<string, string> = {
  sales: 'Sales',
  sales_mix: 'Sales mix',
  sales_totals: 'Gross profit % targets',
  expenses: 'Expenses',
  occupancy: 'Occupancy costs',
}

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const PERCENT_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const TARGET_TIMEFRAME: PnlTimeframeKey = '12m'

type EditableMap = Record<string, Record<string, string>>

type Props = {
  initialData: PnlDashboardData
  canExport?: boolean
}

function normaliseNumericInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function formatValue(value: number | null, format: 'currency' | 'percent' = 'currency') {
  if (value === null || Number.isNaN(value)) return '—'
  if (format === 'percent') {
    return PERCENT_FORMATTER.format(value / 100)
  }
  return CURRENCY_FORMATTER.format(value)
}

function variance(actual: number | null, target: number | null): number | null {
  if (actual === null || target === null) return null
  return Number((actual - target).toFixed(2))
}

function buildInitialEditableMap(
  keys: string[],
  timeframeKeys: Array<{ key: string }>,
  source: Record<string, Partial<Record<string, number | null>> | undefined>
) {
  const map: EditableMap = {}
  keys.forEach((metric) => {
    map[metric] = {}
    timeframeKeys.forEach((tf) => {
      const value = source[metric]?.[tf.key] ?? null
      map[metric][tf.key] = value === null || value === undefined ? '' : String(value)
    })
  })
  return map
}

function deriveTargetValue(
  metricFormat: 'currency' | 'percent' | undefined,
  timeframe: PnlTimeframeKey,
  annualValue: number | null
) {
  if (annualValue === null || annualValue === undefined) return null
  if (metricFormat === 'percent') {
    return annualValue
  }
  const timeframeConfig = PNL_TIMEFRAMES.find((tf) => tf.key === timeframe)
  const annualConfig = PNL_TIMEFRAMES.find((tf) => tf.key === TARGET_TIMEFRAME)
  if (!timeframeConfig || !annualConfig) return annualValue
  const ratio = timeframeConfig.days / annualConfig.days
  return Number((annualValue * ratio).toFixed(2))
}

export default function PnlClient({ initialData, canExport = false }: Props) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<PnlTimeframeKey>('12m')
  const [isSavingManual, startSavingManual] = useTransition()
  const [isSavingTargets, startSavingTargets] = useTransition()

  const [manualValues, setManualValues] = useState<EditableMap>(() =>
    buildInitialEditableMap(MANUAL_METRIC_KEYS, PNL_TIMEFRAMES, initialData.manualActuals)
  )
  const [targetValues, setTargetValues] = useState<EditableMap>(() =>
    buildInitialEditableMap(
      initialData.metrics.map((metric) => metric.key),
      [{ key: TARGET_TIMEFRAME }],
      initialData.targets
    )
  )

  const manualInitialRef = useRef(manualValues)
  const targetInitialRef = useRef(targetValues)

  const annualTargetValues = useMemo(() => {
    const map: Record<string, number | null> = {}
    initialData.metrics.forEach((metric) => {
      map[metric.key] = normaliseNumericInput(targetValues[metric.key]?.[TARGET_TIMEFRAME] ?? '')
    })
    return map
  }, [targetValues, initialData.metrics])

  const actualValues = useMemo(() => {
    const map: Record<string, number> = {}
    initialData.metrics.forEach((metric) => {
      if (metric.type === 'manual') {
        const raw = manualValues[metric.key]?.[selectedTimeframe] ?? ''
        map[metric.key] = normaliseNumericInput(raw) ?? 0
      } else {
        map[metric.key] = initialData.actuals[selectedTimeframe]?.[metric.key] ?? 0
      }
    })

    initialData.metrics
      .filter((metric) => metric.group === 'expenses')
      .forEach((metric) => {
        map[metric.key] = initialData.actuals[selectedTimeframe]?.[metric.key] ?? 0
      })

    return map
  }, [manualValues, initialData.actuals, initialData.metrics, selectedTimeframe])

  const derivedTargetValues = useMemo(() => {
    const map: Record<string, number | null> = {}
    initialData.metrics.forEach((metric) => {
      map[metric.key] = deriveTargetValue(metric.format, selectedTimeframe, annualTargetValues[metric.key] ?? null)
    })
    initialData.metrics
      .filter((metric) => metric.type === 'expense')
      .forEach((metric) => {
        map[metric.key] = deriveTargetValue('currency', selectedTimeframe, annualTargetValues[metric.key] ?? null)
      })
    return map
  }, [annualTargetValues, initialData.metrics, selectedTimeframe])

  const salesActualTotal = useMemo(() => (
    initialData.metrics
      .filter((metric) => metric.group === 'sales')
      .reduce((sum, metric) => sum + (actualValues[metric.key] ?? 0), 0)
  ), [actualValues, initialData.metrics])

  const salesTargetTotal = useMemo(() => (
    initialData.metrics
      .filter((metric) => metric.group === 'sales')
      .reduce((sum, metric) => sum + (derivedTargetValues[metric.key] ?? 0), 0)
  ), [derivedTargetValues, initialData.metrics])
  const salesAnnualTargetTotal = useMemo(() => (
    initialData.metrics
      .filter((metric) => metric.group === 'sales')
      .reduce((sum, metric) => sum + (annualTargetValues[metric.key] ?? 0), 0)
  ), [annualTargetValues, initialData.metrics])

  const expenseActualTotal = useMemo(() => {
    const automaticExpenses = initialData.expenseTotals[selectedTimeframe] ?? 0
    const occupancyActual = initialData.metrics
      .filter((metric) => metric.group === 'occupancy')
      .reduce((sum, metric) => sum + (actualValues[metric.key] ?? 0), 0)
    return Number((automaticExpenses + occupancyActual).toFixed(2))
  }, [initialData.expenseTotals, initialData.metrics, actualValues, selectedTimeframe])

  const expenseTargetTotal = useMemo(() => {
    const automaticTarget = initialData.metrics
      .filter((metric) => metric.type === 'expense')
      .reduce((sum, metric) => sum + (derivedTargetValues[metric.key] ?? 0), 0)
    const occupancyTarget = initialData.metrics
      .filter((metric) => metric.group === 'occupancy')
      .reduce((sum, metric) => sum + (derivedTargetValues[metric.key] ?? 0), 0)
    return Number((automaticTarget + occupancyTarget).toFixed(2))
  }, [initialData.metrics, derivedTargetValues])
  const expenseAnnualTargetTotal = useMemo(() => {
    const automaticAnnualTarget = initialData.metrics
      .filter((metric) => metric.type === 'expense')
      .reduce((sum, metric) => sum + (annualTargetValues[metric.key] ?? 0), 0)
    const occupancyAnnualTarget = initialData.metrics
      .filter((metric) => metric.group === 'occupancy')
      .reduce((sum, metric) => sum + (annualTargetValues[metric.key] ?? 0), 0)
    return Number((automaticAnnualTarget + occupancyAnnualTarget).toFixed(2))
  }, [initialData.metrics, annualTargetValues])

  const operatingProfitActual = Number((salesActualTotal - expenseActualTotal).toFixed(2))
  const operatingProfitTarget = Number((salesTargetTotal - expenseTargetTotal).toFixed(2))

  const groupedMetrics = useMemo(() => (
    PNL_METRICS.reduce<Record<string, typeof PNL_METRICS>>((acc, metric) => {
      if (!acc[metric.group]) acc[metric.group] = []
      acc[metric.group].push(metric)
      return acc
    }, {})
  ), [])

  const handleManualChange = (metric: string, timeframe: string, value: string) => {
    setManualValues((prev) => ({
      ...prev,
      [metric]: {
        ...prev[metric],
        [timeframe]: value,
      },
    }))
  }

  const handleTargetChange = (metric: string, value: string) => {
    setTargetValues((prev) => ({
      ...prev,
      [metric]: {
        ...prev[metric],
        [TARGET_TIMEFRAME]: value,
      },
    }))
  }

  const saveManualValues = () => {
    startSavingManual(async () => {
      try {
        const payload = MANUAL_METRIC_KEYS.flatMap((metric) =>
          PNL_TIMEFRAMES.map((tf) => ({
            metric,
            timeframe: tf.key,
            value: normaliseNumericInput(manualValues[metric]?.[tf.key] ?? ''),
          }))
        )

        const formData = new FormData()
        formData.append('data', JSON.stringify(payload))
        const result = await savePlManualActualsAction(formData)
        if (result?.error) {
          toast.error(result.error)
          return
        }
        manualInitialRef.current = manualValues
        toast.success('Manual inputs saved')
      } catch (error) {
        console.error('Failed to save manual inputs', error)
        toast.error('Failed to save manual inputs')
      }
    })
  }

  const saveTargetValues = () => {
    startSavingTargets(async () => {
      try {
        const payload = PNL_METRICS.map((metric) => ({
          metric: metric.key,
          timeframe: TARGET_TIMEFRAME,
          value: normaliseNumericInput(targetValues[metric.key]?.[TARGET_TIMEFRAME] ?? ''),
        }))

        const formData = new FormData()
        formData.append('data', JSON.stringify(payload))
        const result = await savePlTargetsAction(formData)
        if (result?.error) {
          toast.error(result.error)
          return
        }
        targetInitialRef.current = targetValues
        toast.success('Targets saved')
      } catch (error) {
        console.error('Failed to save targets', error)
        toast.error('Failed to save targets')
      }
    })
  }

  const timeframeLabel = PNL_TIMEFRAMES.find((tf) => tf.key === selectedTimeframe)?.label ?? ''
  const timeframeVsShadowLabel = `${timeframeLabel.toUpperCase()} VS. SHADOW P&L`
  const exportUrl = `/api/receipts/pnl/export?timeframe=${encodeURIComponent(selectedTimeframe)}`

  const downloadReport = () => {
    window.location.assign(exportUrl)
  }

  const renderTimeframeSelector = () => (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm font-medium text-gray-700" htmlFor="pnl-timeframe">View timeframe</label>
      <select
        id="pnl-timeframe"
        className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-emerald-500"
        value={selectedTimeframe}
        onChange={(event: ChangeEvent<HTMLSelectElement>) =>
          setSelectedTimeframe(event.target.value as PnlTimeframeKey)
        }
      >
        {PNL_TIMEFRAMES.map((tf) => (
          <option key={tf.key} value={tf.key}>{tf.label}</option>
        ))}
      </select>
    </div>
  )

  const renderActualCell = (metricKey: string, metricFormat: 'currency' | 'percent' | undefined, isManual: boolean) => {
    const value = actualValues[metricKey] ?? 0
    if (isManual) {
      const inputValue = manualValues[metricKey]?.[selectedTimeframe] ?? ''
      return (
        <Input
          type="number"
          step={metricFormat === 'percent' ? '0.1' : '0.01'}
          value={inputValue}
          onChange={(event) => handleManualChange(metricKey, selectedTimeframe, event.target.value)}
          className="w-full text-right"
        />
      )
    }
    return <span>{formatValue(value, metricFormat ?? 'currency')}</span>
  }

const renderPeriodTargetCell = (
  metricFormat: 'currency' | 'percent' | undefined,
  periodTarget: number | null,
  detailLines?: string[]
) => (
  <div className="flex flex-col items-end gap-1 text-right">
    <span className="font-medium text-gray-900">{formatValue(periodTarget, metricFormat ?? 'currency')}</span>
    {detailLines && detailLines.length > 0 && (
      <div className="space-y-0.5 text-xs text-gray-500">
        {detailLines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    )}
  </div>
)

  const renderVarianceCell = (
    metricKey: string,
    metricFormat: 'currency' | 'percent' | undefined,
    periodTarget: number | null
  ) => {
    const actual = metricFormat === 'percent' ? actualValues[metricKey] ?? null : actualValues[metricKey] ?? null
    const diff = variance(actual, periodTarget)
    if (diff === null) return <span>—</span>
    const positive = diff >= 0
    return (
      <span
        className={clsx(
          'inline-flex rounded px-2 py-0.5 text-xs font-semibold',
          positive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        )}
      >
        {formatValue(diff, metricFormat ?? 'currency')}
      </span>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {renderTimeframeSelector()}
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <Button variant="secondary" onClick={downloadReport} data-export-url={exportUrl}>
              <DocumentArrowDownIcon className="mr-2 h-4 w-4" />
              Download P&L report (PDF)
            </Button>
          )}
          <Button onClick={saveManualValues} disabled={isSavingManual}>
            {isSavingManual && <Spinner className="mr-2 h-4 w-4" />}Save manual inputs
          </Button>
          <Button onClick={saveTargetValues} disabled={isSavingTargets}>
            {isSavingTargets && <Spinner className="mr-2 h-4 w-4" />}Save Shadow P&L targets
          </Button>
        </div>
      </div>
      <p className="text-sm text-gray-600">
        Targets in this dashboard are set from your Shadow P&amp;L target values.
      </p>

      {Object.entries(groupedMetrics).map(([group, metrics]) => {
        const sectionTitle = (group === 'sales' || group === 'expenses')
          ? `${GROUP_LABELS[group] ?? group} - ${timeframeVsShadowLabel}`
          : GROUP_LABELS[group] ?? group
        const sectionSubtotal = group === 'sales'
          ? {
              label: 'Total sales',
              actual: salesActualTotal,
              annualTarget: salesAnnualTargetTotal,
              periodTarget: salesTargetTotal,
              variance: Number((salesActualTotal - salesTargetTotal).toFixed(2)),
              invertVariance: false,
            }
          : group === 'expenses'
            ? {
                label: 'Total expenses (incl occupancy)',
                actual: expenseActualTotal,
                annualTarget: expenseAnnualTargetTotal,
                periodTarget: expenseTargetTotal,
                variance: Number((expenseActualTotal - expenseTargetTotal).toFixed(2)),
                invertVariance: true,
              }
            : null

        return (
          <section key={group} className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">{sectionTitle}</h2>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Metric</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Actual</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Annual</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">P&L Target</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600">Var</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {metrics.map((metric) => {
                    const actualValue = actualValues[metric.key] ?? 0
                    const annualTarget = annualTargetValues[metric.key] ?? null
                    const periodTarget = derivedTargetValues[metric.key] ?? null

                    const detailLines: string[] = []

                    if (metric.baseMetricKey) {
                      const baseActual = actualValues[metric.baseMetricKey] ?? 0
                      const baseTarget = derivedTargetValues[metric.baseMetricKey] ?? null

                      if (metric.group === 'sales_mix') {
                        const actualCurrency = Number((baseActual * (actualValue / 100)).toFixed(2))
                        const targetCurrency = baseTarget !== null && periodTarget !== null
                          ? Number((baseTarget * (periodTarget / 100)).toFixed(2))
                          : null
                        detailLines.push(`Actual ${formatValue(actualCurrency)}`)
                        if (targetCurrency !== null) {
                          detailLines.push(`P&L Target ${formatValue(targetCurrency)}`)
                        }
                      }

                      if (metric.group === 'sales_totals') {
                        const gpActual = Number((baseActual * (actualValue / 100)).toFixed(2))
                        const costActual = Number((baseActual - gpActual).toFixed(2))
                        const gpTarget = baseTarget !== null && periodTarget !== null
                          ? Number((baseTarget * (periodTarget / 100)).toFixed(2))
                          : null
                        const costTarget = gpTarget !== null && baseTarget !== null
                          ? Number((baseTarget - gpTarget).toFixed(2))
                          : null
                        detailLines.push(`Actual GP ${formatValue(gpActual)} · Cost ${formatValue(costActual)}`)
                        if (gpTarget !== null && costTarget !== null) {
                          detailLines.push(`P&L Target GP ${formatValue(gpTarget)} · Cost ${formatValue(costTarget)}`)
                        }
                      }
                    }

                    return (
                      <tr key={metric.key} className="align-top">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{metric.label}</td>
                        <td className="px-4 py-3 min-w-[140px] text-right text-gray-900">
                          {renderActualCell(metric.key, metric.format, metric.type === 'manual')}
                        </td>
                        <td className="px-4 py-3 min-w-[140px] text-right">
                          <Input
                            type="number"
                            step={metric.format === 'percent' ? '0.1' : '0.01'}
                            value={targetValues[metric.key]?.[TARGET_TIMEFRAME] ?? ''}
                            onChange={(event) => handleTargetChange(metric.key, event.target.value)}
                            className="w-full text-right"
                          />
                        </td>
                        <td className="px-4 py-3 min-w-[180px] text-right text-gray-900">
                          {renderPeriodTargetCell(metric.format, periodTarget, detailLines)}
                        </td>
                        <td className="px-4 py-3 min-w-[140px] text-right text-gray-900">
                          {renderVarianceCell(metric.key, metric.format, periodTarget)}
                        </td>
                      </tr>
                    )
                  })}
                  {sectionSubtotal && (
                    <tr className="bg-indigo-50/60">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">{sectionSubtotal.label}</td>
                      <td className="px-4 py-3 min-w-[140px] text-right font-semibold text-gray-900">
                        {formatValue(sectionSubtotal.actual)}
                      </td>
                      <td className="px-4 py-3 min-w-[140px] text-right font-semibold text-gray-900">
                        {formatValue(sectionSubtotal.annualTarget)}
                      </td>
                      <td className="px-4 py-3 min-w-[180px] text-right font-semibold text-gray-900">
                        {formatValue(sectionSubtotal.periodTarget)}
                      </td>
                      <td className="px-4 py-3 min-w-[140px] text-right text-gray-900">
                        <span
                          className={clsx(
                            'inline-flex rounded px-2 py-0.5 text-xs font-semibold',
                            sectionSubtotal.invertVariance
                              ? sectionSubtotal.variance <= 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                              : sectionSubtotal.variance >= 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                          )}
                        >
                          {formatValue(sectionSubtotal.variance)}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <Card variant="bordered">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-gray-200 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{timeframeLabel}</p>
            <div className="mt-2 space-y-2 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span>Total revenue</span>
                <span className="font-semibold text-gray-900">{formatValue(salesActualTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total expenses</span>
                <span className="font-semibold text-gray-900">{formatValue(expenseActualTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Operating profit</span>
                <span className={clsx(
                  'font-semibold',
                  operatingProfitActual >= 0 ? 'text-emerald-700' : 'text-rose-700'
                )}>
                  {formatValue(operatingProfitActual)}
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-gray-200 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{timeframeLabel} targets (Shadow P&L)</p>
            <div className="mt-2 space-y-2 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span>Revenue P&L Target</span>
                <span className="font-semibold text-gray-900">{formatValue(salesTargetTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Expense P&L Target</span>
                <span className="font-semibold text-gray-900">{formatValue(expenseTargetTotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Profit P&L Target</span>
                <span className={clsx(
                  'font-semibold',
                  operatingProfitTarget >= 0 ? 'text-emerald-700' : 'text-rose-700'
                )}>
                  {formatValue(operatingProfitTarget)}
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-gray-200 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Variance (£)</p>
            <div className="mt-2 space-y-2 text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span>Revenue</span>
                <span className={clsx(
                  'font-semibold',
                  salesActualTotal - salesTargetTotal >= 0 ? 'text-emerald-700' : 'text-rose-700'
                )}>
                  {formatValue(salesActualTotal - salesTargetTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Expenses</span>
                <span className={clsx(
                  'font-semibold',
                  expenseActualTotal - expenseTargetTotal <= 0 ? 'text-emerald-700' : 'text-rose-700'
                )}>
                  {formatValue(expenseActualTotal - expenseTargetTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Operating profit</span>
                <span className={clsx(
                  'font-semibold',
                  operatingProfitActual - operatingProfitTarget >= 0 ? 'text-emerald-700' : 'text-rose-700'
                )}>
                  {formatValue(operatingProfitActual - operatingProfitTarget)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
