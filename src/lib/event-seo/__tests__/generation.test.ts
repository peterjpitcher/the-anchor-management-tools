import { describe, it, expect } from 'vitest'
import {
  buildEventSeoFacts,
  preflightCheck,
  ANCHOR_VENUE_CONTEXT,
  CONTENT_RETRY_CONFIG,
  GENERATION_TIMEOUT_MS,
  REPAIR_TIMEOUT_MS,
  OVERALL_BUDGET_MS,
} from '../generation'
import type {
  BuildFactsInput,
  BuildFactsDbData,
  EventSeoFacts,
} from '../generation'
import {
  buildGenerationMessages,
  buildRepairMessages,
  buildFactsJson,
  SYSTEM_ROLE,
  ANCHOR_VENUE_CONTEXT_PROMPT,
  OUTPUT_RUBRIC,
  FIELD_RULES,
  KEYWORD_RULES,
} from '../prompts'

// ── Fixtures ────────────────────────────────────────────────

function completeInput(): BuildFactsInput {
  return {
    name: 'Live Music — Jessica Lovelock',
    date: '2026-06-14',
    time: '7:00 PM',
    categoryName: 'Live Music',
    capacity: 80,
    brief: 'An evening of acoustic folk and indie covers.',
    performerName: 'Jessica Lovelock',
    performerType: 'Singer-Songwriter',
    price: '£10',
    isFree: false,
    bookingUrl: 'https://example.com/book',
    existingMetaTitle: 'Old Title',
    existingMetaDescription: 'Old description here',
    existingShortDescription: 'Short desc',
    existingLongDescription: 'A longer existing description paragraph.',
    existingHighlights: ['Great atmosphere', 'Free parking'],
    existingKeywords: ['live music', 'stanwell moor'],
    primaryKeywords: ['Live Music'],
    secondaryKeywords: ['acoustic night', 'pub gig'],
    localSeoKeywords: ['Stanwell Moor', 'near Heathrow'],
  }
}

function completeDbData(): BuildFactsDbData {
  return {
    name: 'DB Event Name',
    date: '2026-06-15',
    start_time: '8:00 PM',
    category_name: 'DB Category',
    capacity: 100,
    description: 'DB description text.',
    performer_name: 'DB Performer',
    performer_type: 'Band',
    price: '£15',
    is_free: false,
    booking_url: 'https://db.example.com/book',
    brief: 'DB brief text.',
  }
}

// ── buildEventSeoFacts ──────────────────────────────────────

