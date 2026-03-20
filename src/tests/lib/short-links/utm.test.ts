import { describe, it, expect } from 'vitest'
import { slugifyCampaign, buildUtmUrl, buildVariantName } from '@/lib/short-links/utm'

describe('slugifyCampaign', () => {
  it('should convert spaces and special chars to underscores', () => {
    expect(slugifyCampaign('Easter Sunday Lunch')).toBe('easter_sunday_lunch')
  })

  it('should strip leading/trailing underscores', () => {
    expect(slugifyCampaign('  --Hello World--  ')).toBe('hello_world')
  })

  it('should truncate to 100 chars', () => {
    const long = 'a'.repeat(150)
    expect(slugifyCampaign(long).length).toBe(100)
  })

  it('should handle empty string', () => {
    expect(slugifyCampaign('')).toBe('')
  })
})

describe('buildUtmUrl', () => {
  const facebookChannel = {
    key: 'facebook',
    label: 'Facebook',
    type: 'digital' as const,
    utmSource: 'facebook',
    utmMedium: 'social',
    utmContent: 'facebook_main',
  }

  it('should append UTM params to destination', () => {
    const result = buildUtmUrl('https://www.the-anchor.pub/events/easter', facebookChannel, 'Easter Lunch')
    const url = new URL(result)
    expect(url.searchParams.get('utm_source')).toBe('facebook')
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe('easter_lunch')
    expect(url.searchParams.get('utm_content')).toBe('facebook_main')
  })

  it('should preserve existing query params', () => {
    const result = buildUtmUrl('https://example.com?foo=bar', facebookChannel, 'Test')
    const url = new URL(result)
    expect(url.searchParams.get('foo')).toBe('bar')
    expect(url.searchParams.get('utm_source')).toBe('facebook')
  })
})

describe('buildVariantName', () => {
  it('should join parent name and channel with em-dash', () => {
    expect(buildVariantName('Easter Lunch', 'Facebook')).toBe('Easter Lunch \u2014 Facebook')
  })
})
