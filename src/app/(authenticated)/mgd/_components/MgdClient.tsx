'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Tooltip } from '@/components/ui-v2/overlay/Tooltip'
import { Input } from '@/components/ui-v2/forms/Input'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { formatCurrency } from '@/components/ui-v2/utils/format'
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
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline'
import { useSort } from '@/hooks/useSort'
import { SortableHeader } from '@/components/ui/SortableHeader'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeVariant(
  status: MgdReturn['status']
): 'success' | 'warning' | 'info' {
  switch (status) {
    case 'open':
      return 'info'
    case 'submitted':
      return 'warning'
    case 'paid':
      return 'success'
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
  return `${fmt(periodStart)} \u2014 ${fmt(periodEnd)}`
}

function isLocked(ret: MgdReturn | null): boolean {
  return ret?.status === 'submitted' || ret?.status === 'paid'
}

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

  // ---------------------------------------------------------------------------
  // Sorting — Collections table
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Sorting — Return History table
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Data refresh
  // ---------------------------------------------------------------------------

  const refreshData = useCallback(async (): Promise<void> => {
    const [retResult, returnsResult] = await Promise.all([
      getCurrentReturn(),
      getReturns(),
    ])

    if ('error' in retResult || 'error' in returnsResult) return

    setCurrentReturn(retResult.data ?? null)
    setAllReturns(returnsResult.data ?? [])

    // Refresh collections for the selected period
    const period = selectedPeriod ?? (retResult.data ? {
      periodStart: retResult.data.period_start,
      periodEnd: retResult.data.period_end,
    } : null)

    if (period) {
      const colResult = await getCollections(period.periodStart, period.periodEnd)
      if (!('error' in colResult)) {
        setCollections(colResult.data ?? [])
      }
    }
  }, [selectedPeriod])

  // ---------------------------------------------------------------------------
  // Period switching
  // ---------------------------------------------------------------------------

  async function switchPeriod(
    periodStart: string,
    periodEnd: string
  ): Promise<void> {
    setSelectedPeriod({ periodStart, periodEnd })
    const result = await getCollections(periodStart, periodEnd)
    if (!('error' in result)) {
      setCollections(result.data ?? [])
    }
  }

  // Apply URL search params as initial period on mount
  useEffect(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (from && to) {
      void switchPeriod(from, to)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  async function handleSubmitReturn(): Promise<void> {
    if (!viewingReturn) return
    setSubmitting(true)
    try {
      const result = await updateReturnStatus({
        id: viewingReturn.id,
        status: 'submitted',
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Return marked as submitted')
      await refreshData()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMarkPaid(): Promise<void> {
    if (!viewingReturn || !datePaid) return
    setSubmitting(true)
    try {
      const result = await updateReturnStatus({
        id: viewingReturn.id,
        status: 'paid',
        date_paid: datePaid,
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Return marked as paid')
      setShowPayDialog(false)
      setDatePaid('')
      await refreshData()
    } finally {
      setSubmitting(false)
    }
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
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Return reopened')
      setShowReopenConfirm(false)
      await refreshData()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deletingId) return
    setSubmitting(true)
    try {
      const result = await deleteCollection(deletingId)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Collection deleted')
      setShowDeleteConfirm(false)
      setDeletingId(null)
      await refreshData()
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Section 1: Current Return Period */}
      <Card padding="lg">
        {viewingReturn ? (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {periodLabel(viewingReturn.period_start, viewingReturn.period_end)}
                </h2>
                <Badge variant={statusBadgeVariant(viewingReturn.status)} className="mt-1">
                  {viewingReturn.status.charAt(0).toUpperCase() + viewingReturn.status.slice(1)}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowHmrcFormat(true)}
                >
                  HMRC Format
                </Button>
                {viewingReturn.status === 'open' && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSubmitReturn}
                    loading={submitting}
                  >
                    Mark as Submitted
                  </Button>
                )}
                {viewingReturn.status === 'submitted' && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setShowPayDialog(true)}
                    >
                      Mark as Paid
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowReopenConfirm(true)}
                    >
                      Reopen
                    </Button>
                  </>
                )}
                {viewingReturn.status === 'paid' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowReopenConfirm(true)}
                  >
                    Reopen
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-sm text-gray-500">Net Takings</p>
                <p className="text-xl font-semibold text-gray-900">
                  {formatCurrency(viewingReturn.total_net_take ?? 0)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-sm text-gray-500">MGD Due (20%)</p>
                <p className="text-xl font-semibold text-gray-900">
                  {formatCurrency(viewingReturn.total_mgd ?? 0)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-sm text-gray-500">VAT on Supplier</p>
                <p className="text-xl font-semibold text-gray-900">
                  {formatCurrency(viewingReturn.total_vat_on_supplier ?? 0)}
                </p>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No return period yet"
            description="Record your first collection to create a return for the current quarter."
          />
        )}
      </Card>

      {/* Section 2: Collections List */}
      <Card padding="lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Collections</h2>
          {locked ? (
            <Tooltip content={`Return is ${viewingReturn?.status}. Reopen to add collections.`}>
              <Button variant="primary" size="sm" disabled leftIcon={<LockClosedIcon className="h-4 w-4" />}>
                Record Collection
              </Button>
            </Tooltip>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setEditingCollection(undefined)
                setShowForm(true)
              }}
            >
              Record Collection
            </Button>
          )}
        </div>

        {collections.length === 0 ? (
          <EmptyState
            title="No collections"
            description="No machine game collections recorded for this period."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <SortableHeader
                    label="Date"
                    column="date"
                    currentColumn={collectionSort.column}
                    currentDirection={collectionSort.direction}
                    onSort={toggleCollectionSort}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                  <SortableHeader
                    label="Net Take"
                    column="netTake"
                    currentColumn={collectionSort.column}
                    currentDirection={collectionSort.direction}
                    onSort={toggleCollectionSort}
                    className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                  <SortableHeader
                    label="MGD (20%)"
                    column="mgdAmount"
                    currentColumn={collectionSort.column}
                    currentDirection={collectionSort.direction}
                    onSort={toggleCollectionSort}
                    className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                  <SortableHeader
                    label="VAT on Supplier"
                    column="vatOnSupplier"
                    currentColumn={collectionSort.column}
                    currentDirection={collectionSort.direction}
                    onSort={toggleCollectionSort}
                    className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedCollections.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                      {formatDateInLondon(c.collection_date, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                      {formatCurrency(c.net_take)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-600">
                      {formatCurrency(c.mgd_amount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                      {formatCurrency(c.vat_on_supplier)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {locked ? (
                        <Tooltip content={`Return is ${viewingReturn?.status}`}>
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            <LockClosedIcon className="h-3.5 w-3.5" />
                            Locked
                          </span>
                        </Tooltip>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            iconOnly
                            aria-label="Edit collection"
                            onClick={() => {
                              setEditingCollection(c)
                              setShowForm(true)
                            }}
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            iconOnly
                            aria-label="Delete collection"
                            onClick={() => {
                              setDeletingId(c.id)
                              setShowDeleteConfirm(true)
                            }}
                          >
                            <TrashIcon className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Section 3: Return History */}
      <Card padding="lg">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Return History</h2>

        {allReturns.length === 0 ? (
          <EmptyState
            title="No returns"
            description="Returns are created automatically when you record collections."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <SortableHeader
                    label="Period"
                    column="period"
                    currentColumn={returnSort.column}
                    currentDirection={returnSort.direction}
                    onSort={toggleReturnSort}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                  <SortableHeader
                    label="Net Take"
                    column="netTake"
                    currentColumn={returnSort.column}
                    currentDirection={returnSort.direction}
                    onSort={toggleReturnSort}
                    className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                  <SortableHeader
                    label="MGD"
                    column="mgd"
                    currentColumn={returnSort.column}
                    currentDirection={returnSort.direction}
                    onSort={toggleReturnSort}
                    className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                  <SortableHeader
                    label="Status"
                    column="status"
                    currentColumn={returnSort.column}
                    currentDirection={returnSort.direction}
                    onSort={toggleReturnSort}
                    className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                  <SortableHeader
                    label="Date Paid"
                    column="datePaid"
                    currentColumn={returnSort.column}
                    currentDirection={returnSort.direction}
                    onSort={toggleReturnSort}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedReturns.map((r) => {
                  const isSelected =
                    selectedPeriod?.periodStart === r.period_start &&
                    selectedPeriod?.periodEnd === r.period_end
                  return (
                    <tr
                      key={r.id}
                      className={`cursor-pointer hover:bg-gray-50 ${
                        isSelected ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => switchPeriod(r.period_start, r.period_end)}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                        {periodLabel(r.period_start, r.period_end)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                        {formatCurrency(r.total_net_take ?? 0)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-900">
                        {formatCurrency(r.total_mgd ?? 0)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <Badge variant={statusBadgeVariant(r.status)} size="sm">
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {r.date_paid
                          ? formatDateInLondon(r.date_paid, {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })
                          : '\u2014'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Collection form modal */}
      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false)
          setEditingCollection(undefined)
        }}
        title={editingCollection ? 'Edit Collection' : 'Record Collection'}
        size="md"
      >
        <CollectionForm
          collection={editingCollection}
          disabled={locked}
          onSuccess={() => {
            setShowForm(false)
            setEditingCollection(undefined)
            refreshData()
          }}
          onCancel={() => {
            setShowForm(false)
            setEditingCollection(undefined)
          }}
        />
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false)
          setDeletingId(null)
        }}
        onConfirm={handleDelete}
        title="Delete Collection"
        message="Are you sure you want to delete this collection? The return totals will be recalculated automatically."
        type="danger"
        confirmText="Delete"
      />

      {/* Reopen confirmation */}
      <ConfirmDialog
        open={showReopenConfirm}
        onClose={() => setShowReopenConfirm(false)}
        onConfirm={handleReopen}
        title="Reopen Return"
        message={
          viewingReturn?.status === 'paid'
            ? 'This return has been marked as paid. Reopening will clear the payment date and allow edits. Are you sure?'
            : 'This will reopen the return for editing. Are you sure?'
        }
        type={viewingReturn?.status === 'paid' ? 'danger' : 'warning'}
        confirmText="Reopen"
      />

      {/* Mark as Paid dialog */}
      <Modal
        open={showPayDialog}
        onClose={() => {
          setShowPayDialog(false)
          setDatePaid('')
        }}
        title="Mark Return as Paid"
        size="sm"
      >
        <div className="space-y-4">
          <FormGroup label="Date Paid" required>
            <Input
              type="date"
              value={datePaid}
              onChange={(e) => setDatePaid(e.target.value)}
              required
            />
          </FormGroup>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowPayDialog(false)
                setDatePaid('')
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleMarkPaid}
              loading={submitting}
              disabled={!datePaid || submitting}
            >
              Confirm Payment
            </Button>
          </div>
        </div>
      </Modal>

      {/* HMRC Submission Format Modal */}
      <Modal
        open={showHmrcFormat}
        onClose={() => setShowHmrcFormat(false)}
        title="HMRC Submission Format"
      >
        {viewingReturn && (() => {
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
              <p className="text-sm text-gray-500 mb-4">
                {periodLabel(viewingReturn.period_start, viewingReturn.period_end)}
              </p>
              {lines.map((line) => (
                <div key={line.box} className="flex items-baseline gap-2 py-1 border-b border-gray-100 last:border-0">
                  <span className="text-sm font-medium text-gray-500 whitespace-nowrap">Box {line.box}</span>
                  <span className="text-sm text-gray-400">—</span>
                  <span className="text-sm text-gray-700 flex-1">{line.label}:</span>
                  <span className="text-sm font-semibold text-gray-900 font-mono">{line.value}</span>
                </div>
              ))}
              <div className="mt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const text = lines.map(l => `Box ${l.box} - ${l.label}:${l.value}`).join('\n')
                    navigator.clipboard.writeText(text)
                    toast.success('Copied to clipboard')
                  }}
                >
                  Copy to Clipboard
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