describe('buildEventSeoFacts', () => {
  it('populates all fields from complete input', () => {
    const facts = buildEventSeoFacts(completeInput())

    expect(facts.name).toBe('Live Music — Jessica Lovelock')
    expect(facts.date).toBe('2026-06-14')
    expect(facts.time).toBe('7:00 PM')
    expect(facts.categoryName).toBe('Live Music')
    expect(facts.capacity).toBe(80)
    expect(facts.pricingLabel).toBe('£10')
    expect(facts.performerName).toBe('Jessica Lovelock')
    expect(facts.performerType).toBe('Singer-Songwriter')
    expect(facts.bookingUrlPresent).toBe(true)
    expect(facts.brief).toBe('An evening of acoustic folk and indie covers.')
    expect(facts.isFree).toBe(false)
    expect(facts.existingContent.metaTitle).toBe('Old Title')
    expect(facts.existingContent.highlights).toEqual(['Great atmosphere', 'Free parking'])
    expect(facts.venue).toBe(ANCHOR_VENUE_CONTEXT)
  })

  it('form input wins over DB data for every field', () => {
    const facts = buildEventSeoFacts(completeInput(), completeDbData())

    expect(facts.name).toBe('Live Music — Jessica Lovelock')
    expect(facts.date).toBe('2026-06-14')
    expect(facts.time).toBe('7:00 PM')
    expect(facts.categoryName).toBe('Live Music')
    expect(facts.capacity).toBe(80)
    expect(facts.performerName).toBe('Jessica Lovelock')
    expect(facts.performerType).toBe('Singer-Songwriter')
    expect(facts.brief).toBe('An evening of acoustic folk and indie covers.')
  })

  it('falls back to DB data when form input is missing', () => {
    const minimalInput: BuildFactsInput = { name: '' }
    const facts = buildEventSeoFacts(minimalInput, completeDbData())

    expect(facts.name).toBe('DB Event Name')
    expect(facts.date).toBe('2026-06-15')
    expect(facts.time).toBe('8:00 PM')
    expect(facts.categoryName).toBe('DB Category')
    expect(facts.capacity).toBe(100)
    expect(facts.performerName).toBe('DB Performer')
    expect(facts.performerType).toBe('Band')
    expect(facts.brief).toBe('DB brief text.')
  })

  it('falls back to DB description when brief is missing', () => {
    const input: BuildFactsInput = { name: 'Test' }
    const dbData: BuildFactsDbData = { description: 'From DB description' }
    const facts = buildEventSeoFacts(input, dbData)

    expect(facts.brief).toBe('From DB description')
  })

  it('returns null when both form and DB data are missing', () => {
    const facts = buildEventSeoFacts({ name: 'Test Event' })

    expect(facts.date).toBeNull()
    expect(facts.time).toBeNull()
    expect(facts.categoryName).toBeNull()
    expect(facts.capacity).toBeNull()
    expect(facts.performerName).toBeNull()
    expect(facts.performerType).toBeNull()
    expect(facts.brief).toBeNull()
    expect(facts.pricingLabel).toBeNull()
    expect(facts.bookingUrlPresent).toBe(false)
  })

  it('normalizes keywords to lowercase and trims whitespace', () => {
    const input: BuildFactsInput = {
      name: 'Test',
      primaryKeywords: ['  Live MUSIC  ', 'pub gig'],
      secondaryKeywords: ['Acoustic Night'],
      localSeoKeywords: ['  STANWELL moor '],
    }
    const facts = buildEventSeoFacts(input)

    expect(facts.keywords.primary).toEqual(['live music', 'pub gig'])
    expect(facts.keywords.secondary).toEqual(['acoustic night'])
    expect(facts.keywords.local).toEqual(['stanwell moor'])
  })

  it('deduplicates keywords across arrays', () => {
    const input: BuildFactsInput = {
      name: 'Test',
      primaryKeywords: ['live music', 'pub gig'],
      secondaryKeywords: ['Live Music', 'acoustic night'],
      localSeoKeywords: ['pub gig', 'stanwell moor'],
    }
    const facts = buildEventSeoFacts(input)

    expect(facts.keywords.primary).toEqual(['live music', 'pub gig'])
    expect(facts.keywords.secondary).toEqual(['acoustic night'])
    expect(facts.keywords.local).toEqual(['stanwell moor'])
  })

  it('builds pricing label: isFree → "Free entry"', () => {
    const input: BuildFactsInput = { name: 'Test', isFree: true, price: '£10' }
    const facts = buildEventSeoFacts(input)
    expect(facts.pricingLabel).toBe('Free entry')
    expect(facts.isFree).toBe(true)
  })

  it('builds pricing label: price present → use as-is', () => {
    const input: BuildFactsInput = { name: 'Test', isFree: false, price: '£15' }
    const facts = buildEventSeoFacts(input)
    expect(facts.pricingLabel).toBe('£15')
  })

  it('builds pricing label: neither → null', () => {
    const input: BuildFactsInput = { name: 'Test' }
    const facts = buildEventSeoFacts(input)
    expect(facts.pricingLabel).toBeNull()
  })

  it('always sets venue to ANCHOR_VENUE_CONTEXT', () => {
    const facts = buildEventSeoFacts({ name: 'Test' })
    expect(facts.venue).toBe(ANCHOR_VENUE_CONTEXT)
    expect(facts.venue.phone).toBe('01753 682707')
  })
})

// ── preflightCheck ──────────────────────────────────────────

