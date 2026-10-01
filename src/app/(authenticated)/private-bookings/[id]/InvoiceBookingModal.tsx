'use client'

/**
 * The confirmation dialog for invoicing a private booking.
 *
 * The deposit question is asked HERE, at the moment of use, rather than being
 * a setting to find beforehand. Both answers are priced on screen so the
 * consequence is visible before anything is sent, and whichever is chosen is
 * saved on the booking so the invoice can always be explained afterwards.
 *
 * A first invoice also asks whether the customer can pay by card or PayPal.
 * Sending creates their billing record, and the "pay online" link in the email
 * is decided from that record, so the answer has to exist before the send.
 * A customer who already has a billing record is not asked: their setting
 * lives on the vendor screen and is left alone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Fieldset,
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
  onConfirm: (input: {
    depositTreatment: DepositTreatment
    reference: string
    /** Only set when the question was asked: a first invoice for this customer. */
    paypalPaymentsEnabled?: boolean
  }) => void
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
  // Deliberately unanswered to start with. A first invoice creates the
  // customer's billing record, and the "pay online" link in the email is
  // decided from it, so a default either way would send some customers the
  // wrong email without anyone having chosen it.
  const [paypalPaymentsEnabled, setPaypalPaymentsEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!preview) return
    setTreatment(preview.previousTreatment ?? 'held_separately')
    setReference(preview.suggestedReference)
    setPaypalPaymentsEnabled(null)
  }, [preview])

  const deposit = preview?.deposit ?? null
  const askAboutDeposit = Boolean(deposit && !deposit.waived && deposit.amount > 0)
  const askAboutPayPal = preview?.createsBillingRecord ?? false
  const paypalUnanswered = askAboutPayPal && paypalPaymentsEnabled === null

  const balanceDue = useMemo(() => {
    if (!preview) return 0
    return treatment === 'deducted' && askAboutDeposit
      ? preview.balanceDeductingDeposit
      : preview.balanceHoldingDeposit
  }, [preview, treatment, askAboutDeposit])

  const blockedByOverpayment =
    treatment === 'deducted' && askAboutDeposit && (preview?.depositWouldOverpay ?? false)

  const handleConfirm = useCallback(() => {
    if (!preview || sending || blockedByOverpayment || blocked || paypalUnanswered) return
    onConfirm({
      depositTreatment: askAboutDeposit ? treatment : 'held_separately',
      reference: reference.trim(),
      ...(askAboutPayPal && paypalPaymentsEnabled !== null ? { paypalPaymentsEnabled } : {}),
    })
  }, [
    preview,
    sending,
    blockedByOverpayment,
    blocked,
    paypalUnanswered,
    onConfirm,
    askAboutDeposit,
    treatment,
    reference,
    askAboutPayPal,
    paypalPaymentsEnabled,
  ])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate and Send Invoice"
      description={preview ? preview.customerName : undefined}
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
            disabled={!preview || loading || blockedByOverpayment || blocked || paypalUnanswered}
            loading={sending}
          >
            Send Invoice
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
        <div className="space-y-4">
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
            <Fieldset legend={`How should the ${money(deposit.amount)} deposit be treated?`}>
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
            </Fieldset>
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

          {askAboutPayPal && (
            <Fieldset
              legend={`Can ${preview.customerName.split(' ')[0]} pay online by card or PayPal?`}
              required
              hint={
                paypalUnanswered
                  ? 'Choose one to send the invoice. This is their first invoice, so the answer is saved on their billing record. You can change it later under Invoices, Vendors.'
                  : 'Saved on their billing record. You can change it later under Invoices, Vendors.'
              }
            >
              <Radio
                name="paypal-payments"
                value="yes"
                label="Yes, add a payment link"
                description={
                  balanceDue > 0
                    ? `The email includes a link to pay the ${money(balanceDue)} online by card or PayPal.`
                    : 'Nothing is owed on this invoice, so this email has no link. Later invoices will include one.'
                }
                checked={paypalPaymentsEnabled === true}
                onChange={() => setPaypalPaymentsEnabled(true)}
                disabled={sending}
              />

              <Radio
                name="paypal-payments"
                value="no"
                label="No, bank transfer only"
                description="No payment link goes in the email."
                checked={paypalPaymentsEnabled === false}
                onChange={() => setPaypalPaymentsEnabled(false)}
                disabled={sending}
              />
            </Fieldset>
          )}

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
