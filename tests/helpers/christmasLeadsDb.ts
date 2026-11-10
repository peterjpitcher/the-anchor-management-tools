import { createFakeDb, type FakeDb } from './fakeSupabaseDb'

/**
 * The fake database for the Christmas leads tests, seeded with the live Christmas 2026 period as
 * production holds it (read 10 November 2026).
 */

export const CHRISTMAS_PERIOD = {
  id: 'period-xmas-2026',
  period_kind: 'christmas',
  is_active: true,
  archived_at: null,
  starts_on: '2026-11-10',
  ends_on: '2026-12-20',
  min_party_size: 4,
  max_party_size: 60,
  min_notice_hours: 192,
  deposit_basis: 'per_head',
  deposit_amount: '10.00',
}

/**
 * The fake database, with the one query shape it lacks: upsert(...).select(...).single(). The
 * real client returns the saved row; this reads it back by lead_ref.
 */
export function leadsDb(seed: Record<string, Array<Record<string, unknown>>> = {}): { fake: FakeDb; client: never } {
  const fake = createFakeDb({ booking_periods: [CHRISTMAS_PERIOD], ...seed })
  const client = {
    ...fake.client,
    from: (table: string) => {
      const base = fake.client.from(table)
      return {
        ...base,
        upsert: (payload: Record<string, unknown>, options?: { onConflict?: string }) => {
          const done = base.upsert(payload, options)
          const readBack = async () => {
            const result = await done
            if (result.error) return { data: null, error: result.error }
            return { data: fake.rows(table).find((row) => row.lead_ref === payload.lead_ref) ?? null, error: null }
          }
          return { select: () => ({ single: readBack, maybeSingle: readBack }), then: done.then.bind(done) }
        },
      }
    },
  }
  return { fake, client: client as never }
}
