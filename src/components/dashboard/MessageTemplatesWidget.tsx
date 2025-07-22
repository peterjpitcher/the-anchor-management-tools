'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { DocumentTextIcon, ClockIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'

interface TemplateStats {
  totalTemplates: number
  activeTemplates: number
  customEventTemplates: number
  recentlyUsed: {
    name: string
    type: string
    lastUsed: string
    useCount: number
  }[]
  templatesByType: {
    type: string
    badge: number
  }[]
}

export function MessageTemplatesWidget() {
  const supabase = useSupabase()
  const [stats, setStats] = useState<TemplateStats>({
    totalTemplates: 0,
    activeTemplates: 0,
    customEventTemplates: 0,
    recentlyUsed: [],
    templatesByType: []
  })
  const [isLoading, setIsLoading] = useState(true)

  const loadTemplateStats = useCallback(async () => {
    try {
      setIsLoading(true)

      // Get all templates
      const { data: templates, error: templatesError } = await supabase
        .from('message_templates')
        .select('*')
        .order('created_at', { ascending: false })

      if (templatesError) throw templatesError

      // Get event-specific templates
      const { count: eventTemplateCount, error: eventTemplateError } = await supabase
        .from('event_message_templates')
        .select('*', { count: 'exact' })

      if (eventTemplateError) throw eventTemplateError

      // Get message usage stats for templates (last 30 days)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('created_at, body')
        .eq('direction', 'outbound')
        .gte('created_at', thirtyDaysAgo.toISOString())

      if (messagesError) throw messagesError

      // Calculate template usage by analyzing message content
      const templateUsage = new Map<string, { badge: number; lastUsed: string }>()
      
      templates?.forEach(template => {
        const matchingMessages = messages?.filter(msg => {
          // Simple check - in production you'd want more sophisticated matching
          return msg.body.includes(template.name) || 
                 (template.content && msg.body.includes(template.content.substring(0, 50)))
        }) || []

        if (matchingMessages.length > 0) {
          templateUsage.set(template.name, {
            badge: matchingMessages.length,
            lastUsed: matchingMessages[0].created_at
          })
        }
      })

      // Group templates by type
      const typeGroups = templates?.reduce((acc, template) => {
        const type = template.type || 'custom'
        acc[type] = (acc[type] || 0) + 1
        return acc
      }, {} as Record<string, number>) || {}

      // Get recently used templates
      const recentlyUsed = Array.from(templateUsage.entries())
        .map(([name, stats]) => {
          const template = templates?.find(t => t.name === name)
          return {
            name,
            type: template?.type || 'custom',
            lastUsed: stats.lastUsed,
            useCount: stats.badge
          }
        })
        .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
        .slice(0, 3)

      setStats({
        totalTemplates: templates?.length || 0,
        activeTemplates: templates?.filter(t => t.is_active !== false).length || 0,
        customEventTemplates: eventTemplateCount || 0,
        recentlyUsed,
        templatesByType: Object.entries(typeGroups).map(([type, count]) => ({ 
          type, 
          badge: count as number 
        }))
      })
    } catch (error) {
      console.error('Error loading template stats:', error)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadTemplateStats()
  }, [loadTemplateStats])

  if (isLoading) {
    return (
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
            <div className="space-y-3">
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg leading-6 font-medium text-gray-900 flex items-center">
            <DocumentTextIcon className="h-5 w-5 text-indigo-600 mr-2" />
            Message Templates
          </h3>
          <Link
            href="/settings/message-templates"
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            Manage
          </Link>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <p className="text-2xl font-semibold text-gray-900">{stats.activeTemplates}</p>
            <p className="text-xs text-gray-500">Active</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-semibold text-gray-900">{stats.totalTemplates}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-semibold text-gray-900">{stats.customEventTemplates}</p>
            <p className="text-xs text-gray-500">Custom</p>
          </div>
        </div>

        {/* Recently Used Templates */}
        {stats.recentlyUsed.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Recently Used</h4>
            <div className="space-y-2">
              {stats.recentlyUsed.map((template, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div className="flex items-center">
                    <ClockIcon className="h-4 w-4 text-gray-400 mr-2" />
                    <span className="text-gray-900">{template.name}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      ({template.type})
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {template.useCount} uses
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Template Types */}
        {stats.templatesByType.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-2">By Type</h4>
            <div className="space-y-1">
              {stats.templatesByType.map((typeGroup, index) => (
                <div key={index} className="flex justify-between text-sm">
                  <span className="text-gray-600 capitalize">{typeGroup.type}</span>
                  <span className="font-medium text-gray-900">{typeGroup.badge}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats.totalTemplates === 0 && (
          <div className="text-center py-4">
            <DocumentTextIcon className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-2 text-sm text-gray-500">No templates created yet</p>
            <Link
              href="/settings/message-templates"
              className="mt-2 text-sm text-indigo-600 hover:text-indigo-500"
            >
              Create your first template
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}