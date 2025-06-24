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
  slug: string
  meta_description: string | null
  sort_order: number
  is_active: boolean
  is_default?: boolean
  created_at: string
  updated_at: string
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
  slug?: string
  meta_description?: string
  is_active: boolean
  is_default?: boolean
}

// Icon options for categories
export const CATEGORY_ICONS = [
  { value: 'AcademicCapIcon', label: '🎓 Academic', icon: 'AcademicCapIcon' },
  { value: 'BeakerIcon', label: '🧪 Science', icon: 'BeakerIcon' },
  { value: 'SquaresPlusIcon', label: '🎯 Games', icon: 'SquaresPlusIcon' },
  { value: 'SparklesIcon', label: '✨ Sparkles', icon: 'SparklesIcon' },
  { value: 'MusicalNoteIcon', label: '🎵 Music', icon: 'MusicalNoteIcon' },
  { value: 'CakeIcon', label: '🎂 Party', icon: 'CakeIcon' },
  { value: 'GlobeAltIcon', label: '🌍 Global', icon: 'GlobeAltIcon' },
  { value: 'HeartIcon', label: '❤️ Love', icon: 'HeartIcon' },
  { value: 'StarIcon', label: '⭐ Star', icon: 'StarIcon' },
  { value: 'TrophyIcon', label: '🏆 Trophy', icon: 'TrophyIcon' },
  { value: 'FilmIcon', label: '🎬 Film', icon: 'FilmIcon' },
  { value: 'MicrophoneIcon', label: '🎤 Microphone', icon: 'MicrophoneIcon' },
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