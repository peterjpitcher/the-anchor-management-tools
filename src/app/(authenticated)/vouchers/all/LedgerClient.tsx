'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  Button,
  Input,
  Select,
  Modal,
  Textarea,
  ConfirmDialog,
  Checkbox,
  Pagination,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  toast,
} from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import type { VoucherStatus } from '@/types/vouchers'
import {
  getVoucherLedger,
  cancelVoucher,
} from '@/app/actions/vouchers'
import type {
  VoucherLedgerFilters,
  VoucherLedgerResult,
  VoucherLedgerRow,
} from '@/app/actions/vouchers'
import {
  VOUCHER_STATUS_LABELS,
  VoucherStatusBadge,
  formatPence,
  newIdempotencyKey,
} from '../_shared/voucher-ui'

interface LedgerClientProps {
  initialFilters: VoucherLedgerFilters
  initialResult: VoucherLedgerResult
  types: { id: string; displayTitle: string }[]
  batches: { id: string; label: string }[]
}

const ALL_STATUSES: VoucherStatus[] = [
  'generated',
  'issued',
  'redeemed',
  'expired',
  'cancelled',
  'replaced',
]

function filtersToQuery(filters: VoucherLedgerFilters): string {
  const params = new URLSearchParams()
  if (filters.status?.length) params.set('status', filters.status.join(','))
  if (filters.typeIds?.length) params.set('type', filters.typeIds.join(','))
  if (filters.batchId) params.set('batch', filters.batchId)
  if (filters.eventId) params.set('event', filters.eventId)
  if (filters.customerId) params.set('customer', filters.customerId)
  if (filters.generatedFrom) params.set('generatedFrom', filters.generatedFrom)
  if (filters.generatedTo) params.set('generatedTo', filters.generatedTo)
  if (filters.issuedFrom) params.set('issuedFrom', filters.issuedFrom)
  if (filters.issuedTo) params.set('issuedTo', filters.issuedTo)
  if (filters.redeemedFrom) params.set('redeemedFrom', filters.redeemedFrom)
  if (filters.redeemedTo) params.set('redeemedTo', filters.redeemedTo)
  if (filters.expiringWithinDays !== undefined && filters.expiringWithinDays !== null) {
    params.set('expiringWithinDays', String(filters.expiringWithinDays))
  }
  if (filters.batchReady) params.set('batchReady', '1')
  if (filters.q) params.set('q', filters.q)
  if (filters.page && filters.page > 1) params.set('page', String(filters.page))
  return params.toString()
}

