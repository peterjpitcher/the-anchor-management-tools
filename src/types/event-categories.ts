export interface EventCategory {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  default_start_time: string | null
  default_end_time: string | null
  default_capacity: number | null
  default_reminder_hours: number
  default_price: number
  default_is_free: boolean
  default_performer_name: string | null
  default_performer_type: string | null
  default_event_status: string
  default_image_url: string | null
  slug: string
  meta_description: string | null
  sort_order: number
  is_active: boolean
  is_default?: boolean
  created_at: string
  updated_at: string
  // Additional SEO and content fields
  short_description?: string | null
  long_description?: string | null
  highlights?: string[]
  meta_title?: string | null
  keywords?: string[]
  gallery_image_urls?: string[]
  poster_image_url?: string | null
  thumbnail_image_url?: string | null
  promo_video_url?: string | null
  highlight_video_urls?: string[]
  default_duration_minutes?: number | null
  default_doors_time?: string | null
  default_last_entry_time?: string | null
  default_booking_url?: string | null
  default_booking_mode: 'table' | 'general' | 'mixed' | 'communal'
  default_payment_mode: 'free' | 'cash_only' | 'prepaid'
  default_promo_sms_enabled: boolean
  default_bookings_enabled: boolean
  faqs?: Array<{
    question: string
    answer: string
    sort_order: number
  }>
  primary_keywords?: string[] | null
  secondary_keywords?: string[] | null
  local_seo_keywords?: string[] | null
  image_alt_text?: string | null
  cancellation_policy?: string | null
  accessibility_notes?: string | null
}

interface CustomerCategoryStats {
  customer_id: string
  category_id: string
  times_attended: number
  last_attended_date: string | null
  first_attended_date: string | null
  created_at: string
  updated_at: string
}

export interface CategoryRegular {
  customer_id: string
  first_name: string
  last_name: string
  mobile_number: string
  times_attended: number
  last_attended_date: string
  days_since_last_visit: number
}

export interface CrossCategorySuggestion {
  customer_id: string
  first_name: string
  last_name: string
  mobile_number: string
  source_times_attended: number
  source_last_attended: string
  already_attended_target: boolean
}

interface CategoryRecentCheckIn {
  customer_id: string
  first_name: string
  last_name: string | null
  mobile_number: string | null
  last_check_in_time: string
  check_in_count: number
}

export interface CategoryFormData {
  name: string
  description?: string
  color: string
  icon: string
  default_start_time?: string
  default_end_time?: string
  default_capacity?: number
  default_reminder_hours: number
  default_price?: number
  default_is_free?: boolean
  default_performer_name?: string
  default_performer_type?: string
  default_event_status?: string
  default_image_url?: string
  slug?: string
  meta_description?: string
  is_active: boolean
  is_default?: boolean
  sort_order?: number
  // Additional SEO and content fields
  short_description?: string
  long_description?: string
  highlights?: string[]
  meta_title?: string
  keywords?: string[]
  gallery_image_urls?: string[]
  poster_image_url?: string
  thumbnail_image_url?: string
  promo_video_url?: string
  highlight_video_urls?: string[]
  default_duration_minutes?: number
  default_doors_time?: string
  default_last_entry_time?: string
  default_booking_url?: string
  default_booking_mode?: 'table' | 'general' | 'mixed' | 'communal'
  default_payment_mode?: 'free' | 'cash_only' | 'prepaid'
  default_promo_sms_enabled?: boolean
  default_bookings_enabled?: boolean
  faqs?: Array<{
    question: string
    answer: string
    sort_order: number
  }>
  primary_keywords?: string[]
  secondary_keywords?: string[]
  local_seo_keywords?: string[]
  image_alt_text?: string
  cancellation_policy?: string
  accessibility_notes?: string
}

// Icon options for categories. value is the name saved on the category (the old icon
// library component name, kept so saved categories still match); icon is the DS glyph.
export const CATEGORY_ICONS = [
  { value: 'AcademicCapIcon', label: 'Academic', icon: 'graduationCap' },
  { value: 'BeakerIcon', label: 'Science', icon: 'beaker' },
  { value: 'SquaresPlusIcon', label: 'Games', icon: 'gridPlus' },
  { value: 'SparklesIcon', label: 'Special', icon: 'sparkles' },
  { value: 'MusicalNoteIcon', label: 'Music', icon: 'music' },
  { value: 'CakeIcon', label: 'Party', icon: 'cake' },
  { value: 'GlobeAltIcon', label: 'Global', icon: 'globe' },
  { value: 'HeartIcon', label: 'Love', icon: 'heart' },
  { value: 'StarIcon', label: 'Featured', icon: 'star' },
  { value: 'TrophyIcon', label: 'Competition', icon: 'trophy' },
  { value: 'CalendarIcon', label: 'Calendar', icon: 'calendar' },
  { value: 'UsersIcon', label: 'Community', icon: 'users' },
  { value: 'MicrophoneIcon', label: 'Microphone', icon: 'mic' },
  { value: 'FilmIcon', label: 'Film', icon: 'film' },
  { value: 'PaintBrushIcon', label: 'Art', icon: 'brush' },
  { value: 'BuildingStorefrontIcon', label: 'Dining', icon: 'store' },
] as const

// Color presets for categories
export const CATEGORY_COLORS = [
  { value: '#9333EA', label: 'Purple' },
  { value: '#991B1B', label: 'Burgundy' },
  { value: '#16A34A', label: 'Green' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#F59E0B', label: 'Amber' },
  { value: '#EF4444', label: 'Red' },
  { value: '#8B5CF6', label: 'Violet' },
  { value: '#10B981', label: 'Emerald' },
  { value: '#F97316', label: 'Orange' },
] as const
