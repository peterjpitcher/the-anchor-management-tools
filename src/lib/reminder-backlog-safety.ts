type ReminderBacklogRow = {
  id: unknown
  booking?: unknown
}

type BookingEventContainer = {
  event?: unknown
}

type EventContainer = {
  date?: unknown
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

function firstFromRelation<T>(value: unknown): T | null {
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null
  }
  return (value as T | null) ?? null
}

function extractEventDate(value: unknown): string | null {
  const booking = normalizeObject(firstFromRelation<BookingEventContainer>(value))
  const event = normalizeObject(firstFromRelation<EventContainer>(booking?.event))
  const date = event?.date

  if (typeof date !== 'string' || date.trim().length === 0) {
    return null
  }

  return date
}

function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function extractUniqueRowIds(params: {
  operation: string
  rows: Array<{ id: unknown }>
}): string[] {
  const invalidRows: string[] = []
  const duplicates: string[] = []
  const ids: string[] = []
  const seen = new Set<string>()

  params.rows.forEach((row, index) => {
    if (typeof row.id !== 'string' || row.id.trim().length === 0) {
      invalidRows.push(`row#${index + 1}`)
      return
    }

    const id = row.id.trim()
    if (seen.has(id)) {
      duplicates.push(id)
      return
    }

    seen.add(id)
    ids.push(id)
  })

  if (invalidRows.length > 0) {
    throw new Error(
      `${params.operation} returned rows with invalid ids: ${invalidRows.join(', ')}`
    )
  }

  if (duplicates.length > 0) {
    throw new Error(
      `${params.operation} returned duplicate ids: ${Array.from(new Set(duplicates)).join(', ')}`
    )
  }

  return ids
}

export function selectPastEventReminderIds(params: {
  rows: ReminderBacklogRow[]
  todayIsoDate: string
}): { pastReminderIds: string[]; invalidReminderIds: string[] } {
  const pastReminderIds: string[] = []
  const invalidReminderIds: string[] = []
  const seenIds = new Set<string>()

  for (const row of params.rows) {
    if (typeof row.id !== 'string' || row.id.trim().length === 0) {
      invalidReminderIds.push('[missing-id]')
      continue
    }

    const reminderId = row.id.trim()
    if (seenIds.has(reminderId)) {
      invalidReminderIds.push(reminderId)
      continue
    }
    seenIds.add(reminderId)

    const eventDate = extractEventDate(row.booking)

    if (!eventDate || !isIsoDateOnly(eventDate)) {
      invalidReminderIds.push(reminderId)
      continue
    }

    if (eventDate < params.todayIsoDate) {
      pastReminderIds.push(reminderId)
    }
  }

  return { pastReminderIds, invalidReminderIds }
}

export function assertNoInvalidPastEventReminderRows(invalidReminderIds: string[]): void {
  if (invalidReminderIds.length === 0) {
    return
  }

  throw new Error(
    `Cannot safely process pending reminders because ${invalidReminderIds.length} row(s) have invalid event context: ${invalidReminderIds.join(', ')}`
  )
}
