'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
// New UI components
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
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { useRouter } from 'next/navigation';
interface MessageTemplate {
  id: string
  name: string
  message: string | null
  template_type: 'booking_confirmation' | 'reminder_7_day' | 'reminder_24_hour' | 'booking_reminder_confirmation' | 'booking_reminder_7_day' | 'booking_reminder_24_hour' | 'custom'
  content: string
  variables: string[]
  is_default: boolean
  is_active: boolean
  character_badge: number
  estimated_segments: number
  send_timing?: 'immediate' | '1_hour' | '12_hours' | '24_hours' | '7_days' | 'custom'
  custom_timing_hours?: number | null
}

const TEMPLATE_TYPES = {
  booking_confirmation: 'Booking Confirmation',
  reminder_7_day: '7-Day Reminder',
  reminder_24_hour: '24-Hour Reminder',
  booking_reminder_confirmation: 'Booking Reminder Confirmation (0 seats)',
  booking_reminder_7_day: '7-Day Booking Reminder (0 seats)',
  booking_reminder_24_hour: '24-Hour Booking Reminder (0 seats)',
  custom: 'Custom'
}

const AVAILABLE_VARIABLES = {
  customer_name: 'Customer full name',
  first_name: 'Customer first name',
  event_name: 'Event name',
  event_date: 'Event date (formatted)',
  event_time: 'Event time',
  seats: 'Number of seats booked',
  venue_name: 'Venue name (The Anchor)',
  contact_phone: 'Contact phone number',
  booking_reference: 'Booking reference number'
}

const TIMING_OPTIONS = {
  immediate: 'Send immediately',
  '1_hour': '1 hour before event',
  '12_hours': '12 hours before event',
  '24_hours': '24 hours before event',
  '7_days': '7 days before event',
  custom: 'Custom timing'
}

