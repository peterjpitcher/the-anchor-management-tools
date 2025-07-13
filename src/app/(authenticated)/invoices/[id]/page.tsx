'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getInvoice, updateInvoiceStatus, deleteInvoice } from '@/app/actions/invoices'
import { getEmailConfigStatus } from '@/app/actions/email'
import { Button } from '@/components/ui/Button'
import { Download, Mail, Edit, Trash2, Copy, ChevronLeft, CheckCircle, XCircle, Clock } from 'lucide-react'
import { EmailInvoiceModal } from '@/components/EmailInvoiceModal'
import { ChasePaymentModal } from '@/components/ChasePaymentModal'
import type { InvoiceWithDetails, InvoiceStatus } from '@/types/invoices'

export default function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [invoice, setInvoice] = useState<InvoiceWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [showChaseModal, setShowChaseModal] = useState(false)
  const [emailConfigured, setEmailConfigured] = useState(false)

  const invoiceId = params.id as string

  useEffect(() => {
    async function loadInvoice() {
      if (!invoiceId) return
      
      try {
        const result = await getInvoice(invoiceId)
        
        if (result.error || !result.invoice) {
          throw new Error(result.error || 'Invoice not found')
        }

        setInvoice(result.invoice)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invoice')
      } finally {
        setLoading(false)
      }
    }
    
    loadInvoice()
    checkEmailConfig()
  }, [invoiceId])

  async function checkEmailConfig() {
    try {
      const result = await getEmailConfigStatus()
      if (!result.error && result.configured) {
        setEmailConfigured(true)
      }
    } catch (err) {
      console.error('Error checking email config:', err)
    }
  }


  async function handleStatusChange(newStatus: InvoiceStatus) {
    if (!invoice || actionLoading) return

    setActionLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      formData.append('status', newStatus)

      const result = await updateInvoiceStatus(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      // Reload invoice
      const refreshResult = await getInvoice(invoiceId)
      if (refreshResult.invoice) {
        setInvoice(refreshResult.invoice)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDelete() {
    if (!invoice || actionLoading) return

    if (!confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
      return
    }

    setActionLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)

      const result = await deleteInvoice(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      router.push('/invoices')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete invoice')
      setActionLoading(false)
    }
  }

  function getStatusColor(status: InvoiceStatus): string {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800'
      case 'sent': return 'bg-blue-100 text-blue-800'
      case 'partially_paid': return 'bg-yellow-100 text-yellow-800'
      case 'paid': return 'bg-green-100 text-green-800'
      case 'overdue': return 'bg-red-100 text-red-800'
      case 'void': return 'bg-gray-100 text-gray-800'
      case 'written_off': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  function getStatusIcon(status: InvoiceStatus) {
    switch (status) {
      case 'paid': return <CheckCircle className="h-4 w-4" />
      case 'overdue': return <XCircle className="h-4 w-4" />
      case 'partially_paid': return <Clock className="h-4 w-4" />
      default: return null
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

  if (error || !invoice) {
    return (
      <div className="space-y-6">
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

  const subtotal = invoice.line_items?.reduce((acc, item) => {
    const lineSubtotal = item.quantity * item.unit_price
    const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
    return acc + (lineSubtotal - lineDiscount)
  }, 0) || 0

  const invoiceDiscount = subtotal * (invoice.invoice_discount_percentage / 100)

  const vat = invoice.line_items?.reduce((acc, item) => {
    const itemSubtotal = item.quantity * item.unit_price
    const itemDiscount = itemSubtotal * (item.discount_percentage / 100)
    const itemAfterDiscount = itemSubtotal - itemDiscount
    const itemShare = subtotal > 0 ? itemAfterDiscount / subtotal : 0
    const itemAfterInvoiceDiscount = itemAfterDiscount - (invoiceDiscount * itemShare)
    return acc + (itemAfterInvoiceDiscount * (item.vat_rate / 100))
  }, 0) || 0

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.push('/invoices')}
          className="mb-4"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Invoices
        </Button>

        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Invoice {invoice.invoice_number}</h1>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(invoice.status)}`}>
                {getStatusIcon(invoice.status)}
                {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).replace('_', ' ')}
              </span>
              {invoice.reference && (
                <span className="text-sm sm:text-base text-gray-600">
                  Reference: {invoice.reference}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {invoice.status === 'draft' && (
              <>
                <Button
                  onClick={() => handleStatusChange('sent')}
                  disabled={actionLoading}
                  className="text-sm"
                >
                  <Mail className="h-4 w-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Mark as Sent</span>
                  <span className="sm:hidden">Send</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push(`/invoices/${invoice.id}/edit`)}
                  disabled={actionLoading}
                  className="text-sm"
                >
                  <Edit className="h-4 w-4 mr-1 sm:mr-2" />
                  Edit
                </Button>
              </>
            )}
            
            {invoice.status === 'sent' && (
              <Button
                onClick={() => handleStatusChange('paid')}
                disabled={actionLoading}
                className="bg-green-600 hover:bg-green-700 text-white text-sm"
              >
                <CheckCircle className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Mark as Paid</span>
                <span className="sm:hidden">Paid</span>
              </Button>
            )}

            {emailConfigured && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowEmailModal(true)}
                  disabled={actionLoading}
                  className="text-sm"
                >
                  <Mail className="h-4 w-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Send Email</span>
                  <span className="sm:hidden">Email</span>
                </Button>
                {(invoice.status === 'overdue' || 
                  (invoice.status === 'sent' && new Date(invoice.due_date) < new Date())) && (
                  <Button
                    variant="outline"
                    onClick={() => setShowChaseModal(true)}
                    disabled={actionLoading}
                    className="border-orange-500 text-orange-600 hover:bg-orange-50 text-sm"
                  >
                    <Clock className="h-4 w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Chase Payment</span>
                    <span className="sm:hidden">Chase</span>
                  </Button>
                )}
              </>
            )}

            <Button
              variant="outline"
              onClick={() => window.open(`/api/invoices/${invoice.id}/pdf`, '_blank')}
              disabled={actionLoading}
              className="text-sm"
            >
              <Download className="h-4 w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Download PDF</span>
              <span className="sm:hidden">PDF</span>
            </Button>

            {invoice.status === 'draft' && (
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={actionLoading}
                className="text-red-600 hover:bg-red-50 text-sm"
              >
                <Trash2 className="h-4 w-4 mr-1 sm:mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Invoice Details</h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <h3 className="font-medium text-sm text-gray-600 mb-1">From</h3>
                <p className="font-medium">Orange Jelly Limited</p>
                <p className="text-sm text-gray-600">The Anchor, Horton Road</p>
                <p className="text-sm text-gray-600">Stanwell Moor Village, Surrey</p>
                <p className="text-sm text-gray-600">TW19 6AQ</p>
                <p className="text-sm text-gray-600">VAT: GB315203647</p>
              </div>

              <div>
                <h3 className="font-medium text-sm text-gray-600 mb-1">To</h3>
                {invoice.vendor ? (
                  <>
                    <p className="font-medium">{invoice.vendor.name}</p>
                    {invoice.vendor.contact_name && (
                      <p className="text-sm text-gray-600">{invoice.vendor.contact_name}</p>
                    )}
                    {invoice.vendor.email && (
                      <p className="text-sm text-gray-600">{invoice.vendor.email}</p>
                    )}
                    {invoice.vendor.phone && (
                      <p className="text-sm text-gray-600">{invoice.vendor.phone}</p>
                    )}
                    {invoice.vendor.address && (
                      <p className="text-sm text-gray-600 whitespace-pre-line">{invoice.vendor.address}</p>
                    )}
                  </>
                ) : (
                  <p className="text-gray-500">No vendor details</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:gap-6 mt-6 pt-6 border-t">
              <div>
                <p className="text-sm text-gray-600">Invoice Date</p>
                <p className="font-medium">
                  {new Date(invoice.invoice_date).toLocaleDateString('en-GB')}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Due Date</p>
                <p className="font-medium">
                  {new Date(invoice.due_date).toLocaleDateString('en-GB')}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Line Items</h2>
            
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-sm font-medium text-gray-600">Description</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">Qty</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">Unit Price</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">Discount</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">VAT</th>
                    <th className="text-right py-2 text-sm font-medium text-gray-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.line_items?.map((item) => {
                    const lineSubtotal = item.quantity * item.unit_price
                    const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
                    const lineAfterDiscount = lineSubtotal - lineDiscount
                    const itemShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
                    const lineAfterInvoiceDiscount = lineAfterDiscount - (invoiceDiscount * itemShare)
                    const lineVat = lineAfterInvoiceDiscount * (item.vat_rate / 100)
                    const lineTotal = lineAfterInvoiceDiscount + lineVat

                    return (
                      <tr key={item.id} className="border-b">
                        <td className="py-3 text-sm">{item.description}</td>
                        <td className="py-3 text-sm text-right">{item.quantity}</td>
                        <td className="py-3 text-sm text-right">£{item.unit_price.toFixed(2)}</td>
                        <td className="py-3 text-sm text-right">
                          {item.discount_percentage > 0 && (
                            <span className="text-green-600">-{item.discount_percentage}%</span>
                          )}
                        </td>
                        <td className="py-3 text-sm text-right">{item.vat_rate}%</td>
                        <td className="py-3 text-sm text-right font-medium">£{lineTotal.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {invoice.line_items?.map((item) => {
                const lineSubtotal = item.quantity * item.unit_price
                const lineDiscount = lineSubtotal * (item.discount_percentage / 100)
                const lineAfterDiscount = lineSubtotal - lineDiscount
                const itemShare = subtotal > 0 ? lineAfterDiscount / subtotal : 0
                const lineAfterInvoiceDiscount = lineAfterDiscount - (invoiceDiscount * itemShare)
                const lineVat = lineAfterInvoiceDiscount * (item.vat_rate / 100)
                const lineTotal = lineAfterInvoiceDiscount + lineVat

                return (
                  <div key={item.id} className="border rounded-lg p-4 bg-gray-50">
                    <div className="font-medium text-sm mb-2">{item.description}</div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Quantity:</span>
                        <span>{item.quantity}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Unit Price:</span>
                        <span>£{item.unit_price.toFixed(2)}</span>
                      </div>
                      {item.discount_percentage > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Discount:</span>
                          <span className="text-green-600">-{item.discount_percentage}%</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-600">VAT:</span>
                        <span>{item.vat_rate}%</span>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t flex justify-between font-medium">
                      <span>Total:</span>
                      <span>£{lineTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-6 pt-6 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span>£{subtotal.toFixed(2)}</span>
              </div>
              {invoice.invoice_discount_percentage > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Invoice Discount ({invoice.invoice_discount_percentage}%):</span>
                  <span>-£{invoiceDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span>VAT:</span>
                <span>£{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                <span>Total:</span>
                <span>£{invoice.total_amount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {(invoice.notes || invoice.internal_notes) && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-semibold mb-4">Notes</h2>
              
              {invoice.notes && (
                <div className="mb-4">
                  <h3 className="font-medium text-sm text-gray-600 mb-1">Invoice Notes</h3>
                  <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
              
              {invoice.internal_notes && (
                <div>
                  <h3 className="font-medium text-sm text-gray-600 mb-1">Internal Notes</h3>
                  <p className="text-sm whitespace-pre-wrap bg-yellow-50 p-3 rounded-md">
                    {invoice.internal_notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Payment Status</h2>
            
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Total Amount</p>
                <p className="text-2xl font-bold">£{invoice.total_amount.toFixed(2)}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-600">Paid Amount</p>
                <p className="text-xl font-semibold text-green-600">£{invoice.paid_amount.toFixed(2)}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-600">Outstanding</p>
                <p className="text-xl font-semibold text-red-600">
                  £{(invoice.total_amount - invoice.paid_amount).toFixed(2)}
                </p>
              </div>

              {invoice.status !== 'paid' && invoice.status !== 'void' && (
                <Button
                  className="w-full"
                  onClick={() => router.push(`/invoices/${invoice.id}/payment`)}
                >
                  Record Payment
                </Button>
              )}
            </div>
          </div>

          {invoice.payments && invoice.payments.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-semibold mb-4">Payment History</h2>
              
              <div className="space-y-3">
                {invoice.payments.map((payment) => (
                  <div key={payment.id} className="border-b pb-3 last:border-b-0">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">£{payment.amount.toFixed(2)}</p>
                        <p className="text-sm text-gray-600">
                          {new Date(payment.payment_date).toLocaleDateString('en-GB')}
                        </p>
                        {payment.reference && (
                          <p className="text-sm text-gray-500">{payment.reference}</p>
                        )}
                      </div>
                      <span className="text-sm text-gray-500">{payment.payment_method}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  alert('Link copied to clipboard!')
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy Link
              </Button>
              
              {invoice.status !== 'void' && invoice.status !== 'written_off' && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleStatusChange('void')}
                  disabled={actionLoading}
                >
                  Void Invoice
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {invoice && (
        <>
          <EmailInvoiceModal
            invoice={invoice}
            isOpen={showEmailModal}
            onClose={() => setShowEmailModal(false)}
            onSuccess={async () => {
              // Reload invoice to get updated status
              const result = await getInvoice(invoiceId)
              if (result.invoice) {
                setInvoice(result.invoice)
              }
            }}
          />
          <ChasePaymentModal
            invoice={invoice}
            isOpen={showChaseModal}
            onClose={() => setShowChaseModal(false)}
            onSuccess={async () => {
              // Reload invoice to get updated status
              const result = await getInvoice(invoiceId)
              if (result.invoice) {
                setInvoice(result.invoice)
              }
            }}
          />
        </>
      )}
    </div>
  )
}