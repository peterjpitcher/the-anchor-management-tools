'use client'

import { useRouter } from 'next/navigation'
import { EventFormGrouped } from '@/components/EventFormGrouped'
import { updateEvent } from '@/app/actions/events'
import { Event } from '@/types/database'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { use } from 'react'
// New UI components
import { Page } from '@/components/ui-v2/layout/Page'
import { Card } from '@/components/ui-v2/layout/Card'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function EditEventPage({ params }: PageProps) {
  const router = useRouter()
  const resolvedParams = use(params)
  const [event, setEvent] = useState<Event | null>(null)
  const [categories, setCategories] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      
      // Load event and categories in parallel
      const [eventResult, categoriesResult] = await Promise.all([
        supabase
          .from('events')
          .select('*')
          .eq('id', resolvedParams.id)
          .single(),
        supabase
          .from('event_categories')
          .select('*')
          .eq('is_active', true)
          .order('sort_order')
      ])
      
      if (eventResult.error) {
        toast.error('Event not found')
        router.push('/events')
        return
      }
      
      setEvent(eventResult.data)
      setCategories(categoriesResult.data || [])
      setLoading(false)
    }
    
    loadData()
  }, [resolvedParams.id, router])

  const handleSubmit = async (data: Partial<Event>) => {
    if (!event) return

    try {
      const formData = new FormData()
      
      // Add all fields to formData
      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          if (typeof value === 'object') {
            formData.append(key, JSON.stringify(value))
          } else {
            formData.append(key, value.toString())
          }
        }
      })

      const result = await updateEvent(event.id, formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Event updated successfully')
        router.push(`/events/${event.id}`)
      }
    } catch (error) {
      console.error('Error updating event:', error)
      toast.error('Failed to update event')
    }
  }

  const handleCancel = () => {
    router.push(`/events/${resolvedParams.id}`)
  }

  if (loading || !event) {
    return (
      <Page title="Edit Event">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Spinner size="lg" />
            <p className="mt-4 text-gray-600">Loading event...</p>
          </div>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="Edit Event"
      description={`Update the details for ${event.name}`}
    >
      <Card>
        <EventFormGrouped 
          event={event}
          categories={categories}
          onSubmit={handleSubmit} 
          onCancel={handleCancel} 
        />
      </Card>
    </Page>
  )
}