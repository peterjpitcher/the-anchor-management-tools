import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
  }),
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
  // Each paragraph must be 55-120 words; total 450-650 words; 5-6 paragraphs.
  // Must contain primary keyword "live music", secondary "acoustic night", local "pub near heathrow".
  // No filler phrases from the banned list.
  const longParas = [
    // Para 1: ~75 words, contains event name, date, primary keyword
    'Live music at The Anchor on 2026-06-15. Join us for an incredible evening featuring the talented Jessica Lovelock performing her signature acoustic set at The Anchor in Stanwell Moor. This promises to be one of the highlights of the summer music season, bringing together music lovers from across Surrey for an evening of exceptional entertainment and good times at our welcoming pub near Heathrow.',
    // Para 2: ~90 words, experience
    'Expect an intimate atmosphere where every note resonates through the venue during this acoustic night performance. Jessica brings a unique blend of folk and contemporary acoustic sounds that create the perfect backdrop for a relaxed evening out with friends and family. Her setlist spans original compositions and carefully selected covers that showcase her remarkable vocal range and impressive guitar skills. The warmth of the room combined with the quality of the sound system make every seat feel like the best in the house for this live music experience.',
    // Para 3: ~85 words, performer
    'Jessica Lovelock has been captivating audiences across the south of England for over a decade with her live music performances at venues large and small. Known for her warm stage presence and natural ability to connect with every listener in the room, she transforms each performance into a shared experience that leaves lasting memories for all who attend. Her latest album received critical acclaim from music publications across the country and her touring schedule continues to grow as word spreads about her extraordinary talent and engaging stage presence.',
    // Para 4: ~80 words, food/drink/venue, includes local keyword
    'The Anchor provides the ideal setting for an acoustic night out at this popular pub near Heathrow, with a welcoming bar serving a selection of craft beers, wines, and cocktails throughout the evening. The kitchen will be open serving freshly made pizza so you can enjoy great food alongside the live music. The relaxed and friendly atmosphere makes The Anchor the perfect venue for enjoying quality entertainment in a comfortable Surrey setting.',
    // Para 5: ~80 words, practical + booking
    'Tickets for this live music event are priced at just fifteen pounds per person, offering exceptional value for an evening of quality entertainment at The Anchor. With limited capacity available at the venue, early booking is strongly recommended to avoid disappointment and secure your preferred table position. Reserve your spot now to guarantee your place at what is expected to be one of the most popular live music events of the summer season.',
    // Para 6: ~85 words, local context
    'The Anchor is conveniently located on Horton Road in Stanwell Moor, Surrey, just seven minutes from Heathrow Terminal 5, making it an ideal pub near Heathrow for evening entertainment. Free parking is available for up to twenty vehicles on site, making it easy to reach whether you are travelling from Staines-upon-Thames, West Drayton, or further afield across the county. Public transport links are also excellent, with bus routes connecting to all major local areas and railway stations nearby for this acoustic night.',
  ]

  return {
    metaTitle: 'Live Music — Jessica Lovelock',
    metaDescription: 'Live music at The Anchor featuring Jessica Lovelock on 15 June 2026. Book your table now for a night of acoustic magic near Heathrow.',
    shortDescription: 'Join us at The Anchor for a brilliant evening of live music with Jessica Lovelock performing acoustic favourites and original compositions on Sunday 15 June 2026.',
    longDescription: longParas.join('\n\n'),
    highlights: [
      'live music by jessica lovelock performing acoustic favourites',
      'intimate acoustic night venue atmosphere with craft beers and pizza',
      'free parking and just seven minutes from heathrow terminal five',
      'limited capacity so book early to secure your spot',
    ],
    keywords: [
      'live music',
      'jessica lovelock',
      'the anchor stanwell moor',
      'acoustic night',
      'pub near heathrow',
      'live entertainment surrey',
    ],
    slug: 'live-music-jessica-lovelock-2026-06-15',
    imageAltText: 'Live music performance by Jessica Lovelock at The Anchor pub near Heathrow in Stanwell Moor, performing acoustic guitar on stage',
    faqs: [
      {
        question: 'What time does the live music start at The Anchor on 15 June 2026?',
        answer: 'The live music performance by Jessica Lovelock begins at eight in the evening at The Anchor in Stanwell Moor. Doors open at half past seven so you can grab a drink and settle in before the show starts at this popular pub near Heathrow.',
      },
      {
        question: 'Is there parking available for the acoustic night at The Anchor in Stanwell Moor?',
        answer: 'Yes, The Anchor offers free parking for up to twenty vehicles on site for the acoustic night. The venue is also just seven minutes from Heathrow Terminal 5, making it easily accessible from Staines-upon-Thames, West Drayton, and the surrounding areas.',
      },
      {
        question: 'How much are tickets for the Jessica Lovelock live music evening at The Anchor?',
        answer: 'Tickets for the Jessica Lovelock live music evening are priced at fifteen pounds per person at The Anchor. With limited capacity at the venue we strongly recommend booking early to avoid disappointment and secure your preferred seating position.',
      },
    ],
    cancellationPolicy: 'Tickets are non-refundable.',
    accessibilityNotes: 'Step-free access available.',
  }
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
  name: 'Jessica Lovelock',
  date: '2026-06-15',
  time: '20:00',
  categoryName: 'Live Music',
  capacity: 60,
  brief: 'Acoustic set by Jessica Lovelock',
  performerName: 'Jessica Lovelock',
  performerType: 'Musician',
  price: 15,
  isFree: false,
  bookingUrl: 'https://example.com/book',
  primaryKeywords: ['live music'],
  secondaryKeywords: ['acoustic night'],
  localSeoKeywords: ['pub near heathrow'],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateEventSeoContent', () => {
  let generateEventSeoContent: typeof import('@/app/actions/event-content').generateEventSeoContent

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
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
      expect(result.data.slug).toContain('2026-06-15')
      expect(result.data.accessibilityNotes).toContain('step-free access')
      expect(result.data.cancellationPolicy).toContain('01753 682707')
    }
  })

  it('deterministic repair fixes markdown and bad slug without second OpenAI call', async () => {
    const draft = buildValidSeoResponse()
    // Inject markdown and a bad slug
    draft.longDescription = `**Live music** at The Anchor on 2026-06-15. ${(draft.longDescription as string).slice(50)}`
    draft.slug = 'BAD SLUG!'

    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(draft))

    const result = await generateEventSeoContent(VALID_INPUT)

    // Should have only called OpenAI once (no repair call)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    if (result.success) {
      // Slug should be deterministically generated
      expect(result.data.slug).toMatch(/^[a-z0-9-]+$/)
      expect(result.data.slug).toContain('2026-06-15')
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

  it('overwrites deterministic fields: slug, cancellationPolicy, accessibilityNotes, keywords', async () => {
    const draft = buildValidSeoResponse()
    // Set fields that should be overwritten
    draft.slug = 'model-suggested-slug'
    draft.cancellationPolicy = 'Model suggested policy'
    draft.accessibilityNotes = 'Model suggested notes'
    draft.keywords = ['model keyword one', 'model keyword two', 'model keyword three', 'surrey events', 'stanwell moor entertainment']

    mockFetch.mockResolvedValueOnce(makeOpenAIJsonResponse(draft))

    const result = await generateEventSeoContent(VALID_INPUT)

    expect(result.success).toBe(true)
    if (result.success) {
      // Slug should be deterministic, not model-suggested
      expect(result.data.slug).not.toBe('model-suggested-slug')
      expect(result.data.slug).toContain('2026-06-15')

      // Cancellation policy should be code-generated
      expect(result.data.cancellationPolicy).not.toBe('Model suggested policy')
      expect(result.data.cancellationPolicy).toContain('01753 682707')

      // Accessibility notes should be code-generated
      expect(result.data.accessibilityNotes).not.toBe('Model suggested notes')
      expect(result.data.accessibilityNotes).toContain('step-free access')

      // Keywords should include the input keywords, merged and deduped
      expect(result.data.keywords).toContain('live music')
      expect(result.data.keywords).toContain('acoustic night')
      expect(result.data.keywords).toContain('pub near heathrow')
      // Should also include model-suggested ones (merged in)
      expect(result.data.keywords.length).toBeLessThanOrEqual(10)
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
        'Free event — no cancellation policy required.',
      )
    }
  })
})
