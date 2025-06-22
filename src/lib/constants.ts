// Shared constants for the application

// Phone number validation pattern - must match database constraint
// Database: CHECK (mobile_number ~* '^(\+?44|0)?[0-9]{10,11}$')
export const UK_PHONE_PATTERN = /^(\+?44|0)?[0-9]{10,11}$/
export const UK_PHONE_PATTERN_STRING = '^(\\+?44|0)?[0-9]{10,11}$'

// Common date formats
export const DATE_FORMAT = 'dd MMM yyyy'
export const TIME_FORMAT = 'HH:mm'
export const DATETIME_FORMAT = 'dd MMM yyyy HH:mm'

// Pagination
export const DEFAULT_PAGE_SIZE = 25
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

// File upload limits
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
export const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]

// SMS limits
export const MAX_SMS_LENGTH = 1600 // ~10 segments
export const SMS_SEGMENT_LENGTH = 160
export const SMS_SEGMENT_LENGTH_UNICODE = 70

// Theme colors (matching Tailwind config)
export const THEME_COLORS = {
  primary: '#2563eb', // blue-600
  sidebarGreen: '#005131',
  success: '#10b981', // emerald-500
  warning: '#f59e0b', // amber-500
  error: '#ef4444', // red-500
  info: '#3b82f6', // blue-500
}