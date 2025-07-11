'use client'

import { useState, useEffect } from 'react'
import { sendChasePaymentEmail } from '@/app/actions/email'
import { Button } from '@/components/ui/Button'
import { X, Send, Loader2, Clock } from 'lucide-react'
import type { InvoiceWithDetails } from '@/types/invoices'

interface ChasePaymentModalProps {
  invoice: InvoiceWithDetails
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function ChasePaymentModal({ invoice, isOpen, onClose, onSuccess }: ChasePaymentModalProps) {
  const [recipientEmail, setRecipientEmail] = useState(invoice.vendor?.email || '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Calculate days overdue
  const dueDate = new Date(invoice.due_date)
  const today = new Date()
  const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
  const outstandingAmount = invoice.total_amount - invoice.paid_amount
  
  const [subject, setSubject] = useState(`Gentle reminder: Invoice ${invoice.invoice_number} - ${daysOverdue} days overdue`)
  const [body, setBody] = useState(
    `Hi ${invoice.vendor?.contact_name || invoice.vendor?.name || 'there'},

I hope you're well!

Just a gentle reminder that invoice ${invoice.invoice_number} was due on ${dueDate.toLocaleDateString('en-GB')} and is now ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} overdue.

Amount Outstanding: £${outstandingAmount.toFixed(2)}

I understand things can get busy, so this is just a friendly nudge. If there's anything I can help with or if you need to discuss payment arrangements, please don't hesitate to get in touch.

Many thanks,
Peter Pitcher
Orange Jelly Limited
07995087315

P.S. I've attached a copy of the invoice for your reference.`
  )

  if (!isOpen) return null

  async function handleSend() {
    if (!recipientEmail) {
      setError('Please enter a recipient email address')
      return
    }

    setSending(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      formData.append('recipientEmail', recipientEmail)
      formData.append('subject', subject)
      formData.append('body', body)

      const result = await sendChasePaymentEmail(formData)

      if (result.error) {
        setError(result.error)
      } else {
        if (onSuccess) {
          onSuccess()
        }
        onClose()
      }
    } catch (err) {
      setError('Failed to send chase email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-orange-600" />
            <div>
              <h2 className="text-xl font-semibold">Chase Payment</h2>
              <p className="text-sm text-gray-600">Invoice is {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'} overdue</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            disabled={sending}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">
              Send to
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="customer@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
              rows={12}
            />
          </div>

          <div className="bg-orange-50 rounded-lg p-4">
            <p className="text-sm text-orange-800">
              <strong>Attachment:</strong> Invoice {invoice.invoice_number} (PDF format)
            </p>
            <p className="text-sm text-orange-800 mt-1">
              A copy of the invoice will be attached as a reminder.
            </p>
            <p className="text-sm text-orange-700 mt-2">
              <strong>Outstanding:</strong> £{outstandingAmount.toFixed(2)} • <strong>Due:</strong> {dueDate.toLocaleDateString('en-GB')}
            </p>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end gap-4">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !recipientEmail}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Reminder
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}