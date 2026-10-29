import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { eventSlugStem, resolveMovedEventSlug } from '@/lib/events/slug-redirect'

/* Old event web addresses keep working (BK-192). */

function db(tables: { history?: Record<string, unknown> | null; event?: Record<string, unknown> | null; next?: Record<string, unknown>[]; fail?: boolean }) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  return {
    calls,
    client: {
      from: (table: string) => {
        const builder: Record<string, unknown> = {}
        for (const method of ['select', 'eq', 'ilike', 'gte', 'not', 'order', 'limit']) {
          builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder }
        }
        builder.maybeSingle = async () => tables.fail ? { data: null, error: { message: 'down' } }
          : { data: table === 'event_slug_history' ? tables.history ?? null : tables.event ?? null, error: null }
        builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: tables.next ?? [], error: null })
        return builder
      },
    },
  }
}

describe('resolveMovedEventSlug', () => {
  it('sends an old address to the event it now belongs to', async () => {
    const { client } = db({ history: { event_id: 'e1' }, event: { slug: 'christmas-night-out-tasting-night-2026-11-20' } })
    expect(await resolveMovedEventSlug(client as never, 'tasting-night-2026-12-11')).toEqual({
      slug: 'christmas-night-out-tasting-night-2026-11-20', reason: 'renamed',
    })
  })

  it('offers the next upcoming night of the same name when the event is gone', async () => {
    const { client, calls } = db({ history: null, next: [{ slug: 'pub-quiz-quiz-night-2026-11-04' }] })
    expect(await resolveMovedEventSlug(client as never, 'quiz-night-2026-09-16')).toEqual({ slug: 'pub-quiz-quiz-night-2026-11-04', reason: 'next_in_series' })
    expect(calls).toContainEqual({ table: 'events', method: 'ilike', args: ['slug', '%quiz-night%'] })
  })

  it('answers nothing for an address it cannot place, or when a read fails', async () => {
    expect(await resolveMovedEventSlug(db({ history: null, next: [] }).client as never, 'quiz-night-2026-09-16')).toBeNull()
    expect(await resolveMovedEventSlug(db({ fail: true }).client as never, 'quiz-night-2026-09-16')).toBeNull()
    expect(await resolveMovedEventSlug(db({}).client as never, "quiz'; drop")).toBeNull()
  })

  it('takes the name part of an address', () => {
    expect(eventSlugStem('cash-bingo-2026-10-21')).toBe('cash-bingo')
    expect(eventSlugStem('st-patricks-day-2026')).toBe('st-patricks-day')
    expect(eventSlugStem('ab-2026-10-21')).toBeNull()
  })
})
