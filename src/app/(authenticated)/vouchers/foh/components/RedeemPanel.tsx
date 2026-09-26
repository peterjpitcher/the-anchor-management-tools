'use client'

import React, { useEffect, useState } from 'react'
import { Alert, Button, ConfirmDialog, Input } from '@/ds'
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
      setOutcome('Redemption undone. The voucher is back to Issued.')
      const undoneNumber = success.number
      setSuccess(null)
      onMutated()
      await refreshSelected(undoneNumber)
      return
    }

    setOutcome(result.message ?? 'Undo failed.')
  }

  // Booking-type vouchers still show the reference field so it can be recorded,
  // but a missing reference never blocks a redemption (owner decision 2026-07-30).
  const showBookingRef = Boolean(selected && isActionable(selected, 'redeem') && selected.requiresBooking)
  const canMarkUsed = Boolean(canEdit && staffId && selected && isActionable(selected, 'redeem'))

  // Blocks flow straight into the screen's own stack (VouchersFohClient).
  return (
    <>
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
          <Alert tone="info" role="status">
            {outcome}
          </Alert>
        )}
      </div>

      {success && (
        <Alert
          tone="success"
          role="status"
          title="Marked as used"
          actions={
            <div className="flex flex-col gap-2 sm:flex-row">
              {undoSecondsLeft > 0 ? (
                // Warning outline so the undo reads as a cautious step, not the next action.
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  onClick={handleUndo}
                  disabled={undoBusy || !staffId}
                  className="h-14 flex-1 border-2 border-warning text-lg text-warning-fg hover:bg-warning-soft"
                >
                  {undoBusy ? 'Undoing...' : `Undo (${undoSecondsLeft}s left)`}
                </Button>
              ) : (
                <p className="flex min-h-14 flex-1 items-center rounded-default border border-border-strong bg-surface px-4 text-base text-text">
                  Undo window closed. Ask a manager if this was a mistake.
                </p>
              )}
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => {
                  setSuccess(null)
                  setOutcome(null)
                  lookup.reset()
                }}
                className="h-14 flex-1 text-lg"
              >
                Next Guest
              </Button>
            </div>
          }
        >
          <span className="font-mono font-semibold">{success.number}</span> - {success.typeTitle}
        </Alert>
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
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              {showBookingRef && (
                <Input
                  id="foh-redeem-booking-ref"
                  label="Booking reference (optional)"
                  type="text"
                  autoComplete="off"
                  value={bookingRef}
                  onChange={(event) => setBookingRef(event.target.value)}
                  className="h-12 text-base"
                />
              )}

              <Input
                id="foh-redeem-transaction-ref"
                label="Till transaction reference (optional)"
                type="text"
                autoComplete="off"
                value={transactionRef}
                onChange={(event) => setTransactionRef(event.target.value)}
                className="h-12 text-base"
              />

              {!selected.customer && (
                <CustomerAttach idPrefix="foh-redeem" value={customer} onChange={setCustomer} />
              )}

              {!canEdit && (
                <Alert tone="info" role="status">
                  You have view-only access. Ask a manager to mark this voucher as used.
                </Alert>
              )}
              {canEdit && !staffId && (
                <Alert tone="warning" role="status">
                  Choose your name at the top before marking the voucher as used.
                </Alert>
              )}

              {canEdit && (
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canMarkUsed}
                  className="h-14 w-full text-xl font-bold"
                >
                  Mark as Used
                </Button>
              )}
            </div>
          )}
        </VoucherCard>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmRedeem}
        title="Mark This Voucher as Used?"
        confirmLabel="Yes, Mark as Used"
        tone="warning"
        message={
          selected ? (
            <>
              <span className="font-mono font-semibold">{selected.number}</span> - {selected.typeTitle}
              {bookingRef.trim() ? `, booking ref ${bookingRef.trim()}` : ''}. This can be undone for{' '}
              {UNDO_WINDOW_SECONDS} seconds.
            </>
          ) : undefined
        }
      />
    </>
  )
}
