'use client'

import { useRouter } from 'next/navigation'
import { EventFormGrouped } from '@/components/EventFormGrouped'
import { createEvent } from '@/app/actions/events'
import { Event } from '@/types/database'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
// New UI components
import { PageHeader } from '@/components/ui-v2/layout/PageHeader'
import { PageWrapper, PageContent } from '@/components/ui-v2/layout/PageWrapper'
import { Card } from '@/components/ui-v2/layout/Card'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
export default function NewEventPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
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
        setCategories(data)
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

      const result = await createEvent(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else if (result.data) {
        toast.success('Event created successfully')
        router.push(`/events/${result.data.id}`)
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
      <PageWrapper>
        <PageHeader 
          title="Create New Event"
          backButton={{
            label: "Back to Events",
            href: "/events"
          }}
        />
        <PageContent>
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <Spinner size="lg" />
              <p className="mt-4 text-gray-600">Loading...</p>
            </div>
          </div>
        </PageContent>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper>
      <PageHeader
        title="Create New Event"
        subtitle="Add a new event to your calendar"
        backButton={{
          label: "Back to Events",
          href: "/events"
        }}
      />
      <PageContent>
        <Card>
          <EventFormGrouped 
            categories={categories as any}
            onSubmit={handleSubmit} 
            onCancel={handleCancel} 
          />
        </Card>
      </PageContent>
    </PageWrapper>
  )
}
