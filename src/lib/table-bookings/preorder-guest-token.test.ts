/**
 * A guest's own food link: one seat, hashed at rest, and dead at the cutoff.
 */

import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../../../tests/helpers/fakeSupabase'
import { hashGuestToken } from '@/lib/guest/tokens'
import { createPreorderGuestToken, resolvePreorderGuestToken } from './preorder-guest-token'

const CUTOFF = '2026-12-05T12:00:00.000Z'
const BEFORE_CUTOFF = new Date('2026-12-05T11:59:59Z')

function db() {
  return createFakeSupabase({ guest_tokens: [] })
}

async function created(fake: ReturnType<typeof db>) {
  return createPreorderGuestToken(fake as never, {
    customerId: 'customer-1',
    tableBookingId: 'booking-1',
    coverId: 'cover-2',
    expiresAt: CUTOFF,
    appBaseUrl: 'https://app.example.test/',
  })
}

describe('createPreorderGuestToken', () => {
  it('stores only the hash, scoped to the seat, expiring at the cutoff', async () => {
    const fake = db()
    const token = await created(fake)

    expect(token.url).toBe(`https://app.example.test/g/${token.rawToken}/christmas-choice`)
    expect(token.expiresAt).toBe(CUTOFF)
    expect(fake.tables.guest_tokens).toHaveLength(1)
    const [row] = fake.tables.guest_tokens
    expect(row).toMatchObject({
      hashed_token: hashGuestToken(token.rawToken),
      action_type: 'preorder_guest',
      customer_id: 'customer-1',
      table_booking_id: 'booking-1',
      preorder_cover_id: 'cover-2',
      expires_at: CUTOFF,
    })
    expect(JSON.stringify(row)).not.toContain(token.rawToken)
  })

  it('refuses an expiry that is not a real instant', async () => {
    const fake = db()
    await expect(
      createPreorderGuestToken(fake as never, {
        customerId: 'customer-1',
        tableBookingId: 'booking-1',
        coverId: 'cover-2',
        expiresAt: 'not a date',
        appBaseUrl: 'https://app.example.test',
      }),
    ).rejects.toThrow('A guest food link needs the pre-order cutoff as its expiry.')
    expect(fake.tables.guest_tokens).toEqual([])
  })
})

describe('resolvePreorderGuestToken', () => {
  it('names the one seat, the booking and the customer before the cutoff', async () => {
    const fake = db()
    const token = await created(fake)

    await expect(resolvePreorderGuestToken(fake as never, token.rawToken, BEFORE_CUTOFF)).resolves.toEqual({
      ok: true,
      tableBookingId: 'booking-1',
      coverId: 'cover-2',
      customerId: 'customer-1',
      expiresAt: CUTOFF,
    })
  })

  it('is expired from the cutoff on', async () => {
    const fake = db()
    const token = await created(fake)

    await expect(resolvePreorderGuestToken(fake as never, token.rawToken, new Date(CUTOFF))).resolves.toEqual({
      ok: false,
      reason: 'expired_token',
    })
  })

  it('refuses a token of another type, even for the same booking', async () => {
    const fake = db()
    fake.tables.guest_tokens.push({
      hashed_token: hashGuestToken('manage-raw'),
      action_type: 'manage',
      customer_id: 'customer-1',
      table_booking_id: 'booking-1',
      preorder_cover_id: null,
      expires_at: '2027-01-01T00:00:00.000Z',
      consumed_at: null,
    })

    await expect(resolvePreorderGuestToken(fake as never, 'manage-raw', BEFORE_CUTOFF)).resolves.toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('refuses an unknown, empty, consumed or unscoped token', async () => {
    const fake = db()
    const token = await created(fake)
    fake.tables.guest_tokens.push({
      hashed_token: hashGuestToken('unscoped-raw'),
      action_type: 'preorder_guest',
      customer_id: 'customer-1',
      table_booking_id: 'booking-1',
      preorder_cover_id: null,
      expires_at: CUTOFF,
      consumed_at: null,
    })

    for (const raw of ['unknown-raw', '', 'unscoped-raw']) {
      await expect(resolvePreorderGuestToken(fake as never, raw, BEFORE_CUTOFF)).resolves.toEqual({
        ok: false,
        reason: 'invalid_token',
      })
    }

    fake.tables.guest_tokens[0].consumed_at = '2026-12-01T10:00:00.000Z'
    await expect(resolvePreorderGuestToken(fake as never, token.rawToken, BEFORE_CUTOFF)).resolves.toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })

  it('refuses a token whose expiry cannot be read', async () => {
    const fake = db()
    fake.tables.guest_tokens.push({
      hashed_token: hashGuestToken('broken-raw'),
      action_type: 'preorder_guest',
      customer_id: 'customer-1',
      table_booking_id: 'booking-1',
      preorder_cover_id: 'cover-2',
      expires_at: null,
      consumed_at: null,
    })

    await expect(resolvePreorderGuestToken(fake as never, 'broken-raw', BEFORE_CUTOFF)).resolves.toEqual({
      ok: false,
      reason: 'invalid_token',
    })
  })
})
