'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { MessageTemplateRecord } from '@/app/actions/messageTemplates'
import {
  listMessageTemplates,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
  toggleMessageTemplate,
} from '@/app/actions/messageTemplates'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  FormFooter,
  Icon,
  Input,
  Modal,
  PageLayout,
  PageLoading,
  Select,
  SubHeading,
  Textarea,
  toast,
} from '@/ds'
import { activeStateTone, DEFAULT_TEMPLATE_TONE } from '../_shared/status-ui'

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
  const [templates, setTemplates] = useState<MessageTemplateRecord[]>(initialTemplates)
  const [error, setError] = useState<string | null>(initialError)
  // A list that failed to load is an error, never shown as "no templates yet".
  const [loadFailed, setLoadFailed] = useState(initialError !== null)
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
        setLoadFailed(true)
        return
      }
      setTemplates(result.templates ?? [])
      setLoadFailed(false)
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

  const headerActions = canManage ? (
    <Button
      variant="primary"
      size="sm"
      onClick={openNewTemplateModal}
      icon={<Icon name="plus" size={16} />}
    >
      New Template
    </Button>
  ) : undefined

  return (
    <PageLayout
      title="Message Templates"
      subtitle="Reference copy only, not used when messages are sent"
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      headerActions={headerActions}
    >
      {error && <Alert tone="danger" title="Error">{error}</Alert>}

      {/*
        Nothing in the sending code reads the message_templates table: every
        SMS body is currently hard-coded in the send helpers. Editing here
        therefore changes nothing that a customer receives, and staff had no
        way of knowing that. Remove this notice when the send paths are wired
        up to read these rows.
      */}
      <Alert
        tone="warning"
        title="Editing these does not change the messages customers receive"
      >
        Message wording is currently set in code. These templates are kept as reference copy only, so changes saved here have no effect on live sends. Ask a developer if you need the wording of an automated message changed.
      </Alert>

      <Card padding="none">
        {isRefreshing ? (
          <PageLoading inline label="Loading templates" />
        ) : templates.length === 0 ? (
          loadFailed ? null : (
            <Empty
              size="sm"
              title="No templates yet"
              description="Create your first template to start automating messages."
              action={
                canManage ? (
                  <Button variant="primary" onClick={openNewTemplateModal} icon={<Icon name="plus" size={16} />}>
                    New Template
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <div className="divide-y divide-border">
            {templates.map((template) => (
              <div key={template.id} className="px-pad-card py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <SubHeading as="h3">{template.name}</SubHeading>
                      <Badge tone={activeStateTone(template.is_active)} size="sm">
                        {template.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      {template.is_default && (
                        <Badge tone={DEFAULT_TEMPLATE_TONE} size="sm">
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-text-muted">
                      {TEMPLATE_TYPES[template.template_type] || template.template_type}
                    </p>
                    {template.description && (
                      <p className="mt-1 text-sm text-text-muted">{template.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManage && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Icon name="edit" size={16} />}
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
                            icon={<Icon name="trash" size={16} />}
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

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-text-muted">
                  <span>Variables: {template.variables.join(', ') || 'None'}</span>
                  <span>
                    Segments: {template.estimated_segments ?? Math.ceil(template.content.length / 160)}
                  </span>
                  <span>Timing: {TIMING_OPTIONS[template.send_timing] || template.send_timing}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title="Delete Template"
        message={`Are you sure you want to delete the "${deleteConfirm?.name}" template?`}
        confirmLabel="Delete"
        tone="danger"
      />

      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false)
          setEditingTemplate(null)
          resetForm()
        }}
        title={editingTemplate ? 'Edit Template' : 'New Template'}
        width="lg"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
        >
          <Field label="Name" required>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </Field>

          <Field label="Description">
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </Field>

          {!editingTemplate && (
            <Field label="Type">
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
            </Field>
          )}

          <Field label="Send Timing">
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
          </Field>

          {formData.send_timing === 'custom' && (
            <Field label="Hours before event" hint="Maximum 30 days (720 hours)">
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
            </Field>
          )}

          <Field
            label="Template Content"
            htmlFor="template-content"
            hint={`${formData.content.length} chars, ~${Math.ceil(Math.max(formData.content.length, 1) / 160)} segments`}
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
          </Field>

          <Field label="Preview">
            <pre className="whitespace-pre-wrap rounded-default bg-surface-2 p-3 text-sm">
              {preview || 'Start typing to see preview...'}
            </pre>
          </Field>

          <FormFooter>
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
            <Button type="submit" variant="primary" disabled={isMutating} loading={isMutating}>
              {editingTemplate ? 'Save Changes' : 'Create Template'}
            </Button>
          </FormFooter>
        </form>
      </Modal>
    </PageLayout>
  )
}
