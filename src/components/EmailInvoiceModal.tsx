'use client'

import { useEffect, useMemo, useState } from 'react'
import { sendInvoiceViaEmail } from '@/app/actions/email'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Send } from 'lucide-react'
import type { InvoiceWithDetails } from '@/types/invoices'
import { useSupabase } from '@/components/providers/SupabaseProvider'

interface EmailInvoiceModalProps {
  invoice: InvoiceWithDetails
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function EmailInvoiceModal({ invoice, isOpen, onClose, onSuccess }: EmailInvoiceModalProps) {
  const supabase = useSupabase()
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

  const vendorId = invoice.vendor?.id

  // Prefill with Primary contact + vendor email(s) when modal opens
  useEffect(() => {
    let active = true
    async function loadPrimary() {
      if (!isOpen || !vendorId) return
      const { data } = await supabase
        .from('invoice_vendor_contacts')
        .select('email')
        .eq('vendor_id', vendorId)
        .eq('is_primary', true)
        .maybeSingle()
      if (!active) return
      const parts = [(data as any)?.email, invoice.vendor?.email]
        .filter(Boolean)
        .flatMap(v => String(v).split(/[;,]/))
        .map(s => s.trim())
        .filter(Boolean)
      const unique = Array.from(new Set(parts))
      if (unique.length) setRecipientEmail(unique.join(', '))
    }
    loadPrimary()
    return () => { active = false }
  }, [isOpen, vendorId, supabase, invoice.vendor?.email])

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
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Email Invoice"
      size="lg"
      mobileFullscreen
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
          >
            Send Email
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert variant="error" description={error} />
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            To Email Address(es) <span className="text-red-500">*</span>
          </label>
          <Input
            type="text"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="customer@example.com, accounts@example.com"
            required
          />
          <p className="text-xs text-gray-500 mt-1">Separate multiple emails with commas or semicolons.</p>
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
            rows={10}
          />
        </div>

        <Alert variant="info"
          title="Attachment"
          description={`Invoice ${invoice.invoice_number} (PDF format) will be attached for professional presentation and easy printing.`}
        />
      </div>
    </Modal>
  )
}
