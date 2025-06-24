'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EventFormEnhanced } from '@/components/EventFormEnhanced'
import { updateEventEnhanced } from '@/app/actions/eventsEnhanced'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { Event as BaseEvent, EventFAQ } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import toast from 'react-hot-toast'

type Event = BaseEvent & {
  category?: EventCategory | null
}

export default function EditEnhancedEventPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = use(paramsPromise)
  const router = useRouter()
  const supabase = useSupabase()
  const [event, setEvent] = useState<Event | null>(null)
  const [eventFAQs, setEventFAQs] = useState<EventFAQ[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadEvent = async () => {
      try {
        // Load event with category
        const { data: eventData, error: eventError } = await supabase
          .from('events')
          .select('*, category:event_categories(*)')
          .eq('id', params.id)
          .single()

        if (eventError) throw eventError
        setEvent(eventData)

        // Load FAQs
        const { data: faqData, error: faqError } = await supabase
          .from('event_faqs')
          .select('*')
          .eq('event_id', params.id)
          .order('sort_order')

        if (faqError) {
          console.error('Error loading FAQs:', faqError)
        } else {
          setEventFAQs(faqData || [])
        }
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
      formData.append('capacity', data.capacity?.toString() || '')
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

      const result = await updateEventEnhanced(params.id, formData, faqs)
      
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
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit Event (Enhanced)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Edit event with advanced SEO and media options
        </p>
      </div>
      
      <EventFormEnhanced 
        event={event} 
        eventFAQs={eventFAQs}
        onSubmit={handleSubmit} 
        onCancel={handleCancel} 
      />
    </div>
  )
}