function shortDate(value: string | null): string {
  if (!value) return ''
  return formatDateInLondon(value, { day: 'numeric', month: 'short', year: 'numeric' })
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function LedgerClient({ initialFilters, initialResult, types, batches }: LedgerClientProps) {
  const router = useRouter()
  const [filters, setFilters] = useState<VoucherLedgerFilters>(initialFilters)
  const [result, setResult] = useState<VoucherLedgerResult>(initialResult)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [reprintConfirmOpen, setReprintConfirmOpen] = useState(false)
  const [reprintBusy, setReprintBusy] = useState(false)

  const applyFilters = useCallback(
    async (next: VoucherLedgerFilters) => {
      setFilters(next)
      setLoading(true)
      const qs = filtersToQuery(next)
      router.replace(qs ? `/vouchers/all?${qs}` : '/vouchers/all', { scroll: false })
      const response = await getVoucherLedger(next)
      setLoading(false)
      if (response.error || !response.data) {
        toast.error(response.error ?? 'Could not load the ledger.')
        return
      }
      setResult(response.data)
      setSelected(new Set())
    },
    [router]
  )

  const update = (patch: Partial<VoucherLedgerFilters>) => {
    void applyFilters({ ...filters, ...patch, page: 1 })
  }

  const toggleStatus = (status: VoucherStatus) => {
    const current = new Set(filters.status ?? [])
    if (current.has(status)) current.delete(status)
    else current.add(status)
    update({ status: current.size > 0 ? Array.from(current) : undefined })
  }

  const toggleType = (typeId: string) => {
    const current = new Set(filters.typeIds ?? [])
    if (current.has(typeId)) current.delete(typeId)
    else current.add(typeId)
    update({ typeIds: current.size > 0 ? Array.from(current) : undefined })
  }

  const clearFilters = () => {
    void applyFilters({ page: 1, pageSize: 50 })
  }

  const selectedRows = useMemo(
    () => result.rows.filter((row) => selected.has(row.voucher.voucherNumber)),
    [result.rows, selected]
  )

  const toggleRow = (voucherNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(voucherNumber)) next.delete(voucherNumber)
      else next.add(voucherNumber)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === result.rows.length) return new Set()
      return new Set(result.rows.map((row) => row.voucher.voucherNumber))
    })
  }

  // ------------------------------------------------------------- bulk cancel
  const handleBulkCancel = async () => {
    const blocked = selectedRows.filter(
      (row) => !['generated', 'issued'].includes(row.voucher.status)
    )
    if (blocked.length > 0) {
      toast.error('Only in-stock or issued vouchers can be cancelled.')
      return
    }
    if (cancelReason.trim().length < 3) {
      toast.error('Give a short reason for the cancellation.')
      return
    }
    setCancelBusy(true)
    let done = 0
    const failures: string[] = []
    for (const row of selectedRows) {
      const response = await cancelVoucher({
        voucherNumber: row.voucher.voucherNumber,
        reason: cancelReason.trim(),
        idempotencyKey: newIdempotencyKey(),
      })
      if (response.success) done += 1
      else failures.push(`${row.voucher.voucherNumber}: ${response.error ?? 'failed'}`)
    }
    setCancelBusy(false)
    setCancelOpen(false)
    setCancelReason('')
    if (done > 0) toast.success(`${done} voucher${done === 1 ? '' : 's'} cancelled`)
    if (failures.length > 0) toast.error(failures.slice(0, 3).join('; '))
    void applyFilters({ ...filters })
  }

  // ------------------------------------------------------------- CSV export
  const handleExport = () => {
    const rows = selectedRows.length > 0 ? selectedRows : result.rows
    if (rows.length === 0) {
      toast.error('Nothing to export.')
      return
    }
    const header = [
      'number',
      'type',
      'status',
      'issued_at',
      'issued_by',
      'age',
      'expiry_date',
      'won_at',
      'customer',
      'redeemed_at',
      'redeemed_by',
      'value',
    ]
    const lines = rows.map((row) =>
      [
        row.voucher.voucherNumber,
        row.typeTitle,
        VOUCHER_STATUS_LABELS[row.voucher.status],
        row.voucher.issuedAt ?? '',
        row.voucher.issuedByName ?? '',
        row.ageLabel ?? '',
        row.voucher.expiryDate ?? '',
        row.voucher.wonAtLabel ?? '',
        row.customerName ?? '',
        row.voucher.redeemedAt ?? '',
        row.voucher.redeemedByName ?? '',
        row.voucher.valuePence !== null ? formatPence(row.voucher.valuePence) : '',
      ]
        .map((value) => csvEscape(String(value)))
        .join(',')
    )
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vouchers-export-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  // ------------------------------------------------------------- reprint
  const startReprint = () => {
    if (selectedRows.length === 0) return
    const blocked = selectedRows.filter(
      (row) => !['generated', 'issued'].includes(row.voucher.status)
    )
    if (blocked.length > 0) {
      toast.error('Only in-stock or issued vouchers can be reprinted.')
      return
    }
    const hasIssued = selectedRows.some((row) => row.voucher.status === 'issued')
    if (hasIssued) {
      setReprintConfirmOpen(true)
    } else {
      void runReprint()
    }
  }

  const runReprint = async () => {
    setReprintBusy(true)
    const byBatch = new Map<string, VoucherLedgerRow[]>()
    for (const row of selectedRows) {
      const list = byBatch.get(row.voucher.batchId) ?? []
      list.push(row)
      byBatch.set(row.voucher.batchId, list)
    }
    let failures = 0
    for (const [batchId, rows] of byBatch.entries()) {
      try {
        const response = await fetch(`/api/vouchers/batches/${batchId}/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voucherNumbers: rows.map((row) => row.voucher.voucherNumber),
          }),
        })
        if (!response.ok) {
          failures += 1
          continue
        }
        const payload = (await response.json()) as { url?: string }
        if (payload.url) {
          window.open(payload.url, '_blank', 'noopener')
        } else {
          failures += 1
        }
      } catch {
        failures += 1
      }
    }
    setReprintBusy(false)
    setReprintConfirmOpen(false)
    if (failures > 0) {
      toast.error('Some reprints failed. Try again from the voucher detail page.')
    } else {
      toast.success('Reprint PDF opened in a new tab.')
    }
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize))

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-64">
              <Input
                label="Number search"
                placeholder="AN-2607-0148 or part of it"
                value={filters.q ?? ''}
                onChange={(event) => setFilters({ ...filters, q: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') update({ q: filters.q })
                }}
                className="font-mono"
              />
            </div>
            <Button variant="secondary" onClick={() => update({ q: filters.q })}>
              Search
            </Button>
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {ALL_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  filters.status?.includes(status)
                    ? 'border-green-600 bg-green-50 text-green-800 font-medium'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                {VOUCHER_STATUS_LABELS[status]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => toggleType(type.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filters.typeIds?.includes(type.id)
                    ? 'border-green-600 bg-green-50 text-green-800 font-medium'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                {type.displayTitle}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Select
              label="Batch"
              value={filters.batchId ?? ''}
              onChange={(event) => update({ batchId: event.target.value || undefined })}
              placeholder="All batches"
              options={batches.map((batch) => ({ value: batch.id, label: batch.label }))}
            />
            <Input
              type="date"
              label="Issued from"
              value={filters.issuedFrom ?? ''}
              onChange={(event) => update({ issuedFrom: event.target.value || undefined })}
            />
            <Input
              type="date"
              label="Issued to"
              value={filters.issuedTo ?? ''}
              onChange={(event) => update({ issuedTo: event.target.value || undefined })}
            />
            <Input
              type="number"
              label="Expiring within (days)"
              min={0}
              value={filters.expiringWithinDays !== undefined ? String(filters.expiringWithinDays) : ''}
              onChange={(event) =>
                update({
                  expiringWithinDays:
                    event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            />
          </div>

          {(filters.eventId || filters.customerId || filters.batchReady) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {filters.batchReady && (
                <button
                  type="button"
                  className="rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-gray-400"
                  onClick={() => update({ batchReady: undefined })}
                >
                  Printable stock only ✕
                </button>
              )}
              {filters.eventId && (
                <button
                  type="button"
                  className="rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-gray-400"
                  onClick={() => update({ eventId: undefined })}
                >
                  Filtered to one event ✕
                </button>
              )}
              {filters.customerId && (
                <button
                  type="button"
                  className="rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-gray-400"
                  onClick={() => update({ customerId: undefined })}
                >
                  Filtered to one customer ✕
                </button>
              )}
            </div>
          )}
        </div>
      </Card>

      {selected.size > 0 && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-700">{selected.size} selected</span>
            <Button variant="secondary" size="sm" onClick={() => setCancelOpen(true)}>
              Cancel selected
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExport}>
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={startReprint} loading={reprintBusy}>
              Reprint selected
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox
                    aria-label="Select all rows"
                    checked={selected.size === result.rows.length && result.rows.length > 0}
                    onChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Won at</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Redeemed</TableHead>
                <TableHead align="right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11}>
                    <div className="py-8 text-center text-sm text-gray-500">
                      No vouchers match these filters.
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {result.rows.map((row) => (
                <TableRow
                  key={row.voucher.id}
                  onClick={() => router.push(`/vouchers/${row.voucher.voucherNumber}`)}
                >
                  <TableCell>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select ${row.voucher.voucherNumber}`}
                        checked={selected.has(row.voucher.voucherNumber)}
                        onChange={() => toggleRow(row.voucher.voucherNumber)}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono font-medium text-gray-900">
                      {row.voucher.voucherNumber}
                    </span>
                  </TableCell>
                  <TableCell>{row.typeTitle}</TableCell>
                  <TableCell>
                    <VoucherStatusBadge status={row.voucher.status} />
                  </TableCell>
                  <TableCell>
                    {row.voucher.issuedAt ? (
                      <div>
                        <div>{shortDate(row.voucher.issuedAt)}</div>
                        <div className="text-xs text-gray-500">{row.voucher.issuedByName}</div>
                      </div>
                    ) : (
                      ''
                    )}
                  </TableCell>
                  <TableCell>{row.ageLabel ?? ''}</TableCell>
                  <TableCell>{shortDate(row.voucher.expiryDate)}</TableCell>
                  <TableCell>{row.voucher.wonAtLabel ?? ''}</TableCell>
                  <TableCell>{row.customerName ?? ''}</TableCell>
                  <TableCell>
                    {row.voucher.redeemedAt ? (
                      <div>
                        <div>{shortDate(row.voucher.redeemedAt)}</div>
                        <div className="text-xs text-gray-500">{row.voucher.redeemedByName}</div>
                      </div>
                    ) : (
                      ''
                    )}
                  </TableCell>
                  <TableCell align="right">{formatPence(row.voucher.valuePence)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4">
          <Pagination
            currentPage={result.page}
            totalPages={totalPages}
            totalItems={result.total}
            itemsPerPage={result.pageSize}
            onPageChange={(page) => void applyFilters({ ...filters, page })}
            showItemsPerPage={false}
          />
        </div>
        {loading && <div className="mt-2 text-sm text-gray-500">Loading…</div>}
      </Card>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${selected.size} voucher${selected.size === 1 ? '' : 's'}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep them
            </Button>
            <Button variant="danger" onClick={() => void handleBulkCancel()} loading={cancelBusy}>
              Cancel vouchers
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Cancelling is permanent. Cancelled cards can never be reinstated or reprinted.
          </p>
          <Textarea
            label="Reason (required)"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            rows={2}
            maxLength={500}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={reprintConfirmOpen}
        onClose={() => setReprintConfirmOpen(false)}
        onConfirm={() => void runReprint()}
        title="Reprint issued cards?"
        message="Reprinting an issued card is only allowed when the original is destroyed or unusable. Confirm that applies to every issued card selected."
        confirmLabel="Original destroyed or unusable, reprint"
        tone="warning"
      />
    </div>
  )
}