describe('preflightCheck', () => {
  function minimalPassingFacts(): EventSeoFacts {
    return buildEventSeoFacts({
      name: 'Test Event',
      date: '2026-06-14',
      brief: 'A good brief for testing.',
      primaryKeywords: ['test event'],
    })
  }

  it('passes with complete input and no warnings', () => {
    const facts = buildEventSeoFacts(completeInput())
    const result = preflightCheck(facts)
    expect(result.pass).toBe(true)
    expect(result.hardErrors).toHaveLength(0)
  })

  it('hard error: missing name', () => {
    const facts = minimalPassingFacts()
    facts.name = ''
    const result = preflightCheck(facts)
    expect(result.pass).toBe(false)
    expect(result.hardErrors).toContain('Event name is required.')
  })

  it('hard error: missing date', () => {
    const facts = minimalPassingFacts()
    facts.date = null
    const result = preflightCheck(facts)
    expect(result.pass).toBe(false)
    expect(result.hardErrors).toContain('Event date is required.')
  })

  it('hard error: no primary keywords', () => {
    const facts = minimalPassingFacts()
    facts.keywords = { primary: [], secondary: [], local: [] }
    const result = preflightCheck(facts)
    expect(result.pass).toBe(false)
    expect(result.hardErrors).toContain('At least one primary keyword is required.')
  })

  it('hard error: insufficient detail (name + date only)', () => {
    const facts = buildEventSeoFacts({
      name: 'Test',
      date: '2026-06-14',
      primaryKeywords: ['test'],
    })
    const result = preflightCheck(facts)
    expect(result.pass).toBe(false)
    expect(result.hardErrors[0]).toContain('Insufficient event details')
  })

  it('passes with name + date + brief', () => {
    const result = preflightCheck(minimalPassingFacts())
    expect(result.pass).toBe(true)
  })

  it('passes with name + date + categoryName', () => {
    const facts = buildEventSeoFacts({
      name: 'Test',
      date: '2026-06-14',
      categoryName: 'Quiz Night',
      primaryKeywords: ['quiz night'],
    })
    const result = preflightCheck(facts)
    expect(result.pass).toBe(true)
  })

  it('soft warning: missing time', () => {
    const facts = minimalPassingFacts()
    facts.time = null
    const result = preflightCheck(facts)
    expect(result.pass).toBe(true)
    expect(result.softWarnings).toContain(
      'No event time provided — generated content will omit timing details.'
    )
  })

  it('soft warning: missing performer for music category', () => {
    const facts = buildEventSeoFacts({
      name: 'Test',
      date: '2026-06-14',
      categoryName: 'Live Music',
      primaryKeywords: ['live music'],
    })
    const result = preflightCheck(facts)
    expect(result.softWarnings).toContain(
      'No performer specified for this entertainment event.'
    )
  })

  it('no performer warning for non-entertainment category', () => {
    const facts = buildEventSeoFacts({
      name: 'Test',
      date: '2026-06-14',
      categoryName: 'Sunday Lunch',
      brief: 'Roast dinner special.',
      primaryKeywords: ['sunday lunch'],
    })
    const result = preflightCheck(facts)
    const performerWarning = result.softWarnings.find(w => w.includes('performer'))
    expect(performerWarning).toBeUndefined()
  })

  it('soft warning: missing capacity', () => {
    const facts = minimalPassingFacts()
    const result = preflightCheck(facts)
    expect(result.softWarnings).toContain('No capacity specified.')
  })

  it('soft warning: missing booking URL for paid event', () => {
    const facts = minimalPassingFacts()
    facts.isFree = false
    facts.bookingUrlPresent = false
    const result = preflightCheck(facts)
    expect(result.softWarnings).toContain(
      'No booking URL for a paid event — CTA will be generic.'
    )
  })

  it('no booking URL warning for free event', () => {
    const facts = minimalPassingFacts()
    facts.isFree = true
    facts.bookingUrlPresent = false
    const result = preflightCheck(facts)
    const bookingWarning = result.softWarnings.find(w => w.includes('booking URL'))
    expect(bookingWarning).toBeUndefined()
  })

  it('soft warning: missing brief AND existing long description', () => {
    const facts = buildEventSeoFacts({
      name: 'Test',
      date: '2026-06-14',
      categoryName: 'Quiz Night',
      primaryKeywords: ['quiz'],
    })
    const result = preflightCheck(facts)
    expect(result.softWarnings).toContain(
      'No brief or existing description — content may be less specific.'
    )
  })
})

// ── Prompt builders ─────────────────────────────────────────

describe('buildGenerationMessages', () => {
  const facts = buildEventSeoFacts(completeInput())

  it('returns system + user messages', () => {
    const msgs = buildGenerationMessages(facts)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
  })

  it('system message contains SYSTEM_ROLE', () => {
    const msgs = buildGenerationMessages(facts)
    expect(msgs[0].content).toBe(SYSTEM_ROLE)
  })

  it('user message has static content before dynamic facts', () => {
    const msgs = buildGenerationMessages(facts)
    const user = msgs[1].content
    const venueIdx = user.indexOf('VENUE CONTEXT')
    const factsIdx = user.indexOf('FACTS_JSON:')
    expect(venueIdx).toBeGreaterThan(-1)
    expect(factsIdx).toBeGreaterThan(-1)
    expect(venueIdx).toBeLessThan(factsIdx)
  })

  it('user message contains rubric and field rules', () => {
    const msgs = buildGenerationMessages(facts)
    const user = msgs[1].content
    expect(user).toContain('HOW TO WRITE')
    expect(user).toContain('FIELD RULES')
    expect(user).toContain('KEYWORD RULES')
  })
})

