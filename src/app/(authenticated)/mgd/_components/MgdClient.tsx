'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Card,
  CardHeader,
  CardBody,
  Badge,
  Button,
  Modal,
  ConfirmDialog,
  Empty,
  Tooltip,
  Input,
  Field,
  Alert,
  Stat,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/ds'
import { toast } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import { CollectionForm } from './CollectionForm'
import {
  getCollections,
  getReturns,
  getCurrentReturn,
  deleteCollection,
  updateReturnStatus,
} from '@/app/actions/mgd'
import type { MgdCollection, MgdReturn } from '@/app/actions/mgd'
import { useSort } from '@/hooks/useSort'
import { SortableHeader } from '@/components/ui/SortableHeader'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeTone(
  status: MgdReturn['status']
): 'success' | 'warning' | 'info' {
  switch (status) {
    case 'open': return 'info'
    case 'submitted': return 'warning'
    case 'paid': return 'success'
  }
}

function periodLabel(periodStart: string, periodEnd: string): string {
  const fmt = (d: string): string => {
    const [y, m] = d.split('-')
    const months = [
      '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]
    return `${months[parseInt(m, 10)]} ${y}`
  }
  return `${fmt(periodStart)} — ${fmt(periodEnd)}`
}

function isLocked(ret: MgdReturn | null): boolean {
  return ret?.status === 'submitted' || ret?.status === 'paid'
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(value)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MgdClientProps {
  initialReturn: MgdReturn | null
  initialCollections: MgdCollection[]
  initialReturns: MgdReturn[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MgdClient({
  initialReturn,
  initialCollections,
  initialReturns,
}: MgdClientProps): React.ReactElement {
  const searchParams = useSearchParams()

  // State
  const [currentReturn, setCurrentReturn] = useState<MgdReturn | null>(initialReturn)
  const [collections, setCollections] = useState<MgdCollection[]>(initialCollections)
  const [allReturns, setAllReturns] = useState<MgdReturn[]>(initialReturns)
  const [selectedPeriod, setSelectedPeriod] = useState<{
    periodStart: string
    periodEnd: string
  } | null>(
    initialReturn
      ? { periodStart: initialReturn.period_start, periodEnd: initialReturn.period_end }
      : null
  )

  // Modal/dialog state
  const [showForm, setShowForm] = useState(false)
  const [editingCollection, setEditingCollection] = useState<MgdCollection | undefined>()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showReopenConfirm, setShowReopenConfirm] = useState(false)
  const [showPayDialog, setShowPayDialog] = useState(false)
  const [showHmrcFormat, setShowHmrcFormat] = useState(false)
  const [datePaid, setDatePaid] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Determine which return is currently being viewed
  const viewingReturn = selectedPeriod
    ? allReturns.find(
        (r) =>
          r.period_start === selectedPeriod.periodStart &&
          r.period_end === selectedPeriod.periodEnd
      ) ?? currentReturn
    : currentReturn

  const locked = isLocked(viewingReturn)

  // Sorting -- Collections table
  type CollectionSortKey = 'date' | 'netTake' | 'mgdAmount' | 'vatOnSupplier'

  const collectionComparators = useMemo(
    () => ({
      date: (a: MgdCollection, b: MgdCollection) => a.collection_date.localeCompare(b.collection_date),
      netTake: (a: MgdCollection, b: MgdCollection) => a.net_take - b.net_take,
      mgdAmount: (a: MgdCollection, b: MgdCollection) => a.mgd_amount - b.mgd_amount,
      vatOnSupplier: (a: MgdCollection, b: MgdCollection) => a.vat_on_supplier - b.vat_on_supplier,
    }),
    []
  )

  const {
    sortedData: sortedCollections,
    sort: collectionSort,
    toggleSort: toggleCollectionSort,
  } = useSort<MgdCollection, CollectionSortKey>(collections, 'date', 'desc', collectionComparators)

  // Sorting -- Return History table
  type ReturnSortKey = 'period' | 'netTake' | 'mgd' | 'status' | 'datePaid'

  const returnComparators = useMemo(
    () => ({
      period: (a: MgdReturn, b: MgdReturn) => a.period_start.localeCompare(b.period_start),
      netTake: (a: MgdReturn, b: MgdReturn) => (a.total_net_take ?? 0) - (b.total_net_take ?? 0),
      mgd: (a: MgdReturn, b: MgdReturn) => (a.total_mgd ?? 0) - (b.total_mgd ?? 0),
      status: (a: MgdReturn, b: MgdReturn) => a.status.localeCompare(b.status),
      datePaid: (a: MgdReturn, b: MgdReturn) => (a.date_paid ?? '').localeCompare(b.date_paid ?? ''),
    }),
    []
  )

  const {
    sortedData: sortedReturns,
    sort: returnSort,
    toggleSort: toggleReturnSort,
  } = useSort<MgdReturn, ReturnSortKey>(allReturns, 'period', 'desc', returnComparators)

  // Data refresh
  const refreshData = useCallback(async (): Promise<void> => {
    const [retResult, returnsResult] = await Promise.all([
      getCurrentReturn(),
      getReturns(),
    ])
    if ('error' in retResult || 'error' in returnsResult) return
    setCurrentReturn(retResult.data ?? null)
    setAllReturns(returnsResult.data ?? [])

    const period = selectedPeriod ?? (retResult.data ? {
      periodStart: retResult.data.period_start,
      periodEnd: retResult.data.period_end,
    } : null)

    if (period) {
      const colResult = await getCollections(period.periodStart, period.periodEnd)
      if (!('error' in colResult)) setCollections(colResult.data ?? [])
    }
  }, [selectedPeriod])

  // Period switching
  async function switchPeriod(periodStart: string, periodEnd: string): Promise<void> {
    setSelectedPeriod({ periodStart, periodEnd })
    const result = await getCollections(periodStart, periodEnd)
    if (!('error' in result)) setCollections(result.data ?? [])
  }

  useEffect(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (from && to) void switchPeriod(from, to)
  }, [])

  // Status transitions
  async function handleSubmitReturn(): Promise<void> {
    if (!viewingReturn) return
    setSubmitting(true)
    try {
      const result = await updateReturnStatus({ id: viewingReturn.id, status: 'submitted' })
      if ('error' in result) { toast.error(result.error); return }
      toast.success('Return marked as submitted')
      await refreshData()
    } finally { setSubmitting(false) }
  }

  async function handleMarkPaid(): Promise<void> {
    if (!viewingReturn || !datePaid) return
    setSubmitting(true)
    try {
      const result = await updateReturnStatus({ id: viewingReturn.id, status: 'paid', date_paid: datePaid })
      if ('error' in result) { toast.error(result.error); return }
      toast.success('Return marked as paid')
      setShowPayDialog(false)
      setDatePaid('')
      await refreshData()
    } finally { setSubmitting(false) }
  }

  async function handleReopen(): Promise<void> {
    if (!viewingReturn) return
    setSubmitting(true)
    try {
      const result = await updateReturnStatus({
        id: viewingReturn.id,
        status: 'open',
        confirm_reopen_from_paid: viewingReturn.status === 'paid',
      })
      if ('error' in result) { toast.error(result.error); return }
      toast.success('Return reopened')
      setShowReopenConfirm(false)
      await refreshData()
    } finally { setSubmitting(false) }
  }

  async function handleDelete(): Promise<void> {
    if (!deletingId) return
    setSubmitting(true)
    try {
      const result = await deleteCollection(deletingId)
      if ('error' in result) { toast.error(result.error); return }
      toast.success('Collection deleted')
      setShowDeleteConfirm(false)
      setDeletingId(null)
      await refreshData()
    } finally { setSubmitting(false) }
  }

  // Render
  return (
    <div className="space-y-6">
      {/* Info alert */}
      <Alert tone="info" title="How it works">
        MGD is charged on <strong>net takings</strong> (cash in minus prizes paid out) per dutiable machine.
        Two rates apply: <strong>5%</strong> for low-stake/prize Cat D machines, <strong>20%</strong> for Cat C and
        standard machines. Returns are filed quarterly on form MGD7.
      </Alert>

      {/* Current Return Period */}
      <Card>
        <CardBody>
          {viewingReturn ? (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-text-strong">
                    {periodLabel(viewingReturn.period_start, viewingReturn.period_end)}
                  </h2>
                  <Badge tone={statusBadgeTone(viewingReturn.status)} className="mt-1">
                    {viewingReturn.status.charAt(0).toUpperCase() + viewingReturn.status.slice(1)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setShowHmrcFormat(true)}>
                    HMRC Format
                  </Button>
                  {viewingReturn.status === 'open' && (
                    <Button variant="primary" size="sm" onClick={handleSubmitReturn} loading={submitting}>
                      Mark as Submitted
                    </Button>
                  )}
                  {viewingReturn.status === 'submitted' && (
                    <>
                      <Button variant="primary" size="sm" onClick={() => setShowPayDialog(true)}>
                        Mark as Paid
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowReopenConfirm(true)}>
                        Reopen
                      </Button>
                    </>
                  )}
                  {viewingReturn.status === 'paid' && (
                    <Button variant="ghost" size="sm" onClick={() => setShowReopenConfirm(true)}>
                      Reopen
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat label="Net Takings" value={formatCurrency(viewingReturn.total_net_take ?? 0)} />
                <Stat label="MGD Due (20%)" value={formatCurrency(viewingReturn.total_mgd ?? 0)} />
                <Stat label="VAT on Supplier" value={formatCurrency(viewingReturn.total_vat_on_supplier ?? 0)} />
              </div>
            </>
          ) : (
            <Empty
              title="No return period yet"
              description="Record your first collection to create a return for the current quarter."
            />
          )}
        </CardBody>
      </Card>

      {/* Collections List */}
      <Card>
        <CardHeader
          title="Collections"
          action={
            locked ? (
              <Tooltip content={`Return is ${viewingReturn?.status}. Reopen to add collections.`}>
                <Button variant="primary" size="sm" disabled>
                  Record Collection
                </Button>
              </Tooltip>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => { setEditingCollection(undefined); setShowForm(true) }}
              >
                Record Collection
              </Button>
            )
          }
        />
        {collections.length === 0 ? (
          <CardBody>
            <Empty
              title="No collections"
              description="No machine game collections recorded for this period."
            />
          </CardBody>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader label="Date" column="date" currentColumn={collectionSort.column} currentDirection={collectionSort.direction} onSort={toggleCollectionSort} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted" />
                <SortableHeader label="Net Take" column="netTake" currentColumn={collectionSort.column} currentDirection={collectionSort.direction} onSort={toggleCollectionSort} className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted" />
                <SortableHeader label="MGD (20%)" column="mgdAmount" currentColumn={collectionSort.column} currentDirection={collectionSort.direction} onSort={toggleCollectionSort} className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted" />
                <SortableHeader label="VAT on Supplier" column="vatOnSupplier" currentColumn={collectionSort.column} currentDirection={collectionSort.direction} onSort={toggleCollectionSort} className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted" />
                <TableHead align="right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCollections.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-text">
                    {formatDateInLondon(c.collection_date, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">{formatCurrency(c.net_take)}</TableCell>
                  <TableCell align="right" className="tabular-nums text-text-muted">{formatCurrency(c.mgd_amount)}</TableCell>
                  <TableCell align="right" className="tabular-nums">{formatCurrency(c.vat_on_supplier)}</TableCell>
                  <TableCell align="right">
                    {locked ? (
                      <span className="text-xs text-text-muted">Locked</span>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => { setEditingCollection(c); setShowForm(true) }}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setDeletingId(c.id); setShowDeleteConfirm(true) }}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Return History */}
      <Card>
        <CardHeader title="Return History" />
        {allReturns.length === 0 ? (
          <CardBody>
            <Empty
              title="No returns"
              description="Returns are created automatically when you record collections."
            />
          </CardBody>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader label="Period" column="period" currentColumn={returnSort.column} currentDirection={returnSort.direction} onSort={toggleReturnSort} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted" />
                <SortableHeader label="Net Take" column="netTake" currentColumn={returnSort.column} currentDirection={returnSort.direction} onSort={toggleReturnSort} className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted" />
                <SortableHeader label="MGD" column="mgd" currentColumn={returnSort.column} currentDirection={returnSort.direction} onSort={toggleReturnSort} className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted" />
                <SortableHeader label="Status" column="status" currentColumn={returnSort.column} currentDirection={returnSort.direction} onSort={toggleReturnSort} className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-text-muted" />
                <SortableHeader label="Date Paid" column="datePaid" currentColumn={returnSort.column} currentDirection={returnSort.direction} onSort={toggleReturnSort} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedReturns.map((r) => {
                const isSelected =
                  selectedPeriod?.periodStart === r.period_start &&
                  selectedPeriod?.periodEnd === r.period_end
                return (
                  <TableRow
                    key={r.id}
                    onClick={() => switchPeriod(r.period_start, r.period_end)}
                    className={`cursor-pointer ${isSelected ? 'bg-primary-soft' : ''}`}
                  >
                    <TableCell className="font-medium">{periodLabel(r.period_start, r.period_end)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatCurrency(r.total_net_take ?? 0)}</TableCell>
                    <TableCell align="right" className="tabular-nums">{formatCurrency(r.total_mgd ?? 0)}</TableCell>
                    <TableCell align="center">
                      <Badge tone={statusBadgeTone(r.status)}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {r.date_paid
                        ? formatDateInLondon(r.date_paid, { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Collection form modal */}
      <Modal
        open={showForm}
        onClose={() => { setShowForm(false); setEditingCollection(undefined) }}
        title={editingCollection ? 'Edit Collection' : 'Record Collection'}
      >
        <CollectionForm
          collection={editingCollection}
          disabled={locked}
          onSuccess={() => { setShowForm(false); setEditingCollection(undefined); refreshData() }}
          onCancel={() => { setShowForm(false); setEditingCollection(undefined) }}
        />
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Collection"
        message="Are you sure? The return totals will be recalculated."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onClose={() => { setShowDeleteConfirm(false); setDeletingId(null) }}
      />

      {/* Reopen confirmation */}
      <ConfirmDialog
        open={showReopenConfirm}
        title="Reopen Return"
        message={
          viewingReturn?.status === 'paid'
            ? 'This return has been marked as paid. Reopening will clear the payment date. Are you sure?'
            : 'This will reopen the return for editing. Are you sure?'
        }
        confirmLabel="Reopen"
        onConfirm={handleReopen}
        onClose={() => setShowReopenConfirm(false)}
      />

      {/* Mark as Paid dialog */}
      <Modal
        open={showPayDialog}
        onClose={() => { setShowPayDialog(false); setDatePaid('') }}
        title="Mark Return as Paid"
      >
        <div className="space-y-4">
          <Field label="Date Paid">
            <Input type="date" value={datePaid} onChange={(e) => setDatePaid(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setShowPayDialog(false); setDatePaid('') }}>Cancel</Button>
            <Button variant="primary" onClick={handleMarkPaid} loading={submitting} disabled={!datePaid || submitting}>
              Confirm Payment
            </Button>
          </div>
        </div>
      </Modal>

      {/* HMRC Format Modal */}
      <Modal
        open={showHmrcFormat}
        onClose={() => setShowHmrcFormat(false)}
        title="HMRC Submission Format"
      >
        {viewingReturn && <HmrcFormatContent viewingReturn={viewingReturn} />}
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HMRC format sub-component
// ---------------------------------------------------------------------------

function HmrcFormatContent({ viewingReturn }: { viewingReturn: MgdReturn }) {
  const netTake = Math.round(viewingReturn.total_net_take ?? 0)
  const mgd = Math.round(viewingReturn.total_mgd ?? 0)
  const fmtWhole = (v: number): string => `£${v.toFixed(2)}`
  const lines = [
    { box: 1, label: 'Number of machines available for play at the end of the period', value: '1' },
    { box: 2, label: 'Total net takings liable to higher rate of duty', value: fmtWhole(0) },
    { box: 3, label: 'MGD due at higher rate', value: fmtWhole(0) },
    { box: 4, label: 'Total net takings liable to standard rate of duty', value: fmtWhole(netTake) },
    { box: 5, label: 'MGD due at standard rate', value: fmtWhole(mgd) },
    { box: 6, label: 'Total net takings liable to lower rate of duty', value: fmtWhole(0) },
    { box: 7, label: 'MGD due at lower rate', value: fmtWhole(0) },
    { box: 8, label: 'Duty payable before any adjustments', value: fmtWhole(mgd) },
    { box: 9, label: 'Under declared duty from previous MGD periods', value: fmtWhole(0) },
    { box: 10, label: 'Amount of duty brought forward', value: fmtWhole(0) },
    { box: 11, label: 'Negative amount of duty to carry forward to next return', value: fmtWhole(0) },
    { box: 12, label: 'Net duty payable on this return', value: fmtWhole(mgd) },
  ]

  return (
    <div className="space-y-2">
      <p className="text-sm text-text-muted mb-4">
        {periodLabel(viewingReturn.period_start, viewingReturn.period_end)}
      </p>
      {lines.map((line) => (
        <div key={line.box} className="flex items-baseline gap-2 py-1 border-b border-border last:border-0">
          <span className="text-sm font-medium text-text-muted whitespace-nowrap">Box {line.box}</span>
          <span className="text-sm text-text-subtle">-</span>
          <span className="text-sm text-text flex-1">{line.label}:</span>
          <span className="text-sm font-semibold text-text-strong font-mono">{line.value}</span>
        </div>
      ))}
    </div>
  )
}
