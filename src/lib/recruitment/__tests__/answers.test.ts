import { describe, it, expect } from 'vitest'
import { formatAvailabilityAnswer } from '../answers'

describe('formatAvailabilityAnswer', () => {
  describe('shapes the old code rendered correctly', () => {
    it('should prefer raw when the public form shape is stored', () => {
      // The shape every current production row uses.
      const result = formatAvailabilityAnswer({
        raw: 'Evenings and weekends',
        preferred_role: 'Bartender',
      })
      expect(result.availability).toBe('Evenings and weekends')
      expect(result.preferredRole).toBe('Bartender')
    })

    it('should fall back to text when raw is absent', () => {
      expect(formatAvailabilityAnswer({ text: 'Weekends only' }).availability).toBe('Weekends only')
    })

    it('should prefer raw over text when both are present', () => {
      expect(formatAvailabilityAnswer({ raw: 'From raw', text: 'From text' }).availability).toBe('From raw')
    })

    it('should pass a plain string through', () => {
      expect(formatAvailabilityAnswer('Any shift').availability).toBe('Any shift')
    })
  })

  describe('shapes the old code silently dropped', () => {
    it('should render a day-map object instead of dropping it', () => {
      const result = formatAvailabilityAnswer({ monday: true, tuesday: false })
      expect(result.availability).toBe('Monday: yes\nTuesday: no')
    })

    it('should render an array instead of dropping it', () => {
      expect(formatAvailabilityAnswer(['Mon evening', 'Sat']).availability).toBe('Mon evening, Sat')
    })

    it('should render nested structures instead of dropping them', () => {
      const result = formatAvailabilityAnswer({ days: ['Mon', 'Tue'], shifts: { evening: true } })
      expect(result.availability).toBe('Days: Mon, Tue\nShifts: Evening: yes')
    })

    it('should keep unrecognised keys alongside raw rather than losing them', () => {
      // The subtle case: preferring `raw` must not discard sibling answers.
      const result = formatAvailabilityAnswer({ raw: 'Evenings', notice_period: '2 weeks' })
      expect(result.availability).toBe('Evenings\nNotice period: 2 weeks')
    })

    it('should dump a non-string raw rather than treating it as absent', () => {
      const result = formatAvailabilityAnswer({ raw: { evening: true } })
      expect(result.availability).toBe('Raw: Evening: yes')
    })

    it('should render a non-string preferred_role rather than dropping it', () => {
      const result = formatAvailabilityAnswer({ preferred_role: ['Bartender', 'Chef'] })
      expect(result.preferredRole).toBeNull()
      expect(result.availability).toBe('Preferred role: Bartender, Chef')
    })

    it('should render numbers and zero', () => {
      expect(formatAvailabilityAnswer({ hours_per_week: 0 }).availability).toBe('Hours per week: 0')
    })
  })

  describe('empty and absent values', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an empty object', {}],
      ['an empty array', []],
      ['an empty string', '   '],
      ['an all-empty object', { raw: '', text: null }],
    ])('should return nothing for %s', (_label, input) => {
      expect(formatAvailabilityAnswer(input)).toEqual({ availability: null, preferredRole: null })
    })

    it('should ignore an empty raw but still use text', () => {
      expect(formatAvailabilityAnswer({ raw: '  ', text: 'Weekends' }).availability).toBe('Weekends')
    })

    it('should not report an empty preferred_role', () => {
      const result = formatAvailabilityAnswer({ raw: 'Evenings', preferred_role: '  ' })
      expect(result.preferredRole).toBeNull()
      expect(result.availability).toBe('Evenings')
    })
  })

  describe('robustness', () => {
    it('should trim surrounding whitespace', () => {
      expect(formatAvailabilityAnswer({ raw: '  Evenings  ' }).availability).toBe('Evenings')
    })

    it('should preserve internal newlines for pre-wrap rendering', () => {
      expect(formatAvailabilityAnswer({ raw: 'Mon\nTue' }).availability).toBe('Mon\nTue')
    })

    it('should not recurse without bound on deeply nested input', () => {
      let nested: Record<string, unknown> = { value: 'deep' }
      for (let i = 0; i < 50; i += 1) nested = { level: nested }
      const result = formatAvailabilityAnswer(nested)
      expect(result.availability).toContain('deep')
    })

    it('should survive values JSON cannot serialise', () => {
      expect(() => formatAvailabilityAnswer({ big: 1n })).not.toThrow()
    })
  })
})
