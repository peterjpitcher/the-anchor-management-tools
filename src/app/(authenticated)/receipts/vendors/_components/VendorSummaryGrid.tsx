'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  getReceiptVendorAiSummary,
  getReceiptVendorDetail,
  getReceiptVendorMovements,
  setReceiptVendorReviewStatus,
  setReceiptVendorWatched,
  type ReceiptVendorAiReview,
  type ReceiptVendorDetail,
  type ReceiptVendorMovementComparison,
  type ReceiptVendorMovementRange,
  type ReceiptVendorMovementSignal,
  type ReceiptVendorMovementSummary,
  type ReceiptVendorReviewItem,
  type ReceiptVendorReviewStatus,
  type ReceiptVendorMonthTransaction,
  type ReceiptVendorWatchlistItem,
} from '@/app/actions/receipts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  Empty,
  Icon,
  IconButton,
  PageLoading,
  Section,
  Segmented,
  Select,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import {
  RECEIPT_STATUS_LABEL,
  RECEIPT_STATUS_TONE,
  spendMovementBarClass,
  spendMovementTextClass,
  vendorSignalTone,
} from '@/app/(authenticated)/receipts/_shared/status-ui'
import { ReceiptsPageChrome } from '../../_components/ReceiptsPageChrome'

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

type VendorSummaryGridProps = {
  initialWatchlist: ReceiptVendorWatchlistItem[]
  initialReviews?: ReceiptVendorReviewItem[]
  /** Whether this person has `receipts:manage`, for the Receipts tab row. */
  canManage: boolean
}

const COMPARISON_OPTIONS: Array<{ id: ReceiptVendorMovementComparison; label: string }> = [
  { id: 'rolling_3m', label: '3m Trend' },
  { id: 'yoy', label: 'Year on Year' },
  { id: 'mom', label: 'Month on Month' },
]

function normalizeVendorKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function reviewKey(vendorLabel: string, comparison: ReceiptVendorMovementComparison, monthStart: string) {
  return `${normalizeVendorKey(vendorLabel)}|${comparison}|${monthStart}`
}

