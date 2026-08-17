'use client'

import { useEffect, useState } from 'react'
import { sendQuoteViaEmail } from '@/app/actions/email'
import { Button, Modal, ModalActions, Input, Textarea, Alert, FormGroup } from '@/ds'
import { Send } from 'lucide-react'
import type { QuoteWithDetails } from '@/types/invoices'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import {
  buildDefaultQuoteEmailBody,
  buildDefaultQuoteEmailSubject,
} from '@/lib/invoices/email-drafts'

interface EmailQuoteModalProps {
  quote: QuoteWithDetails
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function EmailQuoteModal({ quote, isOpen, onClose, onSuccess }: EmailQuoteModalProps) {
  const supabase = useSupabase()
  const [toEmails, setToEmails] = useState('')
  const [ccEmails, setCcEmails] = useState('')
  const [subject, setSubject] = useState(() => buildDefaultQuoteEmailSubject(quote))
  const [body, setBody] = useState(() => buildDefaultQuoteEmailBody(quote))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Same trap as the invoice dialog: `useState` initialisers run once, and this
   * modal is rendered with an `isOpen` prop rather than mounted on demand, so
   * the draft text would keep whatever the quote totalled when the page loaded.
   * Rebuild it on open and whenever a quoted figure changes.
   */
  useEffect(() => {
    if (!isOpen) return
    setSubject(buildDefaultQuoteEmailSubject(quote))
    setBody(buildDefaultQuoteEmailBody(quote))
  }, [
    isOpen,
    quote.id,
    quote.quote_number,
    quote.total_amount,
    quote.valid_until,
    quote.notes,
    quote.vendor?.contact_name,
    quote.vendor?.name,
  ])

  // Prefill To with Primary contact, CC with all other contacts + vendor default emails (excluding Primary)
  useEffect(() => {
    if (!isOpen) {
      return
    }
    let active = true
    async function loadPrimary() {
      const vendorId = quote.vendor?.id
      if (!vendorId) return
      const { data: contacts } = await supabase
        .from('invoice_vendor_contacts')
        .select('email, is_primary')
        .eq('vendor_id', vendorId)
        .order('is_primary', { ascending: false })
      if (!active) return
      const vendorEmails = (quote.vendor?.email ? String(quote.vendor.email).split(/[;,]/) : [])
        .map(s => s.trim())
        .filter(Boolean)
      const contactEmails = (contacts || []).map((c: any) => c.email).filter(Boolean)
      const primaryEmail = ((contacts || [])).find((c: any) => c.is_primary)?.email || vendorEmails[0] || ''
      const all = Array.from(new Set([...vendorEmails, ...contactEmails]))
      const cc = all.filter(e => e && e !== primaryEmail)
      setToEmails(primaryEmail || '')
      setCcEmails(cc.join(', '))
    }
    loadPrimary()
    return () => { active = false }
  }, [isOpen, supabase, quote.vendor?.id, quote.vendor?.email])

  if (!isOpen) {
    return null
  }

  async function handleSend() {
    if (!toEmails && !ccEmails) {
      setError('Please enter a recipient email address')
      return
    }

    setSending(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('quoteId', quote.id)
      const combined = [toEmails, ccEmails].filter(Boolean).join(', ')
      formData.append('recipientEmail', combined)
      formData.append('subject', subject)
      formData.append('body', body)

      const result = await sendQuoteViaEmail(formData)

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
      title="Email Quote"
      size="lg"
      mobileFullscreen
    >

      <div className="space-y-4">
        {error && (
          <Alert variant="error">
            {error}
          </Alert>
        )}

        <FormGroup label="To" required>
          <Input
            type="text"
            value={toEmails}
            onChange={(e) => setToEmails(e.target.value)}
            placeholder="primary.contact@example.com"
            required
          />
          <p className="text-xs text-gray-500 mt-1">
            Primary recipient. Usually the vendor&apos;s primary contact.
          </p>
        </FormGroup>

        <FormGroup label="CC">
          <Input
            type="text"
            value={ccEmails}
            onChange={(e) => setCcEmails(e.target.value)}
            placeholder="accounts@example.com, ops@example.com"
          />
          <p className="text-xs text-gray-500 mt-1">Separate multiple emails with commas or semicolons.</p>
        </FormGroup>

        <FormGroup label="Subject">
          <Input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </FormGroup>

        <FormGroup label="Message">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
          />
        </FormGroup>

        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-600">
            <strong>Attachment:</strong> Quote {quote.quote_number} (PDF format)
          </p>
          <p className="text-sm text-gray-600 mt-1">
            The quote will be attached as a PDF file for professional presentation and easy printing.
          </p>
        </div>
      </div>

      <ModalActions>
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={sending}
        >
          Cancel
        </Button>
        <Button onClick={handleSend}
          disabled={!toEmails && !ccEmails}
          loading={sending}
          leftIcon={!sending && <Send className="h-4 w-4" />}
        >
          Send Email
        </Button>
      </ModalActions>
    </Modal>
  )
}
