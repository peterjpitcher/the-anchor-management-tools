'use client'

import { invoiceBalanceDue } from '@/lib/invoices/balance'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getInvoice, getReceiptEmailContext, recordPayment } from '@/app/actions/invoices'
import {
  PageLayout,
  Icon,
  Card,
  CardHeader,
  CardBody,
  Button,
  LinkButton,
  Input,
  Select,
  Textarea,
  Field,
  Alert,
  Checkbox,
  FormFooter,
  StatGrid,
  Stat,
  toast,
} from '@/ds'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { buildReceiptEmail } from '@/lib/invoices/email-copy'
import type { InvoiceWithDetails, PaymentMethod } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { invoicePageTitle } from '../../_shared/nav'

/**
 * Who the receipt would go to. `unknown` means the lookup failed: the page then says so
 * rather than guessing, and the server still decides who gets it when the payment is saved.
 */
type ReceiptRecipient =
  | { state: 'loading' }
  | { state: 'unknown' }
  | { state: 'known'; firstName: string | null; to: string | null; ccCount: number }

export default function RecordPaymentPage() {
  const params = useParams()
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canEdit = hasPermission('invoices', 'edit')

  const rawInvoiceId = params?.id
  const invoiceId = Array.isArray(rawInvoiceId) ? rawInvoiceId[0] : rawInvoiceId ?? null

  const [invoice, setInvoice] = useState<InvoiceWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form fields
  const todayIso = getTodayIsoDate()
  const [paymentDate, setPaymentDate] = useState(todayIso)
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  // On by default: a receipt is the normal case, and the tick is there to hold one back.
  const [sendReceipt, setSendReceipt] = useState(true)
  const [receiptRecipient, setReceiptRecipient] = useState<ReceiptRecipient>({ state: 'loading' })

  // A client with no email address cannot be sent one, so the tick is off and locked.
  const receiptHasNowhereToGo = receiptRecipient.state === 'known' && !receiptRecipient.to
  const receiptTicked = sendReceipt && !receiptHasNowhereToGo
  const receiptFirstName = receiptRecipient.state === 'known' ? receiptRecipient.firstName : null

  useEffect(() => {
    if (!invoiceId) {
      setError('Invoice not found')
      setLoading(false)
      return
    }

    if (permissionsLoading) {
      return
    }

    if (!canEdit) {
      router.replace('/unauthorized')
      return
    }

    const currentInvoiceId = invoiceId

    async function loadInvoice() {
      setLoading(true)
      setError(null)

      try {
        const result = await getInvoice(currentInvoiceId)

        if (result.error || !result.invoice) {
          throw new Error(result.error || 'Invoice not found')
        }

        setInvoice(result.invoice)

        const outstanding = invoiceBalanceDue(result.invoice)
        setAmount(outstanding > 0 ? outstanding.toFixed(2) : '0.00')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invoice')
      } finally {
        setLoading(false)
      }
    }

    // Separate from the invoice load so a failed lookup costs the page the name on the tick,
    // not the form. The contact tables are closed to most staff, hence a server action.
    async function loadReceiptRecipient() {
      try {
        const result = await getReceiptEmailContext(currentInvoiceId)
        setReceiptRecipient(
          result?.context ? { state: 'known', ...result.context } : { state: 'unknown' }
        )
      } catch {
        setReceiptRecipient({ state: 'unknown' })
      }
    }

    loadInvoice()
    loadReceiptRecipient()
  }, [invoiceId, permissionsLoading, canEdit, router])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!invoice || submitting) {
      return
    }

    if (!canEdit) {
      toast.error('You do not have permission to record payments')
      return
    }

    const paymentAmount = parseFloat(amount)
    const outstanding = invoiceBalanceDue(invoice)

    if (Number.isNaN(paymentAmount) || paymentAmount <= 0) {
      setError('Payment amount must be greater than 0')
      return
    }

    if (paymentAmount > outstanding) {
      setError(`Payment amount cannot exceed outstanding balance of £${outstanding.toFixed(2)}`)
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      formData.append('paymentDate', paymentDate)
      formData.append('amount', paymentAmount.toString())
      formData.append('paymentMethod', paymentMethod)
      formData.append('reference', reference)
      formData.append('notes', notes)
      // Sent as a string and checked on the server, which is where the choice is enforced.
      formData.append('send_receipt', receiptTicked ? 'true' : 'false')

      const result = await recordPayment(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      // The toast confirms it; the page redirects straight away, so an inline banner would never be read.
      toast.success('Payment recorded successfully!')
      // A receipt problem is not a failed payment: the payment is saved, so it is a warning
      // on top of the success, kept up longer because it asks the reader to do something.
      if (result.warning) {
        toast.warning(result.warning, { duration: 12000 })
      }
      router.push(`/invoices/${invoice.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment')
      setSubmitting(false)
    }
  }

  const layoutProps = {
    title: 'Record Payment',
    subtitle: 'Update invoice balances',
    // Back to the invoice page, named as that page is titled ("Invoice INV-001").
    backButton: {
      label: `Back to ${invoicePageTitle(invoice?.invoice_number)}`,
      href: invoiceId ? `/invoices/${invoiceId}` : '/invoices',
    },
    containerSize: 'md' as const,
  }

  if (permissionsLoading || loading) {
    return <PageLayout {...layoutProps} loading loadingLabel="Loading invoice" />
  }

  if (!permissionsLoading && !canEdit) {
    return null
  }

  if (!invoice) {
    return <PageLayout {...layoutProps} error={error || 'Invoice not found'} />
  }

  const outstanding = invoiceBalanceDue(invoice)

  // The wording the customer will get, for the amount typed so far. The server builds the real
  // one from the saved payment with the same function, so the two cannot drift apart.
  const typedAmount = parseFloat(amount)
  const receiptPreview =
    Number.isFinite(typedAmount) && typedAmount > 0
      ? buildReceiptEmail({
          firstName: receiptFirstName,
          invoiceNumber: invoice.invoice_number,
          paymentAmount: typedAmount,
          balance: Math.max(0, Math.round((outstanding - typedAmount) * 100) / 100),
        })
      : null

  const receiptDestination = (() => {
    if (receiptRecipient.state === 'loading') return 'Checking who this goes to.'
    if (receiptRecipient.state === 'unknown') {
      return 'We could not check who this goes to. It will be sent to the invoice contact on the client record, if there is one.'
    }
    if (!receiptRecipient.to) {
      return 'This client has no email address, so a receipt cannot be sent.'
    }
    const copies = receiptRecipient.ccCount
    return copies > 0
      ? `Goes to ${receiptRecipient.to}, with ${copies} copied ${copies === 1 ? 'address' : 'addresses'}.`
      : `Goes to ${receiptRecipient.to}.`
  })()

  return (
    <PageLayout {...layoutProps}>
      {error && <Alert tone="danger">{error}</Alert>}

      <StatGrid columns={3}>
        <Stat label="Invoice Total" value={`£${invoice.total_amount.toFixed(2)}`} />
        <Stat label="Already Paid" value={`£${invoice.paid_amount.toFixed(2)}`} tone="success" />
        {/* Red only once the invoice is overdue, the same rule as the invoice list. */}
        <Stat
          label="Outstanding"
          value={`£${outstanding.toFixed(2)}`}
          hint={invoice.status === 'overdue' ? 'Overdue' : undefined}
          tone={invoice.status === 'overdue' ? 'danger' : 'default'}
        />
      </StatGrid>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader
            title="Payment Details"
            subtitle={`Invoice ${invoice.invoice_number} - ${invoice.vendor?.name ?? 'Unknown vendor'}`}
          />
          <CardBody className="space-y-4">
            <Field label="Payment Date" required>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                max={todayIso}
                required
              />
            </Field>

            <Field label="Amount (£)" required hint={`Maximum: £${outstanding.toFixed(2)}`}>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                max={outstanding.toFixed(2)}
                step="0.01"
                required
              />
            </Field>

            <Field label="Payment Method" required>
              <Select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                required
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </Select>
            </Field>

            <Field label="Reference">
              <Input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Transaction reference or cheque number"
              />
            </Field>

            <Field label="Notes">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any additional notes about this payment"
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Receipt" subtitle="The payment is saved whether or not a receipt is sent" />
          <CardBody className="space-y-4">
            <Checkbox
              label={receiptFirstName ? `Email a receipt to ${receiptFirstName}` : 'Email a receipt to the customer'}
              description={receiptDestination}
              checked={receiptTicked}
              onChange={setSendReceipt}
              disabled={submitting || receiptHasNowhereToGo}
            />

            {receiptTicked && (
              <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
                <p className="text-xs text-text-muted">What the email will say, with the receipt attached as a PDF</p>
                {receiptPreview ? (
                  <>
                    <p className="text-ui font-medium text-text">{receiptPreview.subject}</p>
                    <p className="text-ui text-text whitespace-pre-wrap">{receiptPreview.body}</p>
                  </>
                ) : (
                  <p className="text-ui text-text-muted">Enter the amount to see the wording.</p>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <FormFooter>
          <LinkButton href={`/invoices/${invoice.id}`} variant="secondary" disabled={submitting}>
            Cancel
          </LinkButton>
          <Button variant="primary"
            type="submit"
            disabled={
              submitting ||
              !canEdit ||
              parseFloat(amount) <= 0 ||
              parseFloat(amount) > outstanding
            }
            loading={submitting}
            leftIcon={<Icon name="save" size={16} />}
          >
            Record Payment
          </Button>
        </FormFooter>
      </form>
    </PageLayout>
  )
}
