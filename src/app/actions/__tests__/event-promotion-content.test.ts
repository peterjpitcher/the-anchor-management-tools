import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateEventPromotionContent, type EventPromotionInput } from '../event-content'

const mocks = vi.hoisted(() => ({ permission: vi.fn(), single: vi.fn(), config: vi.fn(), fetch: vi.fn(), retry: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.permission }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({
  from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
})) }))
vi.mock('@/lib/openai/config', () => ({ getOpenAIConfig: mocks.config }))
vi.mock('@/lib/retry', () => ({ retry: mocks.retry, RetryConfigs: { api: { maxAttempts: 1 } } }))
vi.mock('@/services/business-hours', () => ({ getKitchenWindowForDate: vi.fn() }))

const eventId = 'd81512e7-5e99-48fd-a153-3400c2f6f009'
const input: EventPromotionInput = { eventId, contentType: 'facebook_event' }
const event = {
  id: eventId, name: 'Quiz Night', date: '2026-09-30', time: '19:00:00', end_time: '21:30:00',
  doors_time: null, last_entry_time: null, duration_minutes: null, capacity: 60,
  price: 10, is_free: false, brief: 'Friendly quiz night.', short_description: null,
  long_description: null, booking_url: 'https://example.com/book', performer_name: null,
  performer_type: null, category: { name: 'Quiz' },
}
const draft = { name: 'Quiz Night', description: 'Quiz Night at The Anchor. Wednesday 30 September 2026, 7pm. £10 per person. Come along.' }
function modelResponse(value: unknown, finishReason = 'stop'): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(value) } }] }), { status: 200 })
}
function queue(...values: unknown[]): void {
  for (const value of values) mocks.fetch.mockResolvedValueOnce(modelResponse(value))
}
function request(index: number): { messages: Array<{ role: string; content: string }>; response_format: { json_schema: { name: string } } } {
  return JSON.parse(mocks.fetch.mock.calls[index][1].body)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue(true)
  mocks.single.mockResolvedValue({ data: event, error: null })
  mocks.config.mockResolvedValue({ apiKey: 'test-only', baseUrl: 'https://model.invalid/v1', eventsModel: 'test-model' })
  mocks.retry.mockImplementation(async (fn: () => Promise<unknown>) => fn())
  mocks.fetch.mockReset()
  vi.stubGlobal('fetch', mocks.fetch)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('generateEventPromotionContent', () => {
  it('denies permission before contacting the model or database', async () => {
    mocks.permission.mockResolvedValue(false)
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false, error: expect.stringContaining('permission') })
    expect(mocks.single).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([{ ...input, eventId: 'invalid' }, { ...input, ctaUrl: 'javascript:alert(1)' }, { ...input, ctaUrl: 'not a url' }, { ...input, ctaDestinationUrl: 'not a url' }, { ...input, contentType: 'feed_post' }])('rejects invalid input before external calls', async (value) => {
    expect(await generateEventPromotionContent(value as EventPromotionInput)).toMatchObject({ success: false })
    expect(mocks.permission).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('returns copy only after a separate factual review with structured source dates', async () => {
    queue(draft, { issues: [] })
    expect(await generateEventPromotionContent(input)).toEqual({ success: true, data: { type: input.contentType, content: draft, warnings: [] } })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(request(0).response_format.json_schema.name).toBe('facebook_event_copy')
    expect(request(1).response_format.json_schema.name).toBe('event_copy_fact_check')
    const review = JSON.parse(request(1).messages[1].content)
    expect(review.draft).toEqual(draft)
    expect(review.facts).toContain('Event date: Wednesday, 30 September 2026 (2026-09-30)')
    expect(review.facts).toContain('Price: £10.00')
    expect(mocks.retry).toHaveBeenCalledWith(expect.any(Function), { maxAttempts: 1 })
  })

  it('repairs a factual hallucination then checks the repaired draft independently', async () => {
    queue({ ...draft, description: draft.description.replace('£10', '£15') }, { issues: ['Price must be £10.00, not £15.'] }, draft, { issues: [] })
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: true, data: { content: draft } })
    expect(mocks.fetch).toHaveBeenCalledTimes(4)
    expect(request(2).messages.at(-1)?.content).toContain('Price must be £10.00')
    expect(JSON.parse(request(3).messages[1].content).draft).toEqual(draft)
  })

  it('repairs formatting before using a factual review', async () => {
    queue({ ...draft, description: '**Quiz Night**' }, draft, { issues: [] })
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: true })
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(request(1).response_format.json_schema.name).toBe('facebook_event_copy')
    expect(request(1).messages.at(-1)?.content).toContain('markdown')
  })

  it('fails when the repaired draft is still invalid', async () => {
    queue({ ...draft, description: '**Quiz**' }, { ...draft, description: '**Quiz**' })
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false, error: expect.stringContaining('still needs correction') })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('fails when the repaired factual claims still contradict the source', async () => {
    queue(draft, { issues: ['Wrong price'] }, draft, { issues: ['Wrong price'] })
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false, error: expect.stringContaining('Wrong price') })
    expect(mocks.fetch).toHaveBeenCalledTimes(4)
  })

  it.each([null, {}, { issues: 'fine' }, { issues: [], unexpected: true }, { issues: [''] }])('fails closed on malformed factual review %j', async (review) => {
    queue(draft, review)
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false })
  })

  it('rejects a truncated model response even if its JSON looks valid', async () => {
    mocks.fetch.mockResolvedValueOnce(modelResponse(draft, 'length'))
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a truncated factual review', async () => {
    queue(draft)
    mocks.fetch.mockResolvedValueOnce(modelResponse({ issues: [] }, 'length'))
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false })
  })

  it.each([429, 500])('returns a failure for provider error %i', async (status) => {
    mocks.fetch.mockResolvedValueOnce(new Response('private provider detail', { status }))
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false, error: expect.not.stringContaining('private provider detail') })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('returns the cash bingo suitability warning with checked GBP content', async () => {
    mocks.single.mockResolvedValue({ data: { ...event, name: 'Cash Bingo' }, error: null })
    const googleDraft = { title: 'Cash Bingo', description: draft.description }
    queue(googleDraft, { issues: [] })
    const result = await generateEventPromotionContent({ ...input, contentType: 'google_business_profile_event' })
    expect(result).toMatchObject({ success: true, data: { warnings: [expect.stringContaining('gambling')] } })
    expect(request(0).messages[0].content).toContain('Never disguise')
  })

  it.each([
    [{ ctaUrl: 'https://short.example/link', ctaDestinationUrl: 'https://example.com/book?utm_source=facebook' }, 'A booking link is selected.'],
    [{ ctaUrl: 'https://example.com/book/' }, 'A booking link is selected.'],
    [{ ctaUrl: 'https://short.example/link', ctaDestinationUrl: 'https://example.com/event' }, 'A details link is selected.'],
    [{ ctaUrl: null }, 'No link selected.'],
  ])('uses the selected CTA destination %j', async (cta, expected) => {
    queue(draft, { issues: [] })
    await generateEventPromotionContent({ ...input, ...cta })
    expect(request(0).messages[1].content).toContain(expected)
    expect(request(1).messages[1].content).toContain(expected)
    expect(mocks.fetch.mock.calls.every(call => call[0] === 'https://model.invalid/v1/chat/completions')).toBe(true)
  })

  it('does not treat a different booking event query as the same destination', async () => {
    mocks.single.mockResolvedValue({ data: { ...event, booking_url: 'https://example.com/book?event=one' }, error: null })
    queue(draft, { issues: [] })
    await generateEventPromotionContent({ ...input, ctaUrl: 'https://example.com/book?event=two' })
    expect(request(0).messages[1].content).toContain('A details link is selected.')
  })

  it('uses the post button instruction for a GBP booking link', async () => {
    queue({ title: draft.name, description: draft.description }, { issues: [] })
    await generateEventPromotionContent({ ...input, contentType: 'google_business_profile_event', ctaUrl: event.booking_url })
    expect(request(0).messages[1].content).toContain('book using the post button')
  })

  it('does not call the model when configuration or event data are unavailable', async () => {
    mocks.config.mockResolvedValueOnce({ apiKey: null })
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false })
    mocks.single.mockResolvedValueOnce({ data: null, error: { message: 'missing' } })
    expect(await generateEventPromotionContent(input)).toMatchObject({ success: false })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
