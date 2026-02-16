import { describe, expect, it } from 'vitest'
import {
  assertFeb2026EventReviewSmsSendAllowed,
  assertFeb2026EventReviewSmsSendLimit,
  isFeb2026EventReviewSmsRunEnabled,
  isFeb2026EventReviewSmsSendEnabled,
  readFeb2026EventReviewSmsSendLimit,
} from '@/lib/send-feb-2026-event-review-sms-safety'

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const snapshot: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    snapshot[key] = process.env[key]
    const value = env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return fn()
  } finally {
    for (const key of Object.keys(env)) {
      const value = snapshot[key]
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

describe('send-feb-2026-event-review-sms safety', () => {
  it('requires RUN_FEB_REVIEW_SMS_SEND to enable send mode', () => {
    withEnv({ RUN_FEB_REVIEW_SMS_SEND: undefined }, () => {
      expect(isFeb2026EventReviewSmsRunEnabled()).toBe(false)
      expect(isFeb2026EventReviewSmsSendEnabled(['--confirm'])).toBe(false)
    })
  })

  it('requires --confirm and RUN_FEB_REVIEW_SMS_SEND to enable send mode', () => {
    withEnv({ RUN_FEB_REVIEW_SMS_SEND: 'true' }, () => {
      expect(isFeb2026EventReviewSmsRunEnabled()).toBe(true)
      expect(isFeb2026EventReviewSmsSendEnabled([])).toBe(false)
      expect(isFeb2026EventReviewSmsSendEnabled(['--confirm'])).toBe(true)
    })
  })

  it('blocks sending unless ALLOW_FEB_REVIEW_SMS_SEND is set', () => {
    withEnv({ ALLOW_FEB_REVIEW_SMS_SEND: undefined }, () => {
      expect(() => assertFeb2026EventReviewSmsSendAllowed()).toThrow(
        'send-feb-2026-event-review-sms blocked by safety guard. Set ALLOW_FEB_REVIEW_SMS_SEND=true to run this mutation script.'
      )
    })

    withEnv({ ALLOW_FEB_REVIEW_SMS_SEND: 'true' }, () => {
      expect(() => assertFeb2026EventReviewSmsSendAllowed()).not.toThrow()
    })
  })

  it('parses --limit=<n> send caps', () => {
    expect(readFeb2026EventReviewSmsSendLimit(['--limit=25'])).toBe(25)
    expect(readFeb2026EventReviewSmsSendLimit(['--limit', '10'])).toBe(10)
    expect(readFeb2026EventReviewSmsSendLimit(['--limit', '0'])).toBeNull()
    expect(readFeb2026EventReviewSmsSendLimit(['--limit=not-a-number'])).toBeNull()
  })

  it('falls back to FEB_REVIEW_SMS_SEND_LIMIT when no CLI limit is provided', () => {
    withEnv({ FEB_REVIEW_SMS_SEND_LIMIT: '12' }, () => {
      expect(readFeb2026EventReviewSmsSendLimit([])).toBe(12)
    })
  })

  it('enforces hard send caps', () => {
    expect(() => assertFeb2026EventReviewSmsSendLimit(1, 200)).not.toThrow()
    expect(() => assertFeb2026EventReviewSmsSendLimit(201, 200)).toThrow(
      'send-feb-2026-event-review-sms blocked: send limit 201 exceeds hard cap 200. Run in smaller batches.'
    )
  })
})

