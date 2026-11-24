import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validDraft } from '../../../../tests/fixtures/event-seo/valid-draft'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

// The stored event the action reads when an eventId is passed, and its booking count.
const stored: { event: Record<string, unknown> | null; bookings: number } = { event: null, bookings: 0 }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() =>
          table === 'bookings'
            ? Promise.resolve({ count: stored.bookings, error: null })
            : { maybeSingle: vi.fn().mockResolvedValue({ data: stored.event, error: null }) },
        ),
      })),
    })),
  })),
}))

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn().mockResolvedValue({
    apiKey: 'test-key',
    baseUrl: 'https://api.openai.com/v1',
    seoModel: 'gpt-4o-mini',
    eventsModel: 'gpt-4o-mini',
    receiptsModel: 'gpt-4o-mini',
  }),
}))

vi.mock('@/services/business-hours', () => ({
  getKitchenWindowForDate: vi.fn().mockResolvedValue(null),
}))

// Mock retry to just call the function directly (no delay)
vi.mock('@/lib/retry', () => ({
  retry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  RetryConfigs: {
    api: { maxAttempts: 1, delay: 0, backoff: 'linear' as const },
  },
}))

// Mock logger used by retry
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildValidSeoResponse(): Record<string, unknown> {
  return validDraft()
}

