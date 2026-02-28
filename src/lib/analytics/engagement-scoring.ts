import type { SupabaseClient } from '@supabase/supabase-js'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const THREE_SIXTY_FIVE_DAYS_MS = 365 * 24 * 60 * 60 * 1000
const FREQUENT_BOOKER_THRESHOLD_90_DAYS = 5

type CustomerBucket = {
  customerId: string
  eventBookingCount: number
  tableBookingCount: number
  privateConfirmedCount: number
  scoredBookingTimestampsMs: number[]
  interestEventTypes: Set<string>
}

type EventRelationRecord = {
  event_type?: string | null
}

type EventRelation = EventRelationRecord | EventRelationRecord[] | null

function normalizeEventType(input?: string | null): string | null {
  const trimmed = input?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function chunkArray<T>(input: T[], size: number): T[][] {
  if (size <= 0) return [input]
  const chunks: T[][] = []
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size))
  }
  return chunks
}

function parseTimestampMs(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveEventType(relation: EventRelation): string | null {
  const eventRecord = Array.isArray(relation) ? relation[0] : relation
  return normalizeEventType(eventRecord?.event_type)
}

function getOrCreateBucket(map: Map<string, CustomerBucket>, customerId: string): CustomerBucket {
  const existing = map.get(customerId)
  if (existing) return existing

  const created: CustomerBucket = {
    customerId,
    eventBookingCount: 0,
    tableBookingCount: 0,
    privateConfirmedCount: 0,
    scoredBookingTimestampsMs: [],
    interestEventTypes: new Set<string>()
  }
  map.set(customerId, created)
  return created
}

function calculateRepeatBonus(sortedTimestampsMs: number[]): number {
  let bonus = 0
  let windowStart = 0

  for (let index = 0; index < sortedTimestampsMs.length; index += 1) {
    const current = sortedTimestampsMs[index]
    while (windowStart < index && current - sortedTimestampsMs[windowStart] > THIRTY_DAYS_MS) {
      windowStart += 1
    }

    const windowCount = index - windowStart + 1
    if (windowCount === 2) {
      bonus += 2
    } else if (windowCount >= 3) {
      bonus += 3
    }
  }

  return bonus
}

function countWithin(sortedTimestampsMs: number[], nowMs: number, durationMs: number): number {
  if (sortedTimestampsMs.length === 0) return 0
  const cutoff = nowMs - durationMs
  let firstInRange = sortedTimestampsMs.length

  for (let index = 0; index < sortedTimestampsMs.length; index += 1) {
    if (sortedTimestampsMs[index] >= cutoff) {
      firstInRange = index
      break
    }
  }

  return firstInRange === sortedTimestampsMs.length ? 0 : sortedTimestampsMs.length - firstInRange
}

async function ensureSystemLabels(
  supabase: SupabaseClient<any, 'public', any>,
  labelNames: string[]
): Promise<Map<string, string>> {
  const uniqueNames = Array.from(new Set(labelNames.filter((name) => name.trim().length > 0)))
  if (uniqueNames.length === 0) {
    return new Map<string, string>()
  }

  const labelByName = new Map<string, string>()

  for (const chunk of chunkArray(uniqueNames, 100)) {
    const { data, error } = await supabase
      .from('customer_labels')
      .select('id, name')
      .in('name', chunk)

    if (error) {
      throw error
    }

    for (const row of data || []) {
      labelByName.set((row as any).name, (row as any).id)
    }
  }

  const missing = uniqueNames.filter((name) => !labelByName.has(name))
  if (missing.length > 0) {
    for (const chunk of chunkArray(missing, 100)) {
      const { data, error } = await supabase
        .from('customer_labels')
        .insert(
          chunk.map((name) => ({
            name,
            description: 'System generated analytics label',
            color: name.startsWith('Interested: ') ? '#0EA5E9' : '#10B981',
            icon: name.startsWith('Interested: ') ? 'sparkles' : 'chart-bar',
            auto_apply_rules: {
              system: 'v05_analytics_scoring'
            }
          }))
        )
        .select('id, name')

      if (error) {
        throw error
      }

      for (const row of data || []) {
        labelByName.set((row as any).name, (row as any).id)
      }
    }
  }

  return labelByName
}

export type EngagementScoringSummary = {
  processed_customers: number
  customer_scores_upserted: number
  labels_managed: number
  label_assignments_inserted: number
  frequent_bookers: number
  high_value_private: number
  interested_segments: number
  generated_at: string
}

export async function recalculateEngagementScoresAndLabels(
  supabase: SupabaseClient<any, 'public', any>
): Promise<EngagementScoringSummary> {
  const nowMs = Date.now()

  const [customersResult, eventBookingsResult, tableBookingsResult, privateBookingsResult, waitlistEntriesResult] =
    await Promise.all([
      supabase.from('customers').select('id'),
      supabase
        .from('bookings')
        .select('customer_id, created_at, event:events(event_type)')
        .not('customer_id', 'is', null),
      supabase
        .from('table_bookings')
        .select('customer_id, created_at')
        .not('customer_id', 'is', null),
      supabase
        .from('private_bookings')
        .select('customer_id, created_at, status')
        .not('customer_id', 'is', null),
      supabase
        .from('waitlist_entries')
        .select('customer_id, event:events(event_type)')
        .not('customer_id', 'is', null)
    ])

  const errors: string[] = []
  const results = [customersResult, eventBookingsResult, tableBookingsResult, privateBookingsResult, waitlistEntriesResult]
  for (const result of results) {
    if (result.error) {
      errors.push(result.error.message)
    }
  }
  if (errors.length > 0) {
    throw new Error(`Failed to load engagement scoring inputs: ${errors.join('; ')}`)
  }

  const bucketByCustomer = new Map<string, CustomerBucket>()

  const allCustomerRows = (customersResult.data || []) as Array<{ id: string }>
  for (const row of allCustomerRows) {
    getOrCreateBucket(bucketByCustomer, row.id)
  }

  const eventBookingRows = (eventBookingsResult.data || []) as Array<{
    customer_id: string | null
    created_at: string | null
    event?: EventRelation
  }>

  for (const row of eventBookingRows) {
    if (!row.customer_id) continue
    const bucket = getOrCreateBucket(bucketByCustomer, row.customer_id)
    bucket.eventBookingCount += 1

    const createdAtMs = parseTimestampMs(row.created_at)
    if (createdAtMs !== null) {
      bucket.scoredBookingTimestampsMs.push(createdAtMs)
    }

    const eventType = resolveEventType(row.event || null)
    if (eventType) bucket.interestEventTypes.add(eventType)
  }

  const tableBookingRows = (tableBookingsResult.data || []) as Array<{
    customer_id: string | null
    created_at: string | null
  }>

  for (const row of tableBookingRows) {
    if (!row.customer_id) continue
    const bucket = getOrCreateBucket(bucketByCustomer, row.customer_id)
    bucket.tableBookingCount += 1

    const createdAtMs = parseTimestampMs(row.created_at)
    if (createdAtMs !== null) {
      bucket.scoredBookingTimestampsMs.push(createdAtMs)
    }
  }

  const privateBookingRows = (privateBookingsResult.data || []) as Array<{
    customer_id: string | null
    created_at: string | null
    status: string | null
  }>

  for (const row of privateBookingRows) {
    if (!row.customer_id) continue
    if (!row.status || !['confirmed', 'completed'].includes(row.status)) continue

    const bucket = getOrCreateBucket(bucketByCustomer, row.customer_id)
    bucket.privateConfirmedCount += 1

    const createdAtMs = parseTimestampMs(row.created_at)
    if (createdAtMs !== null) {
      bucket.scoredBookingTimestampsMs.push(createdAtMs)
    }
  }

  const waitlistRows = (waitlistEntriesResult.data || []) as Array<{
    customer_id: string | null
    event?: EventRelation
  }>

  for (const row of waitlistRows) {
    if (!row.customer_id) continue
    const bucket = getOrCreateBucket(bucketByCustomer, row.customer_id)
    const eventType = resolveEventType(row.event || null)
    if (eventType) bucket.interestEventTypes.add(eventType)
  }

  const scoreRows: Array<{
    customer_id: string
    total_score: number
    last_booking_date: string | null
    bookings_last_30: number
    bookings_last_90: number
    bookings_last_365: number
    booking_breakdown: Record<string, number>
  }> = []

  const frequentBookers = new Set<string>()
  const highValuePrivate = new Set<string>()
  const interestedByEventType = new Map<string, Set<string>>()

  for (const bucket of bucketByCustomer.values()) {
    const sortedTimestamps = [...bucket.scoredBookingTimestampsMs].sort((a, b) => a - b)

    const baseScore =
      bucket.tableBookingCount * 1 +
      bucket.eventBookingCount * 3 +
      bucket.privateConfirmedCount * 8

    const repeatBonus = calculateRepeatBonus(sortedTimestamps)
    const totalScore = baseScore + repeatBonus

    const bookingsLast30 = countWithin(sortedTimestamps, nowMs, THIRTY_DAYS_MS)
    const bookingsLast90 = countWithin(sortedTimestamps, nowMs, NINETY_DAYS_MS)
    const bookingsLast365 = countWithin(sortedTimestamps, nowMs, THREE_SIXTY_FIVE_DAYS_MS)

    const lastBookingDate =
      sortedTimestamps.length > 0
        ? new Date(sortedTimestamps[sortedTimestamps.length - 1]).toISOString().slice(0, 10)
        : null

    scoreRows.push({
      customer_id: bucket.customerId,
      total_score: totalScore,
      last_booking_date: lastBookingDate,
      bookings_last_30: bookingsLast30,
      bookings_last_90: bookingsLast90,
      bookings_last_365: bookingsLast365,
      booking_breakdown: {
        event: bucket.eventBookingCount,
        table: bucket.tableBookingCount,
        private_confirmed: bucket.privateConfirmedCount,
        scored_total: sortedTimestamps.length
      }
    })

    if (bookingsLast90 >= FREQUENT_BOOKER_THRESHOLD_90_DAYS) {
      frequentBookers.add(bucket.customerId)
    }

    if (bucket.privateConfirmedCount > 0) {
      highValuePrivate.add(bucket.customerId)
    }

    for (const eventType of bucket.interestEventTypes) {
      const set = interestedByEventType.get(eventType) || new Set<string>()
      set.add(bucket.customerId)
      interestedByEventType.set(eventType, set)
    }
  }

  for (const chunk of chunkArray(scoreRows, 500)) {
    if (chunk.length === 0) continue

    const { error } = await supabase.from('customer_scores').upsert(chunk, {
      onConflict: 'customer_id'
    })

    if (error) {
      throw error
    }
  }

  const frequentLabel = 'Frequent booker'
  const highValueLabel = 'High value: Private booking'
  const interestLabels = Array.from(interestedByEventType.keys()).map((eventType) => `Interested: ${eventType}`)

  const managedLabelNames = [frequentLabel, highValueLabel, ...interestLabels]
  const labelIdByName = await ensureSystemLabels(supabase, managedLabelNames)

  const managedLabelIds = managedLabelNames
    .map((name) => labelIdByName.get(name))
    .filter((id): id is string => Boolean(id))

  // Delete ALL auto-assigned analytics labels (not just labels in the current run),
  // so stale labels from previous runs (e.g. "Interested: Uncategorized") are also cleaned up.
  const { data: allSystemLabels, error: systemLabelsError } = await supabase
    .from('customer_labels')
    .select('id')
    .contains('auto_apply_rules', { system: 'v05_analytics_scoring' })

  if (systemLabelsError) {
    throw systemLabelsError
  }

  const allSystemLabelIds = (allSystemLabels || []).map((l: any) => l.id)

  if (allSystemLabelIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('customer_label_assignments')
      .delete()
      .eq('auto_assigned', true)
      .in('label_id', allSystemLabelIds)

    if (deleteError) {
      throw deleteError
    }
  }

  const desiredAssignments: Array<{
    customer_id: string
    label_id: string
    auto_assigned: boolean
    notes: string
  }> = []

  const frequentLabelId = labelIdByName.get(frequentLabel)
  if (frequentLabelId) {
    for (const customerId of frequentBookers) {
      desiredAssignments.push({
        customer_id: customerId,
        label_id: frequentLabelId,
        auto_assigned: true,
        notes: 'v0.5 analytics: frequent booker'
      })
    }
  }

  const highValueLabelId = labelIdByName.get(highValueLabel)
  if (highValueLabelId) {
    for (const customerId of highValuePrivate) {
      desiredAssignments.push({
        customer_id: customerId,
        label_id: highValueLabelId,
        auto_assigned: true,
        notes: 'v0.5 analytics: private booking value'
      })
    }
  }

  for (const [eventType, customerIds] of interestedByEventType.entries()) {
    const labelId = labelIdByName.get(`Interested: ${eventType}`)
    if (!labelId) continue

    for (const customerId of customerIds) {
      desiredAssignments.push({
        customer_id: customerId,
        label_id: labelId,
        auto_assigned: true,
        notes: `v0.5 analytics: event interest ${eventType}`
      })
    }
  }

  for (const chunk of chunkArray(desiredAssignments, 500)) {
    if (chunk.length === 0) continue

    const { error } = await supabase.from('customer_label_assignments').upsert(chunk, {
      onConflict: 'customer_id,label_id',
      ignoreDuplicates: true
    })

    if (error) {
      throw error
    }
  }

  return {
    processed_customers: bucketByCustomer.size,
    customer_scores_upserted: scoreRows.length,
    labels_managed: managedLabelIds.length,
    label_assignments_inserted: desiredAssignments.length,
    frequent_bookers: frequentBookers.size,
    high_value_private: highValuePrivate.size,
    interested_segments: interestLabels.length,
    generated_at: new Date().toISOString()
  }
}
