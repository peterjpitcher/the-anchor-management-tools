'use client'

import { useRouter } from 'next/navigation'
import { EventFormSimple } from '@/components/EventFormSimple'
import { createEvent } from '@/app/actions/events'
import { Event } from '@/types/database'
import toast from 'react-hot-toast'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function NewEventPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<any[]>([])
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create New Event</h1>
        <p className="mt-1 text-sm text-gray-600">
          Add a new event to your calendar
        </p>
      </div>
      
      <EventFormSimple 
        categories={categories}
        onSubmit={handleSubmit} 
        onCancel={handleCancel} 
      />
    </div>
  )
}