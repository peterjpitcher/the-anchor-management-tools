'use client'

import React, { useEffect, useState } from 'react'
import { UNDO_WINDOW_SECONDS } from '@/lib/vouchers/constants'
import {
  newIdempotencyKey,
  postVoucherAction,
  type FohCustomerRef,
  type FohVoucherLookupItem
} from '../lib'
import { useVoucherLookup } from './useVoucherLookup'
import { NumberSearch } from './NumberSearch'
import { VoucherCard, isActionable } from './VoucherCard'
import { CustomerAttach } from './CustomerAttach'
import { ConfirmDialog } from './ConfirmDialog'

type RedeemPanelProps = {
  canEdit: boolean
  staffId: string | null
  todayIso: string
  onMutated: () => void
}

type RedeemSuccess = {
  number: string
  typeTitle: string
  redeemedAtMs: number
}

export function RedeemPanel({ canEdit, staffId, onMutated }: RedeemPanelProps) {
  const lookup = useVoucherLookup()
  const [selected, setSelected] = useState<FohVoucherLookupItem | null>(null)
  const [bookingRef, setBookingRef] = useState('')
  const [transactionRef, setTransactionRef] = useState('')
  const [customer, setCustomer] = useState<FohCustomerRef | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [success, setSuccess] = useState<RedeemSuccess | null>(null)
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0)
  const [undoBusy, setUndoBusy] = useState(false)

  useEffect(() => {
    if (!success) {
      return
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - success.redeemedAtMs) / 1000)
      setUndoSecondsLeft(Math.max(0, UNDO_WINDOW_SECONDS - elapsed))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [success])

  function selectVoucher(item: FohVoucherLookupItem) {
    setSelected(item)
    setBookingRef('')
    setTransactionRef('')
    setCustomer(null)
    setOutcome(null)
  }

  async function handleSearch(overrideQuery?: string) {
    setSelected(null)
    setSuccess(null)
    setOutcome(null)
    const items = await lookup.search(overrideQuery)
    if (items && items.length === 1) {
      selectVoucher(items[0])
    }
  }

  async function refreshSelected(voucherNumber: string, note?: string) {
    const items = await lookup.search(voucherNumber)
    const match = items?.find((item) => item.number === voucherNumber) ?? null
    if (match) {
      setSelected(match)
    }
    if (note) {
      setOutcome(note)
    }
  }

  async function confirmRedeem() {
    if (!selected || !staffId || submitting) {
      return
    }
    setSubmitting(true)
    const result = await postVoucherAction('/api/foh/vouchers/redeem', {
      number: selected.number,
      employeeId: staffId,
      transactionRef: transactionRef.trim() || undefined,
      bookingRef: bookingRef.trim() || undefined,
      customerId: customer?.id,
      idempotencyKey: newIdempotencyKey()
    })
    setSubmitting(false)
    setConfirmOpen(false)

    if (result.ok) {
      setSuccess({
        number: selected.number,
        typeTitle: selected.typeTitle,
        redeemedAtMs: Date.now()
      })
      setSelected(null)
      setOutcome(null)
      onMutated()
      return
    }

    if (result.networkError) {
      await refreshSelected(
        selected.number,
        'Connection problem. Showing the voucher as the server sees it - check its status before trying again.'
      )
      return
    }

    await refreshSelected(selected.number, result.message ?? 'The redeem was refused.')
  }

  async function handleUndo() {
    if (!success || !staffId || undoBusy) {
      return
    }
    setUndoBusy(true)
    const result = await postVoucherAction('/api/foh/vouchers/undo-redeem', {
      number: success.number,
      employeeId: staffId,
      idempotencyKey: newIdempotencyKey()
    })
    setUndoBusy(false)

    if (result.ok) {
      setOutcome('Redemption undone. The voucher is active again.')
      const undoneNumber = success.number
      setSuccess(null)
      onMutated()
      await refreshSelected(undoneNumber)
      return
    }

    setOutcome(result.message ?? 'Undo failed.')
  }

  const requiresBookingRef = Boolean(selected && isActionable(selected, 'redeem') && selected.requiresBooking)
  const canMarkUsed = Boolean(
    canEdit &&
      staffId &&
      selected &&
      isActionable(selected, 'redeem') &&
      (!requiresBookingRef || bookingRef.trim().length > 0)
  )

  return (
    <div className="space-y-4">
      <NumberSearch
        idPrefix="foh-redeem"
        label="Voucher number"
        query={lookup.query}
        onQueryChange={lookup.setQuery}
        onSearch={() => handleSearch()}
        searching={lookup.searching}
        results={lookup.results}
        message={lookup.message}
        onSelect={selectVoucher}
        selectedNumber={selected?.number ?? null}
      />

      <div aria-live="polite">
        {outcome && (
          <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-base text-blue-900">
            {outcome}
          </p>
        )}
      </div>

      {success && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-4">
          <p className="text-xl font-bold text-green-900">Marked as used</p>
          <p className="mt-1 text-base text-green-900">
            <span className="font-mono font-semibold">{success.number}</span> - {success.typeTitle}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {undoSecondsLeft > 0 ? (
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoBusy || !staffId}
                className="min-h-[56px] flex-1 rounded-lg border-2 border-amber-500 bg-white px-4 py-3 text-lg font-semibold text-amber-900 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {undoBusy ? 'Undoing...' : `Undo (${undoSecondsLeft}s left)`}
              </button>
            ) : (
              <p className="flex min-h-[56px] flex-1 items-center rounded-lg border border-gray-300 bg-white px-4 text-base text-gray-700">
                Undo window closed. Ask a manager if this was a mistake.
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setSuccess(null)
                setOutcome(null)
                lookup.reset()
              }}
              className="min-h-[56px] flex-1 rounded-lg bg-sidebar px-4 py-3 text-lg font-semibold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-2"
            >
              Next guest
            </button>
          </div>
        </div>
      )}

      {selected && !success && (
        <VoucherCard
          item={selected}
          mode="redeem"
          onViewReplacement={(replacementNumber) => {
            lookup.setQuery(replacementNumber)
            handleSearch(replacementNumber)
          }}
        >
          {isActionable(selected, 'redeem') && (
            <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
              {requiresBookingRef && (
                <div>
                  <label htmlFor="foh-redeem-booking-ref" className="block text-sm font-medium text-gray-900">
                    Booking reference (required for this voucher)
                  </label>
                  <input
                    id="foh-redeem-booking-ref"
                    type="text"
                    autoComplete="off"
                    value={bookingRef}
                    onChange={(event) => setBookingRef(event.target.value)}
                    className="mt-1 block h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40"
                  />
                </div>
              )}

              <div>
                <label htmlFor="foh-redeem-transaction-ref" className="block text-sm font-medium text-gray-900">
                  Till transaction reference (optional)
                </label>
                <input
                  id="foh-redeem-transaction-ref"
                  type="text"
                  autoComplete="off"
                  value={transactionRef}
                  onChange={(event) => setTransactionRef(event.target.value)}
                  className="mt-1 block h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:border-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/40"
                />
              </div>

              {!selected.customer && (
                <CustomerAttach idPrefix="foh-redeem" value={customer} onChange={setCustomer} />
              )}

              {!canEdit && (
                <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-700">
                  You have view-only access. Ask a manager to mark this voucher as used.
                </p>
              )}
              {canEdit && !staffId && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-900">
                  Choose your name at the top before marking the voucher as used.
                </p>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canMarkUsed}
                  className="min-h-[56px] w-full rounded-lg bg-sidebar px-4 py-3 text-xl font-bold text-white hover:bg-sidebar/90 focus:outline-none focus:ring-2 focus:ring-sidebar/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mark as used
                </button>
              )}
            </div>
          )}
        </VoucherCard>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Mark this voucher as used?"
        confirmLabel="Yes, mark as used"
        busy={submitting}
        onConfirm={confirmRedeem}
        onCancel={() => setConfirmOpen(false)}
      >
        {selected && (
          <p>
            <span className="font-mono font-semibold">{selected.number}</span> - {selected.typeTitle}
            {bookingRef.trim() ? `, booking ref ${bookingRef.trim()}` : ''}. This can be undone for{' '}
            {UNDO_WINDOW_SECONDS} seconds.
          </p>
        )}
      </ConfirmDialog>
    </div>
  )
}
