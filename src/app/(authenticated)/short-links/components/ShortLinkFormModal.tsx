'use client'

import { useState, useEffect } from 'react'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { createShortLink, updateShortLink } from '@/app/actions/short-links'
import toast from 'react-hot-toast'

interface ShortLink {
  id: string
  name?: string | null
  short_code: string
  destination_url: string
  link_type: string
  click_count: number
  created_at: string
  expires_at: string | null
  last_clicked_at: string | null
}

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
  const [expiresIn, setExpiresIn] = useState('never')
  const [submitting, setSubmitting] = useState(false)

  // Reset or populate form when opening/changing link
  useEffect(() => {
    if (open) {
      if (link) {
        // Edit mode
        setName(link.name || '')
        setDestinationUrl(link.destination_url)
        setLinkType(link.link_type)
        setCustomCode(link.short_code)

        if (link.expires_at) {
          const expiryDate = new Date(link.expires_at)
          const now = new Date()
          const diffDays = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          if (diffDays <= 1) setExpiresIn('1d')
          else if (diffDays <= 7) setExpiresIn('7d')
          else if (diffDays <= 30) setExpiresIn('30d')
          else setExpiresIn('never')
        } else {
          setExpiresIn('never')
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
    setExpiresIn('never')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      let expiresAt: string | undefined | null = null
      if (expiresIn !== 'never') {
        const date = new Date()
        if (expiresIn === '1d') date.setDate(date.getDate() + 1)
        else if (expiresIn === '7d') date.setDate(date.getDate() + 7)
        else if (expiresIn === '30d') date.setDate(date.getDate() + 30)
        expiresAt = date.toISOString()
      }

      let result
      if (link) {
        // Update
        result = await updateShortLink({
          id: link.id,
          name: name || null,
          destination_url: destinationUrl,
          link_type: linkType as any,
          expires_at: expiresAt
        })
      } else {
        // Create
        result = await createShortLink({
          name: name || undefined,
          destination_url: destinationUrl,
          link_type: linkType as any,
          custom_code: customCode || undefined,
          expires_at: expiresAt as string | undefined
        })
      }

      if (!result || 'error' in result) {
        toast.error(result?.error || `Failed to ${link ? 'update' : 'create'} short link`)
        return
      }

      toast.success(`Short link ${link ? 'updated' : 'created'}`)
      
      // Special handling for create: copy to clipboard if available
      if (!link && result.data?.full_url && navigator.clipboard) {
         try {
            await navigator.clipboard.writeText(result.data.full_url)
            toast.success('Copied to clipboard!')
         } catch (e) {
             // Ignore clipboard errors
         }
      }

      onSuccess(result)
      onClose()
    } catch (error) {
      console.error(`Failed to ${link ? 'update' : 'create'} short link`, error)
      toast.error(`Failed to ${link ? 'update' : 'create'} short link`)
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
            onChange={(e) => setDestinationUrl(e.target.value)}
            required
            placeholder="https://"
          />
        </FormGroup>

        <FormGroup label="Link Type">
          <Select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
            <option value="custom">Custom</option>
            <option value="event_checkin">Event Check-in</option>
            <option value="promotion">Promotion</option>
            <option value="reward_redemption">Reward Redemption</option>
          </Select>
        </FormGroup>

        {!link && (
            <FormGroup label="Custom Code (optional)">
            <Input
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
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
          <Select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
            <option value="never">Never</option>
            <option value="1d">In 1 day</option>
            <option value="7d">In 7 days</option>
            <option value="30d">In 30 days</option>
          </Select>
        </FormGroup>

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
