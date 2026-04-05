import { describe, it, expect } from 'vitest'

/**
 * Tests for leg chain validation logic and canonical distance cache ordering.
 * The actual validation lives in the server action, but the rules are testable
 * as pure logic extracted here.
 */

// Extracted validation logic (mirrors createTrip server action checks)
function validateLegChain(
  legs: Array<{ fromDestinationId: string; toDestinationId: string }>,
  homeBaseId: string
): string | null {
  if (legs.length === 0) return 'At least one leg is required'

  if (legs[0].fromDestinationId !== homeBaseId) {
    return 'First leg must start from home base'
  }

  if (legs[legs.length - 1].toDestinationId !== homeBaseId) {
    return 'Last leg must end at home base'
  }

  for (let i = 1; i < legs.length; i++) {
    if (legs[i].fromDestinationId !== legs[i - 1].toDestinationId) {
      return `Leg ${i + 1} must start where leg ${i} ends`
    }
  }

  return null // valid
}

// Canonical pair ordering (mirrors server action helper)
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

describe('validateLegChain', () => {
  const HOME = 'aaa-home'
  const DEST_A = 'bbb-costco'
  const DEST_B = 'ccc-b-and-m'

  it('should accept valid single-stop round trip', () => {
    const legs = [
      { fromDestinationId: HOME, toDestinationId: DEST_A },
      { fromDestinationId: DEST_A, toDestinationId: HOME },
    ]
    expect(validateLegChain(legs, HOME)).toBeNull()
  })

  it('should accept valid multi-stop round trip', () => {
    const legs = [
      { fromDestinationId: HOME, toDestinationId: DEST_A },
      { fromDestinationId: DEST_A, toDestinationId: DEST_B },
      { fromDestinationId: DEST_B, toDestinationId: HOME },
    ]
    expect(validateLegChain(legs, HOME)).toBeNull()
  })

  it('should reject empty legs', () => {
    expect(validateLegChain([], HOME)).toBe('At least one leg is required')
  })

  it('should reject when first leg does not start from home base', () => {
    const legs = [
      { fromDestinationId: DEST_A, toDestinationId: DEST_B },
      { fromDestinationId: DEST_B, toDestinationId: HOME },
    ]
    expect(validateLegChain(legs, HOME)).toBe('First leg must start from home base')
  })

  it('should reject when last leg does not end at home base', () => {
    const legs = [
      { fromDestinationId: HOME, toDestinationId: DEST_A },
      { fromDestinationId: DEST_A, toDestinationId: DEST_B },
    ]
    expect(validateLegChain(legs, HOME)).toBe('Last leg must end at home base')
  })

  it('should reject when chain is broken', () => {
    const legs = [
      { fromDestinationId: HOME, toDestinationId: DEST_A },
      { fromDestinationId: DEST_B, toDestinationId: HOME }, // should start from DEST_A
    ]
    expect(validateLegChain(legs, HOME)).toBe('Leg 2 must start where leg 1 ends')
  })
})

describe('canonicalPair', () => {
  it('should order smaller UUID first', () => {
    const [a, b] = canonicalPair('zzz', 'aaa')
    expect(a).toBe('aaa')
    expect(b).toBe('zzz')
  })

  it('should maintain order if already canonical', () => {
    const [a, b] = canonicalPair('aaa', 'zzz')
    expect(a).toBe('aaa')
    expect(b).toBe('zzz')
  })

  it('should handle equal UUIDs', () => {
    const [a, b] = canonicalPair('same', 'same')
    expect(a).toBe('same')
    expect(b).toBe('same')
  })

  it('should produce same result regardless of input order', () => {
    const pair1 = canonicalPair('abc-123', 'def-456')
    const pair2 = canonicalPair('def-456', 'abc-123')
    expect(pair1).toEqual(pair2)
  })
})
