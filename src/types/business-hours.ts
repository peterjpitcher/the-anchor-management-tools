export interface ScheduleConfigItem {
  name: string
  starts_at: string
  ends_at: string
  capacity: number
  booking_type: string
}

export interface BusinessHours {
  id: string
  day_of_week: number // 0 = Sunday, 6 = Saturday
  /** The version this row belongs to. Seven rows share one version. */
  version_id: string
  opens: string | null
  closes: string | null
  kitchen_opens: string | null
  kitchen_closes: string | null
  is_closed: boolean
  is_kitchen_closed: boolean
  schedule_config: ScheduleConfigItem[] | null
  created_at: string
  updated_at: string
}

/**
 * A dated set of weekly hours. Only `published` versions are visible to
 * resolution, so a draft can be prepared without affecting bookings.
 */
export interface BusinessHoursVersion {
  id: string
  /** ISO date, the first day this version applies. */
  effective_from: string
  status: 'draft' | 'published' | 'withdrawn'
  label: string | null
  /**
   * The synthetic version created when versioning was introduced. It holds the
   * schedule as at migration day, back-dated so historical queries resolve. It is
   * not evidence of the hours actually worked before then.
   */
  is_baseline: boolean
  created_at: string
  created_by: string | null
  published_at: string | null
  published_by: string | null
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
  schedule_config: ScheduleConfigItem[] | null
  /** Per-date kitchen pacing overrides, added 20260726000000. */
  kitchen_pace_covers: number | null
  kitchen_walk_in_reserve: number | null
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

export interface ServiceStatusOverride {
  id: string
  service_code: string
  start_date: string
  end_date: string
  is_enabled: boolean
  message: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DAY_ABBREVIATIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
