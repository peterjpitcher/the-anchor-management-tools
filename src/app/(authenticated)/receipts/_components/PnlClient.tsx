'use client'

import { useMemo, useState, useTransition, useRef } from 'react'
import { PNL_METRICS, PNL_TIMEFRAMES, MANUAL_METRIC_KEYS } from '@/lib/pnl/constants'
import { buildPnlReportViewModel, formatPnlMetricValue, type PnlReportRow } from '@/lib/pnl/report-view-model'
import type { PnlDashboardData, PnlTimeframeKey } from '@/app/actions/pnl'
import { savePlManualActualsAction, savePlTargetsAction } from '@/app/actions/pnl'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormFooter,
  Icon,
  Input,
  Section,
  Segmented,
  Stat,
  StatGrid,
  toast,
} from '@/ds'
import { ReceiptsPageChrome } from './ReceiptsPageChrome'
import { PNL_HEALTH_TONE, pnlVarianceTone } from '../_shared/status-ui'

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

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** One P&L line: its variance badge in the header, actual and target below. */
function MetricCard({ row, invertVariance = false }: { row: PnlReportRow; invertVariance?: boolean }) {
  return (
    <Card>
      <CardHeader
        title={row.label}
        action={
          <Badge tone={pnlVarianceTone(row.variance, invertVariance)}>
            {formatPnlMetricValue(row.variance, row.format)}
          </Badge>
        }
      />
      <CardBody>
        <div className="grid grid-cols-2 gap-2 text-sm">
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
      </CardBody>
    </Card>
  )
}

const PNL_SUBTITLE = 'Cash-up sales and receipt expenses against the Greene King Shadow P&L'

export default function PnlClient({ initialData, canExport = false, canManage = false }: Props) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<PnlTimeframeKey>('12m')
  const [showBenchmarkTargets, setShowBenchmarkTargets] = useState(false)
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
    <ReceiptsPageChrome
      subtitle={PNL_SUBTITLE}
      navState={{ view: 'pnl' }}
      canManage={canManage}
      headerActions={
        <>
          <Segmented
            options={PNL_TIMEFRAMES.map((tf) => ({ id: tf.key, label: tf.label }))}
            value={selectedTimeframe}
            onChange={(key) => setSelectedTimeframe(key as PnlTimeframeKey)}
            size="sm"
            aria-label="Period"
          />
          {canExport && (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="download" size={16} />}
                onClick={() => downloadReport('pdf')}
                data-export-url={`/api/receipts/pnl/export?timeframe=${selectedTimeframe}&format=pdf`}
              >
                PDF
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Icon name="download" size={16} />}
                onClick={() => downloadReport('xlsx')}
                data-export-url={`/api/receipts/pnl/export?timeframe=${selectedTimeframe}&format=xlsx`}
              >
                Spreadsheet
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
        <span>Business health, {timeframeLabel.toLowerCase()}:</span>
        <Badge tone={PNL_HEALTH_TONE[viewModel.healthStatus]}>{viewModel.healthLabel}</Badge>
      </div>

      {viewModel.dataQualityWarnings.length > 0 && (
        <Alert tone="warning" title="Data confidence warnings">
          <div className="space-y-1">
            {viewModel.dataQualityWarnings.slice(0, 5).map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        </Alert>
      )}

      <StatGrid columns={4}>
        {summaryCards.map((item) => (
          <div key={item.label} className="space-y-2">
            <Stat
              label={item.label}
              value={formatPnlMetricValue(item.value)}
              hint={`${item.targetLabel}: ${formatPnlMetricValue(item.target)}`}
            />
            <div className="flex items-center justify-between gap-2 text-sm text-text">
              <span>Variance</span>
              <Badge tone={pnlVarianceTone(item.variance, item.invert)}>{formatPnlMetricValue(item.variance)}</Badge>
            </div>
          </div>
        ))}
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Sales Performance" description={`${timeframeLabel} against Greene King target`}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {salesSection?.rows.map((row) => <MetricCard key={row.key} row={row} />)}
            </div>
            <StatGrid columns={4}>
              <Stat label="Sales days" value={selectedCashupSummary.sessionCount} />
              <Stat
                label="Latest sales day"
                value={selectedCashupSummary.latestSessionDate ? formatDate(selectedCashupSummary.latestSessionDate) : 'None'}
              />
              <Stat label="Missing splits" value={selectedCashupSummary.missingSplitCount} />
              <Stat label="Unallocated" value={formatPnlMetricValue(selectedCashupSummary.unallocatedSales)} />
            </StatGrid>
          </div>
        </Section>

        <Card>
          <CardHeader title="Greene King Benchmark" subtitle={`${benchmark.pubCode} - ${benchmark.pubName}`} />
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
      </div>

      <Section title="Expense Performance" description="Receipt categories against Greene King model">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {expensesSection?.rows.map((row) => <MetricCard key={row.key} row={row} invertVariance />)}
        </div>
      </Section>

      <Section title="Gross Profit / Operating Profit" description="Operating profit is before rent, matching the Shadow P&L">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
      </Section>

      <Card>
        <CardHeader title="P&L Inputs" subtitle={canManage ? `${timeframeLabel} inputs` : 'Read-only'} />
        <CardBody className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {manualInputMetrics.map((metric) => (
              <Input
                key={metric.key}
                label={metric.label}
                type="number"
                step={metric.format === 'percent' ? '0.1' : '0.01'}
                value={manualValues[metric.key]?.[selectedTimeframe] ?? ''}
                onChange={(event) => handleManualChange(metric.key, selectedTimeframe, event.target.value)}
                disabled={!canManage}
                className="w-full"
              />
            ))}
          </div>
          {canManage && (
            <FormFooter>
              <Button variant="primary" onClick={() => saveManualValues(selectedTimeframe)} loading={isSavingManual}>
                Save P&L Inputs
              </Button>
            </FormFooter>
          )}
        </CardBody>
      </Card>

      <Section title="Rent/Divisible Balance Assumptions" description="Shown separately from operating profit">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rentSection?.rows.map((row) => <MetricCard key={row.key} row={row} />)}
        </div>
      </Section>

      <Card>
        <CardHeader
          title="Greene King Benchmark Target Values"
          subtitle="Annual targets the comparisons above are measured against"
          action={
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={showBenchmarkTargets}
              onClick={() => setShowBenchmarkTargets((current) => !current)}
            >
              {showBenchmarkTargets ? 'Hide' : 'Show'}
            </Button>
          }
        />
        {showBenchmarkTargets && (
          <CardBody className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {initialData.metrics.map((metric) => (
                <Input
                  key={metric.key}
                  label={metric.label}
                  type="number"
                  step={metric.format === 'percent' ? '0.1' : '0.01'}
                  value={targetValues[metric.key]?.[TARGET_TIMEFRAME] ?? ''}
                  onChange={(event) => handleTargetChange(metric.key, event.target.value)}
                  disabled={!canManage}
                  className="w-full"
                />
              ))}
            </div>
            {canManage && (
              <FormFooter>
                <Button variant="primary" onClick={saveTargetValues} loading={isSavingTargets}>
                  Save GK Targets
                </Button>
              </FormFooter>
            )}
          </CardBody>
        )}
      </Card>
    </ReceiptsPageChrome>
  )
}
