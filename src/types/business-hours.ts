export interface BusinessHours {
  id: string
  day_of_week: number // 0 = Sunday, 6 = Saturday
  opens: string | null
  closes: string | null
  kitchen_opens: string | null
  kitchen_closes: string | null
  is_closed: boolean
  created_at: string
  updated_at: string
}

export interface SpecialHours {
  id: string
  date: string
  opens: string | null
  closes: string | null
  kitchen_opens: string | null
  kitchen_closes: string | null
  is_closed: boolean
  is_kitchen_closed: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export interface ServiceStatus {
  service_code: string
  display_name: string
  is_enabled: boolean
  message: string | null
  metadata: Record<string, unknown>
  updated_by?: string | null
  updated_at: string
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const DAY_ABBREVIATIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
