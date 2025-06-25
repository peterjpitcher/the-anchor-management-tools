'use client'

import { useRouter } from 'next/navigation'
import { EventFormEnhanced } from '@/components/EventFormEnhanced'
import { createEventEnhanced } from '@/app/actions/eventsEnhanced'
import { Event, EventFAQ } from '@/types/database'
import toast from 'react-hot-toast'

export default function NewEnhancedEventPage() {
  const router = useRouter()

  const handleSubmit = async (
    data: Omit<Event, 'id' | 'created_at'>, 
    faqs: Omit<EventFAQ, 'id' | 'event_id' | 'created_at' | 'updated_at'>[]
  ) => {
    try {
      const formData = new FormData()
      
      // Basic fields
      formData.append('name', data.name)
      formData.append('date', data.date)
      formData.append('time', data.time)
      // Only append capacity if it has a value, otherwise let server handle null
      if (data.capacity !== null && data.capacity !== undefined) {
        formData.append('capacity', data.capacity.toString())
      }
      formData.append('category_id', data.category_id || '')
      
      // Enhanced SEO fields
      formData.append('slug', data.slug || '')
      formData.append('short_description', data.short_description || '')
      formData.append('long_description', data.long_description || '')
      formData.append('highlights', JSON.stringify(data.highlights || []))
      formData.append('keywords', JSON.stringify(data.keywords || []))
      formData.append('meta_title', data.meta_title || '')
      formData.append('meta_description', data.meta_description || '')
      
      // Additional fields
      formData.append('description', data.description || '')
      formData.append('end_time', data.end_time || '')
      formData.append('last_entry_time', data.last_entry_time || '')
      formData.append('event_status', data.event_status || 'scheduled')
      formData.append('performer_name', data.performer_name || '')
      formData.append('performer_type', data.performer_type || '')
      formData.append('price', data.price?.toString() || '0')
      formData.append('price_currency', data.price_currency || 'GBP')
      formData.append('is_free', data.is_free?.toString() || 'false')
      formData.append('booking_url', data.booking_url || '')
      
      // Image URLs
      formData.append('hero_image_url', data.hero_image_url || '')
      formData.append('thumbnail_image_url', data.thumbnail_image_url || '')
      formData.append('poster_image_url', data.poster_image_url || '')
      formData.append('gallery_image_urls', JSON.stringify(data.gallery_image_urls || []))
      
      // Video URLs
      formData.append('promo_video_url', data.promo_video_url || '')
      formData.append('highlight_video_urls', JSON.stringify(data.highlight_video_urls || []))
      
      // Legacy image_urls for backward compatibility
      formData.append('image_urls', JSON.stringify(data.image_urls || []))

      const result = await createEventEnhanced(formData, faqs)
      
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

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create New Event (Enhanced)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Create an event with advanced SEO and media options
        </p>
      </div>
      
      <EventFormEnhanced 
        onSubmit={handleSubmit} 
        onCancel={handleCancel} 
      />
    </div>
  )
}