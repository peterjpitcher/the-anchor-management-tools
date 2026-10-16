import { describe, expect, it } from 'vitest'
import { mapFohBlockedReason } from './utils'

describe('mapFohBlockedReason', () => {
  it('shows a clear kitchen pacing message', () => {
    expect(mapFohBlockedReason('slot_full')).toContain('kitchen arrival window is full')
  })

  it('reads the database reason when the server could only say blocked', () => {
    expect(mapFohBlockedReason('blocked', 'outside_full')).toContain('outside tables are taken')
  })

  it('still prefers a specific server reason', () => {
    expect(mapFohBlockedReason('no_table', 'something_else')).toContain('No suitable table')
  })
})
