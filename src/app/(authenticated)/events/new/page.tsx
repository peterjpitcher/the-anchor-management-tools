'use client'

import { useRouter } from 'next/navigation'
import { EventForm } from '@/components/EventForm'
import { createEvent } from '@/app/actions/events'
import { Event } from '@/types/database'
import toast from 'react-hot-toast'

export default function NewEventPage() {
  const router = useRouter()

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
      formData.append('hero_image_url', data.hero_image_url || '')
      formData.append('image_urls', JSON.stringify(data.image_urls || []))

      const result = await createEvent(formData)
      
      if (result.error) {
        toast.error(result.error)
      } else {
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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <EventForm 
            onSubmit={handleSubmit} 
            onCancel={handleCancel} 
          />
        </div>
      </div>
    </div>
  )
}