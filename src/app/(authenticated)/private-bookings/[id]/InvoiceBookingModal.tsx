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
import { Alert, Button, Input, Modal } from '@/ds'
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
    if (!preview || sending || blockedByOverpayment) return
    onConfirm({
      depositTreatment: askAboutDeposit ? treatment : 'held_separately',
      reference: reference.trim(),
    })
  }, [preview, sending, blockedByOverpayment, onConfirm, askAboutDeposit, treatment, reference])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={preview ? `Invoice ${preview.customerName}` : 'Invoice this booking'}
      width="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!preview || loading || sending || blockedByOverpayment}
          >
            {sending
              ? 'Sending…'
              : preview
                ? `Send invoice to ${preview.customerName.split(' ')[0]}`
                : 'Send invoice'}
          </Button>
        </>
      }
    >
      {loading && <p className="text-sm text-gray-600">Working out the figures…</p>}

      {error && (
        <Alert variant="error" title="This booking cannot be invoiced">
          {error}
        </Alert>
      )}

      {preview && !loading && (
        <div className="space-y-5">
          <p className="text-sm text-gray-600">
            Going to <span className="font-medium text-gray-900">{preview.recipientEmail}</span>
          </p>

          {preview.warnings.length > 0 && (
            <Alert variant="warning" title="Worth a look before you send">
              <ul className="list-disc space-y-1 pl-4">
                {preview.warnings.map(warning => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-2">Item</th>
                  <th className="py-2 px-2 text-right">Qty</th>
                  <th className="py-2 px-2 text-right">Unit</th>
                  <th className="py-2 pl-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line, index) => (
                  <tr key={`${line.description}-${index}`} className="border-b border-gray-100">
                    <td className="py-2 pr-2 text-gray-900">
                      {line.description}
                      {line.discountPercentage > 0 && (
                        <span className="ml-2 text-xs font-medium text-green-700">
                          {line.discountPercentage}% off
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-600">
                      {formatQuantity(line.quantity)}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-600">{money(line.unitPrice)}</td>
                    <td className="py-2 pl-2 text-right text-gray-900">{money(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">Subtotal (excl. VAT)</dt>
              <dd className="text-gray-900">{money(preview.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">VAT</dt>
              <dd className="text-gray-900">{money(preview.vatAmount)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt className="text-gray-900">Invoice total</dt>
              <dd className="text-gray-900">{money(preview.invoiceTotal)}</dd>
            </div>
          </dl>

          {askAboutDeposit && deposit ? (
            <fieldset className="rounded-lg border border-gray-200 p-4">
              <legend className="px-1 text-sm font-medium text-gray-900">
                How should the {money(deposit.amount)} deposit be treated?
              </legend>

              <div className="mt-2 space-y-3">
                <label className="flex cursor-pointer gap-3">
                  <input
                    type="radio"
                    name="deposit-treatment"
                    className="mt-1"
                    checked={treatment === 'held_separately'}
                    onChange={() => setTreatment('held_separately')}
                    disabled={sending}
                  />
                  <span className="text-sm">
                    <span className="font-medium text-gray-900">
                      Hold it separately (standard)
                    </span>
                    <span className="block text-gray-600">
                      {preview.customerName.split(' ')[0]} pays{' '}
                      {money(preview.balanceHoldingDeposit)} now. Deposit refunded within 48
                      hours after the event.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer gap-3">
                  <input
                    type="radio"
                    name="deposit-treatment"
                    className="mt-1"
                    checked={treatment === 'deducted'}
                    onChange={() => setTreatment('deducted')}
                    disabled={sending || preview.depositWouldOverpay}
                  />
                  <span className="text-sm">
                    <span className="font-medium text-gray-900">
                      Take it off this invoice (account customer)
                    </span>
                    <span className="block text-gray-600">
                      {preview.depositWouldOverpay ? (
                        <>
                          Not possible here: the deposit and payments received are more than the
                          invoice total, so this booking is owed a refund rather than an invoice.
                        </>
                      ) : (
                        <>
                          {preview.customerName.split(' ')[0]} pays{' '}
                          {money(preview.balanceDeductingDeposit)} now. Deposit is used up,
                          nothing refunded afterwards.
                        </>
                      )}
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          ) : (
            <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
              {deposit?.waived
                ? 'The deposit was waived on this booking, so there is nothing to apply.'
                : 'No deposit has been paid on this booking.'}
            </p>
          )}

          <dl className="space-y-1 border-t border-gray-200 pt-3 text-sm">
            {preview.paymentsReceived > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-600">Payments already received</dt>
                <dd className="text-gray-900">-{money(preview.paymentsReceived)}</dd>
              </div>
            )}
            {treatment === 'deducted' && askAboutDeposit && deposit && (
              <div className="flex justify-between">
                <dt className="text-gray-600">Deposit applied</dt>
                <dd className="text-gray-900">-{money(deposit.amount)}</dd>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold">
              <dt className="text-gray-900">Balance due</dt>
              <dd className="text-gray-900">{money(balanceDue)}</dd>
            </div>
          </dl>

          <div>
            <label
              htmlFor="invoice-reference"
              className="block text-sm font-medium text-gray-900"
            >
              Their reference or PO number
            </label>
            <Input
              id="invoice-reference"
              value={reference}
              onChange={event => setReference(event.target.value)}
              disabled={sending}
              maxLength={100}
            />
            <p className="mt-1 text-xs text-gray-500">
              Optional, and it prints on the invoice. Leave it as it is for a private customer.
              Businesses often need their own PO number here or their finance team will not pay
              it.
            </p>
          </div>
        </div>
      )}
    </Modal>
  )
}
