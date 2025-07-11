'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getInvoice, recordPayment } from '@/app/actions/invoices'
import { Button } from '@/components/ui/Button'
import { ChevronLeft, Save, AlertCircle } from 'lucide-react'
import type { InvoiceWithDetails, PaymentMethod } from '@/types/invoices'

export default function RecordPaymentPage() {
  const params = useParams()
  const router = useRouter()
  const [invoice, setInvoice] = useState<InvoiceWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  const invoiceId = params.id as string
  
  // Form fields
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    async function loadInvoice() {
      if (!invoiceId) return
      
      try {
        const result = await getInvoice(invoiceId)
        
        if (result.error || !result.invoice) {
          throw new Error(result.error || 'Invoice not found')
        }

        setInvoice(result.invoice)
        
        // Set default amount to outstanding balance
        const outstanding = result.invoice.total_amount - result.invoice.paid_amount
        setAmount(outstanding.toFixed(2))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invoice')
      } finally {
        setLoading(false)
      }
    }
    
    loadInvoice()
  }, [invoiceId])


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!invoice || submitting) return

    const paymentAmount = parseFloat(amount)
    const outstanding = invoice.total_amount - invoice.paid_amount

    if (paymentAmount <= 0) {
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
      setTimeout(() => {
        router.push(`/invoices/${invoice.id}`)
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading invoice...</p>
        </div>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="container mx-auto p-6">
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg p-4">
          {error || 'Invoice not found'}
        </div>
        <Button
          onClick={() => router.push('/invoices')}
          className="mt-4"
        >
          Back to Invoices
        </Button>
      </div>
    )
  }

  const outstanding = invoice.total_amount - invoice.paid_amount

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.push(`/invoices/${invoice.id}`)}
          className="mb-4"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Invoice
        </Button>

        <h1 className="text-3xl font-bold mb-2">Record Payment</h1>
        <p className="text-muted-foreground">
          Invoice {invoice.invoice_number} - {invoice.vendor?.name}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-600 rounded-lg">
          Payment recorded successfully! Redirecting...
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Payment Summary</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
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
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border p-6">
        <h2 className="text-lg font-semibold mb-4">Payment Details</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Payment Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Amount (£) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0.01"
              max={outstanding.toFixed(2)}
              step="0.01"
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-sm text-gray-500 mt-1">
              Maximum: £{outstanding.toFixed(2)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Payment Method <span className="text-red-500">*</span>
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="bank_transfer">Bank Transfer</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Reference
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Transaction reference or cheque number"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Any additional notes about this payment"
            />
          </div>
        </div>

        <div className="flex justify-end gap-4 mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/invoices/${invoice.id}`)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || parseFloat(amount) <= 0 || parseFloat(amount) > outstanding}
          >
            <Save className="h-4 w-4 mr-2" />
            {submitting ? 'Recording...' : 'Record Payment'}
          </Button>
        </div>
      </form>
    </div>
  )
}