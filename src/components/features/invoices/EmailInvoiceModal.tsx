'use client'

import { useEffect, useMemo, useState } from 'react'
import { sendInvoiceViaEmail } from '@/app/actions/email'
import { Modal, Icon, Button, Input, Textarea, Field, Alert, toast } from '@/ds'
import type { InvoiceWithDetails } from '@/types/invoices'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import {
  buildDefaultInvoiceEmailDraft,
  invoiceCanOfferPayPal,
  PAY_ONLINE_POSTSCRIPT_NOTE,
} from '@/lib/invoices/email-drafts'

interface EmailInvoiceModalProps {
  invoice: InvoiceWithDetails
  /**
   * The first name to greet, resolved on the server (`getInvoiceEmailDraftContext`). The
   * contacts it comes from cannot be read from the browser by most staff, and the draft
   * must never fall back to the company name. Nothing means "Hi there".
   */
  greetingName?: string | null
  /** Set for an invoice that belongs to a private booking, so the draft names the booking. */
  privateHire?: { eventDate: string | null } | null
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function EmailInvoiceModal({ invoice, greetingName, privateHire, isOpen, onClose, onSuccess }: EmailInvoiceModalProps) {
  const supabase = useSupabase()
  const [toEmails, setToEmails] = useState('')
  const [ccEmails, setCcEmails] = useState('')
  // Rebuilt on every render and compared as text, so the draft follows anything the wording
  // quotes (number, reference, balance, credits, due date, greeting) without a list of
  // fields here to fall out of date.
  const { subject: defaultSubject, body: defaultBody } = buildDefaultInvoiceEmailDraft(invoice, greetingName, privateHire)
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState(defaultBody)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const vendorId = invoice.vendor?.id

  /**
   * The modal is rendered with an `isOpen` prop rather than being mounted on
   * demand, so it lives for the whole page and a `useState` initialiser runs
   * exactly once. That meant the draft text kept whatever the invoice totalled
   * when the page first loaded: reissue or edit an invoice, hit Email without
   * reloading, and the body quoted the OLD amount to the client while the
   * attached PDF showed the new one.
   *
   * Rebuilding whenever the dialog opens, and whenever a figure the text quotes
   * changes, keeps the body honest. Edits made while it is open survive, because
   * the default text does not move until the invoice itself does.
   */
  useEffect(() => {
    if (!isOpen) return
    setSubject(defaultSubject)
    setBody(defaultBody)
  }, [isOpen, defaultSubject, defaultBody])

  // Prefill To with Primary contact, CC with all other contacts + vendor default emails (excluding Primary)
  useEffect(() => {
    let active = true
    async function loadPrimary() {
      if (!isOpen || !vendorId) return
      const { data: contacts } = await supabase
        .from('invoice_vendor_contacts')
        .select('email, is_primary')
        .eq('vendor_id', vendorId)
        .order('is_primary', { ascending: false })
      if (!active) return
      const vendorEmails = (invoice.vendor?.email ? String(invoice.vendor.email).split(/[;,]/) : [])
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
  }, [isOpen, vendorId, supabase, invoice.vendor?.email])

  async function handleSend() {
    if (!toEmails && !ccEmails) {
      setError('Please enter a recipient email address')
      return
    }

    setSending(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      const combined = [toEmails, ccEmails].filter(Boolean).join(', ')
      formData.append('recipientEmail', combined)
      formData.append('subject', subject)
      formData.append('body', body)

      const result = await sendInvoiceViaEmail(formData)

      if (result.error) {
        throw new Error(result.error)
      }

      // The server treats an identical email within the hour as a duplicate and sends nothing.
      // That is right for a double click, but it used to close this dialog as a success, so a
      // deliberate resend of an unchanged draft silently did nothing.
      if ('deduplicated' in result && result.deduplicated) {
        throw new Error(
          'This exact email was already sent in the last hour, so it was not sent again. Change the wording to send it again now.'
        )
      }

      // The email has gone, so the dialog closes either way: leaving it open invites a
      // second send. A warning means something after the send did not save (the log, the
      // sent date, the status), and closing silently used to hide that.
      if ('warnings' in result && result.warnings && result.warnings.length > 0) {
        toast.warning(`Invoice emailed, but check this: ${result.warnings.join('. ')}`, { duration: 10000 })
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
      width="lg"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSend}
            disabled={!toEmails && !ccEmails}
            loading={sending}
            leftIcon={<Icon name="send" size={16} />}
          >
            Send Email
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert tone="danger">{error}</Alert>
        )}

        <Field label="To" required hint="Primary recipient. Usually the vendor's primary contact.">
          <Input
            type="text"
            value={toEmails}
            onChange={(e) => setToEmails(e.target.value)}
            placeholder="primary.contact@example.com"
            required
          />
        </Field>

        <Field label="CC" hint="Separate multiple emails with commas or semicolons.">
          <Input
            type="text"
            value={ccEmails}
            onChange={(e) => setCcEmails(e.target.value)}
            placeholder="accounts@example.com, ops@example.com"
          />
        </Field>

        <Input
          label="Subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />

        <Textarea
          label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          hint={invoiceCanOfferPayPal(invoice) ? PAY_ONLINE_POSTSCRIPT_NOTE : undefined}
        />

        <Alert tone="info"
          title="Attachment"
        >
          {`Invoice ${invoice.invoice_number} (PDF format) will be attached for professional presentation and easy printing.`}
        </Alert>
      </div>
    </Modal>
  )
}
