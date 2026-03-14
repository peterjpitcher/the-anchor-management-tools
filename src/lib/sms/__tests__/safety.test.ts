import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildSmsDedupContext, evaluateSmsSafetyLimits } from '../safety'
import { evaluateSmsQuietHours } from '../quiet-hours'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSupabaseMock(overrides: {
  globalCount?: number
  recipientHourCount?: number
  recipientDayCount?: number
  error?: unknown
} = {}) {
  const {
    globalCount = 0,
    recipientHourCount = 0,
    recipientDayCount = 0,
    error = null,
  } = overrides

  // Each .from().select().eq()…gte() chain returns a different count.
  // We track call order to return the correct value.
  let selectCallCount = 0

  const counts = [globalCount, recipientHourCount, recipientDayCount]

  const chain: Record<string, unknown> = {}
  const builder = () => chain

  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.gte = vi.fn().mockImplementation(() => {
    const idx = selectCallCount++
    return Promise.resolve({ count: error ? null : (counts[idx] ?? 0), error })
  })

  return {
    from: vi.fn().mockReturnValue(chain),
  }
}

// ---------------------------------------------------------------------------
// buildSmsDedupContext (pure function)
// ---------------------------------------------------------------------------

describe('buildSmsDedupContext', () => {
  describe('returns null when template_key is absent', () => {
    it('should return null when metadata is null', () => {
      const result = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: null,
      })
      expect(result).toBeNull()
    })

    it('should return null when metadata has no template_key', () => {
      const result = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: { event_booking_id: 'abc' },
      })
      expect(result).toBeNull()
    })

    it('should return null when template_key is an empty string', () => {
      const result = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: { template_key: '  ' },
      })
      expect(result).toBeNull()
    })
  })

  describe('returns a SmsDedupContext when template_key is present', () => {
    it('should return an object with key and requestHash properties', () => {
      const result = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: { template_key: 'event_reminder', event_booking_id: 'booking-1' },
      })
      expect(result).not.toBeNull()
      expect(result).toHaveProperty('key')
      expect(result).toHaveProperty('requestHash')
    })

    it('should produce a key with the "sms:" prefix', () => {
      const result = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: { template_key: 'event_reminder' },
      })
      expect(result!.key).toMatch(/^sms:/)
    })

    it('should produce consistent keys for identical inputs', () => {
      const params = {
        to: '+447700900123',
        body: 'Hello',
        metadata: { template_key: 'event_reminder', event_booking_id: 'booking-1' },
      }
      const r1 = buildSmsDedupContext(params)
      const r2 = buildSmsDedupContext(params)
      expect(r1!.key).toBe(r2!.key)
      expect(r1!.requestHash).toBe(r2!.requestHash)
    })

    it('should produce the same key but different requestHash when only body changes', () => {
      const base = {
        to: '+447700900123',
        metadata: { template_key: 'event_reminder', event_booking_id: 'booking-1' },
      }
      const r1 = buildSmsDedupContext({ ...base, body: 'Hello v1' })
      const r2 = buildSmsDedupContext({ ...base, body: 'Hello v2' })
      // Same key (body not included in dedupe scope), different requestHash (body is)
      expect(r1!.key).toBe(r2!.key)
      expect(r1!.requestHash).not.toBe(r2!.requestHash)
    })

    it('should produce different keys for different template_keys', () => {
      const base = {
        to: '+447700900123',
        body: 'Hello',
        metadata: { event_booking_id: 'booking-1' },
      }
      const r1 = buildSmsDedupContext({ ...base, metadata: { ...base.metadata, template_key: 'key_a' } })
      const r2 = buildSmsDedupContext({ ...base, metadata: { ...base.metadata, template_key: 'key_b' } })
      expect(r1!.key).not.toBe(r2!.key)
    })

    it('should use customerId in the identity when provided', () => {
      const withCustomer = buildSmsDedupContext({
        to: '+447700900123',
        customerId: 'cust-abc',
        body: 'Hello',
        metadata: { template_key: 'event_reminder', event_booking_id: 'booking-1' },
      })
      const withoutCustomer = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: { template_key: 'event_reminder', event_booking_id: 'booking-1' },
      })
      // Different identity → different key
      expect(withCustomer!.key).not.toBe(withoutCustomer!.key)
    })

    it('should fall back to a day_bucket_utc context when no known context keys are present', () => {
      // Just the template_key with no known context keys
      const result = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: { template_key: 'test_template' },
      })
      // Key is non-null and deterministic within the same UTC day
      expect(result).not.toBeNull()
      expect(result!.key).toMatch(/^sms:[a-f0-9]{64}$/)
    })

    it('should include marketing flag in context when metadata.marketing is true', () => {
      const withMarketing = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: { template_key: 'promo', marketing: true },
      })
      const withoutMarketing = buildSmsDedupContext({
        to: '+447700900123',
        body: 'Hello',
        metadata: { template_key: 'promo' },
      })
      // marketing=true changes context → different key
      expect(withMarketing!.key).not.toBe(withoutMarketing!.key)
    })
  })
})

