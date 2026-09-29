import { describe, expect, it } from 'vitest'
import { validatePromotionCopy, type PromotionChannel } from '../event-promotion-validation'

const facebook = { name: 'Quiz Night', description: 'Bring your friends for a cheerful evening. Book your table.' }
const google = { title: 'Quiz Night', description: 'Join us for Quiz Night. Reserve your table using the button.' }

function copy(channel: PromotionChannel, description: string): typeof facebook | typeof google {
  return channel === 'facebook_event' ? { ...facebook, description } : { ...google, description }
}

describe('validatePromotionCopy', () => {
  it('accepts and trims valid copy for each channel', () => {
    expect(validatePromotionCopy('facebook_event', { ...facebook, name: ' Quiz Night ' }).content).toEqual(facebook)
    expect(validatePromotionCopy('google_business_profile_event', google)).toEqual({ content: google, issues: [] })
  })

  it.each([
    ['facebook_event', 'name', 70], ['facebook_event', 'description', 3000],
    ['google_business_profile_event', 'title', 58], ['google_business_profile_event', 'description', 1500],
  ] as const)('enforces the %s %s editorial cap without truncating', (channel, field, limit) => {
    const original = channel === 'facebook_event' ? facebook : google
    expect(validatePromotionCopy(channel, { ...original, [field]: 'a'.repeat(limit) }).issues).toEqual([])
    const rejected = validatePromotionCopy(channel, { ...original, [field]: 'a'.repeat(limit + 1) })
    expect(rejected.content).toBeNull()
    expect(rejected.issues.length).toBeGreaterThan(0)
  })

  it.each([null, undefined, [], 'copy', {}, { name: '', description: 'Good evening' },
    { name: 'Quiz', description: ' ' }, { name: 4, description: 'Good evening' },
    { ...facebook, unexpected: 'field' }, { title: 'Wrong shape', description: 'Good evening' },
  ])('rejects malformed Facebook output: %j', (value) => {
    expect(validatePromotionCopy('facebook_event', value).content).toBeNull()
  })

  it.each([null, {}, { title: '', description: 'Join us' }, { ...google, extra: true }, facebook])('rejects malformed GBP output: %j', (value) => {
    expect(validatePromotionCopy('google_business_profile_event', value).content).toBeNull()
  })

  it.each(['facebook_event', 'google_business_profile_event'] as const)('rejects markup, URLs and banned claims for %s', (channel) => {
    for (const description of ['<p>Join us</p>', '**Join us**', '# Join us', '- Join us', '`Join us`',
      '[Book](https://example.com)', 'Visit https://example.com', 'Visit the-anchor.pub',
      `Join us ${String.fromCharCode(0x2014)} today`, 'Serving Stanwell Moor since 1866.']) {
      const result = validatePromotionCopy(channel, copy(channel, description))
      expect(result.content, description).toBeNull()
      expect(result.issues.length, description).toBeGreaterThan(0)
    }
  })

  it.each(['Join us 🎉', 'Book on 01753 123456', 'Call +44 (0)1753 123456',
    'Email hello@example.com', 'Find us @theanchor', 'Win a prize 1️⃣', 'Join us 🇬🇧'])('rejects GBP contact details or emojis: %s', (description) => {
    expect(validatePromotionCopy('google_business_profile_event', copy('google_business_profile_event', description)).content).toBeNull()
  })

  it('allows event dates, times and prices in GBP copy', () => {
    expect(validatePromotionCopy('google_business_profile_event', { ...google, description: '30 September 2026, 7:00pm. £10 per person. Date: 2026-09-30.' }).issues).toEqual([])
  })

  it('allows one complete Facebook emoji but rejects two or a title emoji', () => {
    for (const emoji of ['🎉', '👨‍👩‍👧‍👦', '🇬🇧', '👍🏽', '1️⃣']) {
      expect(validatePromotionCopy('facebook_event', { ...facebook, description: `Join us ${emoji}` }).issues).toEqual([])
    }
    expect(validatePromotionCopy('facebook_event', { ...facebook, description: 'Join us 🎉 🎉' }).content).toBeNull()
    expect(validatePromotionCopy('facebook_event', { ...facebook, name: 'Quiz 🎉' }).content).toBeNull()
  })
})
