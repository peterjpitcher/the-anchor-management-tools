export function formatDate(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
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
  const [hours, minutes] = time.split(':').map(num => parseInt(num, 10))
  
  if (isNaN(hours) || isNaN(minutes)) return time
  
  const period = hours >= 12 ? 'PM' : 'AM'
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
  
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  
  const timeStr = minutes === 0 
    ? `${displayHours}${period}`
    : `${displayHours}:${minutes.toString().padStart(2, '0')}${period}`
  
  return `${dateStr} at ${timeStr}`
}