'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  getReceiptVendorAiSummary,
  getReceiptVendorDetail,
  getReceiptVendorMovements,
  setReceiptVendorReviewStatus,
  setReceiptVendorWatched,
  type ReceiptVendorAiReview,
  type ReceiptVendorCostSignal,
  type ReceiptVendorDetail,
  type ReceiptVendorMovementComparison,
  type ReceiptVendorMovementRange,
  type ReceiptVendorMovementSignal,
  type ReceiptVendorMovementSummary,
  type ReceiptVendorReviewItem,
  type ReceiptVendorReviewStatus,
  type ReceiptVendorMonthTransaction,
  type ReceiptVendorSummary,
  type ReceiptVendorWatchlistItem,
} from '@/app/actions/receipts'
import { Alert, Button, Card, Drawer, Spinner } from '@/ds'
import {
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  StarIcon,
} from '@heroicons/react/20/solid'

const MONTH_WINDOW = 12
const DEFAULT_MOVEMENT_RANGE: ReceiptVendorMovementRange = '36m'
const DEFAULT_MOVEMENT_COMPARISON: ReceiptVendorMovementComparison = 'rolling_3m'

type MovementState = {
  movements: ReceiptVendorMovementSummary[]
  signals: ReceiptVendorMovementSignal[]
  error?: string
}

type DetailAiState = {
  review?: ReceiptVendorAiReview
  error?: string
}

type VendorTransactionRow = ReceiptVendorMonthTransaction | ReceiptVendorDetail['recentTransactions'][number]

function formatCurrency(value: number | null | undefined) {
  const amount = Number(value ?? 0)
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function formatMonth(isoDate: string) {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  if (value > 0) return `+${formatCurrency(value)}`
  return formatCurrency(value)
}

function formatSignedPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
}

function formatDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

function formatHistoryDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function signalTone(signal: ReceiptVendorCostSignal | { severity: 'medium' | 'high'; direction: 'spike' | 'drop' | 'new' | 'resumed' }) {
  if (signal.severity === 'high') return 'bg-rose-50 text-rose-700 border-rose-100'
  if (signal.direction === 'drop') return 'bg-emerald-50 text-emerald-700 border-emerald-100'
  return 'bg-amber-50 text-amber-700 border-amber-100'
}

const statusLabels: Record<ReceiptVendorMonthTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
  cant_find: "Can't find",
}

const statusTone: Record<ReceiptVendorMonthTransaction['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  auto_completed: 'bg-blue-100 text-blue-700',
  no_receipt_required: 'bg-gray-200 text-gray-700',
  cant_find: 'bg-rose-100 text-rose-700',
}

type VendorSummaryGridProps = {
  vendors: ReceiptVendorSummary[]
  initialWatchlist: ReceiptVendorWatchlistItem[]
  initialReviews?: ReceiptVendorReviewItem[]
}

function normalizeVendorKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function reviewKey(vendorLabel: string, comparison: ReceiptVendorMovementComparison, monthStart: string) {
  return `${normalizeVendorKey(vendorLabel)}|${comparison}|${monthStart}`
}

