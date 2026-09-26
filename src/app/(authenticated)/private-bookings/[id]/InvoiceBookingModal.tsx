'use client'

/**
 * The confirmation dialog for invoicing a private booking.
 *
 * The deposit question is asked HERE, at the moment of use, rather than being
 * a setting to find beforehand. Both answers are priced on screen so the
 * consequence is visible before anything is sent, and whichever is chosen is
 * saved on the booking so the invoice can always be explained afterwards.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Input,
  Modal,
  PageLoading,
  Radio,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import type {
  DepositTreatment,
  PrivateBookingInvoicePreview,
} from '@/app/actions/privateBookingInvoice'

interface InvoiceBookingModalProps {
  open: boolean
  onClose: () => void
  preview: PrivateBookingInvoicePreview | null
  loading: boolean
  sending: boolean
  error: string | null
  /** True when the error means the booking cannot be invoiced at all. */
  blocked?: boolean
  onConfirm: (input: { depositTreatment: DepositTreatment; reference: string }) => void
}

function money(amount: number): string {
  return `£${amount.toFixed(2)}`
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(quantity)
}

export function InvoiceBookingModal({
  open,
  onClose,
  preview,
  loading,
  sending,
  error,
  blocked = false,
  onConfirm,
}: InvoiceBookingModalProps) {
  // The contract default. Only an explicit choice moves it.
  const [treatment, setTreatment] = useState<DepositTreatment>('held_separately')
  // Defaults to TBC rather than empty: most bookings have no PO number, and an
  // empty box invites someone to leave it blank by accident. TBC prints as a
  // deliberate "not applicable" and is easy to overtype when a business does
  // supply one.
  const [reference, setReference] = useState('TBC')

  useEffect(() => {
    if (!preview) return
    setTreatment(preview.previousTreatment ?? 'held_separately')
    setReference(preview.suggestedReference)
  }, [preview])

  const deposit = preview?.deposit ?? null
  const askAboutDeposit = Boolean(deposit && !deposit.waived && deposit.amount > 0)

  const balanceDue = useMemo(() => {
    if (!preview) return 0
    return treatment === 'deducted' && askAboutDeposit
      ? preview.balanceDeductingDeposit
      : preview.balanceHoldingDeposit
  }, [preview, treatment, askAboutDeposit])

  const blockedByOverpayment =
    treatment === 'deducted' && askAboutDeposit && (preview?.depositWouldOverpay ?? false)

  const handleConfirm = useCallback(() => {
    if (!preview || sending || blockedByOverpayment || blocked) return
    onConfirm({
      depositTreatment: askAboutDeposit ? treatment : 'held_separately',
      reference: reference.trim(),
    })
  }, [preview, sending, blockedByOverpayment, blocked, onConfirm, askAboutDeposit, treatment, reference])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={preview ? `Invoice ${preview.customerName}` : 'Invoice This Booking'}
      width="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          {/*
            `blocked` means the booking itself cannot be invoiced, so clicking
            again would only repeat the same refusal. A retryable failure (a
            bounced email, a dropped connection) leaves the button live so the
            operator can try again.
          */}
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!preview || loading || sending || blockedByOverpayment || blocked}
          >
            {sending
              ? 'Sending…'
              : preview
                ? `Send Invoice to ${preview.customerName.split(' ')[0]}`
                : 'Send Invoice'}
          </Button>
        </>
      }
    >
      {loading && <PageLoading inline label="Working out the figures…" />}

      {error && (
        <Alert tone="danger" title="This booking cannot be invoiced">
          {error}
        </Alert>
      )}

      {preview && !loading && (
        <div className="space-y-5">
          <p className="text-sm text-text-muted">
            Going to <span className="font-medium text-text">{preview.recipientEmail}</span>
          </p>

          {preview.warnings.length > 0 && (
            <Alert tone="warning" title="Worth a look before you send">
              <ul className="list-disc space-y-1 pl-4">
                {preview.warnings.map(warning => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Alert>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead align="right">Qty</TableHead>
                <TableHead align="right">Unit</TableHead>
                <TableHead align="right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.lines.map((line, index) => (
                <TableRow key={`${line.description}-${index}`}>
                  <TableCell className="whitespace-normal">
                    {line.description}
                    {line.discountPercentage > 0 && (
                      <span className="ml-2 text-xs font-medium text-success-fg">
                        {line.discountPercentage}% off
                      </span>
                    )}
                  </TableCell>
                  <TableCell align="right" className="text-text-muted">
                    {formatQuantity(line.quantity)}
                  </TableCell>
                  <TableCell align="right" className="text-text-muted">{money(line.unitPrice)}</TableCell>
                  <TableCell align="right">{money(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">Subtotal (excl. VAT)</dt>
              <dd className="text-text">{money(preview.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">VAT</dt>
              <dd className="text-text">{money(preview.vatAmount)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt className="text-text">Invoice total</dt>
              <dd className="text-text">{money(preview.invoiceTotal)}</dd>
            </div>
          </dl>

          {askAboutDeposit && deposit ? (
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium text-text">
                How should the {money(deposit.amount)} deposit be treated?
              </legend>

              <Radio
                name="deposit-treatment"
                value="held_separately"
                label="Hold it separately (standard)"
                description={`${preview.customerName.split(' ')[0]} pays ${money(preview.balanceHoldingDeposit)} now. Deposit refunded within 48 hours after the event.`}
                checked={treatment === 'held_separately'}
                onChange={() => setTreatment('held_separately')}
                disabled={sending}
              />

              <Radio
                name="deposit-treatment"
                value="deducted"
                label="Take it off this invoice (account customer)"
                description={
                  preview.depositWouldOverpay
                    ? 'Not possible here: the deposit and payments received are more than the invoice total, so this booking is owed a refund rather than an invoice.'
                    : `${preview.customerName.split(' ')[0]} pays ${money(preview.balanceDeductingDeposit)} now. Deposit is used up, nothing refunded afterwards.`
                }
                checked={treatment === 'deducted'}
                onChange={() => setTreatment('deducted')}
                disabled={sending || preview.depositWouldOverpay}
              />
            </fieldset>
          ) : (
            <Alert tone="info" size="sm" role="status">
              {deposit?.waived
                ? 'The deposit was waived on this booking, so there is nothing to apply.'
                : 'No deposit has been paid on this booking.'}
            </Alert>
          )}

          <dl className="space-y-1 border-t border-border pt-3 text-sm">
            {preview.paymentsReceived > 0 && (
              <div className="flex justify-between">
                <dt className="text-text-muted">Payments already received</dt>
                <dd className="text-text">-{money(preview.paymentsReceived)}</dd>
              </div>
            )}
            {treatment === 'deducted' && askAboutDeposit && deposit && (
              <div className="flex justify-between">
                <dt className="text-text-muted">Deposit applied</dt>
                <dd className="text-text">-{money(deposit.amount)}</dd>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold">
              <dt className="text-text">Balance due</dt>
              <dd className="text-text">{money(balanceDue)}</dd>
            </div>
          </dl>

          <Input
            id="invoice-reference"
            label="Their reference or PO number"
            hint="Optional, and it prints on the invoice. Leave it as it is for a private customer. Businesses often need their own PO number here or their finance team will not pay it."
            value={reference}
            onChange={event => setReference(event.target.value)}
            disabled={sending}
            maxLength={100}
          />
        </div>
      )}
    </Modal>
  )
}
