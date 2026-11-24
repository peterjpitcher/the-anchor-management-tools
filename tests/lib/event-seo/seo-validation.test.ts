import { describe, expect, it } from 'vitest'
import {
  applyDeterministicRepair,
  capitaliseProperNames,
  capAndDeduplicate,
  containsKeyword,
  countKeywordMatches,
  focusPhrase,
  keywordCoverage,
  namesHomeAndNearbyPlace,
  normalizeSlug,
  validateGeneratedContent,
} from '@/lib/seo-validation'
import { SLEIGH_FACTS, validDraft } from '../../fixtures/event-seo/valid-draft'

function check(overrides: Record<string, unknown> = {}, facts = SLEIGH_FACTS) {
  return validateGeneratedContent({ ...validDraft(), ...overrides }, { facts, mode: 'final' })
}

function codes(result: ReturnType<typeof check>, severity?: string): string[] {
  return result.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code)
}

describe('the fixture draft', () => {
  it('passes with no issues at all', () => {
    expect(check()).toEqual({ passed: true, issues: [] })
  })
})

// Section 4.2 of the spec: checks that could not fail. Each test fails on the code before
// 24 November 2026.
describe('checks that used to pass anything', () => {
  it('no longer counts a three word keyword as present from its first two words', () => {
    expect(containsKeyword('Lots of things to see here', ['things to do in staines'])).toBe(false)
    expect(containsKeyword('Welcome to the anchor', ['the anchor stanwell moor'])).toBe(false)
    expect(containsKeyword("What's on this week", ["what's on staines"])).toBe(false)
    expect(containsKeyword('Good pubs near the river', ['pubs near heathrow'])).toBe(false)
  })

  it('requires the focus phrase itself, not any primary keyword', () => {
    const description = 'Music bingo with Nikki on Friday 11 December 2026 at 7pm, at The Anchor, Stanwell Moor. Entry is £5 cash. Book on this page now please.'
    const result = check({ metaDescription: description }, {
      ...SLEIGH_FACTS,
      primaryKeywords: ['christmas music bingo', 'music bingo'],
    })
    expect(codes(result, 'repairable')).toContain('meta_desc_focus')
  })

  it('can pass the first paragraph date check, and fails it when the date is missing', () => {
    expect(codes(check())).not.toContain('first_para_date')
    const longDescription = (validDraft().longDescription as string).replace('on Friday 11 December 2026', 'this winter')
    expect(codes(check({ longDescription }))).toContain('first_para_date')
  })

  it('gives the same URL finding on every run', () => {
    const shortDescription = 'Christmas music bingo at The Anchor, Stanwell Moor, on Friday 11 December 2026. Details at https://the-anchor.pub/events today.'
    const first = codes(check({ shortDescription })).filter((c) => c === 'contains_urls').length
    const second = codes(check({ shortDescription })).filter((c) => c === 'contains_urls').length
    const third = codes(check({ shortDescription })).filter((c) => c === 'contains_urls').length
    expect([first, second, third]).toEqual([1, 1, 1])
  })

  it('no longer gates a keywords array the form throws away', () => {
    expect(check({ keywords: [] }).passed).toBe(true)
    expect(codes(check({ keywords: ['one'] }))).not.toContain('keywords_count')
  })
})

describe('keyword matching', () => {
  it('matches the whole phrase on word boundaries', () => {
    expect(containsKeyword('A night of christmas music bingo.', ['christmas music bingo'])).toBe(true)
    expect(containsKeyword('A start to the night', ['art'])).toBe(false)
  })

  it('folds hyphens, apostrophes and plurals', () => {
    expect(containsKeyword('A family friendly pub quiz', ['family-friendly pub quiz'])).toBe(true)
    expect(containsKeyword("A New Year's Eve party", ['new years eve party'])).toBe(true)
    expect(containsKeyword('Our bingo nights', ['bingo night'])).toBe(true)
  })

  it('strips "near me" before matching and never matches on it alone', () => {
    expect(containsKeyword('Pub bingo in Stanwell Moor', ['pub bingo near me'])).toBe(true)
    expect(containsKeyword('anything', ['near me'])).toBe(false)
    expect(focusPhrase(['near me', 'music bingo near me'])).toBe('music bingo')
  })

  it('counts and covers with the same matcher', () => {
    const text = 'Music bingo and drag bingo'
    expect(countKeywordMatches(text, ['music bingo', 'drag bingo', 'snowball bingo'])).toBe(2)
    expect(keywordCoverage(text, ['music bingo', 'drag bingo', 'snowball bingo'], 2)).toBe(true)
    expect(keywordCoverage(text, ['snowball bingo', 'cash bingo'], 2)).toBe(false)
    expect(keywordCoverage(text, [], 2)).toBe(true)
  })

  it('needs Stanwell Moor and one other place', () => {
    expect(namesHomeAndNearbyPlace('In Stanwell Moor, near Staines')).toBe(true)
    expect(namesHomeAndNearbyPlace('In Stanwell Moor')).toBe(false)
    expect(namesHomeAndNearbyPlace('Near Staines and Heathrow')).toBe(false)
  })
})

