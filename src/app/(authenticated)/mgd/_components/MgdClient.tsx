'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Card,
  CardHeader,
  CardBody,
  PageLayout,
  Section,
  StatGrid,
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
  Icon,
  RowActions,
} from '@/ds'
import { toast } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import { buildMgdHmrcLines } from '@/lib/mgd/hmrcFormat'
import { CollectionForm, type CollectionFormStatus } from './CollectionForm'
import {
  getCollections,
  getReturns,
  getCurrentReturn,
  deleteCollection,
  updateReturnStatus,
  updateReturnMachineCount,
} from '@/app/actions/mgd'
import type { MgdCollection, MgdReturn } from '@/app/actions/mgd'
import { useSort } from '@/hooks/useSort'
import { MGD_COLLECTIONS_LAYOUT } from '../_shared/nav'
import { MGD_RETURN_STATUS_TONE, mgdReturnStatusLabel } from '../_shared/status-ui'

/** The Modal footer's submit button names the collection form by this id. */
const COLLECTION_FORM_ID = 'mgd-collection-form'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodLabel(periodStart: string, periodEnd: string): string {
  const fmt = (d: string): string => {
    const [y, m] = d.split('-')
    const months = [
      '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]
    return `${months[parseInt(m, 10)]} ${y}`
  }
  return `${fmt(periodStart)} to ${fmt(periodEnd)}`
}

function isLocked(ret: MgdReturn | null): boolean {
  return ret?.status === 'submitted' || ret?.status === 'paid'
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(value)

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value)
  return `"${raw.replace(/"/g, '""')}"`
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number | null | undefined>>): void {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MgdClientProps {
  initialReturn: MgdReturn | null
  initialCollections: MgdCollection[]
  /** Why the current period's collections could not be loaded, if they could not. */
  initialCollectionsError?: string | null
  initialReturns: MgdReturn[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MgdClient({
  initialReturn,
  initialCollections,
  initialCollectionsError = null,
  initialReturns,
}: MgdClientProps): React.ReactElement {
  const searchParams = useSearchParams()

  // State
  const [currentReturn, setCurrentReturn] = useState<MgdReturn | null>(initialReturn)
  const [collections, setCollections] = useState<MgdCollection[]>(initialCollections)
  const [collectionsError, setCollectionsError] = useState<string | null>(initialCollectionsError)
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
  // The collection form saves itself; the Modal footer's submit button follows its state.
  const [collectionFormStatus, setCollectionFormStatus] = useState<CollectionFormStatus>({ saving: false, canSubmit: false })
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showReopenConfirm, setShowReopenConfirm] = useState(false)
  const [showPayDialog, setShowPayDialog] = useState(false)
  const [showHmrcFormat, setShowHmrcFormat] = useState(false)
  const [datePaid, setDatePaid] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [collectionSearch, setCollectionSearch] = useState('')
  const [returnSearch, setReturnSearch] = useState('')

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

  const visibleCollections = useMemo(() => {
    const term = collectionSearch.trim().toLowerCase()
    if (!term) return sortedCollections
    return sortedCollections.filter((collection) =>
      [
        collection.collection_date,
        collection.notes ?? '',
        String(collection.net_take),
        String(collection.mgd_amount),
        String(collection.vat_on_supplier),
      ].some((value) => value.toLowerCase().includes(term))
    )
  }, [collectionSearch, sortedCollections])

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

  const visibleReturns = useMemo(() => {
    const term = returnSearch.trim().toLowerCase()
    if (!term) return sortedReturns
    return sortedReturns.filter((ret) =>
      [
        periodLabel(ret.period_start, ret.period_end),
        ret.status,
        ret.date_paid ?? '',
        String(ret.total_net_take ?? 0),
        String(ret.total_mgd ?? 0),
      ].some((value) => value.toLowerCase().includes(term))
    )
  }, [returnSearch, sortedReturns])

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
      applyCollectionsResult(colResult)
    }
  }, [selectedPeriod])

  // A failed read is shown as a failure, never as a period with no collections.
  function applyCollectionsResult(result: Awaited<ReturnType<typeof getCollections>>): void {
    if ('error' in result) {
      setCollectionsError(result.error)
      return
    }
    setCollections(result.data ?? [])
    setCollectionsError(null)
  }

  // Period switching
  async function switchPeriod(periodStart: string, periodEnd: string): Promise<void> {
    setSelectedPeriod({ periodStart, periodEnd })
    const result = await getCollections(periodStart, periodEnd)
    applyCollectionsResult(result)
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

  function exportCollections(): void {
    downloadCsv(
      `mgd-collections-${viewingReturn?.period_start ?? 'all'}-${viewingReturn?.period_end ?? 'all'}.csv`,
      visibleCollections.map((collection) => ({
        Date: collection.collection_date,
        'Net Take': collection.net_take,
        'MGD Amount': collection.mgd_amount,
        'VAT on Supplier': collection.vat_on_supplier,
        Notes: collection.notes ?? '',
      }))
    )
  }

  function exportReturns(): void {
    downloadCsv(
      'mgd-return-history.csv',
      visibleReturns.map((ret) => ({
        Period: periodLabel(ret.period_start, ret.period_end),
        'Period Start': ret.period_start,
        'Period End': ret.period_end,
        'Net Take': ret.total_net_take ?? 0,
        'MGD Due': ret.total_mgd ?? 0,
        'VAT on Supplier': ret.total_vat_on_supplier ?? 0,
        Status: ret.status,
        'Date Paid': ret.date_paid ?? '',
        Collections: ret.collection_count ?? 0,
      }))
    )
  }

  const recordCollectionButton = locked ? (
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

  // Render
  return (
    <PageLayout {...MGD_COLLECTIONS_LAYOUT} headerActions={recordCollectionButton}>
      {/* Info alert */}
      <Alert tone="info" title="How it works">
        MGD is charged on <strong>net takings</strong> (cash in minus prizes paid out) per dutiable machine.
        Two rates apply: <strong>5%</strong> for low-stake/prize Cat D machines, <strong>20%</strong> for Cat C and
        standard machines. Returns are filed quarterly on form MGD7.
      </Alert>

      {/* Current Return Period */}
      {viewingReturn ? (
        <Section
          title={periodLabel(viewingReturn.period_start, viewingReturn.period_end)}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge tone={MGD_RETURN_STATUS_TONE[viewingReturn.status]}>
                {mgdReturnStatusLabel(viewingReturn.status)}
              </Badge>
              <Button variant="secondary" size="sm" onClick={() => setShowHmrcFormat(true)}>
                HMRC Format
              </Button>
              {viewingReturn.status !== 'open' && (
                <Button variant="secondary" size="sm" onClick={() => setShowReopenConfirm(true)}>
                  Reopen
                </Button>
              )}
              {viewingReturn.status === 'open' && (
                <Button variant="primary" size="sm" onClick={handleSubmitReturn} loading={submitting}>
                  Mark as Submitted
                </Button>
              )}
              {viewingReturn.status === 'submitted' && (
                <Button variant="primary" size="sm" onClick={() => setShowPayDialog(true)}>
                  Mark as Paid
                </Button>
              )}
            </div>
          }
        >
          <div className="space-y-4">
            <StatGrid columns={3}>
              <Stat label="Net Takings" value={formatCurrency(viewingReturn.total_net_take ?? 0)} />
              <Stat label="MGD Due (20%)" value={formatCurrency(viewingReturn.total_mgd ?? 0)} />
              <Stat label="VAT on Supplier" value={formatCurrency(viewingReturn.total_vat_on_supplier ?? 0)} />
            </StatGrid>
            <StatGrid columns={2}>
              <Stat label="Collections in Period" value={String(viewingReturn.collection_count ?? collections.length)} />
              <MachineCountField viewingReturn={viewingReturn} locked={locked} onSaved={refreshData} />
            </StatGrid>
          </div>
        </Section>
      ) : (
        <Card>
          <Empty
            size="sm"
            title="No return period yet"
            description="Record your first collection to create a return for the current quarter."
          />
        </Card>
      )}

      {/* Collections List */}
      <Card>
        <CardHeader
          title="Collections"
          action={
            <Button variant="secondary" size="sm" onClick={exportCollections} disabled={visibleCollections.length === 0 || Boolean(collectionsError)}>
              Export CSV
            </Button>
          }
        />
        <CardBody>
          <Input
            value={collectionSearch}
            onChange={(event) => setCollectionSearch(event.target.value)}
            placeholder="Search collections..."
            aria-label="Search collections"
            className="sm:max-w-xs"
          />
        </CardBody>
        {collectionsError ? (
          <CardBody>
            <Alert tone="danger" title="Couldn't load collections">{collectionsError}</Alert>
          </CardBody>
        ) : visibleCollections.length === 0 ? (
          <Empty
            size="sm"
            title={collectionSearch ? 'No collections match this search' : 'No collections for this period'}
            description={
              collectionSearch
                ? 'Change or clear the search to see more collections.'
                : 'No machine game collections were recorded in this period.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  sortable
                  sortDirection={collectionSort.column === 'date' ? collectionSort.direction : null}
                  onSort={() => toggleCollectionSort('date')}
                >
                  Date
                </TableHead>
                <TableHead
                  align="right"
                  sortable
                  sortDirection={collectionSort.column === 'netTake' ? collectionSort.direction : null}
                  onSort={() => toggleCollectionSort('netTake')}
                >
                  Net Take
                </TableHead>
                <TableHead
                  align="right"
                  sortable
                  sortDirection={collectionSort.column === 'mgdAmount' ? collectionSort.direction : null}
                  onSort={() => toggleCollectionSort('mgdAmount')}
                >
                  MGD (20%)
                </TableHead>
                <TableHead
                  align="right"
                  sortable
                  sortDirection={collectionSort.column === 'vatOnSupplier' ? collectionSort.direction : null}
                  onSort={() => toggleCollectionSort('vatOnSupplier')}
                >
                  VAT on Supplier
                </TableHead>
                <TableHead align="right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCollections.map((c) => (
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
                      <RowActions
                        className="justify-end"
                        actions={[
                          {
                            key: 'edit',
                            label: 'Edit',
                            icon: <Icon name="edit" size={16} />,
                            onSelect: () => { setEditingCollection(c); setShowForm(true) },
                          },
                          {
                            key: 'delete',
                            label: 'Delete',
                            icon: <Icon name="trash" size={16} />,
                            tone: 'danger',
                            onSelect: () => { setDeletingId(c.id); setShowDeleteConfirm(true) },
                          },
                        ]}
                      />
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
        <CardHeader
          title="Return History"
          action={
            <Button variant="secondary" size="sm" onClick={exportReturns} disabled={visibleReturns.length === 0}>
              Export CSV
            </Button>
          }
        />
        <CardBody>
          <Input
            value={returnSearch}
            onChange={(event) => setReturnSearch(event.target.value)}
            placeholder="Search returns..."
            aria-label="Search returns"
            className="sm:max-w-xs"
          />
        </CardBody>
        {visibleReturns.length === 0 ? (
          <Empty
            size="sm"
            title={returnSearch ? 'No returns match this search' : 'No returns yet'}
            description={
              returnSearch
                ? 'Change or clear the search to see more returns.'
                : 'Returns are created automatically when you record collections.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  sortable
                  sortDirection={returnSort.column === 'period' ? returnSort.direction : null}
                  onSort={() => toggleReturnSort('period')}
                >
                  Period
                </TableHead>
                <TableHead
                  align="right"
                  sortable
                  sortDirection={returnSort.column === 'netTake' ? returnSort.direction : null}
                  onSort={() => toggleReturnSort('netTake')}
                >
                  Net Take
                </TableHead>
                <TableHead
                  align="right"
                  sortable
                  sortDirection={returnSort.column === 'mgd' ? returnSort.direction : null}
                  onSort={() => toggleReturnSort('mgd')}
                >
                  MGD
                </TableHead>
                <TableHead
                  align="center"
                  sortable
                  sortDirection={returnSort.column === 'status' ? returnSort.direction : null}
                  onSort={() => toggleReturnSort('status')}
                >
                  Status
                </TableHead>
                <TableHead
                  sortable
                  sortDirection={returnSort.column === 'datePaid' ? returnSort.direction : null}
                  onSort={() => toggleReturnSort('datePaid')}
                >
                  Date Paid
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleReturns.map((r) => {
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
                      <Badge tone={MGD_RETURN_STATUS_TONE[r.status]}>
                        {mgdReturnStatusLabel(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {r.date_paid
                        ? formatDateInLondon(r.date_paid, { day: 'numeric', month: 'short', year: 'numeric' })
                        : '-'}
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
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowForm(false); setEditingCollection(undefined) }}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={COLLECTION_FORM_ID}
              variant="primary"
              loading={collectionFormStatus.saving}
              disabled={!collectionFormStatus.canSubmit}
            >
              {editingCollection ? 'Save Changes' : 'Record Collection'}
            </Button>
          </>
        }
      >
        <CollectionForm
          collection={editingCollection}
          disabled={locked}
          formId={COLLECTION_FORM_ID}
          onStatusChange={setCollectionFormStatus}
          onSuccess={() => { setShowForm(false); setEditingCollection(undefined); refreshData() }}
        />
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Collection"
        message="Delete this collection? The return totals will be recalculated."
        confirmLabel="Delete"
        tone="danger"
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
        tone="primary"
        onConfirm={handleReopen}
        onClose={() => setShowReopenConfirm(false)}
      />

      {/* Mark as Paid dialog */}
      <Modal
        open={showPayDialog}
        onClose={() => { setShowPayDialog(false); setDatePaid('') }}
        title="Mark as Paid"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowPayDialog(false); setDatePaid('') }}>Cancel</Button>
            <Button variant="primary" onClick={handleMarkPaid} loading={submitting} disabled={!datePaid || submitting}>
              Confirm Payment
            </Button>
          </>
        }
      >
        <Field label="Date Paid">
          <Input type="date" value={datePaid} onChange={(e) => setDatePaid(e.target.value)} />
        </Field>
      </Modal>

      {/* HMRC Format Modal */}
      <Modal
        open={showHmrcFormat}
        onClose={() => setShowHmrcFormat(false)}
        title="HMRC Submission Format"
        description={viewingReturn ? periodLabel(viewingReturn.period_start, viewingReturn.period_end) : undefined}
      >
        {viewingReturn && <HmrcFormatContent viewingReturn={viewingReturn} />}
      </Modal>
    </PageLayout>
  )
}

// ---------------------------------------------------------------------------
// Machine count editor (MGD7 Box 1)
// ---------------------------------------------------------------------------

function MachineCountField({
  viewingReturn,
  locked,
  onSaved,
}: {
  viewingReturn: MgdReturn
  locked: boolean
  onSaved: () => Promise<void>
}): React.ReactElement {
  const [value, setValue] = useState(String(viewingReturn.machine_count ?? 1))
  const [saving, setSaving] = useState(false)

  // Resync when switching periods or after a data refresh.
  useEffect(() => {
    setValue(String(viewingReturn.machine_count ?? 1))
  }, [viewingReturn.id, viewingReturn.machine_count])

  if (locked) {
    return <Stat label="Machines (at period end)" value={String(viewingReturn.machine_count ?? 1)} />
  }

  const parsed = Number(value)
  const isValid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0
  const isDirty = String(viewingReturn.machine_count ?? 1) !== value.trim()

  async function handleSave(): Promise<void> {
    if (!isValid) {
      toast.error('Enter a whole number of machines (0 or more)')
      return
    }
    setSaving(true)
    try {
      const result = await updateReturnMachineCount({ id: viewingReturn.id, machine_count: parsed })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      toast.success('Machine count updated')
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-end gap-2">
      <Input
        label="Machines (at period end)"
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Number of machines available for play at the end of the period"
        className="max-w-[7rem]"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={handleSave}
        loading={saving}
        disabled={saving || !isValid || !isDirty}
      >
        Save
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HMRC format sub-component
// ---------------------------------------------------------------------------

function HmrcFormatContent({ viewingReturn }: { viewingReturn: MgdReturn }) {
  const lines = buildMgdHmrcLines(viewingReturn)

  return (
    <div className="space-y-2">
      {lines.map((line) => (
        <div key={line.box} className="flex items-baseline gap-2 py-1 border-b border-border last:border-0">
          <span className="text-sm font-medium text-text-muted whitespace-nowrap">Box {line.box}</span>
          <span className="text-sm text-text-soft" aria-hidden="true">-</span>
          <span className="text-sm text-text flex-1">{line.label}:</span>
          <span className="text-sm font-semibold text-text-strong font-mono">{line.value}</span>
        </div>
      ))}
    </div>
  )
}
