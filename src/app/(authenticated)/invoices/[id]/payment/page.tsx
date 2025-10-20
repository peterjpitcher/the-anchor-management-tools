'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getInvoice, recordPayment } from '@/app/actions/invoices'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Save } from 'lucide-react'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { InvoiceWithDetails, PaymentMethod } from '@/types/invoices'
import { usePermissions } from '@/contexts/PermissionContext'

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
  const [success, setSuccess] = useState(false)

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

        const outstanding = result.invoice.total_amount - result.invoice.paid_amount
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
    const outstanding = invoice.total_amount - invoice.paid_amount

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

      setSuccess(true)
      toast.success('Payment recorded successfully!')
      router.push(`/invoices/${invoice.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment')
      setSubmitting(false)
    }
  }

  if (permissionsLoading || loading) {
    return (
      <PageLayout
        title="Record Payment"
        subtitle="Update invoice balances"
        backButton={{ label: 'Back to Invoice', href: invoiceId ? `/invoices/${invoiceId}` : '/invoices' }}
        loading
        loadingLabel="Loading invoice..."
      />
    )
  }

  if (!permissionsLoading && !canEdit) {
    return null
  }

  if (!invoice) {
    return (
      <PageLayout
        title="Record Payment"
        subtitle="Update invoice balances"
        backButton={{ label: 'Back to Invoices', href: '/invoices' }}
        error={error || 'Invoice not found'}
      />
    )
  }

  const outstanding = invoice.total_amount - invoice.paid_amount

  return (
    <PageLayout
      title="Record Payment"
      subtitle={`Invoice ${invoice.invoice_number} - ${invoice.vendor?.name ?? 'Unknown vendor'}`}
      backButton={{ label: 'Back to Invoice', href: `/invoices/${invoice.id}` }}
    >
      <div className="space-y-6">
        {error && <Alert variant="error" description={error} />}

        {success && (
          <Alert variant="success" description="Payment recorded successfully! Redirecting..." />
        )}

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Payment Summary</h2>
          <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
            <div>
              <p className="text-sm text-gray-600">Invoice Total</p>
              <p className="text-xl font-bold">£{invoice.total_amount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Already Paid</p>
              <p className="text-xl font-bold text-green-600">£{invoice.paid_amount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Outstanding</p>
              <p className="text-xl font-bold text-red-600">£{outstanding.toFixed(2)}</p>
            </div>
          </div>
        </Card>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Payment Details</h2>
            <div className="space-y-4">
              <FormGroup label="Payment Date" required>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  max={todayIso}
                  required
                />
              </FormGroup>

              <FormGroup label="Amount (£)" required help={`Maximum: £${outstanding.toFixed(2)}`}>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0.01"
                  max={outstanding.toFixed(2)}
                  step="0.01"
                  required
                />
              </FormGroup>

              <FormGroup label="Payment Method" required>
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
              </FormGroup>

              <FormGroup label="Reference">
                <Input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Transaction reference or cheque number"
                />
              </FormGroup>

              <FormGroup label="Notes">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Any additional notes about this payment"
                />
              </FormGroup>
            </div>
          </Card>

          <div className="flex flex-col justify-end gap-3 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/invoices/${invoice.id}`)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                !canEdit ||
                parseFloat(amount) <= 0 ||
                parseFloat(amount) > outstanding
              }
              loading={submitting}
              leftIcon={<Save className="h-4 w-4" />}
            >
              Record Payment
            </Button>
          </div>
        </form>
      </div>
    </PageLayout>
  )
}
