'use client'

import { useEffect, useMemo, useState } from 'react'
import { sendChasePaymentEmail, getInvoiceEmailLogs } from '@/app/actions/email'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Send, Clock, AlertTriangle } from 'lucide-react'
import type { InvoiceWithDetails } from '@/types/invoices'
import { useSupabase } from '@/components/providers/SupabaseProvider'

interface ChasePaymentModalProps {
  invoice: InvoiceWithDetails
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function ChasePaymentModal({ invoice, isOpen, onClose, onSuccess }: ChasePaymentModalProps) {
  const supabase = useSupabase()
  // Separate To and CC fields for clarity
  const [toEmails, setToEmails] = useState('')
  const [ccEmails, setCcEmails] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastChaseDate, setLastChaseDate] = useState<string | null>(null)
  const [recentChaseWarning, setRecentChaseWarning] = useState<boolean>(false)
  
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

  // Load email logs
  useEffect(() => {
    if (!isOpen) return
    
    async function checkLogs() {
      const result = await getInvoiceEmailLogs(invoice.id)
      if (result.logs && result.logs.length > 0) {
        const lastLog = result.logs[0]
        setLastChaseDate(lastLog.created_at)
        
        // Check if less than 48 hours
        const lastDate = new Date(lastLog.created_at)
        const diffHours = (new Date().getTime() - lastDate.getTime()) / (1000 * 60 * 60)
        if (diffHours < 48) {
          setRecentChaseWarning(true)
        }
      }
    }
    checkLogs()
  }, [isOpen, invoice.id])

  // Prefill To with Primary contact, CC with all other contacts + vendor default emails (excluding Primary)
  useEffect(() => {
    let active = true
    async function loadPrimary() {
      const vendorId = invoice.vendor?.id
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
      const primaryEmail = ((contacts || []) as any[]).find((c: any) => c.is_primary)?.email || vendorEmails[0] || ''
      const all = Array.from(new Set([...vendorEmails, ...contactEmails]))
      const cc = all.filter(e => e && e !== primaryEmail)
      setToEmails(primaryEmail || '')
      setCcEmails(cc.join(', '))
    }
    loadPrimary()
    return () => { active = false }
  }, [isOpen, supabase, invoice.vendor?.id, invoice.vendor?.email])

  async function handleSend() {
    if (!toEmails) {
      setError('Please enter a recipient email address')
      return
    }

    setSending(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('invoiceId', invoice.id)
      // Combine To and CC for backend; it will split and place Primary in To
      const combined = [toEmails, ccEmails].filter(Boolean).join(', ')
      formData.append('recipientEmail', combined)
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
    } catch {
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
            disabled={!toEmails}
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

        {recentChaseWarning && lastChaseDate && (
          <Alert 
            variant="warning" 
            title="Recent Reminder Sent"
            description={`A payment reminder was already sent on ${new Date(lastChaseDate).toLocaleDateString('en-GB')} at ${new Date(lastChaseDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. Sending another one so soon might be aggressive.`}
            className="mb-4"
          />
        )}

        {error && (
          <Alert variant="error">{error}</Alert>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">To</label>
          <Input
            type="text"
            value={toEmails}
            onChange={(e) => setToEmails(e.target.value)}
            placeholder="primary.contact@example.com"
          />
          <p className="text-xs text-gray-500 mt-1">
            Primary recipient. Usually the vendor&apos;s primary contact.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">CC</label>
          <Input
            type="text"
            value={ccEmails}
            onChange={(e) => setCcEmails(e.target.value)}
            placeholder="accounts@example.com, ops@example.com"
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
