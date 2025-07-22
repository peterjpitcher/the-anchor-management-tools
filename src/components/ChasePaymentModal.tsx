'use client'

import { useState } from 'react'
import { sendChasePaymentEmail } from '@/app/actions/email'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Send, Clock } from 'lucide-react'
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
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Chase Payment"
      size="lg"
      footer={
        <ModalActions>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button onClick={handleSend}
            disabled={!recipientEmail}
            loading={sending}
            leftIcon={<Send className="h-4 w-4" />}
            className="bg-orange-600 hover:bg-orange-700 focus:ring-orange-500"
          >
            Send Reminder
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-4">
        {/* Chase Payment Header */}
        <div className="flex items-center gap-3 pb-4 border-b">
          <Clock className="h-6 w-6 text-orange-600" />
          <div>
            <p className="text-sm text-gray-600">Invoice is {daysOverdue} {daysOverdue === 1 ? 'day' : 'days'} overdue</p>
          </div>
        </div>

        {error && (
          <Alert variant="error">{error}</Alert>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            Send to
          </label>
          <Input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="customer@example.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Subject
          </label>
          <Input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Message
          </label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
          />
        </div>

        <Alert variant="warning"
          title="Attachment"
          description={`Invoice ${invoice.invoice_number} (PDF format) will be attached as a reminder.`}
        >
          <p className="text-sm text-orange-700 mt-2">
            <strong>Outstanding:</strong> £{outstandingAmount.toFixed(2)} • <strong>Due:</strong> {dueDate.toLocaleDateString('en-GB')}
          </p>
        </Alert>
      </div>
    </Modal>
  )
}