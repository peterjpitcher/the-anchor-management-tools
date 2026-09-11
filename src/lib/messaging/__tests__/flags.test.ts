import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The contract under test: every flag reads OFF unless the messaging_flags row holds the
// boolean true for it, in every failure mode (missing row, malformed value, query error,
// thrown error), and one successful read is trusted for 60 seconds.

const settingRowResult = { data: null as unknown, error: null as unknown }
const maybeSingleMock = vi.fn(() => Promise.resolve(settingRowResult))
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))
const selectMock = vi.fn(() => ({ eq: eqMock }))
const fromMock = vi.fn(() => ({ select: selectMock }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import {
  clearMessagingFlagCache,
  isMessagingFlagOn,
  MESSAGING_FLAG_KEYS,
} from '../flags'

beforeEach(() => {
  vi.clearAllMocks()
  clearMessagingFlagCache()
  settingRowResult.data = null
  settingRowResult.error = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isMessagingFlagOn', () => {
  it('reads the messaging_flags row from system_settings', async () => {
    await isMessagingFlagOn('bounce_sms_fallback')

    expect(fromMock).toHaveBeenCalledWith('system_settings')
    expect(selectMock).toHaveBeenCalledWith('value')
    expect(eqMock).toHaveBeenCalledWith('key', 'messaging_flags')
  })

  it('reads every flag as off when the row does not exist', async () => {
    for (const key of MESSAGING_FLAG_KEYS) {
      expect(await isMessagingFlagOn(key)).toBe(false)
    }
  })

  it('reads a flag as on only when it is stored as the boolean true', async () => {
    settingRowResult.data = {
      value: {
        table_cancelled_email_first: true,
        private_booking_email_first: false,
        event_promo_last_push: 'true',
        bounce_sms_fallback: 1,
      },
    }

    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(true)
    expect(await isMessagingFlagOn('private_booking_email_first')).toBe(false)
    expect(await isMessagingFlagOn('event_promo_last_push')).toBe(false)
    expect(await isMessagingFlagOn('bounce_sms_fallback')).toBe(false)
    expect(await isMessagingFlagOn('staff_message_email_option')).toBe(false)
  })

  it.each([
    ['a string', 'on'],
    ['a number', 1],
    ['a boolean', true],
    ['an array', ['table_cancelled_email_first']],
    ['null', null],
  ])('reads every flag as off when the stored value is malformed (%s)', async (_label, value) => {
    settingRowResult.data = { value }

    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(false)
  })

  it('reads off when the query returns an error, and tries again on the next call', async () => {
    settingRowResult.error = { code: '57014', message: 'canceling statement', details: null, hint: null }

    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(false)
    expect(logger.error).toHaveBeenCalledTimes(1)

    settingRowResult.error = null
    settingRowResult.data = { value: { table_cancelled_email_first: true } }

    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('reads off when building the client throws', async () => {
    vi.mocked(createAdminClient).mockImplementationOnce(() => {
      throw new Error('Missing Supabase environment variables')
    })

    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(false)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('reads off when the query itself rejects', async () => {
    maybeSingleMock.mockImplementationOnce(() => Promise.reject(new Error('fetch failed')))

    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(false)
  })

  it('trusts one read for 60 seconds, then reads the row again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T10:00:00Z'))
    settingRowResult.data = { value: { table_cancelled_email_first: true } }

    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(true)

    // The owner switches the path off. Inside the minute the cached read still answers.
    settingRowResult.data = { value: { table_cancelled_email_first: false } }
    vi.setSystemTime(new Date('2026-09-11T10:00:59Z'))
    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)

    // At 60 seconds the cache has expired and the change is seen.
    vi.setSystemTime(new Date('2026-09-11T10:01:00Z'))
    expect(await isMessagingFlagOn('table_cancelled_email_first')).toBe(false)
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('caches a missing row too, so an absent row costs one read a minute', async () => {
    await isMessagingFlagOn('table_cancelled_email_first')
    await isMessagingFlagOn('private_booking_email_first')

    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })
})
