'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline'
import type { MessageTemplateRecord } from '@/app/actions/messageTemplates'
import {
  listMessageTemplates,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
  toggleMessageTemplate,
} from '@/app/actions/messageTemplates'
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Form } from '@/components/ui-v2/forms/Form'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import toast from 'react-hot-toast'
import { BackButton } from '@/components/ui-v2/navigation/BackButton'
import { useRouter } from 'next/navigation'

const TEMPLATE_TYPES: Record<string, string> = {
  booking_confirmation: 'Booking Confirmation',
  reminder_7_day: '7-Day Reminder',
  reminder_24_hour: '24-Hour Reminder',
  booking_reminder_confirmation: 'Booking Reminder Confirmation (0 tickets)',
  booking_reminder_7_day: '7-Day Booking Reminder (0 tickets)',
  booking_reminder_24_hour: '24-Hour Booking Reminder (0 tickets)',
  private_booking_created: 'Private Booking - Created',
  private_booking_deposit_received: 'Private Booking - Deposit Received',
  private_booking_final_payment: 'Private Booking - Final Payment',
  private_booking_reminder_14d: 'Private Booking - Reminder 14d',
  private_booking_balance_reminder: 'Private Booking - Balance Reminder',
  private_booking_reminder_1d: 'Private Booking - Reminder 1d',
  private_booking_date_changed: 'Private Booking - Date Changed',
  private_booking_confirmed: 'Private Booking - Confirmed',
  private_booking_cancelled: 'Private Booking - Cancelled',
  custom: 'Custom',
}

const AVAILABLE_VARIABLES: Record<string, string> = {
  customer_name: 'Customer full name',
  first_name: 'Customer first name',
  event_name: 'Event name',
  event_date: 'Event date (formatted)',
  event_time: 'Event time',
  seats: 'Number of tickets booked',
  venue_name: 'Venue name (The Anchor)',
  contact_phone: 'Contact phone number',
  booking_reference: 'Booking reference number',
}

const TIMING_OPTIONS: Record<string, string> = {
  immediate: 'Send immediately',
  '1_hour': '1 hour before event',
  '12_hours': '12 hours before event',
  '24_hours': '24 hours before event',
  '7_days': '7 days before event',
  custom: 'Custom timing',
}

type MessageTemplatesClientProps = {
  initialTemplates: MessageTemplateRecord[]
  canManage: boolean
  initialError: string | null
}

type TemplateFormData = {
  id?: string
  name: string
  description: string
  template_type: string
  content: string
  send_timing: 'immediate' | '1_hour' | '12_hours' | '24_hours' | '7_days' | 'custom'
  custom_timing_hours: number | null
}

