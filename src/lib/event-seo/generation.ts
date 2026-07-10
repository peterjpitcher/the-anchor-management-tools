// ──────────────────────────────────────────────────────────────
// Event SEO generation infrastructure — facts builder, preflight
// quality gates, retry/timeout constants.
// ──────────────────────────────────────────────────────────────

// ── Venue context ───────────────────────────────────────────

export type VenueContext = {
  name: string
  area: string
  county: string
  postcode: string
  address: string
  phone: string
  description: string
  transport: string[]
  parking: string
  accessibility: string
  facilities: string[]
  nearby: string[]
}

export const ANCHOR_VENUE_CONTEXT: VenueContext = {
  name: 'The Anchor',
  area: 'Stanwell Moor',
  county: 'Surrey',
  postcode: 'TW19 6AQ',
  address: 'Horton Road, Stanwell Moor, Surrey, TW19 6AQ',
  phone: '01753 682707',
  description: 'A popular pub and venue near Heathrow in Stanwell Moor, Surrey',
  transport: [
    '7 minutes from Heathrow Terminal 5',
    'Bordering West Drayton and Staines-upon-Thames',
  ],
  parking: 'Free parking (20 spaces)',
  accessibility: 'Ground-floor venue with step-free access from car park',
  facilities: [
    'Dog and family friendly',
    'Full menu available while the kitchen is open',
  ],
  nearby: [
    'Stanwell Moor',
    'Staines-upon-Thames',
    'Heathrow',
    'West Drayton',
  ],
}

// ── Core types ──────────────────────────────────────────────

export type EventSeoFacts = {
  name: string
  date: string | null
  time: string | null
  endTime: string | null
  categoryName: string | null
  capacity: number | null
  pricingLabel: string | null
  performerName: string | null
  performerType: string | null
  bookingUrlPresent: boolean
  brief: string | null
  kitchenService: string | null
  isFree: boolean
  existingContent: {
    metaTitle: string | null
    metaDescription: string | null
    shortDescription: string | null
    longDescription: string | null
    highlights: string[]
    keywords: string[]
  }
  keywords: {
    primary: string[]
    secondary: string[]
    local: string[]
  }
  venue: VenueContext
}

export type BuildFactsInput = {
  name: string
  date?: string | null
  time?: string | null
  endTime?: string | null
  categoryName?: string | null
  capacity?: number | null
  brief?: string | null
  kitchenService?: string | null
  performerName?: string | null
  performerType?: string | null
  price?: string | null
  isFree?: boolean
  bookingUrl?: string | null
  existingMetaTitle?: string | null
  existingMetaDescription?: string | null
  existingShortDescription?: string | null
  existingLongDescription?: string | null
  existingHighlights?: string[]
  existingKeywords?: string[]
  primaryKeywords?: string[]
  secondaryKeywords?: string[]
  localSeoKeywords?: string[]
}

export type BuildFactsDbData = {
  name?: string | null
  date?: string | null
  start_time?: string | null
  end_time?: string | null
  category_name?: string | null
  capacity?: number | null
  description?: string | null
  performer_name?: string | null
  performer_type?: string | null
  price?: string | null
  is_free?: boolean
  booking_url?: string | null
  brief?: string | null
}

export type EventKitchenWindow = {
  openMinutes: number
  closeMinutes: number
}

// ── Helpers ─────────────────────────────────────────────────