describe('buildFactsJson', () => {
  it('omits null fields', () => {
    const facts = buildEventSeoFacts({
      name: 'Test',
      primaryKeywords: ['test'],
    })
    const json = buildFactsJson(facts)
    const parsed = JSON.parse(json)
    expect(parsed.date).toBeUndefined()
    expect(parsed.time).toBeUndefined()
    expect(parsed.performer_name).toBeUndefined()
    expect(parsed.capacity).toBeUndefined()
  })

  it('includes present fields', () => {
    const facts = buildEventSeoFacts(completeInput())
    const json = buildFactsJson(facts)
    const parsed = JSON.parse(json)
    expect(parsed.name).toBe('Live Music — Jessica Lovelock')
    expect(parsed.date).toBe('2026-06-14')
    expect(parsed.performer_name).toBe('Jessica Lovelock')
    expect(parsed.venue.phone).toBe('01753 682707')
  })
})

describe('buildRepairMessages', () => {
  const facts = buildEventSeoFacts(completeInput())
  const failedDraft = { metaTitle: 'Too long title that exceeds character limit' }
  const issues = [
    { code: 'META_TITLE_TOO_LONG', severity: 'error', field: 'metaTitle', message: 'Meta title exceeds 40 characters.' },
  ]

  it('returns system + user messages', () => {
    const msgs = buildRepairMessages(facts, failedDraft, issues)
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
  })

  it('includes failed draft and issues', () => {
    const msgs = buildRepairMessages(facts, failedDraft, issues)
    const user = msgs[1].content
    expect(user).toContain('FAILED DRAFT')
    expect(user).toContain('VALIDATION ISSUES')
    expect(user).toContain('META_TITLE_TOO_LONG')
  })

  it('includes repair instruction', () => {
    const msgs = buildRepairMessages(facts, failedDraft, issues)
    const user = msgs[1].content
    expect(user).toContain('Repair the draft')
    expect(user).toContain('Return the complete JSON object, not a patch.')
  })

  it('has static content before facts JSON', () => {
    const msgs = buildRepairMessages(facts, failedDraft, issues)
    const user = msgs[1].content
    const venueIdx = user.indexOf('VENUE CONTEXT')
    const factsIdx = user.indexOf('FACTS_JSON:')
    expect(venueIdx).toBeLessThan(factsIdx)
  })
})

// ── Constants ───────────────────────────────────────────────

describe('constants', () => {
  it('CONTENT_RETRY_CONFIG has expected values', () => {
    expect(CONTENT_RETRY_CONFIG.maxAttempts).toBe(2)
    expect(CONTENT_RETRY_CONFIG.delay).toBe(750)
    expect(CONTENT_RETRY_CONFIG.backoff).toBe('exponential')
  })

  it('timeout constants are set', () => {
    expect(GENERATION_TIMEOUT_MS).toBe(45_000)
    expect(REPAIR_TIMEOUT_MS).toBe(30_000)
    expect(OVERALL_BUDGET_MS).toBe(90_000)
  })

  it('ANCHOR_VENUE_CONTEXT has correct phone', () => {
    expect(ANCHOR_VENUE_CONTEXT.phone).toBe('01753 682707')
  })

  it('ANCHOR_VENUE_CONTEXT has correct postcode', () => {
    expect(ANCHOR_VENUE_CONTEXT.postcode).toBe('TW19 6AQ')
  })
})

// ── Static prompt exports ───────────────────────────────────

describe('prompt constants', () => {
  it('SYSTEM_ROLE mentions UK English and facts discipline', () => {
    expect(SYSTEM_ROLE).toContain('UK English')
    expect(SYSTEM_ROLE).toContain('invent facts')
  })

  it('ANCHOR_VENUE_CONTEXT_PROMPT includes address and phone', () => {
    expect(ANCHOR_VENUE_CONTEXT_PROMPT).toContain('01753 682707')
    expect(ANCHOR_VENUE_CONTEXT_PROMPT).toContain('TW19 6AQ')
  })

  it('OUTPUT_RUBRIC bans filler phrases', () => {
    expect(OUTPUT_RUBRIC).toContain('premium experience')
    expect(OUTPUT_RUBRIC).toContain('hidden gem')
  })

  it('FIELD_RULES specifies metaTitle character limits', () => {
    expect(FIELD_RULES).toContain('20-40 characters')
  })

  it('KEYWORD_RULES mentions keyword placement', () => {
    expect(KEYWORD_RULES).toContain('Work a primary keyword into')
  })
})
