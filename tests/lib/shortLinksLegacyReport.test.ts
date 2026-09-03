import { describe, expect, it } from 'vitest'
import {
  LEGACY_REPORT_LOCATIONS,
  isLegacyShortLinkHost,
  legacyReportLocationLabel,
  legacyReportSubmissionSchema,
  shouldShowLegacyInterstitial,
} from '@/lib/short-links/legacy-report'

const BASE = {
  requestHost: 'www.vip-club.uk',
  deviceType: 'mobile',
  isTablePaymentLink: false,
  shortCode: 'food',
}

describe('isLegacyShortLinkHost', () => {
  it('matches the legacy apex, www and subdomains', () => {
    expect(isLegacyShortLinkHost('vip-club.uk')).toBe(true)
    expect(isLegacyShortLinkHost('www.vip-club.uk')).toBe(true)
    expect(isLegacyShortLinkHost('go.vip-club.uk')).toBe(true)
  })

  it('ignores a port and casing', () => {
    expect(isLegacyShortLinkHost('WWW.VIP-CLUB.UK:443')).toBe(true)
  })

  it('does not match the canonical host or null', () => {
    expect(isLegacyShortLinkHost('l.the-anchor.pub')).toBe(false)
    expect(isLegacyShortLinkHost('the-anchor.pub')).toBe(false)
    expect(isLegacyShortLinkHost(null)).toBe(false)
  })

  it('does not match a lookalike domain that merely ends with the same letters', () => {
    expect(isLegacyShortLinkHost('notvip-club.uk')).toBe(false)
  })
})

describe('shouldShowLegacyInterstitial', () => {
  it('shows the interstitial for an ordinary legacy click', () => {
    expect(shouldShowLegacyInterstitial(BASE)).toBe(true)
  })

  it('never shows it on the canonical domain', () => {
    expect(shouldShowLegacyInterstitial({ ...BASE, requestHost: 'l.the-anchor.pub' })).toBe(false)
  })

  it('never interrupts a table payment link', () => {
    expect(shouldShowLegacyInterstitial({ ...BASE, isTablePaymentLink: true })).toBe(false)
  })

  it('never interrupts the protected feedback slug', () => {
    expect(shouldShowLegacyInterstitial({ ...BASE, shortCode: 'feedback' })).toBe(false)
    expect(shouldShowLegacyInterstitial({ ...BASE, shortCode: 'FEEDBACK' })).toBe(false)
  })

  it('sends bots straight through', () => {
    expect(shouldShowLegacyInterstitial({ ...BASE, deviceType: 'bot' })).toBe(false)
  })
})

describe('legacyReportSubmissionSchema', () => {
  it('accepts a valid one-tap submission', () => {
    const parsed = legacyReportSubmissionSchema.parse({ code: 'food', locationKey: 'table' })
    expect(parsed.locationKey).toBe('table')
    expect(parsed.isStaff).toBe(false)
    expect(parsed.locationDetail).toBeUndefined()
  })

  it('rejects a location that is not on the list', () => {
    expect(() => legacyReportSubmissionSchema.parse({ code: 'food', locationKey: 'nowhere' })).toThrow()
  })

  it('rejects a short code containing path characters', () => {
    expect(() =>
      legacyReportSubmissionSchema.parse({ code: '../admin', locationKey: 'table' })
    ).toThrow()
  })

  it('caps free-text detail', () => {
    expect(() =>
      legacyReportSubmissionSchema.parse({
        code: 'food',
        locationKey: 'other',
        locationDetail: 'x'.repeat(281),
      })
    ).toThrow()
  })

  it('treats blank detail as absent', () => {
    const parsed = legacyReportSubmissionSchema.parse({
      code: 'food',
      locationKey: 'other',
      locationDetail: '   ',
    })
    expect(parsed.locationDetail).toBeUndefined()
  })
})

describe('legacyReportLocationLabel', () => {
  it('resolves every option key to its label', () => {
    for (const option of LEGACY_REPORT_LOCATIONS) {
      expect(legacyReportLocationLabel(option.key)).toBe(option.label)
    }
  })

  it('falls back to the raw key so an old row still renders', () => {
    expect(legacyReportLocationLabel('retired_option')).toBe('retired_option')
    expect(legacyReportLocationLabel(null)).toBe('Unknown')
  })
})
