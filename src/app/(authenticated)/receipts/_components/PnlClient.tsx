'use client'

import { useMemo, useState, useTransition, useRef, ChangeEvent } from 'react'
import { PNL_METRICS, PNL_TIMEFRAMES, MANUAL_METRIC_KEYS } from '@/lib/pnl/constants'
import { buildPnlReportViewModel, formatPnlMetricValue, type PnlReportRow } from '@/lib/pnl/report-view-model'
import type { PnlDashboardData, PnlTimeframeKey } from '@/app/actions/pnl'
import { savePlManualActualsAction, savePlTargetsAction } from '@/app/actions/pnl'
import { Alert, Button, Card, CardBody, CardHeader, Input, Select, Spinner, toast } from '@/ds'
import { DocumentArrowDownIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

const TARGET_TIMEFRAME: PnlTimeframeKey = '12m'

type EditableMap = Record<string, Record<string, string>>

type Props = {
  initialData: PnlDashboardData
  canExport?: boolean
  canManage?: boolean
}

function normaliseNumericInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
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

function varianceClass(value: number | null, invert = false) {
  if (value === null || Math.abs(value) < 0.01) return 'bg-surface-2 text-text'
  const favourable = invert ? value <= 0 : value >= 0
  return favourable ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg'
}

function healthClass(status: string) {
  if (status === 'on_track') return 'border-border bg-success-soft text-success-fg'
  if (status === 'watch') return 'border-border bg-warning-soft text-warning-fg'
  if (status === 'off_track') return 'border-border bg-danger-soft text-danger-fg'
  return 'border-border bg-surface-2 text-text'
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function MetricCard({ row, invertVariance = false }: { row: PnlReportRow; invertVariance?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-strong">{row.label}</h3>
        <span className={clsx('shrink-0 rounded px-2 py-0.5 text-xs font-semibold', varianceClass(row.variance, invertVariance))}>
          {formatPnlMetricValue(row.variance, row.format)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">Actual</p>
          <p className="font-semibold text-text-strong">{formatPnlMetricValue(row.actual, row.format)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">GK target</p>
          <p className="font-semibold text-text-strong">{formatPnlMetricValue(row.timeframeTarget, row.format)}</p>
        </div>
      </div>
      {row.detailLines.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-text-muted">
          {row.detailLines.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}
    </div>
  )
}

export default function PnlClient({ initialData, canExport = false, canManage = false }: Props) {
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

  const workingData = useMemo<PnlDashboardData>(() => {
    const actuals = {
      '1m': { ...initialData.actuals['1m'] },
      '3m': { ...initialData.actuals['3m'] },
      '12m': { ...initialData.actuals['12m'] },
    }
    const targets = { ...initialData.targets }

    initialData.metrics.forEach((metric) => {
      const annualTarget = normaliseNumericInput(targetValues[metric.key]?.[TARGET_TIMEFRAME] ?? '')
      targets[metric.key] = { ...(targets[metric.key] ?? {}), [TARGET_TIMEFRAME]: annualTarget }
    })

    MANUAL_METRIC_KEYS.forEach((metricKey) => {
      PNL_TIMEFRAMES.forEach((tf) => {
        const enteredActual = normaliseNumericInput(manualValues[metricKey]?.[tf.key] ?? '')
        const metric = initialData.metrics.find((item) => item.key === metricKey)
        const fallbackTarget = metric?.group === 'sales_totals'
          ? normaliseNumericInput(targetValues[metricKey]?.[TARGET_TIMEFRAME] ?? '')
          : null
        actuals[tf.key][metricKey] = enteredActual ?? fallbackTarget ?? 0
      })
    })

    return {
      ...initialData,
      actuals,
      targets,
    }
  }, [initialData, manualValues, targetValues])

  const viewModel = useMemo(
    () => buildPnlReportViewModel(workingData, selectedTimeframe),
    [workingData, selectedTimeframe]
  )

  const timeframeLabel = PNL_TIMEFRAMES.find((tf) => tf.key === selectedTimeframe)?.label ?? selectedTimeframe
  const benchmark = initialData.greeneKingBenchmark
  const selectedCashupSummary = initialData.cashupSales[selectedTimeframe]

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

  const saveManualValues = (timeframeToSave = selectedTimeframe) => {
    if (!canManage) return
    startSavingManual(async () => {
      try {
        const payload = MANUAL_METRIC_KEYS.flatMap((metric) =>
          [timeframeToSave].map((timeframe) => ({
            metric,
            timeframe,
            value: normaliseNumericInput(manualValues[metric]?.[timeframe] ?? ''),
          }))
        )

        const formData = new FormData()
        formData.append('data', JSON.stringify(payload))
        const result = await savePlManualActualsAction(formData)
        if (result?.error) {
          toast.error(result.error)
          return
        }
        manualInitialRef.current = {
          ...manualInitialRef.current,
          ...MANUAL_METRIC_KEYS.reduce<EditableMap>((acc, metric) => {
            acc[metric] = {
              ...manualInitialRef.current[metric],
              [timeframeToSave]: manualValues[metric]?.[timeframeToSave] ?? '',
            }
            return acc
          }, {}),
        }
        toast.success('P&L inputs saved')
      } catch (error) {
        console.error('Failed to save P&L inputs', error)
        toast.error('Failed to save P&L inputs')
      }
    })
  }

  const saveTargetValues = () => {
    if (!canManage) return
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
        toast.success('Greene King targets saved')
      } catch (error) {
        console.error('Failed to save Greene King targets', error)
        toast.error('Failed to save Greene King targets')
      }
    })
  }

  const downloadReport = (format: 'pdf' | 'xlsx') => {
    window.location.assign(`/api/receipts/pnl/export?timeframe=${encodeURIComponent(selectedTimeframe)}&format=${format}`)
  }

  const salesSection = viewModel.sections.find((section) => section.key === 'sales')
  const grossProfitSection = viewModel.sections.find((section) => section.key === 'sales_totals')
  const expensesSection = viewModel.sections.find((section) => section.key === 'expenses')
  const rentSection = viewModel.sections.find((section) => section.key === 'occupancy')
  const manualInputMetrics = initialData.metrics.filter((metric) => metric.type === 'manual')

  const summaryCards = [
    {
      label: 'Actual income',
      value: viewModel.summary.revenueActual,
      targetLabel: 'GK target income',
      target: viewModel.summary.revenueTarget,
      variance: viewModel.summary.revenueVariance,
      invert: false,
    },
    {
      label: 'Actual expenses',
      value: viewModel.summary.expenseActual,
      targetLabel: 'GK target expenses',
      target: viewModel.summary.expenseTarget,
      variance: viewModel.summary.expenseVariance,
      invert: true,
    },
    {
      label: 'Gross profit',
      value: viewModel.summary.grossProfitActual,
      targetLabel: 'GK gross profit',
      target: viewModel.summary.grossProfitTarget,
      variance: viewModel.summary.grossProfitVariance,
      invert: false,
    },
    {
      label: 'Operating profit',
      value: viewModel.summary.operatingProfitActual,
      targetLabel: 'GK operating profit',
      target: viewModel.summary.operatingProfitTarget,
      variance: viewModel.summary.operatingProfitVariance,
      invert: false,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-medium text-text" htmlFor="pnl-timeframe">View timeframe</label>
          <Select
            id="pnl-timeframe"
            value={selectedTimeframe}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setSelectedTimeframe(event.target.value as PnlTimeframeKey)
            }
            options={PNL_TIMEFRAMES.map((tf) => ({ value: tf.key, label: tf.label }))}
          />
          <span className={clsx('rounded-md border px-2.5 py-1 text-sm font-semibold', healthClass(viewModel.healthStatus))}>
            {viewModel.healthLabel}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <>
              <Button
                variant="secondary"
                onClick={() => downloadReport('pdf')}
                data-export-url={`/api/receipts/pnl/export?timeframe=${selectedTimeframe}&format=pdf`}
              >
                <DocumentArrowDownIcon className="mr-2 h-4 w-4" />
                PDF
              </Button>
              <Button
                variant="secondary"
                onClick={() => downloadReport('xlsx')}
                data-export-url={`/api/receipts/pnl/export?timeframe=${selectedTimeframe}&format=xlsx`}
              >
                <DocumentArrowDownIcon className="mr-2 h-4 w-4" />
                Spreadsheet
              </Button>
            </>
          )}
          {canManage && (
            <>
              <Button onClick={() => saveManualValues()} disabled={isSavingManual}>
                {isSavingManual && <Spinner className="mr-2 h-4 w-4" />}Save inputs
              </Button>
              <Button onClick={saveTargetValues} disabled={isSavingTargets}>
                {isSavingTargets && <Spinner className="mr-2 h-4 w-4" />}Save GK targets
              </Button>
            </>
          )}
        </div>
      </div>

      {viewModel.dataQualityWarnings.length > 0 && (
        <Alert tone="warning">
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Data confidence warnings</p>
            {viewModel.dataQualityWarnings.slice(0, 5).map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        </Alert>
      )}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label="Business health">
        {summaryCards.map((item) => (
          <Card key={item.label}>
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-text-muted">{item.label}</p>
              <p className="mt-2 text-2xl font-bold text-text-strong">{formatPnlMetricValue(item.value)}</p>
              <div className="mt-3 space-y-1 text-sm text-text">
                <div className="flex justify-between gap-2">
                  <span>{item.targetLabel}</span>
                  <span className="font-semibold">{formatPnlMetricValue(item.target)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Variance</span>
                  <span className={clsx('rounded px-2 py-0.5 text-xs font-semibold', varianceClass(item.variance, item.invert))}>
                    {formatPnlMetricValue(item.variance)}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Sales performance" subtitle={`${timeframeLabel} against Greene King target`} />
          <CardBody>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {salesSection?.rows.map((row) => <MetricCard key={row.key} row={row} />)}
            </div>
            <div className="mt-4 rounded-md border border-border bg-surface-2 p-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-text-muted">Sales days</p>
                  <p className="font-semibold text-text-strong">{selectedCashupSummary.sessionCount}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-text-muted">Latest sales day</p>
                  <p className="font-semibold text-text-strong">
                    {selectedCashupSummary.latestSessionDate ? formatDate(selectedCashupSummary.latestSessionDate) : 'None'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-text-muted">Missing splits</p>
                  <p className="font-semibold text-text-strong">{selectedCashupSummary.missingSplitCount}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-text-muted">Unallocated</p>
                  <p className="font-semibold text-text-strong">{formatPnlMetricValue(selectedCashupSummary.unallocatedSales)}</p>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Greene King benchmark" subtitle={`${benchmark.pubCode} - ${benchmark.pubName}`} />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Assessment</dt>
                <dd className="font-medium text-text-strong">{formatDate(benchmark.assessmentDate)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Report date</dt>
                <dd className="font-medium text-text-strong">{formatDate(benchmark.reportDate)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Proposal</dt>
                <dd className="font-medium text-text-strong">{benchmark.proposalId}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Agreement</dt>
                <dd className="text-right font-medium text-text-strong">{benchmark.agreementType}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Reason</dt>
                <dd className="text-right font-medium text-text-strong">{benchmark.agreementReason}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader title="Expense performance" subtitle="Receipt categories against Greene King model" />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {expensesSection?.rows.map((row) => <MetricCard key={row.key} row={row} invertVariance />)}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Gross profit / operating profit" subtitle="Operating profit is before rent, matching the Shadow P&L" />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {grossProfitSection?.rows.map((row) => <MetricCard key={row.key} row={row} />)}
            {grossProfitSection?.subtotal && (
              <MetricCard
                row={{
                  key: 'gross_profit_total',
                  label: grossProfitSection.subtotal.label,
                  group: 'sales_totals',
                  format: 'currency',
                  actual: grossProfitSection.subtotal.actual,
                  annualTarget: grossProfitSection.subtotal.annualTarget,
                  timeframeTarget: grossProfitSection.subtotal.timeframeTarget,
                  variance: grossProfitSection.subtotal.variance,
                  detailLines: [],
                }}
              />
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="P&L inputs"
          subtitle={canManage ? `${timeframeLabel} inputs` : 'Read-only'}
          action={canManage ? (
            <Button onClick={() => saveManualValues(selectedTimeframe)} disabled={isSavingManual}>
              {isSavingManual && <Spinner className="mr-2 h-4 w-4" />}Save P&L inputs
            </Button>
          ) : undefined}
        />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {manualInputMetrics.map((metric) => (
              <div key={metric.key}>
                <Input
                  label={metric.label}
                  type="number"
                  step={metric.format === 'percent' ? '0.1' : '0.01'}
                  value={manualValues[metric.key]?.[selectedTimeframe] ?? ''}
                  onChange={(event) => handleManualChange(metric.key, selectedTimeframe, event.target.value)}
                  disabled={!canManage}
                  className="w-full"
                />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Rent/divisible balance assumptions" subtitle="Shown separately from operating profit" />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rentSection?.rows.map((row) => <MetricCard key={row.key} row={row} />)}
          </div>
        </CardBody>
      </Card>

      <details className="rounded-md border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-text-strong">
          Greene King benchmark target values
        </summary>
        <div className="border-t border-border p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {initialData.metrics.map((metric) => (
              <div key={metric.key}>
                <Input
                  label={metric.label}
                  type="number"
                  step={metric.format === 'percent' ? '0.1' : '0.01'}
                  value={targetValues[metric.key]?.[TARGET_TIMEFRAME] ?? ''}
                  onChange={(event) => handleTargetChange(metric.key, event.target.value)}
                  disabled={!canManage}
                  className="w-full"
                />
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  )
}
