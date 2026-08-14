'use client'

import { useState } from 'react'

import { Alert, Button, Field, Modal, Select, Textarea, toast } from '@/ds'
import { setContactEligibility, setContactEligibilityBulk } from '@/app/actions/marketing-contacts'
import { suggestSubscriberType } from '@/lib/email/marketing/subscriber-type'
import type {
  BusinessContact,
  EligibilityStatus,
  MarketingBasis,
  SubscriberType,
} from '@/types/marketing'

import { MARKETING_BASIS_LABELS, SUBSCRIBER_TYPE_LABELS } from '../_shared/marketing-ui'

interface EligibilityModalProps {
  /** One contact, or a selection being reviewed together. */
  contacts: BusinessContact[]
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

export function EligibilityModal({ contacts, onClose, onSaved }: EligibilityModalProps) {
  const [saving, setSaving] = useState(false)
  const isBulk = contacts.length > 1
  const contact = contacts[0]
  // A bulk review starts blank rather than inheriting the first contact's answers, so nobody
  // applies one row's evidence to thirty others without noticing.
  const [form, setForm] = useState({
    eligibilityStatus: (isBulk ? 'eligible' : contact.eligibilityStatus) as EligibilityStatus,
    subscriberType: isBulk ? ('corporate' as const) : contact.subscriberType,
    marketingBasis: isBulk ? '' : contact.marketingBasis ?? '',
    basisEvidence: isBulk ? '' : contact.basisEvidence ?? '',
    note: isBulk ? '' : contact.eligibilityNote ?? '',
  })
  const anyFreemail = contacts.some((item) => item.isFreemail)

  // Suggestions, not decisions. Shown with their reason so the reviewer can disagree.
  const suggestions = contacts.map((item) =>
    suggestSubscriberType({
      companyName: item.companyName,
      email: item.email,
      isFreemail: item.isFreemail,
    }),
  )
  const clearCorporate = suggestions.filter(
    (item) => item.suggestion === 'corporate' && item.confidence === 'high',
  ).length

  const markingEligible = form.eligibilityStatus === 'eligible'

  async function handleSave() {
    setSaving(true)
    const payload = {
      eligibilityStatus: form.eligibilityStatus,
      subscriberType: form.subscriberType,
      marketingBasis: form.marketingBasis ? (form.marketingBasis as MarketingBasis) : null,
      basisEvidence: form.basisEvidence.trim() || null,
      note: form.note.trim() || null,
    }

    const result = isBulk
      ? await setContactEligibilityBulk(contacts.map((item) => item.id), payload)
      : await setContactEligibility(contact.id, payload)
    setSaving(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    if (isBulk && result.data && 'failures' in result.data && result.data.failures.length) {
      toast.error(`${result.data.updated} updated, ${result.data.failures.length} could not be saved.`)
    } else {
      toast.success(isBulk ? `Eligibility saved for ${contacts.length} contacts.` : 'Eligibility saved.')
    }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isBulk ? `Set eligibility for ${contacts.length} contacts` : 'Set eligibility'}
      width="lg"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            {isBulk ? `Save for ${contacts.length} contacts` : 'Save eligibility'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="min-w-0">
          {isBulk ? (
            <p className="font-medium text-text">
              Applying one decision to {contacts.length} selected contacts.
            </p>
          ) : (
            <>
              <p className="font-medium text-text break-all">{contact.email}</p>
              {contact.companyName && (
                <p className="text-sm text-text-muted">{contact.companyName}</p>
              )}
            </>
          )}
        </div>

        {isBulk ? (
          clearCorporate > 0 && (
            <Alert tone="info" title="What the names suggest">
              {clearCorporate} of the {contacts.length} selected look like limited companies or
              public bodies, which can be emailed without asking first. The rest need a look.
              This is a hint from the company name only, so it is worth a glance before saving.
            </Alert>
          )
        ) : (
          <Alert
            tone={suggestions[0].confidence === 'high' ? 'info' : 'warning'}
            title={
              suggestions[0].suggestion === 'corporate'
                ? 'Suggested: a company'
                : 'Suggested: check this one'
            }
          >
            {suggestions[0].reason}
          </Alert>
        )}

        <Alert tone="info" title="Why we ask">
          A limited company can be emailed without asking first, a sole trader cannot, and the
          email address alone does not tell you which one you are looking at. Someone has to
          check and record what they found.
        </Alert>

        {anyFreemail && (
          <Alert tone="warning" title={isBulk ? 'Some of these are free-mail addresses' : 'This is a free-mail address'}>
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
