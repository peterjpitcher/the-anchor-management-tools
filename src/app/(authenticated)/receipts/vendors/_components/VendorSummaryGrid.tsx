'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  getReceiptVendorAiSummary,
  getReceiptVendorDetail,
  getReceiptVendorMovements,
  getReceiptVendorMonthTransactions,
  setReceiptVendorWatched,
  type ReceiptVendorAiReview,
  type ReceiptVendorCostSignal,
  type ReceiptVendorDetail,
  type ReceiptVendorMovementComparison,
  type ReceiptVendorMovementRange,
  type ReceiptVendorMovementSignal,
  type ReceiptVendorMovementSummary,
  type ReceiptVendorMonthTransaction,
  type ReceiptVendorSummary,
  type ReceiptVendorWatchlistItem,
} from '@/app/actions/receipts'
import { Alert, Button, Card, Drawer, Spinner } from '@/ds'
import {
  ChevronDownIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  StarIcon,
} from '@heroicons/react/20/solid'

const MONTH_WINDOW = 12
const DEFAULT_MOVEMENT_RANGE: ReceiptVendorMovementRange = '36m'
const DEFAULT_MOVEMENT_COMPARISON: ReceiptVendorMovementComparison = 'yoy'

type MovementState = {
  movements: ReceiptVendorMovementSummary[]
  signals: ReceiptVendorMovementSignal[]
  error?: string
}

type MovementSortKey = 'vendor' | 'latestMonth' | 'spend' | 'baseline' | 'delta' | 'change' | 'transactions' | 'signal'

type MovementSortDirection = 'asc' | 'desc'

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

function formatChange(value: number) {
  if (!Number.isFinite(value) || value === 0) return '0%'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)}%`
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
}

function normalizeVendorKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export default function VendorSummaryGrid({ vendors, initialWatchlist }: VendorSummaryGridProps) {
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
  const [showWatchedOnly, setShowWatchedOnly] = useState(false)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)
  const [updatingWatchVendor, setUpdatingWatchVendor] = useState<string | null>(null)

  const watchedCount = Object.keys(watchedVendors).length
  const displayedVendors = showWatchedOnly
    ? vendors.filter((vendor) => Boolean(watchedVendors[normalizeVendorKey(vendor.vendorLabel)]))
    : vendors

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
        <VendorMovementPanel onViewDetails={openVendorDetail} />

        <WatchedVendorToolbar
          watchedCount={watchedCount}
          showWatchedOnly={showWatchedOnly}
          error={watchlistError}
          onShowAll={() => setShowWatchedOnly(false)}
          onShowWatched={() => setShowWatchedOnly(true)}
        />

        {displayedVendors.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {displayedVendors.map((vendor) => {
              const watched = Boolean(watchedVendors[normalizeVendorKey(vendor.vendorLabel)])
              return (
                <VendorCard
                  key={vendor.vendorLabel}
                  vendor={vendor}
                  watched={watched}
                  watchLoading={updatingWatchVendor === vendor.vendorLabel}
                  onViewDetails={() => openVendorDetail(vendor.vendorLabel)}
                  onToggleWatched={() => toggleVendorWatched(vendor.vendorLabel, !watched)}
                />
              )
            })}
          </div>
        ) : (
          <Card>
            <p className="text-sm text-gray-500">No watched vendors yet.</p>
          </Card>
        )}
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

function defaultMovementSortDirection(key: MovementSortKey): MovementSortDirection {
  return key === 'vendor' ? 'asc' : 'desc'
}

function compareNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: MovementSortDirection,
): number {
  const leftMissing = left === null || left === undefined || !Number.isFinite(left)
  const rightMissing = right === null || right === undefined || !Number.isFinite(right)
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1
  return direction === 'asc' ? left - right : right - left
}

function compareNullableText(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: MovementSortDirection,
): number {
  const leftMissing = !left
  const rightMissing = !right
  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1
  const result = left.localeCompare(right)
  return direction === 'asc' ? result : -result
}

function compareMovementSignals(
  left: ReceiptVendorMovementSummary,
  right: ReceiptVendorMovementSummary,
  direction: MovementSortDirection,
): number {
  const severityRank = (movement: ReceiptVendorMovementSummary) => {
    if (movement.signal?.severity === 'high') return 2
    if (movement.signal?.severity === 'medium') return 1
    return null
  }
  const severityCompare = compareNullableNumber(severityRank(left), severityRank(right), direction)
  if (severityCompare !== 0) return severityCompare

  const deltaCompare = compareNullableNumber(left.signal?.absoluteDelta, right.signal?.absoluteDelta, direction)
  if (deltaCompare !== 0) return deltaCompare

  return compareNullableText(left.signal?.direction, right.signal?.direction, direction)
}

function compareVendorMovements(
  left: ReceiptVendorMovementSummary,
  right: ReceiptVendorMovementSummary,
  key: MovementSortKey,
  direction: MovementSortDirection,
): number {
  if (key === 'vendor') return compareNullableText(left.vendorLabel, right.vendorLabel, direction)
  if (key === 'latestMonth') return compareNullableText(left.latestMonthStart, right.latestMonthStart, direction)
  if (key === 'spend') return compareNullableNumber(left.latestOutgoing, right.latestOutgoing, direction)
  if (key === 'baseline') return compareNullableNumber(left.baselineOutgoing, right.baselineOutgoing, direction)
  if (key === 'delta') return compareNullableNumber(left.delta, right.delta, direction)
  if (key === 'change') return compareNullableNumber(left.percentageChange, right.percentageChange, direction)
  if (key === 'transactions') return compareNullableNumber(left.latestTransactionCount, right.latestTransactionCount, direction)
  return compareMovementSignals(left, right, direction)
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  align = 'left',
  onSort,
}: {
  label: string
  sortKey: MovementSortKey
  activeKey: MovementSortKey
  direction: MovementSortDirection
  align?: 'left' | 'right'
  onSort: (key: MovementSortKey) => void
}) {
  const isActive = activeKey === sortKey

  return (
    <th scope="col" className={`px-2 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`} aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-gray-800 ${align === 'right' ? 'justify-end' : 'justify-start'}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {isActive ? (
          <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${direction === 'asc' ? 'rotate-180' : ''}`} />
        ) : (
          <ChevronUpDownIcon className="h-3.5 w-3.5 text-gray-400" />
        )}
      </button>
    </th>
  )
}

