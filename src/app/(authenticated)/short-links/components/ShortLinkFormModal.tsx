'use client'

import { useState, useEffect } from 'react'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { createShortLink, updateShortLink } from '@/app/actions/short-links'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import toast from 'react-hot-toast'
import type { ShortLink } from '@/types/short-links'

const ALLOWED_LINK_TYPES = new Set([
  'custom',
  'booking_confirmation',
  'event_checkin',
  'loyalty_portal',
  'promotion',
  'reward_redemption',
])

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: (result: any) => void
  link?: ShortLink | null // If provided, we are editing
  canManage: boolean
}

export function ShortLinkFormModal({ open, onClose, onSuccess, link, canManage }: Props) {
  const [name, setName] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [linkType, setLinkType] = useState('custom')
  const [customCode, setCustomCode] = useState('')
  const [hasExpiry, setHasExpiry] = useState(false)
  const [expiryValue, setExpiryValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [existingLinkUrl, setExistingLinkUrl] = useState<string | null>(null)

  // Reset or populate form when opening/changing link
  useEffect(() => {
    if (open) {
      if (link) {
        // Edit mode
        setName(link.name || '')
        setDestinationUrl(link.destination_url)
        setLinkType(ALLOWED_LINK_TYPES.has(link.link_type) ? link.link_type : 'custom')
        setCustomCode(link.short_code)

        if (link.expires_at) {
          setHasExpiry(true)
          const d = new Date(link.expires_at)
          setExpiryValue(d.toISOString().slice(0, 16))
        } else {
          setHasExpiry(false)
          setExpiryValue('')
        }
      } else {
        // Create mode
        resetForm()
      }
    }
  }, [open, link])

  const resetForm = () => {
    setName('')
    setDestinationUrl('')
    setCustomCode('')
    setLinkType('custom')
    setHasExpiry(false)
    setExpiryValue('')
    setFormError(null)
    setExistingLinkUrl(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    setExistingLinkUrl(null)

    try {
      const expiresAt = hasExpiry && expiryValue ? new Date(expiryValue).toISOString() : undefined

      let result
      if (link) {
        result = await updateShortLink({
          id: link.id,
          name: name || null,
          destination_url: destinationUrl,
          link_type: linkType as any,
          expires_at: expiresAt
        })
      } else {
        result = await createShortLink({
          name: name || undefined,
          destination_url: destinationUrl,
          link_type: linkType as any,
          custom_code: customCode || undefined,
          expires_at: expiresAt
        })
      }

      if (!result || 'error' in result) {
        const errorMsg = result?.error || `Failed to ${link ? 'update' : 'create'} short link`
        // Show inline error instead of toast for better UX
        setFormError(errorMsg)
        return
      }

      const alreadyExists = !link && !!result.data?.already_exists
      if (alreadyExists && result.data?.full_url) {
        // Link already exists — show it to the user, copy to clipboard, close the modal
        const url = result.data.full_url
        toast.success(`Link already exists: ${url.replace(/^https?:\/\//, '')}`)
        try {
          await navigator.clipboard.writeText(url)
          toast.success('Copied to clipboard!')
        } catch {
          // Ignore clipboard errors
        }
        onSuccess(result)
        onClose()
        return
      }

      toast.success(link ? 'Short link updated' : 'Short link created')

      if (!link && result.data?.full_url) {
        try {
          await navigator.clipboard.writeText(result.data.full_url)
          toast.success('Copied to clipboard!')
        } catch {
          // Ignore clipboard errors
        }
      }

      onSuccess(result)
      onClose()
    } catch (error) {
      console.error(`Failed to ${link ? 'update' : 'create'} short link`, error)
      setFormError(`Failed to ${link ? 'update' : 'create'} short link. Please try again.`)
    } finally {
      setSubmitting(false)
    }
  }

  if (!canManage) {
    return (
      <Modal open={open} onClose={onClose} title={link ? 'Edit Short Link' : 'Create Short Link'}>
        <EmptyState
            title="Insufficient permissions"
            description={`You do not have permission to ${link ? 'edit' : 'create'} short links.`}
        />
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={link ? 'Edit Short Link' : 'Create Short Link'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormGroup label="Name (optional)">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Friendly name for this link"
          />
        </FormGroup>

        <FormGroup label="Destination URL" required>
          <Input
            type="url"
            value={destinationUrl}
            onChange={(e) => { setDestinationUrl(e.target.value); setFormError(null) }}
            required
            placeholder="https://"
          />
        </FormGroup>

        <FormGroup label="Link Type">
          <Select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
            <option value="custom">Custom</option>
            <option value="booking_confirmation">Booking Confirmation</option>
            <option value="event_checkin">Event Check-in</option>
            <option value="loyalty_portal">Loyalty Portal</option>
            <option value="promotion">Promotion</option>
            <option value="reward_redemption">Reward Redemption</option>
          </Select>
        </FormGroup>

        {!link && (
            <FormGroup label="Custom Code (optional)">
            <Input
                value={customCode}
                onChange={(e) => { setCustomCode(e.target.value); setFormError(null) }}
                placeholder="Leave blank for auto-generated code"
            />
            </FormGroup>
        )}

        {link && (
            <FormGroup label="Short Code">
                <Input value={customCode} disabled className="bg-gray-100" />
                <p className="text-xs text-gray-500 mt-1">Short codes cannot be changed after creation.</p>
            </FormGroup>
        )}

        <FormGroup label="Expires">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasExpiry}
                onChange={(e) => {
                  setHasExpiry(e.target.checked)
                  if (!e.target.checked) setExpiryValue('')
                }}
                className="rounded border-gray-300"
              />
              Set expiry date
            </label>
          </div>
          {hasExpiry && (
            <Input
              type="datetime-local"
              value={expiryValue}
              onChange={(e) => setExpiryValue(e.target.value)}
              className="mt-2"
            />
          )}
        </FormGroup>

        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}

        <ModalActions>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" loading={submitting} disabled={!destinationUrl}>
            {link ? 'Save Changes' : 'Create Link'}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  )
}