export default function MessageTemplatesClient({ initialTemplates, canManage, initialError }: MessageTemplatesClientProps) {
  const router = useRouter()
  const [templates, setTemplates] = useState<MessageTemplateRecord[]>(initialTemplates)
  const [error, setError] = useState<string | null>(initialError)
  const [showForm, setShowForm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<MessageTemplateRecord | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplateRecord | null>(null)
  const [formData, setFormData] = useState<TemplateFormData>({
    name: '',
    description: '',
    template_type: 'custom',
    content: '',
    send_timing: 'immediate',
    custom_timing_hours: null,
  })
  const [preview, setPreview] = useState('')
  const [isRefreshing, startRefreshTransition] = useTransition()
  const [isMutating, startMutateTransition] = useTransition()

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      template_type: 'custom',
      content: '',
      send_timing: 'immediate',
      custom_timing_hours: null,
    })
    setPreview('')
  }

  const extractVariables = (content: string) => {
    const matches = content.match(/{{(\w+)}}/g) || []
    const variables = matches.map((match) => match.replace(/[{}]/g, ''))
    return Array.from(new Set(variables))
  }

  const updatePreview = (content: string) => {
    const sampleData: Record<string, string> = {
      customer_name: 'John Smith',
      first_name: 'John',
      event_name: 'Quiz Night',
      event_date: '25th December',
      event_time: '7:00 PM',
      seats: '4',
      venue_name: 'The Anchor',
      contact_phone: '+44 7700 900123',
      booking_reference: 'BK-12345',
    }

    let previewText = content
    Object.entries(sampleData).forEach(([key, value]) => {
      previewText = previewText.replace(new RegExp(`{{${key}}}`, 'g'), value)
    })
    setPreview(previewText)
  }

  const refreshTemplates = () => {
    startRefreshTransition(async () => {
      const result = await listMessageTemplates()
      if (result.error) {
        setError(result.error)
        return
      }
      setTemplates(result.templates ?? [])
      setError(null)
    })
  }

  const openNewTemplateModal = () => {
    resetForm()
    setEditingTemplate(null)
    setShowForm(true)
  }

  const editTemplate = (template: MessageTemplateRecord) => {
    setEditingTemplate(template)
    setFormData({
      id: template.id,
      name: template.name,
      description: template.description ?? '',
      template_type: template.template_type,
      content: template.content,
      send_timing: template.send_timing,
      custom_timing_hours: template.custom_timing_hours ?? null,
    })
    updatePreview(template.content)
    setShowForm(true)
  }

  const insertVariable = (variable: string) => {
    setFormData((prev) => {
      const textarea = document.getElementById('template-content') as HTMLTextAreaElement | null
      const content = prev.content
      if (!textarea) {
        const nextContent = `${content}{{${variable}}}`
        updatePreview(nextContent)
        return { ...prev, content: nextContent }
      }

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const before = content.substring(0, start)
      const after = content.substring(end)
      const nextContent = `${before}{{${variable}}}${after}`

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + variable.length + 4
        textarea.focus()
      }, 0)

      updatePreview(nextContent)
      return { ...prev, content: nextContent }
    })
  }

  const handleSave = () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      setError('Name and content are required')
      return
    }

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      template_type: formData.template_type,
      content: formData.content,
      send_timing: formData.send_timing,
      custom_timing_hours: formData.send_timing === 'custom' ? formData.custom_timing_hours ?? null : null,
    }

    startMutateTransition(async () => {
      const result = editingTemplate
        ? await updateMessageTemplate({ id: editingTemplate.id, ...payload })
        : await createMessageTemplate(payload)

      if ('error' in result && result.error) {
        setError(result.error)
        toast.error(result.error)
        return
      }

      if (!('success' in result) || !result.success) {
        setError('Unexpected response while saving the template')
        toast.error('Unexpected response while saving the template')
        return
      }

      toast.success(editingTemplate ? 'Template updated' : 'Template created')
      setShowForm(false)
      setEditingTemplate(null)
      resetForm()
      refreshTemplates()
    })
  }

  const handleDelete = (template: MessageTemplateRecord) => {
    setDeleteConfirm(template)
  }

  const confirmDelete = () => {
    if (!deleteConfirm) return
    startMutateTransition(async () => {
      const result = await deleteMessageTemplate(deleteConfirm.id)
      if ('error' in result && result.error) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success('Template deleted')
      setDeleteConfirm(null)
      refreshTemplates()
    })
  }

  const handleToggleActive = (template: MessageTemplateRecord) => {
    startMutateTransition(async () => {
      const result = await toggleMessageTemplate(template.id, !template.is_active)
      if ('error' in result && result.error) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      toast.success(`Template ${template.is_active ? 'deactivated' : 'activated'}`)
      refreshTemplates()
    })
  }

  useEffect(() => {
    updatePreview(formData.content)
  }, [formData.content])

  return (
    <Page
      title="Message Templates"
      description="Manage SMS templates for automated messages"
      actions={
        <div className="flex gap-2">
          <BackButton label="Back to Settings" onBack={() => router.push('/settings')} />
          {canManage && (
            <Button onClick={openNewTemplateModal}>
              <PlusIcon className="mr-2 h-4 w-4" />
              New Template
            </Button>
          )}
        </div>
      }
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'Message Templates' },
      ]}
    >
      {error && <Alert variant="error" title="Error" description={error} className="mb-4" />}

      <Section>
        <Card>
          {isRefreshing ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : templates.length === 0 ? (
            <EmptyState
              title="No templates yet"
              description="Create your first template to start automating messages."
              action={
                canManage ? (
                  <Button onClick={openNewTemplateModal}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    New Template
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="divide-y divide-gray-200">
              {templates.map((template) => (
                <div key={template.id} className="px-4 py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900">{template.name}</h3>
                        <Badge variant={template.is_active ? 'success' : 'warning'} size="sm">
                          {template.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        {template.is_default && (
                          <Badge variant="info" size="sm">
                            Default
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{TEMPLATE_TYPES[template.template_type] || template.template_type}</p>
                      {template.description && (
                        <p className="text-sm text-gray-500 mt-1">{template.description}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canManage && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            leftIcon={<PencilIcon className="h-4 w-4" />}
                            onClick={() => editTemplate(template)}
                            disabled={isMutating}
                          >
                            Edit
                          </Button>
                          {!template.is_default && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleToggleActive(template)}
                              disabled={isMutating}
                            >
                              {template.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
                          )}
                          {!template.is_default && (
                            <Button
                              variant="danger"
                              size="sm"
                              leftIcon={<TrashIcon className="h-4 w-4" />}
                              onClick={() => handleDelete(template)}
                              disabled={isMutating}
                            >
                              Delete
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-3">
                    <span>Variables: {template.variables.join(', ') || 'None'}</span>
                    <span>Segments: {template.estimated_segments ?? Math.ceil(template.content.length / 160)}</span>
                    <span>Timing: {TIMING_OPTIONS[template.send_timing] || template.send_timing}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title="Delete Template"
        message={`Are you sure you want to delete the "${deleteConfirm?.name}" template?`}
        confirmText="Delete"
        type="danger"
      />

      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false)
          setEditingTemplate(null)
          resetForm()
        }}
        title={editingTemplate ? 'Edit Template' : 'New Template'}
        size="lg"
      >
        <Form
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
        >
          <FormGroup label="Name" required>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </FormGroup>

          <FormGroup label="Description">
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </FormGroup>

          {!editingTemplate && (
            <FormGroup label="Type">
              <Select
                value={formData.template_type}
                onChange={(e) => setFormData({ ...formData, template_type: e.target.value })}
              >
                {Object.entries(TEMPLATE_TYPES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormGroup>
          )}

          <FormGroup label="Send Timing">
            <Select
              value={formData.send_timing}
              onChange={(e) =>
                setFormData({ ...formData, send_timing: e.target.value as TemplateFormData['send_timing'] })
              }
            >
              {Object.entries(TIMING_OPTIONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </FormGroup>

          {formData.send_timing === 'custom' && (
            <FormGroup label="Hours before event" help="Maximum 30 days (720 hours)">
              <Input
                type="number"
                min="1"
                max="720"
                value={formData.custom_timing_hours ?? ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    custom_timing_hours: e.target.value ? parseInt(e.target.value, 10) : null,
                  })
                }
                placeholder="Enter hours (1-720)"
              />
            </FormGroup>
          )}

          <FormGroup
            label="Template Content"
            help={`${formData.content.length} chars, ~${Math.ceil(Math.max(formData.content.length, 1) / 160)} segments`}
            required
          >
            <div className="mb-2 flex flex-wrap gap-1.5">
              {Object.entries(AVAILABLE_VARIABLES).map(([key, desc]) => (
                <Button
                  key={key}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => insertVariable(key)}
                  title={desc}
                >
                  {`{{${key}}}`}
                </Button>
              ))}
            </div>
            <Textarea
              id="template-content"
              value={formData.content}
              onChange={(e) => {
                setFormData({ ...formData, content: e.target.value })
                updatePreview(e.target.value)
              }}
              rows={8}
              required
            />
          </FormGroup>

          <Section title="Preview">
            <Card>
              <pre className="bg-gray-100 rounded-md p-3 text-sm whitespace-pre-wrap">
                {preview || 'Start typing to see preview...'}
              </pre>
            </Card>
          </Section>

          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowForm(false)
                setEditingTemplate(null)
                resetForm()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isMutating} loading={isMutating}>
              {editingTemplate ? 'Save Changes' : 'Create Template'}
            </Button>
          </div>
        </Form>
      </Modal>
    </Page>
  )
}