function VendorMovementPanel({ onViewDetails }: { onViewDetails: (vendorLabel: string) => void }) {
  const [range, setRange] = useState<ReceiptVendorMovementRange>(DEFAULT_MOVEMENT_RANGE)
  const [comparison, setComparison] = useState<ReceiptVendorMovementComparison>(DEFAULT_MOVEMENT_COMPARISON)
  const [watchedOnly, setWatchedOnly] = useState(false)
  const [state, setState] = useState<MovementState>({ movements: [], signals: [] })
  const [isLoading, setIsLoading] = useState(true)
  const [sort, setSort] = useState<{ key: MovementSortKey; direction: MovementSortDirection }>({
    key: 'signal',
    direction: 'desc',
  })

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    getReceiptVendorMovements({ range, comparison, watchedOnly })
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
  }, [range, comparison, watchedOnly])

  const baselineLabel = comparison === 'mom' ? 'Prior month' : 'Prior year'
  const sortedMovements = useMemo(() => {
    return [...state.movements].sort((left, right) => {
      const result = compareVendorMovements(left, right, sort.key, sort.direction)
      return result === 0
        ? left.vendorLabel.localeCompare(right.vendorLabel)
        : result
    })
  }, [sort.direction, sort.key, state.movements])

  function handleSort(key: MovementSortKey) {
    setSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        }
      }
      return {
        key,
        direction: defaultMovementSortDirection(key),
      }
    })
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">Vendor movement</h3>
          <p className="mt-1 text-xs text-gray-500">
            {state.movements.length.toLocaleString('en-GB')} vendors ranked by {comparison === 'mom' ? 'month-on-month' : 'year-on-year'} change
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={range}
            options={[
              { value: '12m', label: '12m' },
              { value: '24m', label: '24m' },
              { value: '36m', label: '36m' },
              { value: 'all', label: 'All' },
            ]}
            onChange={(value) => setRange(value as ReceiptVendorMovementRange)}
          />
          <SegmentedControl
            value={comparison}
            options={[
              { value: 'yoy', label: 'YoY' },
              { value: 'mom', label: 'MoM' },
            ]}
            onChange={(value) => setComparison(value as ReceiptVendorMovementComparison)}
          />
          <SegmentedControl
            value={watchedOnly ? 'watched' : 'all'}
            options={[
              { value: 'all', label: 'All' },
              { value: 'watched', label: 'Watched' },
            ]}
            onChange={(value) => setWatchedOnly(value === 'watched')}
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
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-100 text-left font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <SortableHeader label="Vendor" sortKey="vendor" activeKey={sort.key} direction={sort.direction} onSort={handleSort} />
                <SortableHeader label="Latest month" sortKey="latestMonth" activeKey={sort.key} direction={sort.direction} onSort={handleSort} />
                <SortableHeader label="Spend" sortKey="spend" activeKey={sort.key} direction={sort.direction} align="right" onSort={handleSort} />
                <SortableHeader label={baselineLabel} sortKey="baseline" activeKey={sort.key} direction={sort.direction} align="right" onSort={handleSort} />
                <SortableHeader label="Delta" sortKey="delta" activeKey={sort.key} direction={sort.direction} align="right" onSort={handleSort} />
                <SortableHeader label="Change" sortKey="change" activeKey={sort.key} direction={sort.direction} align="right" onSort={handleSort} />
                <SortableHeader label="Txns" sortKey="transactions" activeKey={sort.key} direction={sort.direction} align="right" onSort={handleSort} />
                <SortableHeader label="Signal" sortKey="signal" activeKey={sort.key} direction={sort.direction} onSort={handleSort} />
                <th scope="col" className="px-2 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {sortedMovements.map((movement) => (
                <tr key={`${movement.vendorLabel}-${movement.range}-${movement.comparison}`}>
                  <td className="max-w-[14rem] truncate px-2 py-2 font-medium text-gray-900" title={movement.vendorLabel}>
                    {movement.vendorLabel}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-gray-600">
                    {movement.latestMonthStart ? formatMonth(movement.latestMonthStart) : '-'}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatCurrency(movement.latestOutgoing)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-700">
                    {movement.baselineOutgoing === null ? `No ${comparison === 'mom' ? 'prior month' : 'prior year'}` : formatCurrency(movement.baselineOutgoing)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatSignedCurrency(movement.delta)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-900">{formatSignedPercent(movement.percentageChange)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-700">{movement.latestTransactionCount.toLocaleString('en-GB')}</td>
                  <td className="px-2 py-2">
                    {movement.signal ? (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium capitalize ${signalTone(movement.signal)}`}>
                        {movement.signal.direction}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      className="font-semibold text-blue-700 hover:text-blue-900"
                      onClick={() => onViewDetails(movement.vendorLabel)}
                    >
                      View details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">No vendor movement found for this view.</p>
      )}
    </Card>
  )
}

function WatchedVendorToolbar({
  watchedCount,
  showWatchedOnly,
  error,
  onShowAll,
  onShowWatched,
}: {
  watchedCount: number
  showWatchedOnly: boolean
  error: string | null
  onShowAll: () => void
  onShowWatched: () => void
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StarIcon className="h-5 w-5 text-amber-500" />
            <h3 className="text-base font-semibold text-gray-900">Watched vendors</h3>
          </div>
          <p className="mt-1 text-xs text-gray-500">{watchedCount} watched</p>
        </div>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-1">
          <button
            type="button"
            onClick={onShowAll}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${!showWatchedOnly ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            All
          </button>
          <button
            type="button"
            onClick={onShowWatched}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition ${showWatchedOnly ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Watched
          </button>
        </div>
      </div>
      {error && (
        <Alert tone="danger" title="Watchlist unavailable" className="mt-4">
          {error}
        </Alert>
      )}
    </Card>
  )
}

function VendorCard({
  vendor,
  watched,
  watchLoading,
  onViewDetails,
  onToggleWatched,
}: {
  vendor: ReceiptVendorSummary
  watched: boolean
  watchLoading: boolean
  onViewDetails: () => void
  onToggleWatched: () => void
}) {
  const totalTransactions = useMemo(
    () => vendor.months.reduce((sum, month) => sum + month.transactionCount, 0),
    [vendor.months],
  )
  const maxMonthlySpend = useMemo(
    () => vendor.months.reduce((max, month) => Math.max(max, month.totalOutgoing), 0),
    [vendor.months],
  )
  const recentMonths = useMemo(() => vendor.months.slice(-6), [vendor.months])

  const changeTone = vendor.changePercentage > 5
    ? 'bg-rose-50 text-rose-700'
    : vendor.changePercentage < -5
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-gray-100 text-gray-600'

  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null)
  const [monthTransactions, setMonthTransactions] = useState<Record<string, ReceiptVendorMonthTransaction[]>>({})
  const [monthErrors, setMonthErrors] = useState<Record<string, string | undefined>>({})
  const [isPending, startTransition] = useTransition()

  function toggleMonth(monthStart: string) {
    if (expandedMonth === monthStart) {
      setExpandedMonth(null)
      return
    }

    setExpandedMonth(monthStart)

    if (monthTransactions[monthStart] || loadingMonth === monthStart) {
      return
    }

    setLoadingMonth(monthStart)
    setMonthErrors((prev) => ({ ...prev, [monthStart]: undefined }))

    startTransition(async () => {
      try {
        const result = await getReceiptVendorMonthTransactions({
          vendorLabel: vendor.vendorLabel,
          monthStart,
        })
        if (result.error) {
          setMonthErrors((prev) => ({ ...prev, [monthStart]: result.error }))
        } else {
          setMonthTransactions((prev) => ({ ...prev, [monthStart]: result.transactions }))
          setMonthErrors((prev) => ({ ...prev, [monthStart]: undefined }))
        }
      } catch (error) {
        console.error('Failed to load vendor month details', error)
        setMonthErrors((prev) => ({ ...prev, [monthStart]: 'Something went wrong loading transactions.' }))
      } finally {
        setLoadingMonth(null)
      }
    })
  }

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-gray-900">{vendor.vendorLabel}</h3>
            <p className="text-xs text-gray-500">{totalTransactions} transactions across {vendor.months.length} months</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${changeTone}`}>
              {formatChange(vendor.changePercentage)} vs prior 3 months
            </span>
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
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={<MagnifyingGlassIcon className="h-4 w-4" />}
              onClick={onViewDetails}
            >
              View details
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Total spend" value={formatCurrency(vendor.totalOutgoing)} tone="spend" />
          <Metric label="Avg (last 3m)" value={formatCurrency(vendor.recentAverageOutgoing)} tone="neutral" />
          <Metric label="Prev avg" value={formatCurrency(vendor.previousAverageOutgoing)} tone="neutral" subtle />
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent six months</h4>
          <div className="space-y-2">
            {recentMonths.map((month) => {
              const width = maxMonthlySpend
                ? Math.max(Math.min((month.totalOutgoing / maxMonthlySpend) * 100, 100), 4)
                : 0
              const isActive = expandedMonth === month.monthStart
              const hasError = monthErrors[month.monthStart]
              const transactions = monthTransactions[month.monthStart] ?? []

              return (
                <div key={month.monthStart}>
                  <button
                    type="button"
                    onClick={() => toggleMonth(month.monthStart)}
                    className={`flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left text-xs text-gray-600 transition hover:border-emerald-200 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-300 ${isActive ? 'border-emerald-300 bg-emerald-50' : ''}`}
                    aria-expanded={isActive}
                  >
                    <ChevronDownIcon
                      className={`h-4 w-4 shrink-0 transition-transform ${isActive ? 'rotate-180 text-emerald-600' : 'text-gray-400'}`}
                    />
                    <span className="w-20 text-gray-500">{formatMonth(month.monthStart)}</span>
                    <div className="relative h-2 flex-1 rounded bg-gray-100" title={formatCurrency(month.totalOutgoing)}>
                      <div
                        className="absolute left-0 top-0 h-2 rounded bg-emerald-500"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-gray-700 tabular-nums">{formatCurrency(month.totalOutgoing)}</span>
                  </button>

                  {isActive && (
                    <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                      {loadingMonth === month.monthStart || isPending ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Spinner className="h-4 w-4" />
                          Loading transactions...
                        </div>
                      ) : hasError ? (
                        <p className="text-sm text-rose-600">{hasError}</p>
                      ) : (
                        <TransactionTable transactions={transactions} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
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
