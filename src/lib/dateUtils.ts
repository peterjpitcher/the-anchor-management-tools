export function formatDate(date: string | Date): string {
  const d = new Date(date)
  // Format as "January 15, 2024"
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function getTodayIsoDate(): string {
  const now = new Date()
  const offsetMinutes = now.getTimezoneOffset()
  now.setMinutes(now.getMinutes() - offsetMinutes)
  return now.toISOString().split('T')[0]
}

export function toLocalIsoDate(date: Date): string {
  const copy = new Date(date.getTime())
  const offsetMinutes = copy.getTimezoneOffset()
  copy.setMinutes(copy.getMinutes() - offsetMinutes)
  return copy.toISOString().split('T')[0]
}

export function getLocalIsoDateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return toLocalIsoDate(date)
}

export function getLocalIsoDateDaysAhead(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toLocalIsoDate(date)
}

export function formatDateFull(date: string | Date | null): string {
  if (!date) return 'To be confirmed'
  const d = new Date(date)
  return d.toLocaleDateString('en-GB', { 
    weekday: 'long',
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  })
}

export function formatTime12Hour(time: string | null): string {
  if (!time) return 'TBC'
  
  // Handle time in HH:MM format
  const [hours, minutes] = time.split(':').slice(0, 2).map(num => parseInt(num, 10))
  
  if (isNaN(hours) || isNaN(minutes)) return time
  
  const period = hours >= 12 ? 'pm' : 'am'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  
  // If minutes are 0, just show the hour (e.g., "7PM")
  // Otherwise show full time (e.g., "7:30PM")
  if (minutes === 0) {
    return `${displayHours}${period}`
  } else {
    return `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`
  }
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleString('en-GB', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatDateTime12Hour(date: string | Date): string {
  const d = new Date(date)
  const dateStr = d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
  
  const hours = d.getHours().toString().padStart(2, '0')
  const minutes = d.getMinutes().toString().padStart(2, '0')
  const timeStr = formatTime12Hour(`${hours}:${minutes}`)
  
  return `${dateStr} at ${timeStr}`
}

export function formatDateWithTimeForSms(date: string | Date, time?: string | null): string {
  const d = new Date(date)
  const formattedDate = d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })

  if (!time) {
    return formattedDate
  }

  return `${formattedDate} at ${formatTime12Hour(time)}`
}