function makeOpenAIJsonResponse(data: Record<string, unknown>, usage?: Record<string, unknown>): Response {
  const payload = {
    choices: [
      {
        message: { content: JSON.stringify(data) },
        finish_reason: 'stop',
      },
    ],
    usage: usage ?? {
      prompt_tokens: 1200,
      completion_tokens: 800,
      total_tokens: 2000,
    },
  }
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_INPUT = {
  name: 'Sleigh My Name: Festive Music Bingo',
  date: '2026-12-11',
  time: '19:00',
  endTime: '22:00',
  categoryName: 'Music Bingo',
  capacity: 60,
  brief: 'Two themed rounds of music bingo with Nikki.',
  performerName: 'Nikki',
  performerType: 'Person',
  price: 5,
  isFree: false,
  bookingUrl: null,
  primaryKeywords: ['christmas music bingo'],
  secondaryKeywords: ['music bingo', 'drag bingo', 'musical bingo', 'music bingo night'],
  localSeoKeywords: ['Stanwell Moor', 'Staines', 'Heathrow', 'Feltham'],
}

const NEW_SLUG = 'christmas-sleigh-my-name-festive-music-bingo-2026-12-11'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateEventSeoContent', () => {
  let generateEventSeoContent: typeof import('@/app/actions/event-content').generateEventSeoContent

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    stored.event = null
    stored.bookings = 0
    global.fetch = mockFetch

    // Re-import after resetting modules so fresh mocks apply
    const mod = await import('@/app/actions/event-content')
    generateEventSeoContent = mod.generateEventSeoContent
  })

  it('returns success when OpenAI returns a valid draft', async () => {
    const validResponse = buildValidSeoResponse()
    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(validResponse))

    const result = await generateEventSeoContent(VALID_INPUT)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metaTitle).toBeTruthy()
      expect(result.data.longDescription).toBeTruthy()
      // Deterministic fields should be overwritten
      expect(result.data.slug).toBe(NEW_SLUG)
      expect(result.data.slugLocked).toBe(false)
      expect('keywords' in result.data).toBe(false)
      // SSOT §16: step free from the car park, one step to the garden, and no accessible toilet.
      expect(result.data.accessibilityNotes).toContain('Getting in from the car park is step free')
      expect(result.data.accessibilityNotes).toContain("We don't have an accessible toilet.")
      expect(result.data.accessibilityNotes).not.toMatch(/with an accessible toilet/)
      expect(result.data.cancellationPolicy).toContain('01753 682707')
    }
  })

  it('deterministic repair fixes markdown and bad slug without second OpenAI call', async () => {
    const draft = buildValidSeoResponse()
    // Inject markdown and a bad slug
    draft.longDescription = `**Sleigh My Name**${(draft.longDescription as string).slice('Sleigh My Name'.length)}`
    draft.slug = 'BAD SLUG!'

    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(draft))

    const result = await generateEventSeoContent(VALID_INPUT)

    // Should have only called OpenAI once (no repair call)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    if (result.success) {
      // Slug should be deterministically generated
      expect(result.data.slug).toBe(NEW_SLUG)
      // Markdown should be stripped
      expect(result.data.longDescription).not.toContain('**')
    }
  })

  it('triggers model repair when initial draft has semantic issues', async () => {
    const badDraft = buildValidSeoResponse()
    // Make long description too short (below 200 words = fatal)
    badDraft.longDescription = 'This is a short description that will fail the word count validation check.'

    const fixedDraft = buildValidSeoResponse()

    // First call returns bad draft, second call returns fixed
    mockFetch
      .mockResolvedValueOnce(makeOpenAIJsonResponse(badDraft))
      .mockResolvedValueOnce(makeOpenAIJsonResponse(fixedDraft))

    const result = await generateEventSeoContent(VALID_INPUT)

    // Should have called OpenAI twice
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(true)
  })

  it('returns failure when both initial and repair drafts fail validation', async () => {
    const badDraft = buildValidSeoResponse()
    badDraft.longDescription = 'Too short.'
    badDraft.metaTitle = ''
    badDraft.metaDescription = ''

    // Both calls return invalid content
    mockFetch
      .mockResolvedValueOnce(makeOpenAIJsonResponse(badDraft))
      .mockResolvedValueOnce(makeOpenAIJsonResponse(badDraft))

    const result = await generateEventSeoContent(VALID_INPUT)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Content quality check failed')
    }
  })

  it('fails preflight when input is too sparse (no date, no keywords)', async () => {
    const sparseInput = {
      name: 'Some Event',
    }

    const result = await generateEventSeoContent(sparseInput)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeTruthy()
    }
    // OpenAI should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns timeout error when OpenAI request times out', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    mockFetch.mockRejectedValueOnce(abortError)

    const result = await generateEventSeoContent(VALID_INPUT)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('timed out')
    }
  })

  it('returns permission error when user lacks events.manage permission', async () => {
    const rbac = await import('@/app/actions/rbac')
    vi.mocked(rbac.checkUserPermission).mockResolvedValueOnce(false)

    const result = await generateEventSeoContent(VALID_INPUT)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('permission')
    }
  })

  it('overwrites deterministic fields: slug, cancellationPolicy, accessibilityNotes', async () => {
    const draft = buildValidSeoResponse()
    draft.slug = 'model-suggested-slug'
    draft.cancellationPolicy = 'Model suggested policy'
    draft.accessibilityNotes = 'Model suggested notes'

    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(draft))

    const result = await generateEventSeoContent(VALID_INPUT)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.slug).toBe(NEW_SLUG)
      expect(result.data.cancellationPolicy).toContain('01753 682707')
      expect(result.data.accessibilityNotes).toContain('Getting in from the car park is step free')
      expect(result.data.accessibilityNotes).toContain("We don't have an accessible toilet.")
    }
  })

  it('no longer asks the model for keywords', async () => {
    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))
    await generateEventSeoContent(VALID_INPUT)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.response_format.json_schema.schema.required).not.toContain('keywords')
    expect(body.response_format.json_schema.schema.properties.keywords).toBeUndefined()
  })

  it('keeps the address of a published event (rubric row 10)', async () => {
    stored.event = { id: 'e1', name: VALID_INPUT.name, date: '2026-12-11', slug: 'sleigh-my-name-2026-12-11', event_status: 'scheduled' }
    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))

    const result = await generateEventSeoContent({ ...VALID_INPUT, eventId: 'e1' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.slug).toBe('sleigh-my-name-2026-12-11')
      expect(result.data.slugLocked).toBe(true)
    }
  })

  it('keeps the address of a draft event that already has bookings', async () => {
    stored.event = { id: 'e1', name: VALID_INPUT.name, date: '2026-12-11', slug: 'sleigh-my-name-2026-12-11', event_status: 'draft' }
    stored.bookings = 2
    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))

    const result = await generateEventSeoContent({ ...VALID_INPUT, eventId: 'e1' })

    expect(result.success && result.data.slug).toBe('sleigh-my-name-2026-12-11')
  })

  it('may change the address of a draft with no bookings', async () => {
    stored.event = { id: 'e1', name: VALID_INPUT.name, date: '2026-12-11', slug: 'old-draft-slug', event_status: 'draft' }
    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))

    const result = await generateEventSeoContent({ ...VALID_INPUT, eventId: 'e1' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.slug).toBe(NEW_SLUG)
      expect(result.data.slugLocked).toBe(false)
    }
  })

  it('sets free event cancellation policy when isFree is true', async () => {
    const draft = buildValidSeoResponse()
    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(draft))

    const freeInput = {
      ...VALID_INPUT,
      isFree: true,
      price: null,
    }

    const result = await generateEventSeoContent(freeInput)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.cancellationPolicy).toBe(
        "It's a free event, so there's no cancellation policy.",
      )
    }
  })
})
