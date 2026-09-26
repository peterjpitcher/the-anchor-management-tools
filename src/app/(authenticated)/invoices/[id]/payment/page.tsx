'use client'

import { invoiceBalanceDue } from '@/lib/invoices/balance'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getInvoice, recordPayment } from '@/app/actions/invoices'
import {
  PageLayout,
  Icon,
  Card,
  CardHeader,
  CardBody,
  Button,
  Input,
  Select,
  Textarea,
  Field,
  Alert,
  FormFooter,
  StatGrid,
  Stat,
  toast,
} from '@/ds'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { InvoiceWithDetails, PaymentMethod } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'
import { invoicePageTitle } from '../../_shared/nav'

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

    loadInvoice()
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

      const result = await recordPayment(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      // The toast confirms it; the page redirects straight away, so an inline banner would never be read.
      toast.success('Payment recorded successfully!')
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

        <FormFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push(`/invoices/${invoice.id}`)}
            disabled={submitting}
          >
            Cancel
          </Button>
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
