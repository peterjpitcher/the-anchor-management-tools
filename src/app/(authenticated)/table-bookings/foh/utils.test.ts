import { describe, expect, it } from 'vitest'
import { mapFohBlockedReason } from './utils'

describe('mapFohBlockedReason', () => {
  it('shows a clear kitchen pacing message', () => {
    expect(mapFohBlockedReason('slot_full')).toContain('kitchen arrival window is full')
  })
})
