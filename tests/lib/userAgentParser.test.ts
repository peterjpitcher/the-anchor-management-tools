import { describe, expect, it } from 'vitest'

import { isKnownBotUserAgent, parseUserAgent } from '@/lib/user-agent-parser'

describe('user agent parser bot detection', () => {
  it('marks social preview crawlers as bots', () => {
    const ua = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
    expect(isKnownBotUserAgent(ua)).toBe(true)

    const parsed = parseUserAgent(ua)
    expect(parsed.deviceType).toBe('bot')
  })

  it('marks search crawlers as bots', () => {
    const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    const parsed = parseUserAgent(ua)

    expect(parsed.deviceType).toBe('bot')
  })

  it('keeps regular browsers as human traffic', () => {
    const mobileUa =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1'
    const desktopUa =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

    expect(parseUserAgent(mobileUa).deviceType).toBe('mobile')
    expect(parseUserAgent(desktopUa).deviceType).toBe('desktop')
  })

  it('respects already-classified bot device type', () => {
    expect(isKnownBotUserAgent('Mozilla/5.0', 'bot')).toBe(true)
  })

  it('returns unknown when user agent is missing', () => {
    expect(parseUserAgent(null)).toEqual({
      deviceType: 'unknown',
      browser: 'Unknown',
      os: 'Unknown',
    })
  })
})
