'use client'

import { useState } from 'react'

import { Alert, Button, Field, Modal, Select, Textarea, toast } from '@/ds'
import { setContactEligibility } from '@/app/actions/marketing-contacts'
import type {
  BusinessContact,
  EligibilityStatus,
  MarketingBasis,
  SubscriberType,
} from '@/types/marketing'

import { MARKETING_BASIS_LABELS, SUBSCRIBER_TYPE_LABELS } from '../_shared/marketing-ui'

interface EligibilityModalProps {
  contact: BusinessContact
  onClose: () => void
  onSaved: () => void
}

const ELIGIBILITY_OPTIONS = [
  { value: 'eligible', label: 'Eligible, we can email them' },
  { value: 'excluded', label: 'Excluded, do not email them' },
  { value: 'pending_review', label: 'Leave waiting for review' },
]

const SUBSCRIBER_TYPE_OPTIONS = (['corporate', 'individual', 'unknown'] as SubscriberType[]).map(
  (value) => ({ value, label: SUBSCRIBER_TYPE_LABELS[value] }),
)

const BASIS_OPTIONS = [
  { value: '', label: 'Not chosen yet' },
  ...(['legitimate_interest', 'consent', 'soft_opt_in'] as MarketingBasis[]).map((value) => ({
    value,
    label: MARKETING_BASIS_LABELS[value],
  })),
]

export function EligibilityModal({ contact, onClose, onSaved }: EligibilityModalProps) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    eligibilityStatus: contact.eligibilityStatus as EligibilityStatus,
    subscriberType: contact.subscriberType,
    marketingBasis: contact.marketingBasis ?? '',
    basisEvidence: contact.basisEvidence ?? '',
    note: contact.eligibilityNote ?? '',
  })

  const markingEligible = form.eligibilityStatus === 'eligible'

  async function handleSave() {
    setSaving(true)
    const result = await setContactEligibility(contact.id, {
      eligibilityStatus: form.eligibilityStatus,
      subscriberType: form.subscriberType,
      marketingBasis: form.marketingBasis ? (form.marketingBasis as MarketingBasis) : null,
      basisEvidence: form.basisEvidence.trim() || null,
      note: form.note.trim() || null,
    })
    setSaving(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success('Eligibility saved.')
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Set eligibility"
      width="lg"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save eligibility
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="min-w-0">
          <p className="font-medium text-text break-all">{contact.email}</p>
          {contact.companyName && (
            <p className="text-sm text-text-muted">{contact.companyName}</p>
          )}
        </div>

        <Alert tone="info" title="Why we ask">
          A limited company can be emailed without asking first, a sole trader cannot, and the
          email address alone does not tell you which one you are looking at. Someone has to
          check and record what they found.
        </Alert>

        {contact.isFreemail && (
          <Alert tone="warning" title="This is a free-mail address">
            A Gmail or Outlook address is often a sole trader rather than a company. Worth a
            quick check before marking them eligible.
          </Alert>
        )}

        <Field label="Can we email them?">
          <Select
            options={ELIGIBILITY_OPTIONS}
            value={form.eligibilityStatus}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                eligibilityStatus: event.target.value as EligibilityStatus,
              }))
            }
            fullWidth
          />
        </Field>

        <Field label="What kind of subscriber is this?">
          <Select
            options={SUBSCRIBER_TYPE_OPTIONS}
            value={form.subscriberType}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                subscriberType: event.target.value as SubscriberType,
              }))
            }
            fullWidth
          />
        </Field>

        <Field
          label="On what basis?"
          hint="Legitimate interest suits a company we already deal with. Consent means they asked to hear from us."
        >
          <Select
            options={BASIS_OPTIONS}
            value={form.marketingBasis}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, marketingBasis: event.target.value }))
            }
            fullWidth
          />
        </Field>

        <Field
          label="Evidence"
          hint="Where the address came from and how you checked. For example: Companies House number 12345678, met at the Chamber of Commerce breakfast."
        >
          <Textarea
            value={form.basisEvidence}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, basisEvidence: event.target.value }))
            }
            rows={3}
            fullWidth
          />
        </Field>

        <Field label="Note" hint="Anything else the next person should know.">
          <Textarea
            value={form.note}
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
            rows={2}
            fullWidth
          />
        </Field>

        {markingEligible && (
          <p className="text-sm text-text-muted">
            Marking someone eligible means they can be included in a campaign audience. It does
            not email them on its own.
          </p>
        )}
      </div>
    </Modal>
  )
}
