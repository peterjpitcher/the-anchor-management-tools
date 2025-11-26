'use client'

import { useRouter } from 'next/navigation'
import { EventFormGrouped } from '@/components/features/events/EventFormGrouped'
import { createEvent } from '@/app/actions/events'
import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
// New UI components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { toast } from '@/components/ui-v2/feedback/Toast'
type CreateEventActionResult = Awaited<ReturnType<typeof createEvent>>

export default function NewEventPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadCategories() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('event_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      
      if (!error && data) {
        setCategories(data as unknown as EventCategory[])
      }
      setLoading(false)
    }
    
    loadCategories()
  }, [])

  const handleSubmit = async (data: Partial<Event>) => {
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

      const result = await createEvent(formData) as CreateEventActionResult

      if ('error' in result && result.error) {
        toast.error(result.error)
      } else if ('success' in result && result.success && 'data' in result && result.data) {
        toast.success('Event created successfully')
        router.push(`/events/${result.data.id}`)
      } else {
        toast.error('Failed to create event')
      }
    } catch (error) {
      console.error('Error creating event:', error)
      toast.error('Failed to create event')
    }
  }

  const handleCancel = () => {
    router.push('/events')
  }

  if (loading) {
    return (
      <PageLayout
        title="Create New Event"
        backButton={{
          label: 'Back to Events',
          href: '/events',
        }}
        loading
        loadingLabel="Loading..."
      />
    )
  }

  return (
    <PageLayout
      title="Create New Event"
      subtitle="Add a new event to your calendar"
      backButton={{
        label: 'Back to Events',
        href: '/events',
      }}
    >
      <Card>
        <EventFormGrouped
          categories={categories}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </Card>
    </PageLayout>
  )
}
