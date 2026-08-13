import { describe, expect, it, vi } from 'vitest'
import { buildUnsubscribeUrl, getOrCreateUnsubscribeUrl, lookupUnsubscribeToken } from './unsubscribe'

/**
 * The failure that matters here is not "unsubscribe did not work". It is "unsubscribe
 * appeared to work and did not", because that is the one the guest cannot detect and the
 * one that removes the legal basis for sending at all.
 *
 * The second failure that matters is a rotated link, which silently kills the opt-out in
 * every email already sitting in somebody's inbox.
 */

type Row = { token: string; customer_id: string }

function fakeSupabase(rows: Row[], opts: { insertFails?: boolean } = {}) {
  const inserted: Row[] = []
  return {
    inserted,
    from() {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              return {
                maybeSingle: async () => {
                  const found = rows.find((r) =>
                    column === 'customer_id' ? r.customer_id === value : r.token === value
                  )
                  return { data: found ?? null, error: null }
                },
              }
            },
          }
        },
        insert: async (row: Row) => {
          if (opts.insertFails) return { error: { message: 'duplicate key' } }
          inserted.push(row)
          rows.push(row)
          return { error: null }
        },
      }
    },
  } as never
}

describe('getOrCreateUnsubscribeUrl', () => {
  it('reuses the existing token, so a link sent last Christmas still works', () => {
    // The whole design turns on this. Minting a fresh token per send would break every
    // link already delivered, and a dead unsubscribe link is worse than none.
    const rows: Row[] = [{ token: 'stable-token-aaaaaaaaaaaaaaaaaaaaaa', customer_id: 'cust-1' }]
    return getOrCreateUnsubscribeUrl(fakeSupabase(rows), 'cust-1', 'https://example.test').then((url) => {
      expect(url).toBe('https://example.test/api/unsubscribe?t=stable-token-aaaaaaaaaaaaaaaaaaaaaa')
    })
  })

  it('returns the same URL on a second call for the same customer', async () => {
    const rows: Row[] = []
    const supabase = fakeSupabase(rows)
    const first = await getOrCreateUnsubscribeUrl(supabase, 'cust-1', 'https://example.test')
    const second = await getOrCreateUnsubscribeUrl(supabase, 'cust-1', 'https://example.test')
    expect(first).toBe(second)
  })

  it('mints a token the first time and produces a usable URL', async () => {
    const rows: Row[] = []
    const url = await getOrCreateUnsubscribeUrl(fakeSupabase(rows), 'cust-1', 'https://example.test')
    expect(url).toMatch(/^https:\/\/example\.test\/api\/unsubscribe\?t=.{20,}$/)
    expect(rows).toHaveLength(1)
  })

  it('gives different customers different tokens', async () => {
    const rows: Row[] = []
    const supabase = fakeSupabase(rows)
    const a = await getOrCreateUnsubscribeUrl(supabase, 'cust-1', 'https://example.test')
    const b = await getOrCreateUnsubscribeUrl(supabase, 'cust-2', 'https://example.test')
    expect(a).not.toBe(b)
  })

  it('recovers the other send\'s token when two sends race the same customer', async () => {
    // Both messages must carry a working link, and they must carry the SAME link.
    const rows: Row[] = [{ token: 'winner-token-aaaaaaaaaaaaaaaaaaaaaa', customer_id: 'cust-1' }]
    const supabase = fakeSupabase(rows, { insertFails: true })
    // Pretend the read that precedes the insert missed the row, as it would in a race.
    const url = await getOrCreateUnsubscribeUrl(supabase, 'cust-1', 'https://example.test')
    expect(url).toContain('winner-token-aaaaaaaaaaaaaaaaaaaaaa')
  })

  it('returns null rather than throwing, so a confirmation email is never blocked', async () => {
    const exploding = {
      from() {
        throw new Error('database is down')
      },
    } as never
    await expect(getOrCreateUnsubscribeUrl(exploding, 'cust-1')).resolves.toBeNull()
  })
})

describe('lookupUnsubscribeToken', () => {
  it('resolves a real token to its customer', async () => {
    const rows: Row[] = [{ token: 'real-token-aaaaaaaaaaaaaaaaaaaaaaaa', customer_id: 'cust-9' }]
    await expect(
      lookupUnsubscribeToken(fakeSupabase(rows), 'real-token-aaaaaaaaaaaaaaaaaaaaaaaa')
    ).resolves.toEqual({
      ok: true,
      subjectType: 'customer',
      customerId: 'cust-9',
      businessContactId: null,
    })
  })

  it('rejects an unknown token without saying why', async () => {
    await expect(
      lookupUnsubscribeToken(fakeSupabase([]), 'nope-aaaaaaaaaaaaaaaaaaaaaaaaaa')
    ).resolves.toEqual({ ok: false })
  })

  it.each(['', '   ', 'short'])('rejects obvious junk (%j) before touching the database', async (token) => {
    const supabase = { from: vi.fn() } as never
    await expect(lookupUnsubscribeToken(supabase, token)).resolves.toEqual({ ok: false })
    expect((supabase as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
  })
})

describe('buildUnsubscribeUrl', () => {
  it('percent-encodes the token so a base64url value survives the query string', () => {
    expect(buildUnsubscribeUrl('abc+/=def', 'https://example.test')).toBe(
      'https://example.test/api/unsubscribe?t=abc%2B%2F%3Ddef'
    )
  })

  it('does not double up the slash when the base URL has a trailing one', () => {
    expect(buildUnsubscribeUrl('tok', 'https://example.test/')).toBe(
      'https://example.test/api/unsubscribe?t=tok'
    )
  })
})
