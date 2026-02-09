import { describe, expect, it } from 'vitest'
import {
  computeIdempotencyRequestHash,
  getIdempotencyKey
} from '@/lib/api/idempotency'

describe('computeIdempotencyRequestHash', () => {
  it('produces the same hash for semantically identical payloads', () => {
    const a = {
      customer: {
        first_name: 'Pete',
        mobile_number: '+447700900123'
      },
      seats: 4,
      event_id: 'abc'
    }

    const b = {
      event_id: 'abc',
      seats: 4,
      customer: {
        mobile_number: '+447700900123',
        first_name: 'Pete'
      }
    }

    expect(computeIdempotencyRequestHash(a)).toBe(computeIdempotencyRequestHash(b))
  })
})

describe('getIdempotencyKey', () => {
  it('returns trimmed key values', () => {
    const request = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'Idempotency-Key': '   test-key-123   '
      }
    })

    expect(getIdempotencyKey(request)).toBe('test-key-123')
  })

  it('returns null when the header is missing', () => {
    const request = new Request('https://example.com', { method: 'POST' })
    expect(getIdempotencyKey(request)).toBeNull()
  })
})
