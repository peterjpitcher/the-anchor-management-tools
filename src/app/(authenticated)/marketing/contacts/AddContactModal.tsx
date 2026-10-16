'use client'

import { useState } from 'react'

import { Alert, Button, Input, Modal, Textarea, toast } from '@/ds'
import { createBusinessContact } from '@/app/actions/marketing-contacts'

import { EMAIL_PATTERN, isFreemail } from './ImportModal'

interface AddContactModalProps {
  onClose: () => void
  onAdded: () => void
}

const EMPTY_FORM = {
  email: '',
  contactName: '',
  companyName: '',
  jobTitle: '',
  tags: '',
  notes: '',
}

/**
 * Adds one business contact by hand. Like an import, the contact arrives waiting for
 * eligibility review, so nobody can be emailed straight from this form.
 */
export function AddContactModal({ onClose, onAdded }: AddContactModalProps) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const email = form.email.trim()
  const freemailWarning =
    email && EMAIL_PATTERN.test(email) && isFreemail(email)
      ? 'This looks like a personal address. Contacts here should be business addresses.'
      : undefined

  function update(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (field === 'email') setEmailError(null)
    setSaveError(null)
  }

  async function handleSave(event?: React.FormEvent) {
    event?.preventDefault()
    if (saving) return

    if (!email) {
      setEmailError('Enter an email address.')
      return
    }
    if (!EMAIL_PATTERN.test(email)) {
      setEmailError('Enter a valid email address, like name@company.co.uk.')
      return
    }

    setSaving(true)
    let result: Awaited<ReturnType<typeof createBusinessContact>>
    try {
      result = await createBusinessContact({
        email,
        contactName: form.contactName.trim() || null,
        companyName: form.companyName.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        notes: form.notes.trim() || null,
      })
    } catch {
      result = { error: 'Could not reach the server. Check your connection and try again.' }
    }
    setSaving(false)

    if (result.error || !result.data) {
      setSaveError(result.error ?? 'The contact was not added. Try again.')
      return
    }

    toast.success(`${result.data.email} added. Review their eligibility before emailing them.`)
    onAdded()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Contact"
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => handleSave()} loading={saving}>
            Add Contact
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSave} noValidate>
        <p className="text-sm text-text-muted">
          Business contacts only. A new contact waits for eligibility review, and cannot be
          emailed until that review is done.
        </p>

        {saveError && (
          <Alert tone="danger" size="sm" title="Contact not added">
            <span className="break-words">{saveError}</span>
          </Alert>
        )}

        <Input
          label="Email address"
          type="email"
          autoComplete="off"
          required
          value={form.email}
          error={emailError ?? undefined}
          warning={freemailWarning}
          onChange={(event) => update('email', event.target.value)}
          fullWidth
        />
        <Input
          label="Contact name"
          value={form.contactName}
          onChange={(event) => update('contactName', event.target.value)}
          fullWidth
        />
        <Input
          label="Company name"
          value={form.companyName}
          onChange={(event) => update('companyName', event.target.value)}
          fullWidth
        />
        <Input
          label="Job title"
          value={form.jobTitle}
          onChange={(event) => update('jobTitle', event.target.value)}
          fullWidth
        />
        <Input
          label="Tags"
          hint="Separate tags with commas. Tags decide who a campaign goes to."
          value={form.tags}
          onChange={(event) => update('tags', event.target.value)}
          fullWidth
        />
        <Textarea
          label="Notes"
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          fullWidth
        />
      </form>
    </Modal>
  )
}
