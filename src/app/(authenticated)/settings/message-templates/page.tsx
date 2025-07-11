'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import toast from 'react-hot-toast'
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'

interface MessageTemplate {
  id: string
  name: string
  description: string | null
  template_type: 'booking_confirmation' | 'reminder_7_day' | 'reminder_24_hour' | 'booking_reminder_confirmation' | 'booking_reminder_7_day' | 'booking_reminder_24_hour' | 'custom'
  content: string
  variables: string[]
  is_default: boolean
  is_active: boolean
  character_count: number
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
  const supabase = useSupabase()
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)
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
        const { error } = await supabase
          .from('message_templates')
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
        const { error } = await supabase
          .from('message_templates')
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

  async function handleDelete(templateId: string) {
    if (!confirm('Are you sure you want to delete this template?')) return

    try {
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', templateId)

      if (error) throw error
      toast.success('Template deleted successfully')
      await loadTemplates()
    } catch (error) {
      console.error('Error deleting template:', error)
      toast.error('Failed to delete template')
    }
  }

  async function toggleActive(template: MessageTemplate) {
    try {
      const { error } = await supabase
        .from('message_templates')
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
      description: template.description || '',
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
    return <div className="p-4">Loading templates...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Message Templates</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage SMS templates for automated messages
            </p>
          </div>
        <button
          onClick={() => {
            resetForm()
            setEditingTemplate(null)
            setShowForm(true)
          }}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          <PlusIcon className="-ml-1 mr-2 h-5 w-5" />
          New Template
        </button>
      </div>

      {/* Template Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-semibold mb-4">
              {editingTemplate ? 'Edit Template' : 'New Template'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm"
                />
              </div>

              {!editingTemplate && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Type</label>
                  <select
                    value={formData.template_type}
                    onChange={(e) => setFormData({ ...formData, template_type: e.target.value as MessageTemplate['template_type'] })}
                    className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm"
                  >
                    {Object.entries(TEMPLATE_TYPES).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700">Send Timing</label>
                <select
                  value={formData.send_timing}
                  onChange={(e) => setFormData({ ...formData, send_timing: e.target.value as 'immediate' | '1_hour' | '12_hours' | '24_hours' | '7_days' | 'custom' })}
                  className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm"
                >
                  {Object.entries(TIMING_OPTIONS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {formData.send_timing === 'custom' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Hours before event</label>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={formData.custom_timing_hours || ''}
                    onChange={(e) => setFormData({ ...formData, custom_timing_hours: e.target.value ? parseInt(e.target.value) : null })}
                    className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm"
                    placeholder="Enter hours (1-720)"
                  />
                  <p className="mt-1 text-sm text-gray-500">Maximum 30 days (720 hours)</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Template Content
                  <span className="text-xs text-gray-500 ml-2">
                    ({formData.content.length} chars, ~{Math.ceil(formData.content.length / 160)} segments)
                  </span>
                </label>
                
                {/* Variable buttons */}
                <div className="mb-2 flex flex-wrap gap-2">
                  {Object.entries(AVAILABLE_VARIABLES).map(([key, desc]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => insertVariable(key)}
                      className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
                      title={desc}
                    >
                      {`{{${key}}}`}
                    </button>
                  ))}
                </div>

                <textarea
                  id="template-content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="block w-full rounded-lg border-gray-300 shadow-sm"
                  rows={6}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Preview</label>
                <div className="p-4 bg-gray-100 rounded-md">
                  <p className="text-sm whitespace-pre-wrap">{preview}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowForm(false)
                  setEditingTemplate(null)
                  resetForm()
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              >
                {editingTemplate ? 'Update' : 'Create'} Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates List */}
      <div className="space-y-6">
        {Object.entries(TEMPLATE_TYPES).map(([type, label]) => {
          const typeTemplates = templates.filter(t => t.template_type === type)
          if (typeTemplates.length === 0 && type === 'custom') return null

          return (
            <div key={type} className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium mb-4">{label}</h3>
                
                {typeTemplates.length === 0 ? (
                  <p className="text-gray-500 text-sm">No templates configured</p>
                ) : (
                  <div className="space-y-4">
                    {typeTemplates.map((template) => (
                      <div
                        key={template.id}
                        className={`border rounded-lg p-4 ${
                          !template.is_active ? 'bg-gray-50 opacity-60' : ''
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center">
                              <h4 className="font-medium">
                                {template.name}
                                {template.is_default && (
                                  <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                                    Default
                                  </span>
                                )}
                              </h4>
                            </div>
                            {template.description && (
                              <p className="text-sm text-gray-500 mt-1">{template.description}</p>
                            )}
                            <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap bg-gray-50 p-2 rounded">
                              {template.content}
                            </p>
                            <div className="mt-2 flex items-center space-x-4 text-xs text-gray-500">
                              <span>{template.character_count} characters</span>
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
                          
                          <div className="flex items-center space-x-2 ml-4">
                            <button
                              onClick={() => toggleActive(template)}
                              className={`text-sm ${
                                template.is_active
                                  ? 'text-yellow-600 hover:text-yellow-700'
                                  : 'text-green-600 hover:text-green-700'
                              }`}
                            >
                              {template.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              onClick={() => editTemplate(template)}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              <PencilIcon className="h-5 w-5" />
                            </button>
                            {!template.is_default && (
                              <button
                                onClick={() => handleDelete(template.id)}
                                className="text-red-600 hover:text-red-900"
                              >
                                <TrashIcon className="h-5 w-5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Help Section */}
      <div className="mt-8 bg-blue-50 rounded-lg p-6">
        <h3 className="text-lg font-medium mb-2">Available Variables</h3>
        <p className="text-sm text-gray-600 mb-4">
          Use these variables in your templates. They will be automatically replaced with actual values when messages are sent.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          {Object.entries(AVAILABLE_VARIABLES).map(([key, desc]) => (
            <div key={key}>
              <code className="text-green-600">{`{{${key}}}`}</code>
              <span className="text-gray-600 ml-2">- {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}