export default function VendorSummaryGrid({ vendors, initialWatchlist, initialReviews = [] }: VendorSummaryGridProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReceiptVendorDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailAi, setDetailAi] = useState<DetailAiState | null>(null)
  const [detailAiLoading, setDetailAiLoading] = useState(false)
  const [watchedVendors, setWatchedVendors] = useState<Record<string, string>>(() => {
    return initialWatchlist.reduce<Record<string, string>>((acc, item) => {
      acc[item.vendorKey] = item.vendorLabel
      return acc
    }, {})
  })
  const [watchlistError, setWatchlistError] = useState<string | null>(null)
  const [updatingWatchVendor, setUpdatingWatchVendor] = useState<string | null>(null)
  const [reviews, setReviews] = useState<Record<string, ReceiptVendorReviewStatus>>(() => {
    return initialReviews.reduce<Record<string, ReceiptVendorReviewStatus>>((acc, item) => {
      acc[reviewKey(item.vendorLabel, item.comparison, item.monthStart)] = item.status
      return acc
    }, {})
  })
  const [updatingReview, setUpdatingReview] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)

  if (!vendors.length) return null

  async function openVendorDetail(vendorLabel: string) {
    setSelectedVendor(vendorLabel)
    setDrawerOpen(true)
    setDetail(null)
    setDetailError(null)
    setDetailAi(null)
    setDetailLoading(true)

    try {
      const result = await getReceiptVendorDetail({ vendorLabel, monthWindow: MONTH_WINDOW })
      if (result.error || !result.detail) {
        setDetailError(result.error ?? 'Unable to load vendor details.')
      } else {
        setDetail(result.detail)
      }
    } catch (error) {
      console.error('Failed to load vendor detail', error)
      setDetailError('Something went wrong loading vendor details.')
    } finally {
      setDetailLoading(false)
    }
  }

  async function generateVendorAiSummary() {
    const vendorLabel = detail?.vendorLabel ?? selectedVendor
    if (!vendorLabel) return

    setDetailAiLoading(true)
    setDetailAi(null)

    try {
      const result = await getReceiptVendorAiSummary({ vendorLabel, monthWindow: MONTH_WINDOW })
      if (!result.success || result.error || !result.review) {
        setDetailAi({ error: result.error ?? 'Unable to generate vendor summary.' })
      } else {
        setDetailAi({ review: result.review })
      }
    } catch (error) {
      console.error('Failed to generate vendor AI summary', error)
      setDetailAi({ error: 'Something went wrong generating the vendor summary.' })
    } finally {
      setDetailAiLoading(false)
    }
  }

  async function toggleVendorWatched(vendorLabel: string, watched: boolean) {
    const vendorKey = normalizeVendorKey(vendorLabel)
    const previous = watchedVendors
    setWatchlistError(null)
    setUpdatingWatchVendor(vendorLabel)
    setWatchedVendors((current) => {
      const next = { ...current }
      if (watched) {
        next[vendorKey] = vendorLabel
      } else {
        delete next[vendorKey]
      }
      return next
    })

    try {
      const result = await setReceiptVendorWatched({ vendorLabel, watched })
      if (result.error || !result.success) {
        setWatchedVendors(previous)
        setWatchlistError(result.error ?? 'Unable to update watched vendors.')
      } else if (result.item && result.watched) {
        setWatchedVendors((current) => ({
          ...current,
          [result.item!.vendorKey]: result.item!.vendorLabel,
        }))
      }
    } catch (error) {
      console.error('Failed to update vendor watchlist', error)
      setWatchedVendors(previous)
      setWatchlistError('Something went wrong updating watched vendors.')
    } finally {
      setUpdatingWatchVendor(null)
    }
  }

  async function updateVendorReview(
    movement: ReceiptVendorMovementSummary,
    status: ReceiptVendorReviewStatus,
  ) {
    if (!movement.latestMonthStart) return
    const key = reviewKey(movement.vendorLabel, movement.comparison, movement.latestMonthStart)
    const previous = reviews[key]
    setReviewError(null)
    setUpdatingReview(key)
    setReviews((current) => ({ ...current, [key]: status }))

    try {
      const result = await setReceiptVendorReviewStatus({
        vendorLabel: movement.vendorLabel,
        comparison: movement.comparison,
        monthStart: movement.latestMonthStart,
        status,
      })
      if (!result.success || result.error) {
        setReviews((current) => {
          const next = { ...current }
          if (previous) next[key] = previous
          else delete next[key]
          return next
        })
        setReviewError(result.error ?? 'Unable to update review status.')
      }
    } catch (error) {
      console.error('Failed to update vendor review status', error)
      setReviews((current) => {
        const next = { ...current }
        if (previous) next[key] = previous
        else delete next[key]
        return next
      })
      setReviewError('Something went wrong updating the review status.')
    } finally {
      setUpdatingReview(null)
    }
  }

  const activeVendorLabel = detail?.vendorLabel ?? selectedVendor
  const activeVendorWatched = activeVendorLabel
    ? Boolean(watchedVendors[normalizeVendorKey(activeVendorLabel)])
    : false
  const activeVendorWatchLoading = activeVendorLabel
    ? updatingWatchVendor === activeVendorLabel
    : false

  return (
    <>
      <div className="space-y-4">
        <VendorMovementPanel
          watchedVendors={watchedVendors}
          reviews={reviews}
          updatingWatchVendor={updatingWatchVendor}
          updatingReview={updatingReview}
          error={watchlistError ?? reviewError}
          onViewDetails={openVendorDetail}
          onToggleWatched={toggleVendorWatched}
          onUpdateReview={updateVendorReview}
        />
      </div>

      <VendorDetailDrawer
        open={drawerOpen}
        vendorLabel={detail?.vendorLabel ?? selectedVendor ?? 'Vendor details'}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        aiState={detailAi}
        aiLoading={detailAiLoading}
        watched={activeVendorWatched}
        watchLoading={activeVendorWatchLoading}
        onToggleWatched={() => {
          if (!activeVendorLabel) return
          toggleVendorWatched(activeVendorLabel, !activeVendorWatched)
        }}
        onGenerateAi={generateVendorAiSummary}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  )
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-gray-200 bg-white p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded px-3 py-1.5 text-xs font-semibold transition ${value === option.value ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

type MovementView = 'attention' | 'increases' | 'decreases' | 'new' | 'watched' | 'all'

const reviewStatusLabels: Record<ReceiptVendorReviewStatus, string> = {
  needs_review: 'Needs review',
  expected: 'Expected',
  action_required: 'Action required',
  reviewed: 'Reviewed',
}

function movementReviewStatus(
  movement: ReceiptVendorMovementSummary,
  reviews: Record<string, ReceiptVendorReviewStatus>,
): ReceiptVendorReviewStatus {
  if (!movement.latestMonthStart) return 'reviewed'
  return reviews[reviewKey(movement.vendorLabel, movement.comparison, movement.latestMonthStart)]
    ?? (movement.signal ? 'needs_review' : 'reviewed')
}

function MovementMetric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail: string
  tone?: 'neutral' | 'up' | 'down' | 'attention'
}) {
  const toneClass = tone === 'up'
    ? 'border-rose-100 bg-rose-50 text-rose-800'
    : tone === 'down'
      ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
      : tone === 'attention'
        ? 'border-amber-100 bg-amber-50 text-amber-800'
        : 'border-gray-200 bg-white text-gray-900'

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs opacity-75">{detail}</p>
    </div>
  )
}