function nonEmpty(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function coalesce(
  formValue: string | null | undefined,
  dbValue: string | null | undefined
): string | null {
  return nonEmpty(formValue) ?? nonEmpty(dbValue) ?? null
}

function coalesceNumber(
  formValue: number | null | undefined,
  dbValue: number | null | undefined
): number | null {
  if (formValue != null) return formValue
  if (dbValue != null) return dbValue
  return null
}

function coalesceBool(
  formValue: boolean | undefined,
  dbValue: boolean | undefined
): boolean {
  if (formValue !== undefined) return formValue
  if (dbValue !== undefined) return dbValue
  return false
}

function normalizeKeywords(keywords: string[] | null | undefined): string[] {
  if (!keywords || keywords.length === 0) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const kw of keywords) {
    const normalized = kw.trim().toLowerCase()
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

function deduplicateAcrossArrays(
  primary: string[],
  secondary: string[],
  local: string[]
): { primary: string[]; secondary: string[]; local: string[] } {
  const seen = new Set<string>()

  const dedupedPrimary: string[] = []
  for (const kw of primary) {
    if (!seen.has(kw)) {
      seen.add(kw)
      dedupedPrimary.push(kw)
    }
  }

  const dedupedSecondary: string[] = []
  for (const kw of secondary) {
    if (!seen.has(kw)) {
      seen.add(kw)
      dedupedSecondary.push(kw)
    }
  }

  const dedupedLocal: string[] = []
  for (const kw of local) {
    if (!seen.has(kw)) {
      seen.add(kw)
      dedupedLocal.push(kw)
    }
  }

  return { primary: dedupedPrimary, secondary: dedupedSecondary, local: dedupedLocal }
}

function buildPricingLabel(
  price: string | null | undefined,
  isFree: boolean
): string | null {
  if (isFree) return 'Free entry'
  if (nonEmpty(price)) return price!.trim()
  return null
}

function parseClockMinutes(value: string | null | undefined): number | null {
  if (!value) return null

  const normalized = value.trim().toLowerCase()
  const twelveHour = normalized.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/)
  if (twelveHour) {
    let hours = Number(twelveHour[1])
    const minutes = Number(twelveHour[2])
    if (hours < 1 || hours > 12 || minutes > 59) return null
    if (hours === 12) hours = 0
    if (twelveHour[3] === 'pm') hours += 12
    return hours * 60 + minutes
  }

  const twentyFourHour = normalized.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!twentyFourHour) return null

  const hours = Number(twentyFourHour[1])
  const minutes = Number(twentyFourHour[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function formatClockMinutes(totalMinutes: number): string {
  const minutesInDay = 24 * 60
  const normalized = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay
  const hours24 = Math.floor(normalized / 60)
  const minutes = normalized % 60
  const suffix = hours24 >= 12 ? 'pm' : 'am'
  const hours12 = hours24 % 12 || 12
  return `${hours12}:${String(minutes).padStart(2, '0')}${suffix}`
}

/**
 * Build a date-specific menu fact for the content generator. The kitchen window
 * comes from business_hours/special_hours, so generated copy follows live hours
 * and never falls back to a pizza-only claim.
 */
export function describeKitchenServiceForEvent(
  window: EventKitchenWindow | null,
  startTime?: string | null,
  endTime?: string | null,
): string {
  if (!window) {
    return 'The kitchen is closed on this event date. Do not say food or the menu is available.'
  }

  const opens = formatClockMinutes(window.openMinutes)
  const closes = formatClockMinutes(window.closeMinutes)
  const hours = `${opens} to ${closes}`
  const startMinutes = parseClockMinutes(startTime)
  const parsedEndMinutes = parseClockMinutes(endTime)

  if (startMinutes === null) {
    return `The full menu is available from ${hours}. Only mention it if the event overlaps these kitchen hours. Never describe the food offer as pizza-only.`
  }

  let overlap: boolean | null = null
  if (parsedEndMinutes !== null) {
    let endMinutes = parsedEndMinutes
    if (endMinutes <= startMinutes) endMinutes += 24 * 60
    overlap = startMinutes < window.closeMinutes && endMinutes > window.openMinutes
  } else if (startMinutes >= window.openMinutes && startMinutes < window.closeMinutes) {
    overlap = true
  } else if (startMinutes >= window.closeMinutes) {
    overlap = false
  }

  if (overlap === false) {
    return `The full menu hours on this event date are ${hours}, but the event does not overlap them. Do not say food or the menu is available during the event.`
  }

  if (overlap === true) {
    return `The full menu is available from ${hours}, and the event overlaps these kitchen hours. Mention the full menu, not pizza on its own, and make the kitchen closing time clear if the event continues later.`
  }

  return `The full menu is available from ${hours}. Only mention it if the event overlaps these kitchen hours. Never describe the food offer as pizza-only.`
}

// ── Facts builder ───────────────────────────────────────────

export function buildEventSeoFacts(
  input: BuildFactsInput,
  dbData?: BuildFactsDbData | null
): EventSeoFacts {
  const db = dbData ?? null

  const isFree = coalesceBool(input.isFree, db?.is_free)
  const price = coalesce(input.price, db?.price)

  const rawPrimary = normalizeKeywords(input.primaryKeywords)
  const rawSecondary = normalizeKeywords(input.secondaryKeywords)
  const rawLocal = normalizeKeywords(input.localSeoKeywords)
  const keywords = deduplicateAcrossArrays(rawPrimary, rawSecondary, rawLocal)

  return {
    name: coalesce(input.name, db?.name) ?? input.name,
    date: coalesce(input.date, db?.date),
    time: coalesce(input.time, db?.start_time),
    endTime: coalesce(input.endTime, db?.end_time),
    categoryName: coalesce(input.categoryName, db?.category_name),
    capacity: coalesceNumber(input.capacity, db?.capacity),
    pricingLabel: buildPricingLabel(price, isFree),
    performerName: coalesce(input.performerName, db?.performer_name),
    performerType: coalesce(input.performerType, db?.performer_type),
    bookingUrlPresent: Boolean(
      nonEmpty(input.bookingUrl) ?? nonEmpty(db?.booking_url)
    ),
    brief: coalesce(input.brief, db?.brief ?? db?.description),
    kitchenService: nonEmpty(input.kitchenService),
    isFree,
    existingContent: {
      metaTitle: nonEmpty(input.existingMetaTitle) ?? null,
      metaDescription: nonEmpty(input.existingMetaDescription) ?? null,
      shortDescription: nonEmpty(input.existingShortDescription) ?? null,
      longDescription: nonEmpty(input.existingLongDescription) ?? null,
      highlights: (input.existingHighlights ?? []).filter(Boolean),
      keywords: (input.existingKeywords ?? []).filter(Boolean),
    },
    keywords,
    venue: ANCHOR_VENUE_CONTEXT,
  }
}

// ── Preflight check ─────────────────────────────────────────

const ENTERTAINMENT_CATEGORIES = /music|comedy|entertainment|karaoke|quiz/i

export type PreflightResult = {
  pass: boolean
  hardErrors: string[]
  softWarnings: string[]
}

export function preflightCheck(facts: EventSeoFacts): PreflightResult {
  const hardErrors: string[] = []
  const softWarnings: string[] = []

  // Hard requirements
  if (!nonEmpty(facts.name)) {
    hardErrors.push('Event name is required.')
  }
  if (!nonEmpty(facts.date)) {
    hardErrors.push('Event date is required.')
  }
  if (facts.keywords.primary.length === 0) {
    hardErrors.push('At least one primary keyword is required.')
  }

  const hasDetailSource =
    nonEmpty(facts.brief) !== null ||
    nonEmpty(facts.categoryName) !== null ||
    nonEmpty(facts.performerName) !== null ||
    nonEmpty(facts.pricingLabel) !== null ||
    nonEmpty(facts.existingContent.longDescription) !== null

  if (!hasDetailSource) {
    hardErrors.push(
      'Insufficient event details. Provide at least one of: brief, category, performer, pricing, or existing description.'
    )
  }

  // Soft warnings
  if (!nonEmpty(facts.time)) {
    softWarnings.push(
      'No event time provided — generated content will omit timing details.'
    )
  }

  if (
    nonEmpty(facts.categoryName) !== null &&
    ENTERTAINMENT_CATEGORIES.test(facts.categoryName!) &&
    !nonEmpty(facts.performerName)
  ) {
    softWarnings.push('No performer specified for this entertainment event.')
  }

  if (facts.capacity == null) {
    softWarnings.push('No capacity specified.')
  }

  if (!facts.isFree && !facts.bookingUrlPresent) {
    softWarnings.push(
      'No booking URL for a paid event — CTA will be generic.'
    )
  }

  if (!nonEmpty(facts.brief) && !nonEmpty(facts.existingContent.longDescription)) {
    softWarnings.push(
      'No brief or existing description — content may be less specific.'
    )
  }

  return {
    pass: hardErrors.length === 0,
    hardErrors,
    softWarnings,
  }
}

// ── Retry / timeout constants ───────────────────────────────

export const CONTENT_RETRY_CONFIG = {
  maxAttempts: 2,
  delay: 750,
  backoff: 'exponential' as const,
  factor: 2,
  maxDelay: 2500,
}

export const GENERATION_TIMEOUT_MS = 45_000
export const REPAIR_TIMEOUT_MS = 30_000
export const OVERALL_BUDGET_MS = 90_000
