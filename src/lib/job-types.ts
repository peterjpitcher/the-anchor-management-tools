// Define all job types for type safety
export type JobType = 
  | 'send_sms'
  | 'send_bulk_sms'
  | 'process_reminder'
  | 'sync_customer_stats'
  | 'cleanup_old_messages'
  | 'generate_report'
  | 'process_webhook'
  | 'update_sms_health'
  | 'send_welcome_email'

export interface JobPayload {
  send_sms: {
    to: string
    message: string
    customerId?: string
    type: 'booking_confirmation' | 'reminder' | 'custom'
  }
  send_bulk_sms: {
    customerIds: string[]
    message: string
    filters?: Record<string, any>
    eventId?: string
    categoryId?: string
  }
  process_reminder: {
    bookingId: string
    reminderType: '24_hour' | '7_day'
  }
  sync_customer_stats: {
    customerId?: string
  }
  cleanup_old_messages: {
    daysToKeep: number
  }
  generate_report: {
    type: 'audit' | 'sms' | 'bookings'
    startDate: string
    endDate: string
  }
  process_webhook: {
    webhookId: string
    payload: any
  }
  update_sms_health: {
    customerId?: string
  }
  send_welcome_email: {
    series_id: string
    member_id: string
    customer_id: string
    template_id: string
    template_name: string
    customer_name: string
    customer_email: string
    tier_name: string
    current_points: number
  }
}

export interface Job<T extends JobType = JobType> {
  id: string
  type: T
  payload: JobPayload[T]
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempts: number
  maxAttempts: number
  createdAt: Date
  processedAt?: Date
  completedAt?: Date
  error?: string
  result?: any
}

export interface JobOptions {
  delay?: number // Delay in milliseconds
  priority?: number // Higher number = higher priority
  maxAttempts?: number // Default: 3
}