// ---------------------------------------------------------------------------
// evaluateSmsSafetyLimits (requires Supabase mock)
// ---------------------------------------------------------------------------

describe('evaluateSmsSafetyLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Ensure safety guards are enabled for all tests
    delete process.env.SMS_SAFETY_GUARDS_ENABLED
    delete process.env.SMS_SAFETY_GLOBAL_HOURLY_LIMIT
    delete process.env.SMS_SAFETY_RECIPIENT_HOURLY_LIMIT
    delete process.env.SMS_SAFETY_RECIPIENT_DAILY_LIMIT
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return allowed: true when all counts are under limits', async () => {
    const supabase = makeSupabaseMock({
      globalCount: 10,
      recipientHourCount: 1,
      recipientDayCount: 2,
    })
    const result = await evaluateSmsSafetyLimits(supabase as any, {
      to: '+447700900123',
    })
    expect(result.allowed).toBe(true)
  })

  it('should return allowed: false with code "global_rate_limit" when global hourly limit is reached', async () => {
    // Default global hourly limit is 120; set env to a low value so we can exceed it
    process.env.SMS_SAFETY_GLOBAL_HOURLY_LIMIT = '5'
    const supabase = makeSupabaseMock({
      globalCount: 5, // >= limit
      recipientHourCount: 0,
      recipientDayCount: 0,
    })
    const result = await evaluateSmsSafetyLimits(supabase as any, {
      to: '+447700900123',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.code).toBe('global_rate_limit')
    }
    delete process.env.SMS_SAFETY_GLOBAL_HOURLY_LIMIT
  })

  it('should return allowed: false with code "recipient_hourly_limit" when recipient hourly limit is reached', async () => {
    process.env.SMS_SAFETY_RECIPIENT_HOURLY_LIMIT = '3'
    const supabase = makeSupabaseMock({
      globalCount: 0,
      recipientHourCount: 3, // >= limit
      recipientDayCount: 2,
    })
    const result = await evaluateSmsSafetyLimits(supabase as any, {
      to: '+447700900123',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.code).toBe('recipient_hourly_limit')
    }
    delete process.env.SMS_SAFETY_RECIPIENT_HOURLY_LIMIT
  })

  it('should return allowed: false with code "recipient_daily_limit" when recipient daily limit is reached', async () => {
    process.env.SMS_SAFETY_RECIPIENT_DAILY_LIMIT = '8'
    process.env.SMS_SAFETY_RECIPIENT_HOURLY_LIMIT = '100' // ensure hourly doesn't trigger
    const supabase = makeSupabaseMock({
      globalCount: 0,
      recipientHourCount: 0,
      recipientDayCount: 8, // >= limit
    })
    const result = await evaluateSmsSafetyLimits(supabase as any, {
      to: '+447700900123',
    })
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.code).toBe('recipient_daily_limit')
    }
    delete process.env.SMS_SAFETY_RECIPIENT_DAILY_LIMIT
    delete process.env.SMS_SAFETY_RECIPIENT_HOURLY_LIMIT
  })

  it('should return allowed: true when safety guards are disabled', async () => {
    process.env.SMS_SAFETY_GUARDS_ENABLED = 'false'
    // Even with a mock that would block, it should be allowed
    const supabase = makeSupabaseMock({
      globalCount: 9999,
      recipientHourCount: 9999,
      recipientDayCount: 9999,
    })
    const result = await evaluateSmsSafetyLimits(supabase as any, {
      to: '+447700900123',
    })
    expect(result.allowed).toBe(true)
    delete process.env.SMS_SAFETY_GUARDS_ENABLED
  })

  it('should include metrics in the response', async () => {
    const supabase = makeSupabaseMock({
      globalCount: 5,
      recipientHourCount: 1,
      recipientDayCount: 3,
    })
    const result = await evaluateSmsSafetyLimits(supabase as any, {
      to: '+447700900123',
    })
    expect(result.metrics).toBeDefined()
    expect(result.metrics.globalLastHour).toBe(5)
    expect(result.metrics.recipientLastHour).toBe(1)
    expect(result.metrics.recipientLast24h).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// evaluateSmsQuietHours (pure function with injectable clock)
// ---------------------------------------------------------------------------

describe('evaluateSmsQuietHours', () => {
  it('should return inQuietHours: false during active hours (10:00 London time)', () => {
    // 2025-06-15 is a summer Sunday — London is at UTC+1 (BST)
    // 09:00 UTC = 10:00 BST → active hours
    const now = new Date('2025-06-15T09:00:00Z')
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(false)
    expect(result.timezone).toBe('Europe/London')
  })

  it('should return inQuietHours: true at 22:00 London time (evening quiet hours)', () => {
    // 2025-06-15 21:00 UTC = 22:00 BST
    const now = new Date('2025-06-15T21:00:00Z')
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(true)
  })

  it('should return inQuietHours: true at 08:00 London time (morning quiet hours)', () => {
    // 2025-06-15 07:00 UTC = 08:00 BST
    const now = new Date('2025-06-15T07:00:00Z')
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(true)
  })

  it('should return inQuietHours: false at exactly 09:00 London time', () => {
    // 2025-06-15 08:00 UTC = 09:00 BST — exactly the boundary, allowed (hour < 21, >= 9)
    const now = new Date('2025-06-15T08:00:00Z')
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(false)
  })

  it('should return inQuietHours: true at exactly 21:00 London time', () => {
    // 2025-06-15 20:00 UTC = 21:00 BST
    const now = new Date('2025-06-15T20:00:00Z')
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(true)
  })

  it('should return inQuietHours: true in the early hours of the morning (02:00 London GMT)', () => {
    // 2025-01-15 02:00 UTC = 02:00 GMT (winter)
    const now = new Date('2025-01-15T02:00:00Z')
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(true)
  })

  it('should return nextAllowedSendAt equal to now when not in quiet hours', () => {
    const now = new Date('2025-06-15T09:00:00Z') // 10:00 BST — active
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(false)
    expect(result.nextAllowedSendAt).toEqual(now)
  })

  it('should return nextAllowedSendAt in the future when in evening quiet hours', () => {
    // 21:00 BST → quiet; next allowed = 09:00 BST next day
    const now = new Date('2025-06-15T21:00:00Z') // 22:00 BST
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(true)
    expect(result.nextAllowedSendAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it('should return nextAllowedSendAt in the future when in morning quiet hours', () => {
    // 07:00 BST → quiet; next allowed = 09:00 BST same day
    const now = new Date('2025-06-15T06:00:00Z') // 07:00 BST
    const result = evaluateSmsQuietHours(now)
    expect(result.inQuietHours).toBe(true)
    expect(result.nextAllowedSendAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it('should use current time as default when called with no arguments', () => {
    // Just verify it does not throw and returns the right shape
    const result = evaluateSmsQuietHours()
    expect(result).toHaveProperty('inQuietHours')
    expect(result).toHaveProperty('nextAllowedSendAt')
    expect(result).toHaveProperty('timezone')
    expect(typeof result.inQuietHours).toBe('boolean')
  })

  describe('BST/GMT boundary (clocks change)', () => {
    it('should correctly identify active hours on BST → GMT changeover day (2025-10-26)', () => {
      // After clocks go back: 10:00 UTC = 10:00 GMT = active hours
      const now = new Date('2025-10-26T10:00:00Z')
      const result = evaluateSmsQuietHours(now)
      expect(result.inQuietHours).toBe(false)
    })

    it('should correctly identify quiet hours on GMT → BST changeover day (2026-03-29)', () => {
      // 22:00 UTC = 22:00 GMT (clocks have moved forward, but this is 22:00 GMT → quiet)
      // Actually 2026-03-29 01:00 UTC is when BST starts. By 22:00 UTC it is 23:00 BST → quiet
      const now = new Date('2026-03-29T22:00:00Z')
      const result = evaluateSmsQuietHours(now)
      expect(result.inQuietHours).toBe(true)
    })
  })
})
