import { describe, it, expect } from 'vitest'
import { applyUtmParams } from '../utm-url'

const BASE = 'https://www.the-anchor.pub/events'
const WITH_UTM = 'https://www.the-anchor.pub/events?utm_source=facebook&utm_medium=social&utm_campaign=summer'

describe('applyUtmParams', () => {
  it('should return the URL untouched when the UTM section is hidden', () => {
    expect(applyUtmParams(WITH_UTM, { source: '', medium: '', campaign: '' }, false)).toBe(WITH_UTM)
  })

  it('should set utm params from non-empty fields when shown', () => {
    const result = applyUtmParams(BASE, { source: 'facebook', medium: 'social', campaign: 'summer' }, true)
    const url = new URL(result)
    expect(url.searchParams.get('utm_source')).toBe('facebook')
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe('summer')
  })

  it('should delete utm params when their fields are cleared', () => {
    const result = applyUtmParams(WITH_UTM, { source: '', medium: '', campaign: '' }, true)
    const url = new URL(result)
    expect(url.searchParams.has('utm_source')).toBe(false)
    expect(url.searchParams.has('utm_medium')).toBe(false)
    expect(url.searchParams.has('utm_campaign')).toBe(false)
    expect(url.pathname).toBe('/events')
  })

  it('should delete only the cleared param and keep the others', () => {
    const result = applyUtmParams(WITH_UTM, { source: 'facebook', medium: '', campaign: 'summer' }, true)
    const url = new URL(result)
    expect(url.searchParams.get('utm_source')).toBe('facebook')
    expect(url.searchParams.has('utm_medium')).toBe(false)
    expect(url.searchParams.get('utm_campaign')).toBe('summer')
  })

  it('should trim whitespace and treat whitespace-only fields as empty', () => {
    const result = applyUtmParams(WITH_UTM, { source: '  insta  ', medium: '   ', campaign: '' }, true)
    const url = new URL(result)
    expect(url.searchParams.get('utm_source')).toBe('insta')
    expect(url.searchParams.has('utm_medium')).toBe(false)
    expect(url.searchParams.has('utm_campaign')).toBe(false)
  })

  it('should preserve unrelated query params', () => {
    const result = applyUtmParams(`${BASE}?ref=abc&utm_source=old`, { source: '', medium: '', campaign: '' }, true)
    const url = new URL(result)
    expect(url.searchParams.get('ref')).toBe('abc')
    expect(url.searchParams.has('utm_source')).toBe(false)
  })

  it('should throw for an invalid URL when shown (caller validates first)', () => {
    expect(() => applyUtmParams('not-a-url', { source: 'x', medium: '', campaign: '' }, true)).toThrow()
  })
})
