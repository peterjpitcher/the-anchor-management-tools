export interface Event {
  id: string
  name: string
  slug: string | null
  date: string
  time: string
  end_time: string | null
  duration_minutes: number | null
  doors_time: string | null
  last_entry_time: string | null
  capacity: number | null
  category_id: string | null
  description: string | null
  short_description: string | null
  long_description: string | null
  highlights: string[] | null
  keywords: string[] | null
  meta_title: string | null
  meta_description: string | null
  event_status: 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled'
  performer_name: string | null
  performer_type: string | null
  price: number
  price_currency: string
  is_free: boolean
  booking_url: string | null
  hero_image_url: string | null
  thumbnail_image_url: string | null
  poster_image_url: string | null
  gallery_image_urls: any | null // JSONB array
  image_urls: any | null // JSONB array
  promo_video_url: string | null
  highlight_video_urls: string[] | null
  faqs: any | null // JSONB field
  created_at: string
  updated_at: string
  category?: EventCategory
}

export interface EventCategory {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  slug: string | null
  short_description: string | null
  long_description: string | null
  highlights: string[] | null
  meta_title: string | null
  meta_description: string | null
  keywords: string[] | null
  promo_video_url: string | null
  highlight_video_urls: string[] | null
  default_start_time: string | null
  default_end_time: string | null
  default_capacity: number | null
  default_reminder_hours: number
  default_price: number
  default_is_free: boolean
  default_performer_type: string | null
  default_event_status: string
  default_duration_minutes: number | null
  default_doors_time: string | null
  default_last_entry_time: string | null
  default_booking_url: string | null
  faqs: any | null // JSONB field
  sort_order: number
  is_active: boolean
  is_default: boolean | null
  created_at: string
  updated_at: string
}

export interface EventFormData {
  name: string
  date: string
  time: string
  end_time?: string
  duration_minutes?: number
  doors_time?: string
  last_entry_time?: string
  capacity?: number
  category_id?: string
  description?: string
  short_description?: string
  long_description?: string
  highlights?: string[]
  keywords?: string[]
  meta_title?: string
  meta_description?: string
  event_status?: 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled'
  performer_name?: string
  performer_type?: string
  price?: number
  price_currency?: string
  is_free?: boolean
  booking_url?: string
  hero_image_url?: string
  thumbnail_image_url?: string
  poster_image_url?: string
  gallery_image_urls?: any // JSONB array
  image_urls?: any // JSONB array
  promo_video_url?: string
  highlight_video_urls?: string[]
  faqs?: any[]
}