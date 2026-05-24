import { createAdminClient } from '@/lib/supabase/admin'

export type ReviewVisitChannel = 'event' | 'table' | 'private'

export type ReviewVisitCandidate = {
  channel: ReviewVisitChannel
  bookingId: string | null | undefined
  customerId: string | null | undefined
  visitAt: string | null | undefined
}

type ReviewVisitRecord = {
  channel: ReviewVisitChannel | 'parking'
  bookingId: string
  customerId: string
  visitAtMs: number
  createdAtMs: number
}

type SupabaseClientLike = ReturnType<typeof createAdminClient>

/**
 * Check if a customer has ever clicked a review link across any booking type.
 * Used to prevent sending duplicate review requests to customers who have
 * already left a review via a different booking channel.
 */
export async function hasCustomerReviewed(customerIds: string[]): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set()

  const db = createAdminClient()
  const reviewed = new Set<string>()

  // Batch check across all three tables in parallel
  const [bookings, tableBookings, privateBookings] = await Promise.all([
    db.from('bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
    db.from('table_bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
    db.from('private_bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
  ])

  for (const row of bookings.data ?? []) reviewed.add(row.customer_id)
  for (const row of tableBookings.data ?? []) reviewed.add(row.customer_id)
  for (const row of privateBookings.data ?? []) reviewed.add(row.customer_id)

  return reviewed
}

export function reviewVisitCandidateKey(candidate: {
  channel: ReviewVisitChannel | 'parking'
  bookingId: string | null | undefined
}): string {
  return `${candidate.channel}:${candidate.bookingId ?? ''}`
}

/**
 * Return the review candidates that represent a customer's first visit.
 *
 * The check is based on scheduled/attended visit time across customer-linked
 * event bookings, table bookings, private bookings, and parking bookings. That
 * keeps already-created future bookings from suppressing the first actual visit
 * while blocking review asks for customers who have been before.
 */
export async function getFirstVisitReviewEligibleCandidateKeys(
  candidates: ReviewVisitCandidate[],
  db: SupabaseClientLike = createAdminClient(),
): Promise<Set<string>> {
  const normalizedCandidates: ReviewVisitRecord[] = []
  for (const candidate of candidates) {
    const bookingId = candidate.bookingId?.trim()
    const customerId = candidate.customerId?.trim()
    const visitAtMs = parseTimestampMs(candidate.visitAt)

    if (!bookingId || !customerId || visitAtMs === null) {
      continue
    }

    normalizedCandidates.push({
      channel: candidate.channel,
      bookingId,
      customerId,
      visitAtMs,
      createdAtMs: visitAtMs,
    })
  }

  if (normalizedCandidates.length === 0) {
    return new Set()
  }

  const customerIds = [...new Set(normalizedCandidates.map((candidate) => candidate.customerId))]
  const [eventBookings, tableBookings, privateBookings, parkingBookings] = await Promise.all([
    db
      .from('bookings')
      .select(`
        id,
        customer_id,
        status,
        is_reminder_only,
        created_at,
        event:events(
          start_datetime,
          date,
          time,
          event_status
        )
      `)
      .in('customer_id', customerIds),
    db
      .from('table_bookings')
      .select('id, customer_id, status, start_datetime, booking_date, booking_time, created_at')
      .in('customer_id', customerIds),
    db
      .from('private_bookings')
      .select('id, customer_id, status, event_date, start_time, created_at')
      .in('customer_id', customerIds),
    db
      .from('parking_bookings')
      .select('id, customer_id, status, start_at, created_at')
      .in('customer_id', customerIds),
  ])

  const queryErrors = [
    eventBookings.error,
    tableBookings.error,
    privateBookings.error,
    parkingBookings.error,
  ].filter((error): error is NonNullable<typeof error> => error != null)

  if (queryErrors.length > 0) {
    const message = queryErrors.map(errorMessage).join('; ')
    throw new Error(`Failed to load first-visit review history: ${message}`)
  }

  const visitsByCustomer = new Map<string, ReviewVisitRecord[]>()
  for (const candidate of normalizedCandidates) {
    appendVisit(visitsByCustomer, candidate)
  }

  for (const row of eventBookings.data ?? []) {
    const record = normalizeEventBookingVisit(row)
    if (record) appendVisit(visitsByCustomer, record)
  }

  for (const row of tableBookings.data ?? []) {
    const record = normalizeTableBookingVisit(row)
    if (record) appendVisit(visitsByCustomer, record)
  }

  for (const row of privateBookings.data ?? []) {
    const record = normalizePrivateBookingVisit(row)
    if (record) appendVisit(visitsByCustomer, record)
  }

  for (const row of parkingBookings.data ?? []) {
    const record = normalizeParkingBookingVisit(row)
    if (record) appendVisit(visitsByCustomer, record)
  }

  const candidateKeysByCustomer = new Map<string, Set<string>>()
  for (const candidate of normalizedCandidates) {
    const keys = candidateKeysByCustomer.get(candidate.customerId) ?? new Set<string>()
    keys.add(reviewVisitCandidateKey(candidate))
    candidateKeysByCustomer.set(candidate.customerId, keys)
  }

  const eligible = new Set<string>()
  for (const [customerId, visits] of visitsByCustomer.entries()) {
    const candidateKeys = candidateKeysByCustomer.get(customerId)
    if (!candidateKeys || visits.length === 0) continue

    const [firstVisit] = visits.sort(compareReviewVisits)
    if (!firstVisit) continue

    const firstVisitKey = reviewVisitCandidateKey(firstVisit)
    if (candidateKeys.has(firstVisitKey)) {
      eligible.add(firstVisitKey)
    }
  }

  return eligible
}

function appendVisit(visitsByCustomer: Map<string, ReviewVisitRecord[]>, visit: ReviewVisitRecord): void {
  const visits = visitsByCustomer.get(visit.customerId) ?? []
  visits.push(visit)
  visitsByCustomer.set(visit.customerId, visits)
}

function compareReviewVisits(left: ReviewVisitRecord, right: ReviewVisitRecord): number {
  return (
    left.visitAtMs - right.visitAtMs ||
    left.createdAtMs - right.createdAtMs ||
    channelRank(left.channel) - channelRank(right.channel) ||
    left.bookingId.localeCompare(right.bookingId)
  )
}

function channelRank(channel: ReviewVisitRecord['channel']): number {
  switch (channel) {
    case 'event':
      return 0
    case 'table':
      return 1
    case 'private':
      return 2
    case 'parking':
      return 3
  }
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }

  return String(error)
}

function parseDateTimeParts(date: string | null | undefined, time: string | null | undefined): number | null {
  const datePart = date?.slice(0, 10)
  if (!datePart) return null

  const trimmedTime = time?.trim()
  const timePart = trimmedTime
    ? /^\d{1,2}:\d{2}$/.test(trimmedTime)
      ? `${trimmedTime}:00`
      : trimmedTime
    : '00:00:00'

  return parseTimestampMs(`${datePart}T${timePart}`)
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

function normalizeEventBookingVisit(row: any): ReviewVisitRecord | null {
  if (!row?.id || !row.customer_id) return null
  if (row.is_reminder_only) return null
  if (!['confirmed', 'visited_waiting_for_review', 'review_clicked', 'completed'].includes(row.status)) return null

  const event = firstRelation(row.event)
  if (event?.event_status && ['cancelled', 'draft'].includes(event.event_status)) return null

  const visitAtMs =
    parseTimestampMs(event?.start_datetime) ??
    parseDateTimeParts(event?.date, event?.time) ??
    parseTimestampMs(row.created_at)
  if (visitAtMs === null) return null

  return {
    channel: 'event',
    bookingId: row.id,
    customerId: row.customer_id,
    visitAtMs,
    createdAtMs: parseTimestampMs(row.created_at) ?? visitAtMs,
  }
}

function normalizeTableBookingVisit(row: any): ReviewVisitRecord | null {
  if (!row?.id || !row.customer_id) return null
  if (['cancelled', 'no_show', 'pending_payment', 'pending_card_capture'].includes(row.status)) return null

  const visitAtMs =
    parseTimestampMs(row.start_datetime) ??
    parseDateTimeParts(row.booking_date, row.booking_time) ??
    parseTimestampMs(row.created_at)
  if (visitAtMs === null) return null

  return {
    channel: 'table',
    bookingId: row.id,
    customerId: row.customer_id,
    visitAtMs,
    createdAtMs: parseTimestampMs(row.created_at) ?? visitAtMs,
  }
}

function normalizePrivateBookingVisit(row: any): ReviewVisitRecord | null {
  if (!row?.id || !row.customer_id) return null
  if (!['confirmed', 'completed'].includes(row.status)) return null

  const visitAtMs =
    parseDateTimeParts(row.event_date, row.start_time) ??
    parseTimestampMs(row.created_at)
  if (visitAtMs === null) return null

  return {
    channel: 'private',
    bookingId: row.id,
    customerId: row.customer_id,
    visitAtMs,
    createdAtMs: parseTimestampMs(row.created_at) ?? visitAtMs,
  }
}

function normalizeParkingBookingVisit(row: any): ReviewVisitRecord | null {
  if (!row?.id || !row.customer_id) return null
  if (['cancelled', 'expired'].includes(row.status)) return null

  const visitAtMs = parseTimestampMs(row.start_at) ?? parseTimestampMs(row.created_at)
  if (visitAtMs === null) return null

  return {
    channel: 'parking',
    bookingId: row.id,
    customerId: row.customer_id,
    visitAtMs,
    createdAtMs: parseTimestampMs(row.created_at) ?? visitAtMs,
  }
}