function DivergingMovementChart({ movements }: { movements: ReceiptVendorMovementSummary[] }) {
  const rows = [...movements]
    .filter((movement) => movement.delta !== null && movement.delta !== 0)
    .sort((left, right) => Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0))
    .slice(0, 10)
  const maxDelta = rows.reduce((max, movement) => Math.max(max, Math.abs(movement.delta ?? 0)), 0)

  if (!rows.length) {
    return <p className="text-sm text-gray-500">No movement is available for this comparison.</p>
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(7rem,11rem)_1fr_5rem] items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <span>Vendor</span>
        <div className="grid grid-cols-2 text-center"><span>Down</span><span>Up</span></div>
        <span className="text-right">Movement</span>
      </div>
      {rows.map((movement) => {
        const delta = movement.delta ?? 0
        const width = maxDelta > 0 ? Math.max((Math.abs(delta) / maxDelta) * 50, 2) : 0
        return (
          <div key={movement.vendorLabel} className="grid grid-cols-[minmax(7rem,11rem)_1fr_5rem] items-center gap-3">
            <span className="truncate text-xs font-medium text-gray-700" title={movement.vendorLabel}>{movement.vendorLabel}</span>
            <div className="relative h-5 rounded bg-gray-50">
              <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300" />
              <div
                className={`absolute inset-y-1 rounded ${delta > 0 ? 'left-1/2 bg-rose-500' : 'right-1/2 bg-emerald-500'}`}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className={`text-right text-xs font-semibold tabular-nums ${delta > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {formatSignedCurrency(delta)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function VendorMovementPanel({
  watchedVendors,
  reviews,
  updatingWatchVendor,
  updatingReview,
  error,
  onViewDetails,
  onToggleWatched,
  onUpdateReview,
}: {
  watchedVendors: Record<string, string>
  reviews: Record<string, ReceiptVendorReviewStatus>
  updatingWatchVendor: string | null
  updatingReview: string | null
  error: string | null
  onViewDetails: (vendorLabel: string) => void
  onToggleWatched: (vendorLabel: string, watched: boolean) => void
  onUpdateReview: (movement: ReceiptVendorMovementSummary, status: ReceiptVendorReviewStatus) => void
}) {
  const range: ReceiptVendorMovementRange = DEFAULT_MOVEMENT_RANGE
  const [comparison, setComparison] = useState<ReceiptVendorMovementComparison>(DEFAULT_MOVEMENT_COMPARISON)
  const [view, setView] = useState<MovementView>('attention')
  const [state, setState] = useState<MovementState>({ movements: [], signals: [] })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    getReceiptVendorMovements({ range, comparison })
      .then((result) => {
        if (cancelled) return
        if (!result.success || result.error) {
          setState({
            movements: result.movements ?? [],
            signals: result.signals ?? [],
            error: result.error ?? 'Unable to load vendor movement data.',
          })
        } else {
          setState({ movements: result.movements, signals: result.signals })
        }
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Failed to load vendor movement data', error)
        setState({ movements: [], signals: [], error: 'Something went wrong loading vendor movement data.' })
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [range, comparison])

  const baselineLabel = comparison === 'mom' ? 'Prior month' : comparison === 'yoy' ? 'Prior year' : 'Prior 3m avg'
  const currentLabel = comparison === 'rolling_3m' ? 'Latest 3m avg' : 'Spend'
  const latestMonth = state.movements.find((movement) => movement.latestMonthStart)?.latestMonthStart ?? null
  const periodLabel = latestMonth
    ? comparison === 'rolling_3m'
      ? `Three-month average ending ${formatMonth(latestMonth)}`
      : comparison === 'mom'
        ? `${formatMonth(latestMonth)} against the prior month`
        : `${formatMonth(latestMonth)} against the same month last year`
    : 'Latest completed period'

  const summary = useMemo(() => {
    const comparable = state.movements.filter((movement) => movement.delta !== null)
    const increases = comparable.filter((movement) => (movement.delta ?? 0) > 0)
    const decreases = comparable.filter((movement) => (movement.delta ?? 0) < 0)
    const increaseTotal = increases.reduce((sum, movement) => sum + (movement.delta ?? 0), 0)
    const decreaseTotal = decreases.reduce((sum, movement) => sum + Math.abs(movement.delta ?? 0), 0)
    const attentionCount = state.movements.filter((movement) => {
      const status = movementReviewStatus(movement, reviews)
      return status === 'action_required' || (Boolean(movement.signal) && status === 'needs_review')
    }).length
    return {
      currentSpend: comparable.reduce((sum, movement) => sum + movement.latestOutgoing, 0),
      increaseTotal,
      decreaseTotal,
      netChange: increaseTotal - decreaseTotal,
      attentionCount,
    }
  }, [reviews, state.movements])

  const displayedMovements = useMemo(() => {
    return state.movements
      .filter((movement) => {
        const delta = movement.delta ?? 0
        const status = movementReviewStatus(movement, reviews)
        if (view === 'attention') return status === 'action_required' || (Boolean(movement.signal) && status === 'needs_review')
        if (view === 'increases') return delta > 0
        if (view === 'decreases') return delta < 0
        if (view === 'new') return movement.signal?.direction === 'new' || movement.signal?.direction === 'resumed'
        if (view === 'watched') return Boolean(watchedVendors[normalizeVendorKey(movement.vendorLabel)])
        return true
      })
      .sort((left, right) => Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0))
  }, [reviews, state.movements, view, watchedVendors])

  const views: Array<{ value: MovementView; label: string }> = [
    { value: 'attention', label: `Needs attention (${summary.attentionCount})` },
    { value: 'increases', label: 'Biggest increases' },
    { value: 'decreases', label: 'Biggest decreases' },
    { value: 'new', label: 'New / resumed' },
    { value: 'watched', label: `Watched (${Object.keys(watchedVendors).length})` },
    { value: 'all', label: 'All vendors' },
  ]

  return (
    <div className="space-y-4">
      <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-gray-900">Spend movement overview</h3>
          <p className="mt-1 text-sm text-gray-500">{periodLabel}. Uses complete months only.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={comparison}
            options={[
              { value: 'rolling_3m', label: '3m trend' },
              { value: 'yoy', label: 'Year on year' },
              { value: 'mom', label: 'Month on month' },
            ]}
            onChange={(value) => setComparison(value as ReceiptVendorMovementComparison)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
          <Spinner className="h-4 w-4" />
          Loading vendor movement...
        </div>
      ) : state.error ? (
        <Alert tone="danger" title="Movement unavailable" className="mt-4">
          {state.error}
        </Alert>
      ) : state.movements.length ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MovementMetric label={comparison === 'rolling_3m' ? 'Average monthly spend' : 'Total spend'} value={formatCurrency(summary.currentSpend)} detail={periodLabel} />
          <MovementMetric label="Spend increases" value={`+${formatCurrency(summary.increaseTotal)}`} detail="Across vendors that increased" tone="up" />
          <MovementMetric label="Spend decreases" value={`-${formatCurrency(summary.decreaseTotal)}`} detail="Across vendors that decreased" tone="down" />
          <MovementMetric label="Net movement" value={formatSignedCurrency(summary.netChange)} detail="Increases less decreases" tone={summary.netChange > 0 ? 'up' : summary.netChange < 0 ? 'down' : 'neutral'} />
          <MovementMetric label="Needs attention" value={summary.attentionCount.toLocaleString('en-GB')} detail="Material movements not closed" tone="attention" />
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">No vendor movement found for this view.</p>
      )}
      </Card>

      {!isLoading && !state.error && state.movements.length > 0 && (
        <>
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Biggest movements</h3>
                <p className="mt-1 text-xs text-gray-500">Top vendors ranked by absolute pound movement.</p>
              </div>
              <div className="hidden items-center gap-4 text-xs sm:flex">
                <span className="inline-flex items-center gap-1 text-emerald-700"><ArrowTrendingDownIcon className="h-4 w-4" /> Spend down</span>
                <span className="inline-flex items-center gap-1 text-rose-700"><ArrowTrendingUpIcon className="h-4 w-4" /> Spend up</span>
              </div>
            </div>
            <div className="mt-5"><DivergingMovementChart movements={state.movements} /></div>
          </Card>

          <Card>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {views.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setView(option.value)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${view === option.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {error && <Alert tone="danger" title="Unable to save changes" className="mt-3">{error}</Alert>}

            {displayedMovements.length ? (
              <>
                <div className="mt-4 hidden overflow-x-auto md:block">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-100 text-left font-semibold uppercase tracking-wide text-gray-500">
                      <tr>
                        <th scope="col" className="px-3 py-2">Vendor</th>
                        <th scope="col" className="px-3 py-2 text-right">{currentLabel}</th>
                        <th scope="col" className="px-3 py-2 text-right">{baselineLabel}</th>
                        <th scope="col" className="px-3 py-2 text-right">Movement</th>
                        <th scope="col" className="px-3 py-2">Review status</th>
                        <th scope="col" className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-700">
                      {displayedMovements.map((movement) => {
                        const watched = Boolean(watchedVendors[normalizeVendorKey(movement.vendorLabel)])
                        const status = movementReviewStatus(movement, reviews)
                        const key = movement.latestMonthStart ? reviewKey(movement.vendorLabel, movement.comparison, movement.latestMonthStart) : ''
                        return (
                          <tr key={`${movement.vendorLabel}-${movement.comparison}`}>
                            <td className="max-w-[15rem] px-3 py-3">
                              <div className="truncate font-semibold text-gray-900" title={movement.vendorLabel}>{movement.vendorLabel}</div>
                              <div className="mt-1 flex items-center gap-2">
                                {movement.signal && <span className={`inline-flex rounded-full border px-2 py-0.5 font-medium capitalize ${signalTone(movement.signal)}`}>{movement.signal.direction}</span>}
                                <span className="text-gray-400">{movement.latestTransactionCount.toLocaleString('en-GB')} transactions</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right font-medium tabular-nums text-gray-900">{formatCurrency(movement.latestOutgoing)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-gray-600">{movement.baselineOutgoing === null ? 'No baseline' : formatCurrency(movement.baselineOutgoing)}</td>
                            <td className={`px-3 py-3 text-right font-semibold tabular-nums ${(movement.delta ?? 0) > 0 ? 'text-rose-700' : (movement.delta ?? 0) < 0 ? 'text-emerald-700' : 'text-gray-600'}`}>
                              <div>{formatSignedCurrency(movement.delta)}</div>
                              <div className="mt-1 text-[11px] font-medium opacity-75">{movement.baselineOutgoing === 0 && movement.latestOutgoing > 0 ? 'New' : formatSignedPercent(movement.percentageChange)}</div>
                            </td>
                            <td className="px-3 py-3">
                              <select
                                value={status}
                                disabled={!movement.latestMonthStart || updatingReview === key}
                                onChange={(event) => onUpdateReview(movement, event.target.value as ReceiptVendorReviewStatus)}
                                className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700"
                                aria-label={`Review status for ${movement.vendorLabel}`}
                              >
                                {Object.entries(reviewStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={updatingWatchVendor === movement.vendorLabel}
                                  onClick={() => onToggleWatched(movement.vendorLabel, !watched)}
                                  className={`rounded p-1.5 ${watched ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:bg-gray-100 hover:text-amber-600'}`}
                                  aria-label={`${watched ? 'Stop watching' : 'Watch'} ${movement.vendorLabel}`}
                                >
                                  <StarIcon className="h-4 w-4" />
                                </button>
                                <button type="button" className="font-semibold text-blue-700 hover:text-blue-900" onClick={() => onViewDetails(movement.vendorLabel)}>View details</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 space-y-3 md:hidden">
                  {displayedMovements.map((movement) => {
                    const watched = Boolean(watchedVendors[normalizeVendorKey(movement.vendorLabel)])
                    const status = movementReviewStatus(movement, reviews)
                    const key = movement.latestMonthStart ? reviewKey(movement.vendorLabel, movement.comparison, movement.latestMonthStart) : ''
                    return (
                      <div key={`${movement.vendorLabel}-${movement.comparison}-mobile`} className="rounded-lg border border-gray-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-gray-900">{movement.vendorLabel}</p>
                            <p className="mt-1 text-xs text-gray-500">{formatCurrency(movement.latestOutgoing)} vs {movement.baselineOutgoing === null ? 'no baseline' : formatCurrency(movement.baselineOutgoing)}</p>
                          </div>
                          <div className={`text-right font-semibold tabular-nums ${(movement.delta ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                            <p>{formatSignedCurrency(movement.delta)}</p>
                            <p className="text-xs">{movement.baselineOutgoing === 0 && movement.latestOutgoing > 0 ? 'New' : formatSignedPercent(movement.percentageChange)}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <select
                            value={status}
                            disabled={!movement.latestMonthStart || updatingReview === key}
                            onChange={(event) => onUpdateReview(movement, event.target.value as ReceiptVendorReviewStatus)}
                            className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-2 text-xs font-medium text-gray-700"
                            aria-label={`Review status for ${movement.vendorLabel}`}
                          >
                            {Object.entries(reviewStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <button type="button" onClick={() => onToggleWatched(movement.vendorLabel, !watched)} className={`rounded-md p-2 ${watched ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`} aria-label={`${watched ? 'Stop watching' : 'Watch'} ${movement.vendorLabel}`}><StarIcon className="h-4 w-4" /></button>
                          <button type="button" onClick={() => onViewDetails(movement.vendorLabel)} className="rounded-md bg-gray-900 px-3 py-2 text-xs font-semibold text-white">Details</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="mt-6 rounded-lg bg-gray-50 p-6 text-center">
                {view === 'attention' ? <CheckCircleIcon className="mx-auto h-8 w-8 text-emerald-500" /> : <ExclamationTriangleIcon className="mx-auto h-8 w-8 text-gray-400" />}
                <p className="mt-2 text-sm font-medium text-gray-700">No vendors in this view.</p>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function VendorDetailDrawer({
  open,
  vendorLabel,
  detail,
  loading,
  error,
  aiState,
  aiLoading,
  watched,
  watchLoading,
  onToggleWatched,
  onGenerateAi,
  onClose,
}: {
  open: boolean
  vendorLabel: string
  detail: ReceiptVendorDetail | null
  loading: boolean
  error: string | null
  aiState: DetailAiState | null
  aiLoading: boolean
  watched: boolean
  watchLoading: boolean
  onToggleWatched: () => void
  onGenerateAi: () => void
  onClose: () => void
}) {
  return (
    <Drawer open={open} onClose={onClose} title={vendorLabel} width="min(760px, 100vw)">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner className="h-4 w-4" />
          Loading vendor details...
        </div>
      ) : error ? (
        <Alert tone="danger" title="Unable to load vendor">
          {error}
        </Alert>
      ) : detail ? (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant={watched ? 'primary' : 'secondary'}
              icon={<StarIcon className="h-4 w-4" />}
              loading={watchLoading}
              onClick={onToggleWatched}
            >
              {watched ? 'Watching' : 'Watch'}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="12m spend" value={formatCurrency(detail.totalOutgoing)} tone="spend" />
            <Metric label="Full history" value={detail.historyTransactionCount.toLocaleString('en-GB')} tone="neutral" />
            <Metric label="Recent avg" value={formatCurrency(detail.recentAverageOutgoing)} tone="neutral" />
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-gray-900">AI summary</h4>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<SparklesIcon className="h-4 w-4" />}
                loading={aiLoading}
                onClick={onGenerateAi}
              >
                Generate summary
              </Button>
            </div>

            {detail.signals.length > 0 && !aiState?.review && (
              <div className="space-y-2">
                {detail.signals.map((signal) => (
                  <div key={`${signal.vendorLabel}-${signal.direction}`} className={`rounded-md border p-3 text-sm ${signalTone(signal)}`}>
                    <p className="font-semibold">{signal.severity === 'high' ? 'High priority' : 'Review'} · {signal.direction}</p>
                    <p className="mt-1">{signal.reason}</p>
                  </div>
                ))}
              </div>
            )}

            {aiState?.error && (
              <Alert tone="danger" title="Summary unavailable">
                {aiState.error}
              </Alert>
            )}

            {aiState?.review && (
              <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                <p>{aiState.review.overview}</p>
                {aiState.review.reviewItems.map((item) => (
                  <div key={`${item.vendorLabel}-${item.direction}`} className="mt-3 border-t border-blue-100 pt-3">
                    <p className="font-semibold">{item.direction} · {item.severity}</p>
                    <p className="mt-1">{item.reason}</p>
                    <p className="mt-1 text-xs text-blue-800">{item.suggestedReview}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">Monthly movement</h4>
            <MonthlyMovementTable months={detail.movementMonths} />
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">Expense breakdown</h4>
            {detail.categoryBreakdown.length ? (
              <div className="space-y-2">
                {detail.categoryBreakdown.map((category) => (
                  <div key={category.expenseCategory} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-gray-700">{category.expenseCategory}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-gray-900">{formatCurrency(category.totalOutgoing)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No outgoing expense categories found for this vendor.</p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-gray-900">Full transaction history</h4>
              <span className="text-xs text-gray-500">
                {detail.historyStartDate && detail.historyEndDate
                  ? `${detail.historyTransactionCount.toLocaleString('en-GB')} transactions · ${formatHistoryDate(detail.historyStartDate)} - ${formatHistoryDate(detail.historyEndDate)}`
                  : `${detail.historyTransactionCount.toLocaleString('en-GB')} transactions`}
              </span>
            </div>
            <TransactionTable transactions={detail.transactions} includeYear />
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}

function MonthlyMovementTable({ months }: { months: ReceiptVendorDetail['movementMonths'] }) {
  const rows = [...months].reverse()

  if (!rows.length) {
    return <p className="text-sm text-gray-500">No monthly movement found.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-100 text-left font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th scope="col" className="px-2 py-2">Month</th>
            <th scope="col" className="px-2 py-2 text-right">Spend</th>
            <th scope="col" className="px-2 py-2 text-right">Txns</th>
            <th scope="col" className="px-2 py-2 text-right">MoM</th>
            <th scope="col" className="px-2 py-2 text-right">MoM %</th>
            <th scope="col" className="px-2 py-2 text-right">YoY</th>
            <th scope="col" className="px-2 py-2 text-right">YoY %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-700">
          {rows.map((month) => (
            <tr key={month.monthStart}>
              <td className="whitespace-nowrap px-2 py-2 text-gray-600">{formatMonth(month.monthStart)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatCurrency(month.totalOutgoing)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-700">{month.transactionCount.toLocaleString('en-GB')}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                {month.momBaselineAvailable ? formatSignedCurrency(month.momDelta) : 'No prior month'}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                {month.momBaselineAvailable ? formatSignedPercent(month.momPercentageChange) : '-'}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                {month.yoyBaselineAvailable ? formatSignedCurrency(month.yoyDelta) : 'No prior year'}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">
                {month.yoyBaselineAvailable ? formatSignedPercent(month.yoyPercentageChange) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TransactionTable({
  transactions,
  includeYear = false,
}: {
  transactions: VendorTransactionRow[]
  includeYear?: boolean
}) {
  if (!transactions.length) {
    return <p className="text-sm text-gray-500">No individual transactions matched this vendor.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-100 text-left font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th scope="col" className="px-2 py-2">Date</th>
            <th scope="col" className="px-2 py-2">Details</th>
            <th scope="col" className="px-2 py-2">Type</th>
            <th scope="col" className="px-2 py-2 text-right">Out</th>
            <th scope="col" className="px-2 py-2 text-right">In</th>
            <th scope="col" className="px-2 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-700">
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td className="whitespace-nowrap px-2 py-2 text-gray-600">
                {includeYear ? formatHistoryDate(transaction.transaction_date) : formatDate(transaction.transaction_date)}
              </td>
              <td className="max-w-[14rem] truncate px-2 py-2 text-gray-900" title={transaction.details ?? undefined}>
                {transaction.details || '-'}
              </td>
              <td className="px-2 py-2 text-gray-500">{transaction.transaction_type || '-'}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatCurrency(transaction.amount_out)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatCurrency(transaction.amount_in)}</td>
              <td className="px-2 py-2">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${statusTone[transaction.status]}`}>
                  {statusLabels[transaction.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
  subtle,
}: {
  label: string
  value: string
  tone: 'spend' | 'neutral'
  subtle?: boolean
}) {
  const toneClasses: Record<typeof tone, string> = {
    spend: 'bg-rose-50 text-rose-700',
    neutral: subtle ? 'bg-gray-50 text-gray-500' : 'bg-gray-100 text-gray-700',
  }

  return (
    <div className={`rounded-md px-3 py-2 text-sm font-medium ${toneClasses[tone]}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg">{value}</p>
    </div>
  )
}
