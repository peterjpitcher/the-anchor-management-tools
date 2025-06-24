'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EventForm } from '@/components/EventForm'
import { updateEvent } from '@/app/actions/events'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Event as BaseEvent } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import toast from 'react-hot-toast'

type Event = BaseEvent & {
  category?: EventCategory | null
}

export default function EditEventPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise)
  const router = useRouter()
  const supabase = useSupabase()
  const [event, setEvent] = useState<Event | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadEvent = async () => {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('*, category:event_categories(*)')
          .eq('id', params.id)
          .single()

        if (error) throw error
        setEvent(data)
      } catch (error) {
        console.error('Error loading event:', error)
        toast.error('Failed to load event details')
        router.push('/events')
      } finally {
        setIsLoading(false)
      }
    }

    loadEvent()
  }, [params.id, supabase, router])

  const handleSubmit = async (data: Omit<Event, 'id' | 'created_at'>) => {
    try {
      const formData = new FormData()
      formData.append('name', data.name)
      formData.append('date', data.date)
      formData.append('time', data.time)
      formData.append('capacity', data.capacity?.toString() || '')
      formData.append('category_id', data.category_id || '')
      formData.append('description', data.description || '')
      formData.append('end_time', data.end_time || '')
      formData.append('event_status', data.event_status || 'scheduled')
      formData.append('performer_name', data.performer_name || '')
      formData.append('performer_type', data.performer_type || '')
      formData.append('price', data.price?.toString() || '0')
      formData.append('is_free', data.is_free?.toString() || 'false')
      formData.append('booking_url', data.booking_url || '')
      formData.append('image_urls', JSON.stringify(data.image_urls || []))

      const result = await updateEvent(params.id, formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Event updated successfully')
        router.push(`/events/${params.id}`)
      }
    } catch (error) {
      console.error('Error updating event:', error)
      toast.error('Failed to update event')
    }
  }

  const handleCancel = () => {
    router.push(`/events/${params.id}`)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading event...</p>
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Event not found</h2>
        <p className="mt-2 text-gray-600">The event you're looking for doesn't exist.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <EventForm 
            event={event} 
            onSubmit={handleSubmit} 
            onCancel={handleCancel} 
          />
        </div>
      </div>
    </div>
  )
}