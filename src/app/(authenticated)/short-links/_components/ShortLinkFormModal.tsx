'use client'

import { useState, useEffect } from 'react'
import { Modal, Button, Field, Input, Select, Alert } from '@/ds'
import { createShortLink, updateShortLink } from '@/app/actions/short-links'
import toast from 'react-hot-toast'
import { applyUtmParams } from './utm-url'
import type { ShortLink } from '@/types/short-links'

const LINK_TYPE_OPTIONS = [
  { value: 'custom', label: 'Custom' },
  { value: 'booking_confirmation', label: 'Booking Confirmation' },
  { value: 'event_checkin', label: 'Event Check-in' },
  { value: 'loyalty_portal', label: 'Loyalty Portal' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'reward_redemption', label: 'Reward Redemption' },
]

interface Props {
  open: boolean
  onClose: () => void
  link?: ShortLink | null
  onSave: () => void
}

export function ShortLinkFormModal({ open, onClose, link, onSave }: Props) {
  const [name, setName] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [linkType, setLinkType] = useState('custom')
  const [customCode, setCustomCode] = useState('')
  const [utmSource, setUtmSource] = useState('')
  const [utmMedium, setUtmMedium] = useState('')
  const [utmCampaign, setUtmCampaign] = useState('')
  const [showUtm, setShowUtm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const populateUtmFields = (url: string) => {
    try {
      const parsed = new URL(url)
      const source = parsed.searchParams.get('utm_source') || ''
      const medium = parsed.searchParams.get('utm_medium') || ''
      const campaign = parsed.searchParams.get('utm_campaign') || ''
      setUtmSource(source)
      setUtmMedium(medium)
      setUtmCampaign(campaign)
      setShowUtm(Boolean(source || medium || campaign))
    } catch {
      setUtmSource('')
      setUtmMedium('')
      setUtmCampaign('')
      setShowUtm(false)
    }
  }

  const buildSubmittedDestinationUrl = () =>
    applyUtmParams(destinationUrl, { source: utmSource, medium: utmMedium, campaign: utmCampaign }, showUtm)

  useEffect(() => {
    if (open) {
      if (link) {
        setName(link.name || '')
        setDestinationUrl(link.destination_url)
        setLinkType(link.link_type || 'custom')
        setCustomCode(link.short_code)
        populateUtmFields(link.destination_url)
      } else {
        setName('')
        setDestinationUrl('')
        setLinkType('custom')
        setCustomCode('')
        setUtmSource('')
        setUtmMedium('')
        setUtmCampaign('')
        setShowUtm(false)
      }
      setFormError(null)
    }
  }, [open, link])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // The footer submit button sits outside the <form>, so the input's own
    // type="url" validation never runs — validate here instead.
    try {
      new URL(destinationUrl)
    } catch {
      setFormError('Enter a full URL starting with https://')
      return
    }

    setSubmitting(true)
    setFormError(null)

    try {
      const submittedDestinationUrl = buildSubmittedDestinationUrl()
      if (link) {
        const result = await updateShortLink({
          id: link.id,
          name: name || null,
          destination_url: submittedDestinationUrl,
          link_type: linkType as 'custom',
        })
        if (!result || 'error' in result) {
          setFormError(result?.error || 'Failed to update')
          return
        }
        toast.success('Short link updated')
      } else {
        const result = await createShortLink({
          name: name || undefined,
          destination_url: submittedDestinationUrl,
          link_type: linkType as 'custom',
          custom_code: customCode || undefined,
        })
        if (!result || 'error' in result) {
          setFormError(result?.error || 'Failed to create')
          return
        }
        let successMessage = 'Short link created'
        if (result.data?.full_url) {
          try {
            await navigator.clipboard.writeText(result.data.full_url)
            successMessage = 'Link created and copied!'
          } catch {
            // Clipboard access is best-effort — the link was still created
          }
        }
        toast.success(successMessage)
      }
      onSave()
      onClose()
    } catch {
      setFormError('An unexpected error occurred')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={link ? 'Edit Short Link' : 'Create Short Link'}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={!destinationUrl}>
            {link ? 'Save Changes' : 'Create Link'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Destination URL" required>
          <Input
            type="url"
            value={destinationUrl}
            onChange={(e) => { setDestinationUrl(e.target.value); setFormError(null) }}
            placeholder="https://..."
          />
        </Field>

        <Field label="Name (optional)">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Friendly name for this link"
          />
        </Field>

        {!link && (
          <Field label="Custom slug (optional)">
            <Input
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              placeholder="Leave blank for auto-generated"
            />
          </Field>
        )}

        <Field label="Link Type">
          <Select
            options={LINK_TYPE_OPTIONS}
            value={linkType}
            onChange={(e) => setLinkType(e.target.value)}
          />
        </Field>

        {/* UTM section */}
        <div>
          <button
            type="button"
            onClick={() => setShowUtm(!showUtm)}
            className="text-xs text-primary hover:underline"
          >
            {showUtm ? 'Hide UTM parameters' : 'Add UTM parameters'}
          </button>
          {showUtm && (
            <div className="mt-3 space-y-3 p-3 bg-surface-2 rounded-lg">
              <Field label="UTM Source">
                <Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} placeholder="e.g. facebook" />
              </Field>
              <Field label="UTM Medium">
                <Input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} placeholder="e.g. social" />
              </Field>
              <Field label="UTM Campaign">
                <Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="e.g. summer-promo" />
              </Field>
            </div>
          )}
        </div>

        {formError && (
          <Alert tone="danger">{formError}</Alert>
        )}
      </form>
    </Modal>
  )
}