describe('meta title', () => {
  it('rejects a date, which the website would freeze into the search title', () => {
    expect(codes(check({ metaTitle: 'Music Bingo, 11 December' }), 'repairable')).toContain('meta_title_date')
    expect(codes(check({ metaTitle: 'Music Bingo | Fri 11 Dec' }), 'repairable')).toContain('meta_title_date')
  })

  it('rejects the venue name, which the website adds', () => {
    expect(codes(check({ metaTitle: 'Music Bingo | The Anchor' }), 'repairable')).toContain('meta_title_venue_suffix')
  })

  it('warns on a near miss and blocks a long title', () => {
    expect(codes(check({ metaTitle: 'Christmas Music Bingo Night!' }))).not.toContain('meta_title_length')
    const nearMiss = check({ metaTitle: 'Festive Christmas Music Bingo' })
    expect(nearMiss.issues.find((i) => i.code === 'meta_title_length')?.severity).toBe('warning')
    const long = check({ metaTitle: 'Sleigh My Name: Festive Christmas Music Bingo' })
    expect(long.issues.find((i) => i.code === 'meta_title_length')?.severity).toBe('repairable')
  })
})

describe('meta description', () => {
  it('needs the weekday and the date', () => {
    const metaDescription = 'Christmas music bingo with Nikki on 11 December 2026 at 7pm, at The Anchor, Stanwell Moor. Entry is £5 cash. Book your place on this page.'
    expect(codes(check({ metaDescription }), 'repairable')).toContain('meta_desc_date')
  })

  it('takes no exclamation mark', () => {
    const metaDescription = 'Christmas music bingo with Nikki on Friday 11 December 2026 at 7pm, at The Anchor, Stanwell Moor. Entry is £5 cash. Book on this page!'
    expect(codes(check({ metaDescription }), 'repairable')).toContain('meta_desc_exclamation')
  })
})

describe('reads true after the night', () => {
  it('rejects an invitation anywhere in the short description', () => {
    const shortDescription = 'Join us for two rounds of Christmas music bingo with Nikki at The Anchor, Stanwell Moor, on Friday 11 December 2026.'
    expect(codes(check({ shortDescription }), 'repairable')).toContain('reads_as_invitation')
  })

  it('rejects one exclamation mark at the end of the long description', () => {
    const longDescription = `${validDraft().longDescription as string} It will be brilliant!`
    expect(codes(check({ longDescription }), 'repairable')).toContain('reads_as_invitation')
  })

  it('treats a typographic apostrophe the same as a straight one', () => {
    const longDescription = `${validDraft().longDescription as string} Don’t miss it.`
    expect(codes(check({ longDescription }), 'repairable')).toContain('reads_as_invitation')
  })
})

describe('long description', () => {
  it('needs the focus phrase in the first paragraph', () => {
    const longDescription = (validDraft().longDescription as string).replace('a night of Christmas music bingo', 'a festive night')
    expect(codes(check({ longDescription }), 'repairable')).toContain('first_para_focus')
  })

  it('needs Stanwell Moor and a nearby place', () => {
    const longDescription = (validDraft().longDescription as string)
      .replace(/Stanwell Moor/g, 'the village')
    expect(codes(check({ longDescription }), 'repairable')).toContain('local_places')
  })

  it('warns, never blocks, when supporting terms are thin', () => {
    const result = check({}, { ...SLEIGH_FACTS, secondaryKeywords: ['interactive music event', 'song quiz', 'pub music games'] })
    expect(result.issues.find((i) => i.code === 'supporting_keywords')?.severity).toBe('warning')
    expect(result.passed).toBe(true)
  })

  it('is fatal when far too short', () => {
    expect(codes(check({ longDescription: 'Too short.\n\nStill short.' }), 'fatal')).toContain('long_desc_word_count')
  })
})

describe('FAQs', () => {
  it('needs the focus phrase in one question', () => {
    const faqs = (validDraft().faqs as Array<{ question: string; answer: string }>).map((f, i) =>
      i === 0 ? { ...f, question: 'Is there music bingo near Staines in December?' } : f,
    )
    expect(codes(check({ faqs }), 'repairable')).toContain('faq_focus')
  })

  it('warns when more than one question is about booking', () => {
    const faqs = [
      ...(validDraft().faqs as Array<{ question: string; answer: string }>),
      { question: 'How do I book?', answer: 'Through the form on this page, or by phone on 01753 682707. Book a place for everyone in your group so we can keep you together.' },
      { question: 'Can I pay by card?', answer: 'Entry is cash on arrival, and the bar takes cards as usual. There is a cash machine at the shop in Stanwell Moor if you need one.' },
    ]
    expect(codes(check({ faqs }), 'warning')).toContain('faq_booking_questions')
  })
})

describe('house style', () => {
  it('blocks a banned claim in a highlight', () => {
    const highlights = ['Two rounds of festive music bingo', 'Gluten free options on the menu', 'Entry £5, cash on arrival']
    expect(codes(check({ highlights }), 'repairable')).toContain('banned_claim')
  })
})

