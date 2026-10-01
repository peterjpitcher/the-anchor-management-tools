'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Empty,
  Icon,
  Input,
  LinkButton,
  Modal,
  RowActions,
  SearchInput,
  Select,
  toast,
  type Column,
} from '@/ds'
import {
  mergeReceiptVendors,
  renameReceiptVendor,
  undoReceiptVendorOperation,
  updateReceiptVendorDetails,
} from '@/app/actions/receipt-vendors'
import { formatDateInLondon } from '@/lib/dateUtils'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import type { ReceiptExpenseCategory } from '@/types/database'
import type {
  ReceiptVendorDirectory,
  ReceiptVendorDirectoryItem,
  ReceiptVendorOperation,
} from '@/services/receipts/receiptVendors'
import { ReceiptsPageChrome } from '../../../_components/ReceiptsPageChrome'

type RowAction = Exclude<Parameters<typeof RowActions>[0]['actions'][number], false | null | undefined>

interface VendorDirectoryClientProps {
  directory: ReceiptVendorDirectory
  /** `receipts:manage`: confirm, deactivate, kind and default category. */
  canManage: boolean
  /** Super admin: merge, rename and undo. */
  canGovern: boolean
}

type StatusFilter = 'standing' | 'unconfirmed' | 'confirmed' | 'inactive' | 'merged' | 'all'

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'standing', label: 'In use' },
  { value: 'unconfirmed', label: 'Not yet confirmed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'inactive', label: 'Deactivated' },
  { value: 'merged', label: 'Merged into another' },
  { value: 'all', label: 'All vendors' },
]

const STATUS_LABEL: Record<ReceiptVendorDirectoryItem['status'], string> = {
  unconfirmed: 'Not confirmed',
  confirmed: 'Confirmed',
  inactive: 'Deactivated',
  merged: 'Merged',
}

const STATUS_TONE: Record<ReceiptVendorDirectoryItem['status'], 'neutral' | 'success' | 'warning' | 'info'> = {
  unconfirmed: 'warning',
  confirmed: 'success',
  inactive: 'neutral',
  merged: 'info',
}

const ORIGIN_LABEL: Record<ReceiptVendorDirectoryItem['origin'], string | null> = {
  unknown: null,
  manual: 'Added by a person',
  rule: 'Added by a rule',
  invoice: 'From invoicing',
  ai: 'Added by AI',
  payroll: 'From payroll',
}

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

