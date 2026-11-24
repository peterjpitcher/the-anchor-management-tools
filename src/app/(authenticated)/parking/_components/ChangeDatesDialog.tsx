'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, CardBody, Fieldset, Input, Modal, Radio, Switch, Textarea, toast } from '@/ds'
import { formatDateTime, parseLondonDateTimeLocalToIso, toLondonDateTimeLocalValue } from '@/lib/dateUtils'
import { buildBookingChangedSms, buildPaymentRequestSms } from '@/lib/parking/notifications'
import {
  changeParkingBookingDates,
  previewParkingDateChange,
  type ChangeParkingBookingDatesResult,
  type ParkingDateChangePreview,
} from '@/app/actions/parking'
import type { ParkingBooking } from '@/types/parking'

export interface ChangeDatesDialogProps {
  open: boolean
  booking: ParkingBooking
  onClose: () => void
  /** Called after a save (including one that came back with a warning). */
  onChanged: (result: ChangeParkingBookingDatesResult) => void | Promise<void>
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function newChangeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Fallback for very old browsers: RFC 4122 version 4 shape from Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Change a parking booking's dates and settle the money in one save (spec
 * tasks/spec-2026-11-24-parking-change-time-and-settle.md, section 6.1). Prices come from the
 * server; the browser never prices a stay.
 */
