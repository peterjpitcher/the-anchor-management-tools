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
  faqs?: Array<{
    question: string
    answer: string
    sort_order: number
  }>
}

export interface CustomerCategoryStats {
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
  faqs?: Array<{
    question: string
    answer: string
    sort_order: number
  }>
}

import {
  AcademicCapIcon,
  BeakerIcon,
  SquaresPlusIcon,
  SparklesIcon,
  MusicalNoteIcon,
  CakeIcon,
  GlobeAltIcon,
  HeartIcon,
  StarIcon,
  TrophyIcon,
  CalendarIcon,
  UsersIcon,
  MicrophoneIcon,
  FilmIcon,
  PaintBrushIcon
} from '@heroicons/react/24/outline'

// Icon options for categories
export const CATEGORY_ICONS = [
  { value: 'AcademicCapIcon', label: 'Academic', icon: AcademicCapIcon },
  { value: 'BeakerIcon', label: 'Science', icon: BeakerIcon },
  { value: 'SquaresPlusIcon', label: 'Games', icon: SquaresPlusIcon },
  { value: 'SparklesIcon', label: 'Special', icon: SparklesIcon },
  { value: 'MusicalNoteIcon', label: 'Music', icon: MusicalNoteIcon },
  { value: 'CakeIcon', label: 'Party', icon: CakeIcon },
  { value: 'GlobeAltIcon', label: 'Global', icon: GlobeAltIcon },
  { value: 'HeartIcon', label: 'Love', icon: HeartIcon },
  { value: 'StarIcon', label: 'Featured', icon: StarIcon },
  { value: 'TrophyIcon', label: 'Competition', icon: TrophyIcon },
  { value: 'CalendarIcon', label: 'Calendar', icon: CalendarIcon },
  { value: 'UsersIcon', label: 'Community', icon: UsersIcon },
  { value: 'MicrophoneIcon', label: 'Microphone', icon: MicrophoneIcon },
  { value: 'FilmIcon', label: 'Film', icon: FilmIcon },
  { value: 'PaintBrushIcon', label: 'Art', icon: PaintBrushIcon },
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