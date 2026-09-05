export const MANAGER_REPORT_SECTIONS = [
  'table_bookings', 'staff_shift_reminders', 'holiday_reminders', 'checklist_alerts',
  'checklist_summary', 'recruitment', 'private_bookings', 'rota',
] as const

export type ManagerReportSection = typeof MANAGER_REPORT_SECTIONS[number]

export interface ManagerReportInput {
  section: ManagerReportSection
  key: string
  to: string
  subject: string
  html?: string
  text?: string
  metadata?: Record<string, unknown>
}

export interface ManagerReportQueueResult {
  success: boolean
  queued?: true
  emailMessageId?: string
  error?: string
}

export interface ManagerReportEntry extends ManagerReportInput {
  id: string
  createdAt: string
}

export interface ManagerReportRenderInput {
  entries: ManagerReportEntry[]
  periodStart: string
  periodEnd: string
  appUrl: string
}

export interface ManagerReportRendered {
  subject: string
  html: string
  text: string
  attachment?: { filename: string; contentType: string; content: string }
}
