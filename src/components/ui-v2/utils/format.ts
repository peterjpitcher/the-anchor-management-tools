/**
 * Formatting Utilities
 * 
 * Common formatting functions used across the component library
 */

/**
 * Format bytes into human-readable string
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string (e.g., "1.23 MB")
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/**
 * Format number with thousands separator
 * @param num - Number to format
 * @returns Formatted string (e.g., "1,234,567")
 */
export function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Format currency
 * @param amount - Amount to format
 * @param currency - Currency code (default: 'GBP')
 * @param locale - Locale for formatting (default: 'en-GB')
 * @returns Formatted currency string
 */
export function formatCurrency(
  amount: number,
  currency = 'GBP',
  locale = 'en-GB'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
  }).format(amount)
}

/**
 * Format percentage
 * @param value - Decimal value (0-1)
 * @param decimals - Number of decimal places (default: 0)
 * @returns Formatted percentage string (e.g., "75%")
 */
export function formatPercentage(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`
}

/**
 * Format duration in milliseconds to human-readable string
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "2h 30m")
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) {
    return `${days}d ${hours % 24}h`
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Truncate text with ellipsis
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to add (default: '...')
 * @returns Truncated text
 */
export function truncate(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - suffix.length) + suffix
}

/**
 * Format phone number (UK format)
 * @param phone - Phone number string
 * @returns Formatted phone number
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '')
  
  // UK mobile (07xxx)
  if (digits.startsWith('447') && digits.length === 12) {
    return `+44 ${digits.slice(2, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`
  }
  
  // UK mobile without country code
  if (digits.startsWith('07') && digits.length === 11) {
    return `0${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  
  // UK landline
  if (digits.startsWith('44') && digits.length === 12) {
    return `+44 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
  }
  
  // Default formatting
  return phone
}

/**
 * Format date relative to now
 * @param date - Date to format
 * @returns Relative time string (e.g., "2 hours ago", "in 3 days")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffSec = Math.floor(Math.abs(diffMs) / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  
  const isPast = diffMs < 0
  const prefix = isPast ? '' : 'in '
  const suffix = isPast ? ' ago' : ''
  
  if (diffDay > 0) {
    const unit = diffDay === 1 ? 'day' : 'days'
    return `${prefix}${diffDay} ${unit}${suffix}`
  } else if (diffHour > 0) {
    const unit = diffHour === 1 ? 'hour' : 'hours'
    return `${prefix}${diffHour} ${unit}${suffix}`
  } else if (diffMin > 0) {
    const unit = diffMin === 1 ? 'minute' : 'minutes'
    return `${prefix}${diffMin} ${unit}${suffix}`
  } else {
    return isPast ? 'just now' : 'in a moment'
  }
}

/**
 * Format file size validation message
 * @param maxSize - Maximum size in bytes
 * @returns Validation message
 */
export function formatFileSizeLimit(maxSize: number): string {
  return `Maximum file size is ${formatBytes(maxSize)}`
}

/**
 * Format list of items with proper grammar
 * @param items - Array of strings
 * @param conjunction - Conjunction to use (default: 'and')
 * @returns Formatted string (e.g., "item1, item2, and item3")
 */
export function formatList(items: string[], conjunction = 'and'): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`
  
  const lastItem = items[items.length - 1]
  const otherItems = items.slice(0, -1)
  return `${otherItems.join(', ')}, ${conjunction} ${lastItem}`
}