export function ChangeDatesDialog({ open, booking, onClose, onChanged }: ChangeDatesDialogProps) {
  const [changeId, setChangeId] = useState(newChangeId)
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [preview, setPreview] = useState<ParkingDateChangePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [manualMethod, setManualMethod] = useState<'cash' | 'bank_transfer'>('cash')
  const [sendPaymentLink, setSendPaymentLink] = useState(true)
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null)

  const started = Date.parse(booking.start_at) <= Date.now()

  // Fresh state, and a fresh changeId, every time the dialog opens.
  useEffect(() => {
    if (!open) return
    setChangeId(newChangeId())
    setStartLocal(toLondonDateTimeLocalValue(booking.start_at))
    setEndLocal(toLondonDateTimeLocalValue(booking.end_at))
    setPreview(null)
    setPreviewError(null)
    setRefundAmount('')
    setRefundReason('')
    setManualMethod('cash')
    setSendPaymentLink(true)
    setNotifyCustomer(true)
    setError(null)
    setLinkToCopy(null)
  }, [open, booking.id, booking.start_at, booking.end_at])

  const startIso = useMemo(() => parseLondonDateTimeLocalToIso(startLocal), [startLocal])
  const endIso = useMemo(() => parseLondonDateTimeLocalToIso(endLocal), [endLocal])
  const unchanged =
    startIso !== null &&
    endIso !== null &&
    Date.parse(startIso) === Date.parse(booking.start_at) &&
    Date.parse(endIso) === Date.parse(booking.end_at)

  // Ask the server for the new price whenever the dates settle.
  useEffect(() => {
    if (!open || !startIso || !endIso || unchanged) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    let cancelled = false
    setPreviewing(true)
    const timer = setTimeout(async () => {
      const result = await previewParkingDateChange(booking.id, { start_at: startIso, end_at: endIso })
      if (cancelled) return
      setPreviewing(false)
      if ('error' in result) {
        setPreview(null)
        setPreviewError(result.error)
        return
      }
      setPreview(result.data)
      setPreviewError(null)
      setRefundAmount(result.data.refundDefault.toFixed(2))
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, booking.id, startIso, endIso, unchanged])

  const parsedRefund = Number.parseFloat(refundAmount)
  const refundValid =
    !preview ||
    preview.kind !== 'refund' ||
    !preview.canRefund ||
    (Number.isFinite(parsedRefund) && parsedRefund >= 0 && parsedRefund <= preview.refundDue + 0.005)
  const refundBelowDue = Boolean(preview?.kind === 'refund' && preview.canRefund && refundValid && parsedRefund < preview.refundDue)
  const reasonMissing = refundBelowDue && refundReason.trim().length === 0
  const blockedExtra = preview?.kind === 'extra' && !preview.extendingPaidAvailable

  const canSave = Boolean(preview) && !previewing && refundValid && !reasonMissing && !blockedExtra && !saving && !linkToCopy

  const textPreview = useMemo(() => {
    if (!preview || !startIso || !endIso) return null
    const shown = { ...booking, start_at: startIso, end_at: endIso, calculated_price: preview.newPrice, override_price: null }
    if (preview.kind === 'unpaid' && sendPaymentLink) {
      return buildPaymentRequestSms(shown, '[payment link]')
    }
    if (preview.kind === 'refund' && preview.canRefund && Number.isFinite(parsedRefund) && parsedRefund > 0 && preview.paypalRefundPossible) {
      return buildBookingChangedSms(shown, { kind: 'refund', amount: parsedRefund })
    }
    return buildBookingChangedSms(shown, { kind: 'plain' })
  }, [preview, startIso, endIso, booking, sendPaymentLink, parsedRefund])

  const handleSave = async () => {
    if (!preview || !startIso || !endIso || !canSave) return
    setSaving(true)
    setError(null)
    try {
      const result = await changeParkingBookingDates(booking.id, {
        changeId,
        expectedUpdatedAt: preview.updatedAt,
        start_at: startIso,
        end_at: endIso,
        expectedNewPrice: preview.newPrice,
        notifyCustomer,
        sendPaymentLink,
        refundAmount: preview.kind === 'refund' && preview.canRefund ? parsedRefund : undefined,
        refundReason: refundReason.trim() || undefined,
        manualRefundMethod: manualMethod,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      if (result.alreadyApplied) {
        toast.info('This change had already been saved.')
      } else if (result.warning) {
        // A failed step after the save is never a failed change: say what did not happen.
        toast.error(result.warning, { duration: 20000 })
      } else {
        toast.success(result.textNote ? `Dates changed. ${result.textNote}` : 'Dates changed')
      }
      await onChanged(result)
      // The customer has not been told and there is a link: keep it on screen to copy.
      if (result.paymentLink && result.textStatus !== 'sent' && result.textStatus !== 'held') {
        setLinkToCopy(result.paymentLink)
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the dates')
    } finally {
      setSaving(false)
    }
  }

  const copyLink = async () => {
    if (!linkToCopy) return
    try {
      await navigator.clipboard.writeText(linkToCopy)
      toast.success('Payment link copied')
    } catch {
      toast.error('Could not copy the link. Select it and copy it by hand.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title={`Change dates: ${booking.reference}`}
      footer={
        linkToCopy ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} loading={saving} disabled={!canSave}>Save new dates</Button>
          </>
        )
      }
    >
      {linkToCopy ? (
        <div className="space-y-3">
          <Alert tone="warning" title="The customer has not been told">
            The dates were changed, but the payment link was not texted. Copy it and send it to the customer.
          </Alert>
          <Input label="Payment link" readOnly value={linkToCopy} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="secondary" size="sm" onClick={copyLink}>Copy link</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Card variant="secondary">
            <CardBody className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-text-muted">Now</span>
                <span className="text-right text-text">{formatDateTime(booking.start_at)} to {formatDateTime(booking.end_at)}</span>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="New start"
              type="datetime-local"
              required
              value={startLocal}
              disabled={started}
              hint={started ? 'The stay has started, so only the end can move.' : undefined}
              onChange={(e) => setStartLocal(e.target.value)}
            />
            <Input label="New end" type="datetime-local" required value={endLocal} onChange={(e) => setEndLocal(e.target.value)} />
          </div>

          {previewError && <Alert tone="danger">{previewError}</Alert>}
          {previewing && <p className="text-sm text-text-muted">Working out the new price...</p>}

          {preview && !previewing && (
            <>
              {preview.hadOverride && preview.overridePrice !== null && (
                <Alert tone="info">
                  This booking has an agreed price of {money(preview.overridePrice)}. Changing the dates clears it and starts from the price for the new dates.
                </Alert>
              )}

              <Card variant="secondary">
                <CardBody className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-text-muted">Old price</span><span className="text-text">{money(preview.oldPrice)}</span></div>
                  <div className="flex justify-between"><span className="text-text-muted">New price</span><span className="font-medium text-text">{money(preview.newPrice)}</span></div>
                  <div className="flex justify-between border-t border-border pt-1">
                    <span className="text-text-muted">Difference</span>
                    <span className="font-medium text-text">{money(preview.newPrice - preview.oldPrice)}</span>
                  </div>
                </CardBody>
              </Card>

              {preview.insideNoRefundWindow && preview.kind === 'refund' && (
                <Alert tone="warning">
                  This is inside 24 hours of arrival (or the stay has started). The published terms give no refund, so the refund starts at £0.00. You can raise it up to the difference.
                </Alert>
              )}

              {preview.kind === 'none' && <Alert tone="info">No money to settle.</Alert>}

              {preview.kind === 'extra' && (
                <Alert tone="warning">
                  This change costs {money(preview.extraDue)} more. Extending a paid booking is not available yet.
                </Alert>
              )}

              {preview.kind === 'unpaid' && (
                <Switch
                  label="Send the customer a new payment link"
                  checked={sendPaymentLink}
                  onChange={setSendPaymentLink}
                />
              )}

              {preview.kind === 'refund' && !preview.canRefund && (
                <Alert tone="info">
                  A manager will need to send the refund of up to {money(preview.refundDue)}. The booking will show it as a refund to do.
                </Alert>
              )}

              {preview.kind === 'refund' && preview.canRefund && (
                <div className="space-y-3">
                  <Input
                    label={`Refund (up to ${money(preview.refundDue)})`}
                    type="number"
                    min="0"
                    step="0.01"
                    max={preview.refundDue.toFixed(2)}
                    value={refundAmount}
                    error={refundValid ? undefined : `Enter an amount from £0.00 to ${money(preview.refundDue)}`}
                    onChange={(e) => setRefundAmount(e.target.value)}
                  />
                  <Textarea
                    label={refundBelowDue ? 'Reason (required: the rest of the difference is kept)' : 'Reason (internal only)'}
                    required={refundBelowDue}
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                  />
                  {!preview.paypalRefundPossible && (
                    <Fieldset legend="Refund by cash or bank transfer">
                      <p className="text-sm text-text-muted">This payment can no longer be refunded through PayPal.</p>
                      <Radio name="manual-refund-method" value="cash" label="Cash" checked={manualMethod === 'cash'} onChange={() => setManualMethod('cash')} />
                      <Radio name="manual-refund-method" value="bank_transfer" label="Bank transfer" checked={manualMethod === 'bank_transfer'} onChange={() => setManualMethod('bank_transfer')} />
                    </Fieldset>
                  )}
                </div>
              )}

              {!(preview.kind === 'unpaid' && sendPaymentLink) && (
                <Switch label="Tell the customer by text" checked={notifyCustomer} onChange={setNotifyCustomer} />
              )}

              {textPreview && (notifyCustomer || (preview.kind === 'unpaid' && sendPaymentLink)) && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-text">The text the customer gets</p>
                  <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-text">{textPreview}</p>
                </div>
              )}
            </>
          )}

          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Modal>
  )
}