describe('slug', () => {
  it('puts only the focus words the name lacks in front, as the spec example', () => {
    const slug = normalizeSlug('Sleigh My Name: Festive Music Bingo', '2026-12-11', 'christmas music bingo')
    expect(slug).toBe('christmas-sleigh-my-name-festive-music-bingo-2026-12-11')
    expect(slug.length).toBe(55)
  })

  it('does not repeat a focus phrase the name already has', () => {
    expect(normalizeSlug('Tinsel & Trivia Quiz Night', '2026-12-02', 'quiz night')).toBe('tinsel-trivia-quiz-night-2026-12-02')
  })

  it('stays within 60 characters and keeps the date', () => {
    const slug = normalizeSlug('An Exceptionally Long Themed Evening of Questions About Everything', '2026-10-07', 'pub quiz')
    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith('-2026-10-07')).toBe(true)
  })
})

describe('deterministic repair', () => {
  it('keeps highlight capitals and removes duplicates ignoring case', () => {
    const repaired = applyDeterministicRepair({ highlights: ['Hosted by Nikki', 'hosted by nikki', 'Two rounds.'] })
    expect(repaired.highlights).toEqual(['Hosted by Nikki', 'Two rounds'])
  })

  it('never touches the slug', () => {
    const repaired = applyDeterministicRepair({ slug: 'kept-as-it-is-2026-12-11' }, SLEIGH_FACTS)
    expect(repaired.slug).toBe('kept-as-it-is-2026-12-11')
  })

  it('strips markdown and URLs from prose and FAQ answers', () => {
    const repaired = applyDeterministicRepair({
      shortDescription: '**Bold** text https://example.com here',
      faqs: [{ question: 'Q?', answer: 'See [the page](https://x.y) now' }],
    })
    expect(repaired.shortDescription).toBe('Bold text here')
    expect((repaired.faqs as Array<{ answer: string }>)[0].answer).toBe('See the page now')
  })

  it('lower cases only when asked', () => {
    expect(capAndDeduplicate(['Music Bingo', 'music bingo', 'Drag Bingo'], 5)).toEqual(['Music Bingo', 'Drag Bingo'])
    expect(capAndDeduplicate(['Music Bingo', 'Drag Bingo'], 5, { lowercase: true })).toEqual(['music bingo', 'drag bingo'])
  })
})

describe('what the website would take out of search (spec 6.2.6, 6.2.7)', () => {
  it('blocks "accessible toilet" in the descriptions and highlights however it is phrased', () => {
    const long = `${validDraft().longDescription}\n\nWe don't have an accessible toilet.`
    expect(codes(check({ longDescription: long }), 'repairable')).toContain('website_banned_claim')
    expect(codes(check({ highlights: [...(validDraft().highlights as string[]), 'No accessible toilet'] }), 'repairable')).toContain(
      'website_banned_claim',
    )
  })

  it('blocks baby changing in the short description, even as a denial', () => {
    const short = 'Two rounds of Christmas music bingo with Nikki at The Anchor, Stanwell Moor, on Friday 11 December 2026. No baby changing.'
    expect(codes(check({ shortDescription: short }), 'repairable')).toContain('website_banned_claim')
  })

  it('blocks a retired format anywhere in the copy, but not music bingo', () => {
    const faqs = [...(validDraft().faqs as Array<{ question: string; answer: string }>)]
    faqs[1] = { ...faqs[1], answer: `${faqs[1].answer} There is live music afterwards.` }
    expect(codes(check({ faqs }), 'repairable')).toContain('retired_format')
    expect(codes(check())).not.toContain('retired_format')
  })

  it('passes the clean draft', () => {
    expect(codes(check())).not.toContain('website_banned_claim')
  })
})

describe('capitaliseProperNames', () => {
  it('capitalises seasonal names the model copied from a lower-case focus phrase', () => {
    expect(capitaliseProperNames('A night of christmas pub quiz in stanwell moor.')).toBe(
      'A night of Christmas pub quiz in Stanwell Moor.',
    )
    expect(capitaliseProperNames('A new years eve party.')).toBe("A New Year's Eve party.")
    expect(capitaliseProperNames('A new year’s eve party.')).toBe('A New Year’s Eve party.')
    expect(capitaliseProperNames('halloween party and boxing day')).toBe('Halloween party and Boxing Day')
  })

  it('still carries the focus phrase for the gate', () => {
    expect(containsKeyword(capitaliseProperNames('A new years eve party at The Anchor'), ['new years eve party'])).toBe(true)
  })

  it('is applied by the deterministic repair to every prose field', () => {
    const draft = validDraft()
    draft.longDescription = String(draft.longDescription).replace('Christmas music bingo', 'christmas music bingo')
    draft.highlights = ['Two rounds of christmas songs', 'Hosted by Nikki', 'Dinner from 4pm', 'Entry £5']
    const fixed = applyDeterministicRepair(draft)
    expect(fixed.longDescription).toContain('Christmas music bingo')
    expect(fixed.longDescription).not.toContain('christmas')
    expect((fixed.highlights as string[])[0]).toBe('Two rounds of Christmas songs')
  })
})
