import { describe, expect, it } from 'vitest'
import { RetryConfigs } from '@/lib/retry'

describe('RetryConfigs.sms.retryIf', () => {
  it('does not retry permanent delivery failures', () => {
    expect(RetryConfigs.sms.retryIf({ code: 21211 } as any)).toBe(false)
    expect(RetryConfigs.sms.retryIf({ code: 21610 } as any)).toBe(false)
  })

  it('retries explicit Twilio back-pressure failures', () => {
    expect(RetryConfigs.sms.retryIf({ code: 20429 } as any)).toBe(true)
    expect(RetryConfigs.sms.retryIf({ code: 30001 } as any)).toBe(true)
    expect(RetryConfigs.sms.retryIf({ status: 429 } as any)).toBe(true)
  })

  it('does not retry ambiguous transport failures', () => {
    expect(RetryConfigs.sms.retryIf({ status: 503 } as any)).toBe(false)
    expect(RetryConfigs.sms.retryIf({ code: 'ETIMEDOUT' } as any)).toBe(false)
  })

  it('defaults to no retry for unknown errors', () => {
    expect(RetryConfigs.sms.retryIf({ code: 21611, status: 400 } as any)).toBe(false)
    expect(RetryConfigs.sms.retryIf({} as any)).toBe(false)
  })
})
