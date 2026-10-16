'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Badge, Button, Card, CardBody, CardHeader, toast } from '@/ds'
import { confirmCustomerPayment, dismissCustomerPayment } from '@/app/actions/receipts'
import { formatDateInLondon } from '@/lib/dateUtils'
import type { ConfirmationOption, CustomerPaymentToConfirm } from '@/services/receipts/receiptPaymentConfirmations'
import { formatCurrency } from '@/app/(authenticated)/receipts/utils'

/** Why a payment is waiting, in words for the person deciding. */
const REASONS: Record<string, string> = {
  several_invoices_fit: 'More than one invoice fits this payment exactly. Choose the one it paid.',
  set_of_invoices_fits: 'This payment adds up to these invoices together. Confirm it paid all of them.',
  invoice_claimed_by_another_payment:
    'Another bank payment already points at this invoice. Check it is not paid twice before recording it.',
  too_many_invoices_owing: 'So many invoices are owing that the payment could be for several of them. Choose, or deal with it by hand.',
  several_entries_fit: 'More than one payment already entered on the invoices could be this one. Choose which.',
  entry_fits_another_payment:
    'A payment already entered on the invoices could be this one or another bank payment. Confirm it is this one.',
  entries_split_payment: 'Payments entered on several invoices add up to this one. Confirm they are this payment.',
  entry_may_be_this_payment:
    'A payment of the same amount was entered on an invoice a while before or after this arrived. Check it is not the same money before recording anything.',
  no_exact_fit:
    'No recent invoice owes exactly this amount. If it paid an invoice, enter the payment on that invoice, then mark this as dealt with.',
  over_allocated: 'This payment is already used in full against other invoices. Check it, then mark it as dealt with.',
  error: 'This payment could not be matched automatically.',
}

function day(isoDate: string | null): string {
  return isoDate ? formatDateInLondon(isoDate, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
}

function numbers(option: ConfirmationOption): string {
  return option.parts.map((part) => part.invoiceNumber ?? 'the invoice').join(' and ')
}

function optionLabel(option: ConfirmationOption): string {
  if (option.kind === 'link') {
    return `It is the payment entered on ${day(option.parts[0]?.date ?? null)} for ${numbers(option)}`
  }
  return `Record against ${numbers(option)}`
}

interface CustomerPaymentsToConfirmProps {
  items: CustomerPaymentToConfirm[]
  /** Managing receipts and editing invoices: recording a payment needs both. */
  canConfirm: boolean
  /** The list could not be loaded: said plainly, so an empty list is never read as all clear. */
  loadError?: string | null
}

/**
 * Customer payments the matcher would not guess about: several invoices fitted, or none did
 * exactly. Nothing is recorded until a person picks one of the options, and an invoice with a
 * payment waiting here is not chased.
 */
export function CustomerPaymentsToConfirm({ items, canConfirm, loadError }: CustomerPaymentsToConfirmProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)

  if (loadError && !items.length) {
    return (
      <Alert tone="warning" title="Customer payments to confirm">
        {loadError} Reload the page to try again.
      </Alert>
    )
  }
  if (!items.length) return null

  const run = (key: string, action: () => Promise<{ success?: boolean; error?: string }>, done: string) => {
    setBusyKey(key)
    startTransition(async () => {
      const result = await action()
      setBusyKey(null)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(done)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader
        title="Customer payments to confirm"
        subtitle="These customer payments quoted no invoice number and could not be settled safely on their own. Nothing is recorded until you choose. Invoices offered as a choice here are not chased while the payment waits."
        action={<Badge tone="warning">{items.length}</Badge>}
      />
      <CardBody className="space-y-4">
        {items.map((item) => (
          <div key={item.matchId} className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
            <div>
              <p className="font-medium text-text-strong">
                {formatCurrency(item.amount)} from {item.vendorName ?? item.details} on {day(item.date)}
              </p>
              <p className="text-sm text-text-muted">{item.details}</p>
            </div>
            <p className="text-sm">
              {REASONS[item.reason] ?? REASONS.error}
              {item.error ? ` (${item.error})` : ''}
            </p>
            {item.partlyDone.length > 0 && (
              <p className="text-sm text-text-muted">
                Already done from an earlier attempt: {item.partlyDone.join(' and ')}. Choose the same option again to finish.
              </p>
            )}
            {item.recentInvoices.length > 0 && (
              <p className="text-sm text-text-muted">
                Recent invoices:{' '}
                {item.recentInvoices
                  .map(
                    (invoice) =>
                      `${invoice.invoiceNumber} of ${day(invoice.invoiceDate)}, ${
                        invoice.outstanding > 0 ? `${formatCurrency(invoice.outstanding)} owed` : 'paid'
                      }`
                  )
                  .join('; ')}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {item.options.map((option) => {
                const key = `${item.matchId}:${option.index}`
                return (
                  <Button
                    key={key}
                    size="sm"
                    disabled={!canConfirm || pending}
                    loading={busyKey === key}
                    onClick={() =>
                      run(
                        key,
                        () => confirmCustomerPayment({ matchId: item.matchId, optionIndex: option.index }),
                        option.kind === 'link' ? 'Payment linked to the invoice' : 'Payment recorded on the invoice'
                      )
                    }
                  >
                    {optionLabel(option)}
                  </Button>
                )
              })}
              <Button
                size="sm"
                variant="secondary"
                disabled={!canConfirm || pending}
                loading={busyKey === `${item.matchId}:aside`}
                onClick={() => run(`${item.matchId}:aside`, () => dismissCustomerPayment({ matchId: item.matchId }), 'Taken off the list')}
              >
                {item.options.length ? 'Not an invoice payment' : 'Dealt with'}
              </Button>
            </div>
          </div>
        ))}
        {!canConfirm && (
          <p className="text-sm text-text-muted">Confirming needs permission to manage receipts and to edit invoices.</p>
        )}
      </CardBody>
    </Card>
  )
}