/** Added by the AI and not yet confirmed by a person. */
function needsAiReview(vendor: Pick<ReceiptVendorDirectoryItem, 'status' | 'origin'>): boolean {
  return vendor.status === 'unconfirmed' && vendor.origin === 'ai'
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function formatDay(value: string | null): string {
  if (!value) return 'Never'
  return formatDateInLondon(value, { day: 'numeric', month: 'short', year: 'numeric' })
}

type Dialog =
  | { kind: 'merge'; from: ReceiptVendorDirectoryItem; intoId: string }
  | { kind: 'rename'; vendor: ReceiptVendorDirectoryItem; name: string }
  | { kind: 'details'; vendor: ReceiptVendorDirectoryItem; vendorKind: 'business' | 'person'; category: string }
  | { kind: 'deactivate'; vendor: ReceiptVendorDirectoryItem }
  | { kind: 'undo'; operation: ReceiptVendorOperation }

export function VendorDirectoryClient({ directory, canManage, canGovern }: VendorDirectoryClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('standing')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const vendorsById = useMemo(() => new Map(directory.vendors.map((vendor) => [vendor.id, vendor])), [directory.vendors])

  const standingVendors = useMemo(
    () => directory.vendors.filter((vendor) => vendor.status === 'unconfirmed' || vendor.status === 'confirmed'),
    [directory.vendors]
  )

  const visibleVendors = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matching = directory.vendors.filter((vendor) => {
      if (statusFilter === 'standing' && vendor.status !== 'unconfirmed' && vendor.status !== 'confirmed') return false
      if (statusFilter !== 'standing' && statusFilter !== 'all' && vendor.status !== statusFilter) return false
      if (!term) return true
      return (
        vendor.name.toLowerCase().includes(term) ||
        vendor.aliases.some((alias) => alias.toLowerCase().includes(term))
      )
    })
    // Vendors the AI added and nobody has confirmed come first: they are the ones to look at.
    // The sort is stable, so everything else keeps the order it arrived in.
    return matching.sort((left, right) => Number(needsAiReview(right)) - Number(needsAiReview(left)))
  }, [directory.vendors, search, statusFilter])

  const unconfirmedCount = standingVendors.filter((vendor) => vendor.status === 'unconfirmed').length
  const aiUnconfirmedCount = standingVendors.filter(needsAiReview).length

  function openDialog(next: Dialog) {
    setDialogError(null)
    setDialog(next)
  }

  function closeDialog() {
    if (isPending) return
    setDialog(null)
    setDialogError(null)
  }

  /** Runs one change, then reloads the list from the server. An error stays in the open dialog. */
  function run(action: () => Promise<{ success?: boolean; error?: string }>, onSuccess: () => string) {
    startTransition(async () => {
      let result: { success?: boolean; error?: string }
      try {
        result = await action()
      } catch (error) {
        console.error('Vendor change failed', error)
        result = { error: 'The change did not complete. Refresh the page to see what was saved.' }
      }
      if (!result?.success) {
        const message = result?.error ?? 'The change could not be made.'
        setDialogError(message)
        toast.error(message)
        return
      }
      toast.success(onSuccess())
      setDialog(null)
      setDialogError(null)
      router.refresh()
    })
  }

  function confirmVendor(vendor: ReceiptVendorDirectoryItem) {
    run(
      () => updateReceiptVendorDetails({ vendorId: vendor.id, status: 'confirmed' }),
      () => `${vendor.name} confirmed`
    )
  }

  function reactivateVendor(vendor: ReceiptVendorDirectoryItem) {
    run(
      () => updateReceiptVendorDetails({ vendorId: vendor.id, status: 'unconfirmed' }),
      () => `${vendor.name} is in use again`
    )
  }

  function rowActions(vendor: ReceiptVendorDirectoryItem): Array<RowAction | false> {
    const standing = vendor.status === 'unconfirmed' || vendor.status === 'confirmed'
    return [
      canManage && vendor.status === 'unconfirmed' && {
        key: 'confirm',
        label: 'Confirm',
        icon: <Icon name="check" size={16} />,
        onSelect: () => confirmVendor(vendor),
        disabled: isPending,
      },
      canManage && standing && {
        key: 'details',
        label: 'Kind and default category',
        icon: <Icon name="tag" size={16} />,
        onSelect: () =>
          openDialog({
            kind: 'details',
            vendor,
            vendorKind: vendor.kind,
            category: vendor.defaultExpenseCategory ?? '',
          }),
        disabled: isPending,
      },
      canGovern && standing && {
        key: 'rename',
        label: 'Rename',
        icon: <Icon name="edit" size={16} />,
        onSelect: () => openDialog({ kind: 'rename', vendor, name: vendor.name }),
        disabled: isPending,
      },
      canGovern && standing && {
        key: 'merge',
        label: 'Merge into another vendor',
        icon: <Icon name="arrowLeftRight" size={16} />,
        onSelect: () => openDialog({ kind: 'merge', from: vendor, intoId: '' }),
        disabled: isPending,
      },
      canManage && standing && {
        key: 'deactivate',
        label: 'Deactivate',
        icon: <Icon name="ban" size={16} />,
        onSelect: () => openDialog({ kind: 'deactivate', vendor }),
        disabled: isPending,
        tone: 'danger' as const,
      },
      canManage && vendor.status === 'inactive' && {
        key: 'reactivate',
        label: 'Put back in use',
        icon: <Icon name="refresh" size={16} />,
        onSelect: () => reactivateVendor(vendor),
        disabled: isPending,
      },
    ]
  }

  function vendorNameCell(vendor: ReceiptVendorDirectoryItem) {
    const origin = ORIGIN_LABEL[vendor.origin]
    return (
      <div className="space-y-1">
        <p className="font-medium text-text-strong">{vendor.name}</p>
        {vendor.status === 'merged' && vendor.mergedIntoName && (
          <p className="text-xs text-text-muted">Merged into {vendor.mergedIntoName}</p>
        )}
        {vendor.aliases.length > 0 && (
          <p className="text-xs text-text-muted">Also known as: {vendor.aliases.join(', ')}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {vendor.kind === 'person' && <Badge tone="info">Person</Badge>}
          {origin && <Badge tone="neutral">{origin}</Badge>}
          {vendor.linkedToInvoicing && <Badge tone="neutral">Invoicing customer</Badge>}
        </div>
      </div>
    )
  }

  const columns: Column<ReceiptVendorDirectoryItem>[] = [
    {
      key: 'name',
      header: 'Vendor',
      cell: vendorNameCell,
      sortable: true,
      sortFn: (a, b) => a.name.localeCompare(b.name),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (vendor) => <Badge tone={STATUS_TONE[vendor.status]}>{STATUS_LABEL[vendor.status]}</Badge>,
    },
    {
      key: 'payments',
      header: 'Payments',
      align: 'right',
      cell: (vendor) => (
        <span>
          {vendor.paymentCount}
          {vendor.ruleCount > 0 && (
            <span className="block text-xs text-text-muted">{plural(vendor.ruleCount, 'rule', 'rules')}</span>
          )}
        </span>
      ),
      sortable: true,
      sortFn: (a, b) => a.paymentCount - b.paymentCount,
    },
    {
      key: 'total',
      header: 'Paid out',
      align: 'right',
      cell: (vendor) => currency.format(vendor.totalOutgoing),
      sortable: true,
      sortFn: (a, b) => a.totalOutgoing - b.totalOutgoing,
    },
    {
      key: 'last',
      header: 'Last payment',
      cell: (vendor) => formatDay(vendor.lastTransactionDate),
      sortable: true,
      sortFn: (a, b) => (a.lastTransactionDate ?? '').localeCompare(b.lastTransactionDate ?? ''),
    },
    {
      key: 'category',
      header: 'Default category',
      cell: (vendor) => vendor.defaultExpenseCategory ?? <span className="text-text-soft">None</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (vendor) => <RowActions actions={rowActions(vendor)} label={`Actions for ${vendor.name}`} />,
    },
  ]

  const mergeTargets = dialog?.kind === 'merge'
    ? standingVendors.filter((vendor) => vendor.id !== dialog.from.id)
    : []
  const mergeTarget = dialog?.kind === 'merge' ? vendorsById.get(dialog.intoId) ?? null : null

  return (
    <ReceiptsPageChrome
      subtitle="The vendor list: confirm, rename and merge vendors"
      navState={{ view: 'vendors' }}
      canManage={canManage}
      headerActions={
        <LinkButton href="/receipts/vendors" variant="secondary" size="sm" icon={<Icon name="trendUp" size={16} />}>
          Vendor Trends
        </LinkButton>
      }
    >
      <div className="space-y-6">
        {directory.possibleDuplicates.length > 0 && (
          <Card>
            <CardHeader
              title="Possible duplicates"
              subtitle="Names that look like one vendor. Nothing is merged unless you choose to."
            />
            <CardBody>
              <ul className="space-y-3">
                {directory.possibleDuplicates.map((group) => {
                  // Suggest keeping the one with the most payments.
                  const keeper = [...group].sort((a, b) => b.paymentCount - a.paymentCount)[0]
                  return (
                    <li key={group.map((vendor) => vendor.id).join('|')} className="rounded-lg border border-border p-3">
                      <ul className="space-y-2">
                        {group.map((vendor) => {
                          const full = vendorsById.get(vendor.id)
                          return (
                            <li key={vendor.id} className="flex flex-wrap items-center justify-between gap-2">
                              <span>
                                <span className="font-medium text-text-strong">{vendor.name}</span>{' '}
                                <span className="text-sm text-text-muted">
                                  {plural(vendor.paymentCount, 'payment', 'payments')}
                                </span>
                              </span>
                              {canGovern && full && vendor.id !== keeper.id && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => openDialog({ kind: 'merge', from: full, intoId: keeper.id })}
                                  disabled={isPending}
                                >
                                  Merge into {keeper.name}
                                </Button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  )
                })}
              </ul>
              {!canGovern && (
                <p className="mt-3 text-sm text-text-muted">Only a super admin can merge vendors.</p>
              )}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Vendors"
            subtitle={`${plural(standingVendors.length, 'vendor', 'vendors')} in use, ${unconfirmedCount} not yet confirmed${aiUnconfirmedCount > 0 ? `. ${aiUnconfirmedCount} added by the AI ${aiUnconfirmedCount === 1 ? 'is' : 'are'} listed first` : ''}`}
          />
          <CardBody>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search vendors and their other names"
                aria-label="Search vendors"
              />
              <Select
                aria-label="Show"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                options={STATUS_FILTER_OPTIONS}
              />
            </div>
            <DataTable
              data={visibleVendors}
              columns={columns}
              getRowKey={(vendor) => vendor.id}
              emptyMessage="No vendors match"
              emptyDescription="Change the search or the filter above."
              renderMobileCard={(vendor) => (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    {vendorNameCell(vendor)}
                    <RowActions actions={rowActions(vendor)} mode="menu" label={`Actions for ${vendor.name}`} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                    <Badge tone={STATUS_TONE[vendor.status]}>{STATUS_LABEL[vendor.status]}</Badge>
                    <span>{plural(vendor.paymentCount, 'payment', 'payments')}</span>
                    <span>{currency.format(vendor.totalOutgoing)} paid out</span>
                    <span>Last: {formatDay(vendor.lastTransactionDate)}</span>
                  </div>
                  {vendor.defaultExpenseCategory && (
                    <p className="text-sm text-text-muted">Default category: {vendor.defaultExpenseCategory}</p>
                  )}
                </div>
              )}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent merges and renames" subtitle="The last 20. Each can be undone." />
          <CardBody>
            {directory.recentOperations.length === 0 ? (
              <Empty title="Nothing has been merged or renamed yet" size="sm" variant="minimal" />
            ) : (
              <ul className="divide-y divide-border">
                {directory.recentOperations.map((operation) => (
                  <li key={operation.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="text-text-strong">
                        {operation.operation === 'merge'
                          ? `Merged "${operation.fromName}" into "${operation.toName}"`
                          : `Renamed "${operation.fromName}" to "${operation.toName}"`}
                      </p>
                      <p className="text-sm text-text-muted">
                        {formatDay(operation.performedAt)} · {plural(operation.transactions, 'payment', 'payments')},{' '}
                        {plural(operation.rules, 'rule', 'rules')}
                      </p>
                    </div>
                    {operation.undoneAt ? (
                      <Badge tone="neutral">Undone {formatDay(operation.undoneAt)}</Badge>
                    ) : canGovern ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        icon={<Icon name="undo" size={16} />}
                        onClick={() => openDialog({ kind: 'undo', operation })}
                        disabled={isPending}
                      >
                        Undo
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Merge */}
      <Modal
        open={dialog?.kind === 'merge'}
        onClose={closeDialog}
        title="Merge vendor"
        description={dialog?.kind === 'merge' ? `Merge "${dialog.from.name}" into another vendor.` : undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isPending}
              disabled={!mergeTarget}
              onClick={() => {
                if (dialog?.kind !== 'merge' || !mergeTarget) return
                const { from } = dialog
                run(
                  () => mergeReceiptVendors({ fromVendorId: from.id, intoVendorId: mergeTarget.id }),
                  () => `${from.name} merged into ${mergeTarget.name}`
                )
              }}
            >
              Merge
            </Button>
          </>
        }
      >
        {dialog?.kind === 'merge' && (
          <div className="space-y-4">
            <Select
              label="Keep this vendor"
              value={dialog.intoId}
              onChange={(event) => setDialog({ ...dialog, intoId: event.target.value })}
              placeholder="Choose the vendor to keep"
              options={mergeTargets.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
              disabled={isPending}
            />
            <p>
              {plural(dialog.from.paymentCount, 'payment', 'payments')} and{' '}
              {plural(dialog.from.ruleCount, 'rule', 'rules')} move to the vendor you keep and take its name.
              {' '}&quot;{dialog.from.name}&quot; is kept as another name for it, so anything still using the old
              name lands in the right place. You can undo this afterwards.
            </p>
            {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          </div>
        )}
      </Modal>

      {/* Rename */}
      <Modal
        open={dialog?.kind === 'rename'}
        onClose={closeDialog}
        title="Rename vendor"
        description={dialog?.kind === 'rename' ? `Currently "${dialog.vendor.name}".` : undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isPending}
              disabled={dialog?.kind !== 'rename' || !dialog.name.trim() || dialog.name.trim() === dialog.vendor.name}
              onClick={() => {
                if (dialog?.kind !== 'rename') return
                const { vendor, name } = dialog
                run(
                  () => renameReceiptVendor({ vendorId: vendor.id, name }),
                  () => `Renamed to ${name.trim()}`
                )
              }}
            >
              Rename
            </Button>
          </>
        }
      >
        {dialog?.kind === 'rename' && (
          <div className="space-y-4">
            <Input
              label="New name"
              value={dialog.name}
              onChange={(event) => setDialog({ ...dialog, name: event.target.value })}
              maxLength={120}
              disabled={isPending}
            />
            <p>
              {plural(dialog.vendor.paymentCount, 'payment', 'payments')} and{' '}
              {plural(dialog.vendor.ruleCount, 'rule', 'rules')} will show the new name. The old name is kept as
              another name for this vendor. You can undo this afterwards.
            </p>
            {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          </div>
        )}
      </Modal>

      {/* Kind and default category */}
      <Modal
        open={dialog?.kind === 'details'}
        onClose={closeDialog}
        title="Kind and default category"
        description={dialog?.kind === 'details' ? dialog.vendor.name : undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={isPending}
              onClick={() => {
                if (dialog?.kind !== 'details') return
                const { vendor, vendorKind, category } = dialog
                run(
                  () =>
                    updateReceiptVendorDetails({
                      vendorId: vendor.id,
                      kind: vendorKind,
                      defaultExpenseCategory: category ? (category as ReceiptExpenseCategory) : null,
                    }),
                  () => `${vendor.name} updated`
                )
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {dialog?.kind === 'details' && (
          <div className="space-y-4">
            <Select
              label="Kind"
              hint="A person is a member of staff or another individual. People are never sent to the AI."
              value={dialog.vendorKind}
              onChange={(event) => setDialog({ ...dialog, vendorKind: event.target.value as 'business' | 'person' })}
              options={[
                { value: 'business', label: 'Business' },
                { value: 'person', label: 'Person' },
              ]}
              disabled={isPending}
            />
            <Select
              label="Default expense category"
              hint="Suggested for this vendor's payments that have no category yet."
              value={dialog.category}
              onChange={(event) => setDialog({ ...dialog, category: event.target.value })}
              options={[
                { value: '', label: 'None' },
                ...receiptExpenseCategorySchema.options.map((option) => ({ value: option, label: option })),
              ]}
              disabled={isPending}
            />
            {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={dialog?.kind === 'deactivate'}
        onClose={closeDialog}
        onConfirm={() => {
          if (dialog?.kind !== 'deactivate') return
          const { vendor } = dialog
          run(
            () => updateReceiptVendorDetails({ vendorId: vendor.id, status: 'inactive' }),
            () => `${vendor.name} deactivated`
          )
        }}
        title="Deactivate vendor"
        message={
          dialog?.kind === 'deactivate'
            ? `"${dialog.vendor.name}" keeps its ${plural(dialog.vendor.paymentCount, 'payment', 'payments')} and history, and is no longer offered when choosing a vendor. You can put it back in use at any time.`
            : ''
        }
        confirmLabel="Deactivate"
        tone="primary"
      />

      <ConfirmDialog
        open={dialog?.kind === 'undo'}
        onClose={closeDialog}
        onConfirm={() => {
          if (dialog?.kind !== 'undo') return
          const { operation } = dialog
          startTransition(async () => {
            const result = await undoReceiptVendorOperation(operation.id)
            if (!result.success) {
              toast.error(result.error ?? 'The change could not be undone.')
              setDialog(null)
              return
            }
            const conflicts = (result.transactionConflicts ?? 0) + (result.ruleConflicts ?? 0)
            const restored = `${plural(result.transactionsRestored ?? 0, 'payment', 'payments')} and ${plural(result.rulesRestored ?? 0, 'rule', 'rules')} put back`
            if (conflicts > 0) {
              toast.warning(`${restored}. ${conflicts} had been changed since and were left as they are.`)
            } else {
              toast.success(restored)
            }
            setDialog(null)
            router.refresh()
          })
        }}
        title={dialog?.kind === 'undo' && dialog.operation.operation === 'merge' ? 'Undo merge' : 'Undo rename'}
        message={
          dialog?.kind === 'undo'
            ? `Payments and rules go back to "${dialog.operation.fromName}". Anything changed by hand since is left as it is.`
            : ''
        }
        confirmLabel="Undo"
        tone="primary"
      />
    </ReceiptsPageChrome>
  )
}
