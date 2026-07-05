import { describe, it, expect } from 'vitest'
import { checkCapacity } from '../conflicts'

// SOP §6 live values used as realistic fixtures (data comes from settings, not code)
const diningRoom = { name: 'The Dining Room', capacity_seated: 26, capacity_standing: 50 }
const mainArea = { name: 'The Main Area', capacity_seated: 29, capacity_standing: 150 }
const entirePub = { name: 'Entire Pub', capacity_seated: 119, capacity_standing: 300 }

describe('checkCapacity', () => {
  describe('layout selection', () => {
    it('should use the seated capacity when layout is seated', () => {
      const result = checkCapacity({ spaces: [diningRoom], guestCount: 26, layout: 'seated' })
      expect(result.ok).toBe(true)
      expect(result.capacity).toBe(26)
    })

    it('should block when guest count exceeds the seated capacity for a seated layout', () => {
      const result = checkCapacity({ spaces: [diningRoom], guestCount: 27, layout: 'seated' })
      expect(result.ok).toBe(false)
      expect(result.capacity).toBe(26)
      expect(result.reason).toContain('27')
      expect(result.reason).toContain('26')
      expect(result.reason).toContain('The Dining Room')
    })

    it('should use the standing capacity when layout is standing', () => {
      const result = checkCapacity({ spaces: [diningRoom], guestCount: 50, layout: 'standing' })
      expect(result.ok).toBe(true)
      expect(result.capacity).toBe(50)
    })

    it('should use the standing capacity when layout is mixed', () => {
      const result = checkCapacity({ spaces: [diningRoom], guestCount: 40, layout: 'mixed' })
      expect(result.ok).toBe(true)
      expect(result.capacity).toBe(50)
    })

    it('should use max(seated, standing) when layout is missing', () => {
      const result = checkCapacity({ spaces: [diningRoom], guestCount: 45, layout: null })
      expect(result.ok).toBe(true)
      expect(result.capacity).toBe(50)
    })

    it('should block against max(seated, standing) when layout is missing and count exceeds it', () => {
      const result = checkCapacity({ spaces: [diningRoom], guestCount: 51 })
      expect(result.ok).toBe(false)
      expect(result.capacity).toBe(50)
    })
  })

  describe('multiple spaces', () => {
    it('should sum capacities across all selected spaces', () => {
      const result = checkCapacity({
        spaces: [diningRoom, mainArea],
        guestCount: 55,
        layout: 'seated',
      })
      // 26 + 29 = 55 seated
      expect(result.ok).toBe(true)
      expect(result.capacity).toBe(55)
    })

    it('should block when guest count exceeds the combined capacity', () => {
      const result = checkCapacity({
        spaces: [diningRoom, mainArea],
        guestCount: 56,
        layout: 'seated',
      })
      expect(result.ok).toBe(false)
      expect(result.capacity).toBe(55)
      expect(result.reason).toContain('The Dining Room')
      expect(result.reason).toContain('The Main Area')
    })

    it('should handle a whole-venue standing booking', () => {
      const result = checkCapacity({ spaces: [entirePub], guestCount: 300, layout: 'standing' })
      expect(result.ok).toBe(true)
      expect(result.capacity).toBe(300)
    })
  })

  describe('unknown capacity handling', () => {
    it('should skip spaces with missing capacity data but still check known ones', () => {
      const unknownSpace = { name: 'Mystery Room', capacity_seated: null, capacity_standing: null }
      const result = checkCapacity({
        spaces: [diningRoom, unknownSpace],
        guestCount: 30,
        layout: 'seated',
      })
      // Only the Dining Room's 26 counts; 30 exceeds it
      expect(result.ok).toBe(false)
      expect(result.capacity).toBe(26)
      expect(result.reason).toContain('without capacity data')
    })

    it('should treat zero capacity as unknown', () => {
      const zeroSpace = { name: 'Zero Room', capacity_seated: 0, capacity_standing: 0 }
      const result = checkCapacity({ spaces: [zeroSpace, mainArea], guestCount: 29, layout: 'seated' })
      expect(result.ok).toBe(true)
      expect(result.capacity).toBe(29)
    })

    it('should treat a missing seated capacity as unknown for a seated layout', () => {
      const standingOnly = { name: 'Standing Only', capacity_seated: null, capacity_standing: 100 }
      const result = checkCapacity({ spaces: [standingOnly], guestCount: 500, layout: 'seated' })
      expect(result.ok).toBe(true)
      expect(result.reason).toBe('capacity data missing')
    })

    it('should pass with reason "capacity data missing" when every space lacks capacity data', () => {
      const result = checkCapacity({
        spaces: [
          { name: 'A', capacity_seated: null, capacity_standing: null },
          { name: 'B', capacity_seated: 0, capacity_standing: 0 },
        ],
        guestCount: 100,
        layout: 'standing',
      })
      expect(result.ok).toBe(true)
      expect(result.reason).toBe('capacity data missing')
      expect(result.capacity).toBeUndefined()
    })

    it('should pass with reason "capacity data missing" when no spaces are selected', () => {
      const result = checkCapacity({ spaces: [], guestCount: 100, layout: 'seated' })
      expect(result.ok).toBe(true)
      expect(result.reason).toBe('capacity data missing')
    })
  })

  describe('guest count handling', () => {
    it('should pass with no reason when guest count is missing', () => {
      const result = checkCapacity({ spaces: [diningRoom], guestCount: null, layout: 'seated' })
      expect(result.ok).toBe(true)
      expect(result.reason).toBeUndefined()
      expect(result.capacity).toBe(26)
    })

    it('should pass when guest count is undefined', () => {
      const result = checkCapacity({ spaces: [diningRoom], layout: 'seated' })
      expect(result.ok).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should pass on the exact capacity boundary', () => {
      const result = checkCapacity({ spaces: [mainArea], guestCount: 150, layout: 'standing' })
      expect(result.ok).toBe(true)
      expect(result.capacity).toBe(150)
    })

    it('should block one over the boundary', () => {
      const result = checkCapacity({ spaces: [mainArea], guestCount: 151, layout: 'standing' })
      expect(result.ok).toBe(false)
    })
  })

  describe('blocked reasons', () => {
    it('should name the layout in the reason', () => {
      const seated = checkCapacity({ spaces: [diningRoom], guestCount: 100, layout: 'seated' })
      expect(seated.reason).toContain('seated')

      const standing = checkCapacity({ spaces: [diningRoom], guestCount: 100, layout: 'standing' })
      expect(standing.reason).toContain('standing')

      const mixed = checkCapacity({ spaces: [diningRoom], guestCount: 100, layout: 'mixed' })
      expect(mixed.reason).toContain('mixed')
    })
  })
})
