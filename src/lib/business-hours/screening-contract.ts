export type ServiceWindow = { startAt: string; endAt: string }
export type ScreeningDayHours = {
  date: string
  state: 'open' | 'closed' | 'unknown'
  regularOpensAt: string | null
  bar: ServiceWindow | null
  kitchen: ServiceWindow[]
  kitchenState: 'known' | 'unknown'
  hasSpecialHours: boolean
  fingerprint: string
}
export type ScreeningHoursResponse = {
  schemaVersion: 1
  timezone: 'Europe/London'
  days: ScreeningDayHours[]
}
