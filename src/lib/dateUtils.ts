export function formatDate(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleDateString('en-GB', { month: 'long', day: 'numeric' })
} 