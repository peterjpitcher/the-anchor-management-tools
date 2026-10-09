import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { logger } from '@/lib/logger'
import { eventSlugsIn, resolvePromotedEventId } from '../promoted-event'

const BINGO = 'https://www.the-anchor.pub/events/music-bingo-2026-10-16'
const QUIZ = 'https://www.the-anchor.pub/events/quiz-night-2026-10-21?utm_source=email'

type Lookup = { data: { id: string }[] | null; error: { message: string } | null }

function fakeSupabase(lookup: Lookup | Error) {
  const inFilter = vi.fn(() => (lookup instanceof Error ? Promise.reject(lookup) : Promise.resolve(lookup)))
  const client = { from: vi.fn(() => ({ select: vi.fn(() => ({ in: inFilter })) })) }
  return { client: client as unknown as Parameters<typeof resolvePromotedEventId>[0], inFilter }
}

describe('finding the event a campaign promotes', () => {
  it('reads each event slug once, ignoring query strings and other pages', () => {
    expect(
      eventSlugsIn([BINGO, `${BINGO}#book`, QUIZ, 'https://www.the-anchor.pub', 'https://www.the-anchor.pub/events', 'tel:+441753682707']),
    ).toEqual(['music-bingo-2026-10-16', 'quiz-night-2026-10-21'])
  })

  it('names the event when the email links to exactly one', async () => {
    const { client, inFilter } = fakeSupabase({ data: [{ id: 'event-1' }], error: null })

    await expect(resolvePromotedEventId(client, [BINGO, 'https://www.the-anchor.pub'])).resolves.toBe('event-1')
    expect(inFilter).toHaveBeenCalledWith('slug', ['music-bingo-2026-10-16'])
  })

  it('names none for a round-up that links to several events', async () => {
    const { client } = fakeSupabase({ data: [{ id: 'event-1' }, { id: 'event-2' }], error: null })

    await expect(resolvePromotedEventId(client, [BINGO, QUIZ])).resolves.toBeNull()
  })

  it('names none, without asking the database, when no event is linked', async () => {
    const { client, inFilter } = fakeSupabase({ data: [], error: null })

    await expect(resolvePromotedEventId(client, ['https://www.the-anchor.pub/christmas'])).resolves.toBeNull()
    expect(inFilter).not.toHaveBeenCalled()
  })

  it('names none for a slug we do not know', async () => {
    const { client } = fakeSupabase({ data: [], error: null })

    await expect(resolvePromotedEventId(client, [BINGO])).resolves.toBeNull()
  })

  it.each([
    ['the lookup returns an error', { data: null, error: { message: 'boom' } } as Lookup],
    ['the lookup throws', new Error('network down')],
  ])('names none and raises an error log when %s, so scheduling still goes ahead', async (_label, lookup) => {
    vi.mocked(logger.error).mockClear()
    const { client } = fakeSupabase(lookup)

    await expect(resolvePromotedEventId(client, [BINGO])).resolves.toBeNull()
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
