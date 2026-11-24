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

// Draft calls go to mockFetch; fact check calls go to mockFactCheck, which passes by default.
const mockFetch = vi.fn()
const mockFactCheck = vi.fn()
function isFactCheck(init?: RequestInit): boolean {
  return typeof init?.body === 'string' && init.body.includes('event_copy_fact_check')
}
const routedFetch = vi.fn((url: string, init?: RequestInit) =>
  isFactCheck(init) ? mockFactCheck(url, init) : mockFetch(url, init),
)
global.fetch = routedFetch as unknown as typeof fetch

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
    global.fetch = routedFetch as unknown as typeof fetch
    mockFactCheck.mockImplementation(async () => makeOpenAIJsonResponse({ issues: [] }))

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

  describe('fact check (spec 6.2.9)', () => {
    it('checks the draft that passed the gate against the facts and the venue', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))

      const result = await generateEventSeoContent(VALID_INPUT)

      expect(result.success).toBe(true)
      expect(mockFactCheck).toHaveBeenCalledTimes(1)
      const body = JSON.parse(mockFactCheck.mock.calls[0][1].body)
      expect(body.model).toBe('gpt-4.1')
      const sent = JSON.parse(body.messages[1].content)
      expect(sent.facts.event.date_long).toBe('Friday 11 December 2026')
      expect(sent.facts.venue).toContain('VENUE CONTEXT')
      // Code-owned fields are not sent for checking.
      expect(sent.draft.slug).toBeUndefined()
      expect(sent.draft.accessibilityNotes).toBeUndefined()
      expect(sent.draft.metaDescription).toContain('Friday 11 December 2026')
      // Every amount is checked, and a conditional prize must carry its condition everywhere.
      expect(body.messages[0].content).toContain('Go through every £ amount')
      expect(body.messages[0].content).toContain('must carry its condition wherever it is mentioned')
    })

    it('repairs a draft the fact check rejects, then checks it again', async () => {
      const wrong = buildValidSeoResponse()
      wrong.metaDescription = String(wrong.metaDescription).replace('£5', '£10')
      mockFetch
        .mockResolvedValueOnce(makeOpenAIJsonResponse(wrong))
        .mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))
      mockFactCheck
        .mockImplementationOnce(async () => makeOpenAIJsonResponse({ issues: ['Change £10 to £5.'] }))
        .mockImplementationOnce(async () => makeOpenAIJsonResponse({ issues: [] }))

      const result = await generateEventSeoContent(VALID_INPUT)

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFactCheck).toHaveBeenCalledTimes(2)
      const repairBody = JSON.parse(mockFetch.mock.calls[1][1].body)
      expect(repairBody.messages[1].content).toContain('Change £10 to £5.')
      if (result.success) expect(result.data.metaDescription).toContain('£5')
    })

    it('never returns a draft the fact check still rejects, after two repairs', async () => {
      mockFetch.mockImplementation(async () => makeOpenAIJsonResponse(buildValidSeoResponse()))
      mockFactCheck.mockImplementation(async () => makeOpenAIJsonResponse({ issues: ['The £25 prize is not in the facts.'] }))

      const result = await generateEventSeoContent(VALID_INPUT)

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(mockFactCheck).toHaveBeenCalledTimes(3)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).toContain('£25 prize')
    })

    it('can spend one repair on the gate and one on the fact check', async () => {
      const short = buildValidSeoResponse()
      short.longDescription = 'Too short to pass.'
      mockFetch
        .mockResolvedValueOnce(makeOpenAIJsonResponse(short))
        .mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))
        .mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))
      mockFactCheck
        .mockImplementationOnce(async () => makeOpenAIJsonResponse({ issues: ['Remove the £1 dabber price.'] }))
        .mockImplementationOnce(async () => makeOpenAIJsonResponse({ issues: [] }))

      const result = await generateEventSeoContent(VALID_INPUT)

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(mockFactCheck).toHaveBeenCalledTimes(2)
    })

    it('fails closed when the fact check cannot run', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))
      mockFactCheck.mockImplementation(async () => new Response('{"error":"down"}', { status: 429 }))

      const result = await generateEventSeoContent(VALID_INPUT)

      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).toMatch(/could not be checked/)
    })

    it('fails closed when the fact check answers in the wrong shape', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))
      mockFactCheck.mockImplementation(async () => makeOpenAIJsonResponse({ verdict: 'fine' }))

      const result = await generateEventSeoContent(VALID_INPUT)

      expect(result.success).toBe(false)
    })
  })

  describe('time budget (spec 6.2.11)', () => {
    it('cuts the first call so the fact check still fits inside 90 seconds', async () => {
      const timeouts: number[] = []
      const realSetTimeout = globalThis.setTimeout
      const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
        if (typeof ms === 'number' && ms >= 1000) timeouts.push(ms)
        return realSetTimeout(fn, ms)
      }) as typeof setTimeout)
      mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(buildValidSeoResponse()))

      await generateEventSeoContent(VALID_INPUT)
      spy.mockRestore()

      // First draft at most 45s, fact check at most 20s.
      expect(timeouts[0]).toBeLessThanOrEqual(45_000)
      expect(timeouts.at(-1)).toBeLessThanOrEqual(20_000)
    })

    it('skips the model repair when there is no time left for it and a fact check', async () => {
      const start = Date.now()
      const now = vi.spyOn(Date, 'now')
      const bad = buildValidSeoResponse()
      bad.longDescription = 'Too short to pass.'
      mockFetch.mockImplementationOnce(async () => {
        // The first draft took 60 seconds.
        now.mockReturnValue(start + 60_000)
        return makeOpenAIJsonResponse(bad)
      })

      const result = await generateEventSeoContent(VALID_INPUT)
      now.mockRestore()

      expect(result.success).toBe(false)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFactCheck).not.toHaveBeenCalled()
    })
  })

  it('returns failure when both initial and repair drafts fail validation', async () => {
    const badDraft = buildValidSeoResponse()
    badDraft.longDescription = 'Too short.'
    badDraft.metaTitle = ''
    badDraft.metaDescription = ''

    // The first draft and both repairs return invalid content
    mockFetch.mockImplementation(async () => makeOpenAIJsonResponse(badDraft))

    const result = await generateEventSeoContent(VALID_INPUT)

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFactCheck).not.toHaveBeenCalled()
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