export default function MessageTemplatesPage() {
  
  const router = useRouter();
const supabase = useSupabase()
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<MessageTemplate | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    template_type: 'custom' as 'booking_confirmation' | 'reminder_7_day' | 'reminder_24_hour' | 'booking_reminder_confirmation' | 'booking_reminder_7_day' | 'booking_reminder_24_hour' | 'custom',
    content: '',
    variables: [] as string[],
    send_timing: 'immediate' as 'immediate' | '1_hour' | '12_hours' | '24_hours' | '7_days' | 'custom',
    custom_timing_hours: null as number | null
  })
  const [preview, setPreview] = useState('')

  const loadTemplates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .order('template_type')
        .order('is_default', { ascending: false })

      if (error) throw error
      setTemplates(data || [])
    } catch (error) {
      console.error('Error loading templates:', error)
      toast.error('Failed to load message templates')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  const updatePreview = useCallback(() => {
    let preview = formData.content
    const sampleData: Record<string, string> = {
      customer_name: 'John Smith',
      first_name: 'John',
      event_name: 'Quiz Night',
      event_date: '25th December',
      event_time: '7:00 PM',
      seats: '4',
      venue_name: 'The Anchor',
      contact_phone: '+44 7700 900123',
      booking_reference: 'BK-12345'
    }

    Object.entries(sampleData).forEach(([key, value]) => {
      preview = preview.replace(new RegExp(`{{${key}}}`, 'g'), value)
    })

    setPreview(preview)
  }, [formData.content])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    updatePreview()
  }, [updatePreview])

  async function handleSave() {
    try {
      if (editingTemplate) {
        const { error } = await (supabase
          .from('message_templates') as any)
          .update({
            name: formData.name,
            description: formData.description,
            content: formData.content,
            variables: extractVariables(formData.content),
            send_timing: formData.send_timing,
            custom_timing_hours: formData.send_timing === 'custom' ? formData.custom_timing_hours : null
          })
          .eq('id', editingTemplate.id)

        if (error) throw error
        toast.success('Template updated successfully')
      } else {
        const { error } = await (supabase
          .from('message_templates') as any)
          .insert({
            name: formData.name,
            description: formData.description,
            template_type: formData.template_type,
            content: formData.content,
            variables: extractVariables(formData.content),
            is_default: false,
            send_timing: formData.send_timing,
            custom_timing_hours: formData.send_timing === 'custom' ? formData.custom_timing_hours : null
          })

        if (error) throw error
        toast.success('Template created successfully')
      }

      setShowForm(false)
      setEditingTemplate(null)
      resetForm()
      await loadTemplates()
    } catch (error) {
      console.error('Error saving template:', error)
      toast.error('Failed to save template')
    }
  }

  async function handleDelete(template: MessageTemplate) {
    try {
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', template.id)

      if (error) throw error
      toast.success('Template deleted successfully')
      setDeleteConfirm(null)
      await loadTemplates()
    } catch (error) {
      console.error('Error deleting template:', error)
      toast.error('Failed to delete template')
    }
  }

  async function toggleActive(template: MessageTemplate) {
    try {
      const { error } = await (supabase
        .from('message_templates') as any)
        .update({ is_active: !template.is_active })
        .eq('id', template.id)

      if (error) throw error
      toast.success(`Template ${template.is_active ? 'deactivated' : 'activated'}`)
      await loadTemplates()
    } catch (error) {
      console.error('Error toggling template:', error)
      toast.error('Failed to update template')
    }
  }

  function extractVariables(content: string): string[] {
    const matches = content.match(/{{(\w+)}}/g) || []
    const variables = matches.map(match => match.replace(/[{}]/g, ''))
    return [...new Set(variables)]
  }

  function resetForm() {
    setFormData({
      name: '',
      description: '',
      template_type: 'custom' as 'booking_confirmation' | 'reminder_7_day' | 'reminder_24_hour' | 'booking_reminder_confirmation' | 'booking_reminder_7_day' | 'booking_reminder_24_hour' | 'custom',
      content: '',
      variables: [],
      send_timing: 'immediate',
      custom_timing_hours: null
    })
  }

  function editTemplate(template: MessageTemplate) {
    setFormData({
      name: template.name,
      description: template.message || '',
      template_type: template.template_type,
      content: template.content,
      variables: template.variables,
      send_timing: template.send_timing || 'immediate',
      custom_timing_hours: template.custom_timing_hours || null
    })
    setEditingTemplate(template)
    setShowForm(true)
  }

  function insertVariable(variable: string) {
    const textarea = document.getElementById('template-content') as HTMLTextAreaElement
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = formData.content
    const before = text.substring(0, start)
    const after = text.substring(end, text.length)
    
    setFormData({
      ...formData,
      content: before + `{{${variable}}}` + after
    })
    
    // Reset cursor position
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + variable.length + 4
      textarea.focus()
    }, 0)
  }

  if (loading) {
    return (
      <Page title="Message Templates"
      actions={<BackButton label="Back to Settings" onBack={() => router.push('/settings')} />}
    >
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Spinner size="lg" />
            <p className="mt-4 text-gray-600">Loading templates...</p>
          </div>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="Message Templates"
      description="Manage SMS templates for automated messages"
      actions={
        <Button
          onClick={() => {
            resetForm()
            setEditingTemplate(null)
            setShowForm(true)
          }}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          New Template
        </Button>
      }
    >

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        title="Delete Template"
        message={`Are you sure you want to delete the "${deleteConfirm?.name}" template?`}
        confirmText="Delete"
        type="danger"
      />

      {/* Template Form Modal */}
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
        <Form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>

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
                onChange={(e) => setFormData({ ...formData, template_type: e.target.value as MessageTemplate['template_type'] })}
              >
                {Object.entries(TEMPLATE_TYPES).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </FormGroup>
          )}

          <FormGroup label="Send Timing">
            <Select
              value={formData.send_timing}
              onChange={(e) => setFormData({ ...formData, send_timing: e.target.value as 'immediate' | '1_hour' | '12_hours' | '24_hours' | '7_days' | 'custom' })}
            >
              {Object.entries(TIMING_OPTIONS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </FormGroup>

          {formData.send_timing === 'custom' && (
            <FormGroup
              label="Hours before event"
              help="Maximum 30 days (720 hours)"
            >
              <Input
                type="number"
                min="1"
                max="720"
                value={formData.custom_timing_hours || ''}
                onChange={(e) => setFormData({ ...formData, custom_timing_hours: e.target.value ? parseInt(e.target.value) : null })}
                placeholder="Enter hours (1-720)"
              />
            </FormGroup>
          )}

          <FormGroup
            label="Template Content"
            help={`${formData.content.length} chars, ~${Math.ceil(formData.content.length / 160)} segments`}
            required
          >
            {/* Variable buttons */}
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
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              rows={6}
              required
            />
          </FormGroup>

          <FormGroup label="Preview">
            <div className="p-4 bg-gray-100 rounded-md">
              <p className="text-sm whitespace-pre-wrap">{preview}</p>
            </div>
          </FormGroup>

          <div className="flex justify-end space-x-3 pt-4">
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
            <Button type="submit">
              {editingTemplate ? 'Update' : 'Create'} Template
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Templates List */}
      {Object.entries(TEMPLATE_TYPES).map(([type, label]) => {
        const typeTemplates = templates.filter(t => t.template_type === type)
        if (typeTemplates.length === 0 && type === 'custom') return null

        return (
          <Section key={type} title={label}>
            <Card>
                
              {typeTemplates.length === 0 ? (
                <EmptyState
                  title="No templates configured"
                  description="Create a template to get started"
                />
              ) : (
                <div className="space-y-4">
                  {typeTemplates.map((template) => (
                    <div
                      key={template.id}
                      className={`border rounded-lg p-4 ${
                        !template.is_active ? 'bg-gray-50 opacity-60' : ''
                      }`}
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-base">
                              {template.name}
                            </h4>
                            {template.is_default && (
                              <Badge variant="success" size="sm">
                                Default
                              </Badge>
                            )}
                          </div>
                          {template.message && (
                            <p className="text-sm text-gray-500 mt-1">{template.message}</p>
                          )}
                          <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded overflow-x-auto">
                            {template.content}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
                            <span>{template.character_badge} chars</span>
                            <span>{template.estimated_segments} segment{template.estimated_segments !== 1 ? 's' : ''}</span>
                            <span>Variables: {template.variables.join(', ')}</span>
                            {template.send_timing && (
                              <span>
                                Timing: {
                                  template.send_timing === 'custom' && template.custom_timing_hours 
                                    ? `${template.custom_timing_hours} hours before`
                                    : TIMING_OPTIONS[template.send_timing] || 'Not set'
                                }
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => toggleActive(template)}
                          >
                            {template.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <button
                            onClick={() => editTemplate(template)}
                            className="p-1 text-blue-600 hover:text-blue-700"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          {!template.is_default && (
                            <button
                              onClick={() => setDeleteConfirm(template)}
                              className="p-1 text-red-600 hover:text-red-700"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Section>
        )
      })}

      {/* Help Section */}
      <Section title="Available Variables">
        <Card>
          <p className="text-sm text-gray-600 mb-4">
            Use these variables in your templates. They will be automatically replaced with actual values when messages are sent.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {Object.entries(AVAILABLE_VARIABLES).map(([key, desc]) => (
              <div key={key} className="flex items-start">
                <code className="text-green-600 text-xs flex-shrink-0">{`{{${key}}}`}</code>
                <span className="text-gray-600 ml-2">- {desc}</span>
              </div>
            ))}
          </div>
        </Card>
      </Section>
    </Page>
  )
}