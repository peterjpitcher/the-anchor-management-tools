'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import toast from 'react-hot-toast'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

interface EventTemplate {
  id: string
  event_id: string
  template_type: string
  content: string
  is_active: boolean
  character_badge: number
  estimated_segments: number
}

interface Props {
  eventId: string
  eventName: string
}

const TEMPLATE_TYPES = {
  booking_confirmation: 'Booking Confirmation',
  reminder_7_day: '7-Day Reminder',
  reminder_24_hour: '24-Hour Reminder',
  booking_reminder_confirmation: 'Booking Reminder Confirmation (0 seats)',
  booking_reminder_7_day: '7-Day Booking Reminder (0 seats)',
  booking_reminder_24_hour: '24-Hour Booking Reminder (0 seats)'
}

const AVAILABLE_VARIABLES = {
  customer_name: 'Customer full name',
  first_name: 'Customer first name',
  event_name: 'Event name',
  event_date: 'Event date (formatted)',
  event_time: 'Event time',
  seats: 'Number of seats booked',
  venue_name: 'Venue name',
  contact_phone: 'Contact phone number'
}

export function EventTemplateManager({ eventId }: Props) {
  const supabase = useSupabase()
  const [templates, setTemplates] = useState<EventTemplate[]>([])
  const [defaultTemplates, setDefaultTemplates] = useState<Record<string, string>>({})
  const [editingType, setEditingType] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  const loadTemplates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('event_message_templates')
        .select('*')
        .eq('event_id', eventId)
        .order('template_type')

      if (error) throw error
      setTemplates(data || [])
    } catch (error) {
      console.error('Error loading templates:', error)
      toast.error('Failed to load templates')
    }
  }, [eventId, supabase])

  const loadDefaultTemplates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('name, content, template_type')
        .eq('is_active', true)
        .eq('is_default', true)
        .in('template_type', ['booking_confirmation', 'reminder_24_hour', 'reminder_7_day', 'booking_reminder_confirmation', 'booking_reminder_24_hour', 'booking_reminder_7_day'])

      if (error) throw error
      
      const defaults: Record<string, string> = {}
      data?.forEach((template: any) => {
        defaults[template.template_type] = template.content
      })
      
      setDefaultTemplates(defaults)
    } catch (error) {
      console.error('Error loading default templates:', error)
    }
  }, [supabase])

  useEffect(() => {
    loadTemplates()
    loadDefaultTemplates()
  }, [eventId, loadTemplates, loadDefaultTemplates])


  async function saveTemplate(templateType: string) {
    try {
      const existing = templates.find(t => t.template_type === templateType)
      
      if (existing) {
        // Update existing
        const { error } = await (supabase
          .from('event_message_templates') as any)
          .update({ content, is_active: true })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Create new
        const { error } = await (supabase
          .from('event_message_templates') as any)
          .insert({
            event_id: eventId,
            template_type: templateType,
            content,
            variables: extractVariables(content)
          })

        if (error) throw error
      }

      toast.success('Template saved successfully')
      setEditingType(null)
      setContent('')
      await loadTemplates()
    } catch (error) {
      console.error('Error saving template:', error)
      toast.error('Failed to save template')
    }
  }

  async function deleteTemplate(templateType: string) {
    if (!confirm('Delete this custom template and use the default instead?')) return

    try {
      const template = templates.find(t => t.template_type === templateType)
      if (!template) return

      const { error } = await (supabase
        .from('event_message_templates') as any)
        .delete()
        .eq('id', template.id)

      if (error) throw error
      
      toast.success('Template deleted, using default')
      await loadTemplates()
    } catch (error) {
      console.error('Error deleting template:', error)
      toast.error('Failed to delete template')
    }
  }

  function extractVariables(content: string): string[] {
    const matches = content.match(/{{(\w+)}}/g) || []
    const variables = matches.map(match => match.replace(/[{}]/g, ''))
    return [...new Set(variables)]
  }

  function insertVariable(variable: string) {
    const textarea = document.getElementById(`template-${editingType}`) as HTMLTextAreaElement
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = content
    const before = text.substring(0, start)
    const after = text.substring(end, text.length)
    
    setContent(before + `{{${variable}}}` + after)
    
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + variable.length + 4
      textarea.focus()
    }, 0)
  }

  function getTemplateContent(templateType: string): string {
    const eventTemplate = templates.find(t => t.template_type === templateType)
    return eventTemplate?.content || defaultTemplates[templateType] || ''
  }

  function hasCustomTemplate(templateType: string): boolean {
    return templates.some(t => t.template_type === templateType)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Message Templates</h3>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="text-sm text-indigo-600 hover:text-indigo-700"
        >
          {showHelp ? 'Hide' : 'Show'} Variables
        </button>
      </div>

      {showHelp && (
        <div className="bg-blue-50 rounded-lg p-4 text-sm">
          <p className="font-medium mb-2">Available Variables:</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(AVAILABLE_VARIABLES).map(([key, desc]) => (
              <div key={key}>
                <code className="text-indigo-600">{`{{${key}}}`}</code>
                <span className="text-gray-600 ml-2">- {desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(TEMPLATE_TYPES).map(([type, label]) => {
          const isEditing = editingType === type
          const hasCustom = hasCustomTemplate(type)
          const currentContent = isEditing ? content : getTemplateContent(type)

          return (
            <div key={type} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center">
                  <DocumentTextIcon className="h-5 w-5 text-gray-400 mr-2" />
                  <h4 className="font-medium">
                    {label}
                    {hasCustom && (
                      <span className="ml-2 text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded">
                        Customized
                      </span>
                    )}
                  </h4>
                </div>
                <div className="flex items-center space-x-2">
                  {hasCustom && !isEditing && (
                    <button
                      onClick={() => deleteTemplate(type)}
                      className="text-sm text-red-600 hover:text-red-700"
                    >
                      Reset to Default
                    </button>
                  )}
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => {
                          setEditingType(null)
                          setContent('')
                        }}
                        className="text-sm text-gray-600 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveTemplate(type)}
                        className="text-sm text-indigo-600 hover:text-indigo-700"
                      >
                        Save
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingType(type)
                        setContent(currentContent)
                      }}
                      className="text-sm text-indigo-600 hover:text-indigo-700"
                    >
                      Customize
                    </button>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="mt-2">
                  {showHelp && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {Object.keys(AVAILABLE_VARIABLES).map(key => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => insertVariable(key)}
                          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                        >
                          {`{{${key}}}`}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    id={`template-${type}`}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full p-2 border rounded-md text-sm"
                    rows={4}
                  />
                  <div className="mt-1 text-xs text-gray-500">
                    {content.length} characters, ~{Math.ceil(content.length / 160)} SMS segments
                  </div>
                </div>
              ) : (
                <div className="mt-2">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 p-2 rounded">
                    {currentContent}
                  </p>
                  <div className="mt-1 text-xs text-gray-500">
                    {currentContent.length} characters, ~{Math.ceil(currentContent.length / 160)} SMS segments
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}