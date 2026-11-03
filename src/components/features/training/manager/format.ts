/** "25 min", "1 h", "1 h 5 min" for a whole number of minutes. */
export function formatTrainingMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes))
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}