export default function VendorSummaryGrid({ initialWatchlist, initialReviews = [], canManage }: VendorSummaryGridProps) {
  const [comparison, setComparison] = useState<ReceiptVendorMovementComparison>(DEFAULT_MOVEMENT_COMPARISON)
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

  // This client renders the Receipts chrome itself, so the comparison switch (which changes every
  // figure on the page) can sit in the header.
  return (
    <ReceiptsPageChrome
      subtitle="Which suppliers are rising in cost and where spend is stable"
      navState={{ view: 'vendors' }}
      canManage={canManage}
      headerActions={
        <Segmented
          options={COMPARISON_OPTIONS}
          value={comparison}
          onChange={(value) => setComparison(value as ReceiptVendorMovementComparison)}
          size="sm"
        />
      }
    >
      <VendorMovementPanel
        comparison={comparison}
        watchedVendors={watchedVendors}
        reviews={reviews}
        updatingWatchVendor={updatingWatchVendor}
        updatingReview={updatingReview}
        error={watchlistError ?? reviewError}
        onViewDetails={openVendorDetail}
        onToggleWatched={toggleVendorWatched}
        onUpdateReview={updateVendorReview}
      />

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
    </ReceiptsPageChrome>
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

function DivergingMovementChart({ movements }: { movements: ReceiptVendorMovementSummary[] }) {
  const rows = [...movements]
    .filter((movement) => movement.delta !== null && movement.delta !== 0)
    .sort((left, right) => Math.abs(right.delta ?? 0) - Math.abs(left.delta ?? 0))
    .slice(0, 10)
  const maxDelta = rows.reduce((max, movement) => Math.max(max, Math.abs(movement.delta ?? 0)), 0)

  if (!rows.length) {
    return <Empty size="sm" title="No movement is available for this comparison" />
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(7rem,11rem)_1fr_5rem] items-center gap-3 text-meta font-semibold uppercase tracking-wide text-text-soft">
        <span>Vendor</span>
        <div className="grid grid-cols-2 text-center"><span>Down</span><span>Up</span></div>
        <span className="text-right">Movement</span>
      </div>
      {rows.map((movement) => {
        const delta = movement.delta ?? 0
        const width = maxDelta > 0 ? Math.max((Math.abs(delta) / maxDelta) * 50, 2) : 0
        return (
          <div key={movement.vendorLabel} className="grid grid-cols-[minmax(7rem,11rem)_1fr_5rem] items-center gap-3">
            <span className="truncate text-xs font-medium text-text" title={movement.vendorLabel}>{movement.vendorLabel}</span>
            <div className="relative h-5 rounded-sm bg-surface-2">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
              <div
                className={`absolute inset-y-1 rounded-sm ${delta > 0 ? 'left-1/2' : 'right-1/2'} ${spendMovementBarClass(delta)}`}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className={`text-right text-xs font-semibold tabular-nums ${spendMovementTextClass(delta)}`}>
              {formatSignedCurrency(delta)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** The star that adds a vendor to, or takes it off, the watched list. */
function WatchToggle({
  vendorLabel,
  watched,
  disabled,
  onToggle,
}: {
  vendorLabel: string
  watched: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <IconButton
      type="button"
      size="sm"
      variant={watched ? 'secondary' : 'ghost'}
      aria-pressed={watched}
      disabled={disabled}
      onClick={onToggle}
      label={`${watched ? 'Stop watching' : 'Watch'} ${vendorLabel}`}
      icon={<Icon name="star" size={16} className={watched ? 'fill-current text-warning' : 'text-text-subtle'} />}
    />
  )
}

function VendorMovementPanel({
  comparison,
  watchedVendors,
  reviews,
  updatingWatchVendor,
  updatingReview,
  error,
  onViewDetails,
  onToggleWatched,
  onUpdateReview,
}: {
  comparison: ReceiptVendorMovementComparison
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

  const views: Array<{ id: MovementView; label: string }> = [
    { id: 'attention', label: `Needs Attention (${summary.attentionCount})` },
    { id: 'increases', label: 'Biggest Increases' },
    { id: 'decreases', label: 'Biggest Decreases' },
    { id: 'new', label: 'New / Resumed' },
    { id: 'watched', label: `Watched (${Object.keys(watchedVendors).length})` },
    { id: 'all', label: 'All Vendors' },
  ]

  const reviewStatusSelect = (movement: ReceiptVendorMovementSummary, status: ReceiptVendorReviewStatus, key: string) => (
    <Select
      value={status}
      disabled={!movement.latestMonthStart || updatingReview === key}
      onChange={(event) => onUpdateReview(movement, event.target.value as ReceiptVendorReviewStatus)}
      aria-label={`Review status for ${movement.vendorLabel}`}
    >
      {Object.entries(reviewStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select>
  )

  return (
    <>
      <Section title="Spend Movement Overview" description={`${periodLabel}. Uses complete months only.`}>
        {isLoading ? (
          <PageLoading inline label="Loading vendor movement" />
        ) : state.error ? (
          <Alert tone="danger" title="Movement unavailable">
            {state.error}
          </Alert>
        ) : state.movements.length ? (
          <StatGrid columns={3} className="xl:grid-cols-5">
            <Stat label={comparison === 'rolling_3m' ? 'Average monthly spend' : 'Total spend'} value={formatCurrency(summary.currentSpend)} hint={periodLabel} />
            <Stat label="Spend increases" value={`+${formatCurrency(summary.increaseTotal)}`} hint="Across vendors that increased" />
            <Stat label="Spend decreases" value={`-${formatCurrency(summary.decreaseTotal)}`} hint="Across vendors that decreased" />
            <Stat label="Net movement" value={formatSignedCurrency(summary.netChange)} hint="Increases less decreases" />
            <Stat label="Needs attention" value={summary.attentionCount.toLocaleString('en-GB')} hint="Material movements not closed" />
          </StatGrid>
        ) : (
          <Card>
            <Empty size="sm" title="No vendor movement found for this view" />
          </Card>
        )}
      </Section>

      {!isLoading && !state.error && state.movements.length > 0 && (
        <>
          <Card>
            <CardHeader
              title="Biggest Movements"
              subtitle="Top vendors ranked by absolute pound movement"
              action={
                <div className="hidden items-center gap-4 text-xs sm:flex">
                  <span className="inline-flex items-center gap-1 text-success-fg"><Icon name="trendDown" size={16} /> Spend down</span>
                  <span className="inline-flex items-center gap-1 text-danger-fg"><Icon name="trendUp" size={16} /> Spend up</span>
                </div>
              }
            />
            <CardBody>
              <DivergingMovementChart movements={state.movements} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Vendors" subtitle="Review each movement and watch the suppliers you care about" />
            <CardBody className="space-y-4">
              <div className="overflow-x-auto">
                <Segmented
                  options={views}
                  value={view}
                  onChange={(value) => setView(value as MovementView)}
                  size="sm"
                />
              </div>

              {error && <Alert tone="danger" title="Unable to save changes">{error}</Alert>}

              {displayedMovements.length ? (
                <div className="divide-y divide-border md:hidden">
                  {displayedMovements.map((movement) => {
                    const watched = Boolean(watchedVendors[normalizeVendorKey(movement.vendorLabel)])
                    const status = movementReviewStatus(movement, reviews)
                    const key = movement.latestMonthStart ? reviewKey(movement.vendorLabel, movement.comparison, movement.latestMonthStart) : ''
                    return (
                      <div key={`${movement.vendorLabel}-${movement.comparison}-mobile`} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-text-strong">{movement.vendorLabel}</p>
                            <p className="mt-1 text-xs text-text-muted">{formatCurrency(movement.latestOutgoing)} vs {movement.baselineOutgoing === null ? 'no baseline' : formatCurrency(movement.baselineOutgoing)}</p>
                          </div>
                          <div className={`text-right font-semibold tabular-nums ${spendMovementTextClass(movement.delta ?? 0)}`}>
                            <p>{formatSignedCurrency(movement.delta)}</p>
                            <p className="text-xs">{movement.baselineOutgoing === 0 && movement.latestOutgoing > 0 ? 'New' : formatSignedPercent(movement.percentageChange)}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <div className="min-w-0 flex-1">{reviewStatusSelect(movement, status, key)}</div>
                          <WatchToggle
                            vendorLabel={movement.vendorLabel}
                            watched={watched}
                            onToggle={() => onToggleWatched(movement.vendorLabel, !watched)}
                          />
                          <Button type="button" variant="secondary" size="sm" onClick={() => onViewDetails(movement.vendorLabel)}>Details</Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <Empty
                  size="sm"
                  icon={view === 'attention' ? <Icon name="checkCircle" size={32} /> : <Icon name="alertTriangle" size={32} />}
                  title="No vendors in this view"
                />
              )}
            </CardBody>

            {displayedMovements.length > 0 && (
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead align="right">{currentLabel}</TableHead>
                      <TableHead align="right">{baselineLabel}</TableHead>
                      <TableHead align="right">Movement</TableHead>
                      <TableHead>Review status</TableHead>
                      <TableHead align="right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedMovements.map((movement) => {
                      const watched = Boolean(watchedVendors[normalizeVendorKey(movement.vendorLabel)])
                      const status = movementReviewStatus(movement, reviews)
                      const key = movement.latestMonthStart ? reviewKey(movement.vendorLabel, movement.comparison, movement.latestMonthStart) : ''
                      return (
                        <TableRow key={`${movement.vendorLabel}-${movement.comparison}`}>
                          <TableCell className="max-w-[15rem] whitespace-normal">
                            <div className="truncate font-semibold text-text-strong" title={movement.vendorLabel}>{movement.vendorLabel}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              {movement.signal && <Badge tone={vendorSignalTone(movement.signal)} className="capitalize">{movement.signal.direction}</Badge>}
                              <span className="text-text-soft">{movement.latestTransactionCount.toLocaleString('en-GB')} transactions</span>
                            </div>
                          </TableCell>
                          <TableCell align="right" className="font-medium tabular-nums text-text-strong">{formatCurrency(movement.latestOutgoing)}</TableCell>
                          <TableCell align="right" className="tabular-nums text-text-muted">{movement.baselineOutgoing === null ? 'No baseline' : formatCurrency(movement.baselineOutgoing)}</TableCell>
                          <TableCell align="right" className={`font-semibold tabular-nums ${spendMovementTextClass(movement.delta ?? 0)}`}>
                            <div>{formatSignedCurrency(movement.delta)}</div>
                            <div className="mt-1 text-meta font-medium">{movement.baselineOutgoing === 0 && movement.latestOutgoing > 0 ? 'New' : formatSignedPercent(movement.percentageChange)}</div>
                          </TableCell>
                          <TableCell>{reviewStatusSelect(movement, status, key)}</TableCell>
                          <TableCell align="right">
                            <div className="inline-flex items-center gap-2">
                              <WatchToggle
                                vendorLabel={movement.vendorLabel}
                                watched={watched}
                                disabled={updatingWatchVendor === movement.vendorLabel}
                                onToggle={() => onToggleWatched(movement.vendorLabel, !watched)}
                              />
                              <Button type="button" variant="link" size="sm" onClick={() => onViewDetails(movement.vendorLabel)}>View Details</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
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
        <PageLoading inline label="Loading vendor details" />
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
              icon={<Icon name="star" size={16} className="fill-current" />}
              loading={watchLoading}
              onClick={onToggleWatched}
            >
              {watched ? 'Watching' : 'Watch'}
            </Button>
          </div>

          <StatGrid columns={3}>
            <Stat label="12m spend" value={formatCurrency(detail.totalOutgoing)} />
            <Stat label="Full history" value={detail.historyTransactionCount.toLocaleString('en-GB')} />
            <Stat label="Recent avg" value={formatCurrency(detail.recentAverageOutgoing)} />
          </StatGrid>

          <Section
            title="AI Summary"
            actions={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<Icon name="sparkles" size={16} />}
                loading={aiLoading}
                onClick={onGenerateAi}
              >
                Generate Summary
              </Button>
            }
          >
            <div className="space-y-3">
              {detail.signals.length > 0 && !aiState?.review && (
                <div className="space-y-2">
                  {detail.signals.map((signal) => (
                    <Alert
                      key={`${signal.vendorLabel}-${signal.direction}`}
                      tone={vendorSignalTone(signal)}
                      role="status"
                      title={`${signal.severity === 'high' ? 'High priority' : 'Review'} \u00b7 ${signal.direction}`}
                    >
                      {signal.reason}
                    </Alert>
                  ))}
                </div>
              )}

              {aiState?.error && (
                <Alert tone="danger" title="Summary unavailable">
                  {aiState.error}
                </Alert>
              )}

              {aiState?.review && (
                <Alert tone="info" role="status">
                  <p>{aiState.review.overview}</p>
                  {aiState.review.reviewItems.map((item) => (
                    <div key={`${item.vendorLabel}-${item.direction}`} className="mt-3 border-t border-info-border pt-3">
                      <p className="font-semibold">{item.direction} · {item.severity}</p>
                      <p className="mt-1">{item.reason}</p>
                      <p className="mt-1 text-xs">{item.suggestedReview}</p>
                    </div>
                  ))}
                </Alert>
              )}
            </div>
          </Section>

          <Section title="Monthly Movement">
            <MonthlyMovementTable months={detail.movementMonths} />
          </Section>

          <Section title="Expense Breakdown">
            {detail.categoryBreakdown.length ? (
              <Card padding="none">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Expense type</TableHead>
                      <TableHead align="right">Spend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.categoryBreakdown.map((category) => (
                      <TableRow key={category.expenseCategory}>
                        <TableCell className="max-w-[20rem] truncate">{category.expenseCategory}</TableCell>
                        <TableCell align="right" className="font-semibold tabular-nums text-text-strong">{formatCurrency(category.totalOutgoing)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            ) : (
              <Empty size="sm" title="No outgoing expense categories found for this vendor" />
            )}
          </Section>

          <Section
            title="Full Transaction History"
            description={
              detail.historyStartDate && detail.historyEndDate
                ? `${detail.historyTransactionCount.toLocaleString('en-GB')} transactions \u00b7 ${formatHistoryDate(detail.historyStartDate)} - ${formatHistoryDate(detail.historyEndDate)}`
                : `${detail.historyTransactionCount.toLocaleString('en-GB')} transactions`
            }
          >
            <TransactionTable transactions={detail.transactions} includeYear />
          </Section>
        </div>
      ) : null}
    </Drawer>
  )
}

function MonthlyMovementTable({ months }: { months: ReceiptVendorDetail['movementMonths'] }) {
  const rows = [...months].reverse()

  if (!rows.length) {
    return <Empty size="sm" title="No monthly movement found" />
  }

  return (
    <Card padding="none">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead align="right">Spend</TableHead>
            <TableHead align="right">Txns</TableHead>
            <TableHead align="right">MoM</TableHead>
            <TableHead align="right">MoM %</TableHead>
            <TableHead align="right">YoY</TableHead>
            <TableHead align="right">YoY %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((month) => (
            <TableRow key={month.monthStart}>
              <TableCell className="text-text-muted">{formatMonth(month.monthStart)}</TableCell>
              <TableCell align="right" className="tabular-nums text-text-strong">{formatCurrency(month.totalOutgoing)}</TableCell>
              <TableCell align="right" className="tabular-nums">{month.transactionCount.toLocaleString('en-GB')}</TableCell>
              <TableCell align="right" className="tabular-nums text-text-strong">
                {month.momBaselineAvailable ? formatSignedCurrency(month.momDelta) : 'No prior month'}
              </TableCell>
              <TableCell align="right" className="tabular-nums text-text-strong">
                {month.momBaselineAvailable ? formatSignedPercent(month.momPercentageChange) : '-'}
              </TableCell>
              <TableCell align="right" className="tabular-nums text-text-strong">
                {month.yoyBaselineAvailable ? formatSignedCurrency(month.yoyDelta) : 'No prior year'}
              </TableCell>
              <TableCell align="right" className="tabular-nums text-text-strong">
                {month.yoyBaselineAvailable ? formatSignedPercent(month.yoyPercentageChange) : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
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
    return <Empty size="sm" title="No individual transactions matched this vendor" />
  }

  return (
    <Card padding="none">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Type</TableHead>
            <TableHead align="right">Out</TableHead>
            <TableHead align="right">In</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id}>
              <TableCell className="text-text-muted">
                {includeYear ? formatHistoryDate(transaction.transaction_date) : formatDate(transaction.transaction_date)}
              </TableCell>
              <TableCell className="max-w-[14rem] truncate text-text-strong">
                <span title={transaction.details ?? undefined}>{transaction.details || '-'}</span>
              </TableCell>
              <TableCell className="text-text-muted">{transaction.transaction_type || '-'}</TableCell>
              <TableCell align="right" className="tabular-nums text-text-strong">{formatCurrency(transaction.amount_out)}</TableCell>
              <TableCell align="right" className="tabular-nums text-text-strong">{formatCurrency(transaction.amount_in)}</TableCell>
              <TableCell>
                <Badge tone={RECEIPT_STATUS_TONE[transaction.status]} size="sm">
                  {RECEIPT_STATUS_LABEL[transaction.status]}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
