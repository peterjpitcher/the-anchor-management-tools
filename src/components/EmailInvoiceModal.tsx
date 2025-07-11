'use client'

import { useState } from 'react'
import { sendInvoiceViaEmail } from '@/app/actions/email'
import { Button } from '@/components/ui/Button'
import { X, Send, Loader2 } from 'lucide-react'
import type { InvoiceWithDetails } from '@/types/invoices'

interface EmailInvoiceModalProps {
  invoice: InvoiceWithDetails
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function EmailInvoiceModal({ invoice, isOpen, onClose, onSuccess }: EmailInvoiceModalProps) {
  const [recipientEmail, setRecipientEmail] = useState(invoice.vendor?.email || '')
  const [subject, setSubject] = useState(`Invoice ${invoice.invoice_number} from Orange Jelly Limited`)
  const [body, setBody] = useState(
    `Hi ${invoice.vendor?.contact_name || invoice.vendor?.name || 'there'},

I hope you're doing well!

Please find attached invoice ${invoice.invoice_number} with the following details:

Amount Due: £${invoice.total_amount.toFixed(2)}
Due Date: ${new Date(invoice.due_date).toLocaleDateString('en-GB')}

${invoice.notes ? `${invoice.notes}\n\n` : ''}If you have any questions or need anything at all, just let me know - I'm always happy to help!

Many thanks,
Peter Pitcher
Orange Jelly Limited
07995087315

P.S. The invoice is attached as a PDF for easy viewing and printing.`
  )
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

      const result = await sendInvoiceViaEmail(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Email Invoice</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={sending}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">
              To Email Address <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="customer@example.com"
              required
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
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={10}
            />
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600">
              <strong>Attachment:</strong> Invoice {invoice.invoice_number} (PDF format)
            </p>
            <p className="text-sm text-gray-600 mt-1">
              The invoice will be attached as a PDF file for professional presentation and easy printing.
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
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Email
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}