// src/lib/__tests__/seo-validation.test.ts

import { describe, it, expect } from 'vitest'
import {
  containsKeyword,
  countKeywordMatches,
  keywordCoverage,
  countWords,
  getFirstNWords,
  countParagraphs,
  countValidFaqs,
  validateGeneratedContent,
  trimAndNormalizeWhitespace,
  removeMarkdownMarkers,
  normalizeSlug,
  removeRawUrls,
  capAndDeduplicate,
  applyDeterministicRepair,
} from '@/lib/seo-validation'
import type {
  SeoIssueSeverity,
  SeoValidationIssue,
  SeoValidationOptions,
  SeoValidationResult,
} from '@/lib/seo-validation'

// ---------------------------------------------------------------------------
// Test helper: builds a fully valid draft that passes all checks
// ---------------------------------------------------------------------------

function buildValidDraft(): Record<string, unknown> {
  // Build a long description with 5 paragraphs, ~500 words total (~100 words each)
  const makeParagraph = (words: number, prefix: string): string =>
    `${prefix} ` + Array(words - countWords(prefix)).fill('great food drinks pub evening night music').join(' ').split(/\s+/).slice(0, words - countWords(prefix)).join(' ')

  const para1 = 'Live music with Jessica Lovelock at The Anchor on 2026-05-23 in Stanwell Moor. ' +
    Array(85).fill('word').join(' ')
  const para2 = makeParagraph(100, 'The evening features an incredible lineup of songs.')
  const para3 = makeParagraph(100, 'Our kitchen serves freshly made pizza throughout the evening.')
  const para4 = makeParagraph(100, 'The Anchor is the perfect Stanwell Moor pub for a night out.')
  const para5 = makeParagraph(100, 'Booking is recommended to guarantee your spot at this event.')

  return {
    metaTitle: 'Live Music: Jessica Lovelock at The Anchor',
    metaDescription: 'Enjoy free live music with Jessica Lovelock at The Anchor in Stanwell Moor on 23 May 2026. Great food, drinks, and an amazing atmosphere await.',
    shortDescription: 'Free live music at The Anchor featuring Jessica Lovelock on Friday 23 May 2026. Join us in Stanwell Moor for a fantastic evening of entertainment with great food and drinks.',
    longDescription: [para1, para2, para3, para4, para5].join('\n\n'),
    slug: 'live-music-jessica-lovelock-2026-05-23',
    imageAltText: 'Jessica Lovelock performing live music at The Anchor pub in Stanwell Moor on a Friday evening with audience',
    highlights: [
      'Free entry all evening long',
      'Live music from eight pm',
      'Freshly made pizza available',
      'Great selection of real ales',
    ],
    faqs: [
      {
        question: 'What time does the live music start at The Anchor on Friday evening',
        answer: 'The live music starts at eight pm and runs until approximately ten pm. We recommend arriving early to grab a good seat and enjoy some food before the performance begins at The Anchor.',
      },
      {
        question: 'Is there a cover charge for the live music night at The Anchor',
        answer: 'No, entry is completely free for the live music night. Simply come along and enjoy the performance. We do recommend booking a table if you want to eat during the evening to guarantee availability.',
      },
      {
        question: 'Can I book a table for the live music event at The Anchor pub',
        answer: 'Yes, you can book a table by calling us or using our online booking system. Walk-ins are also welcome but we recommend booking in advance especially on live music nights to secure your preferred seating area.',
      },
    ],
    keywords: [
      'live music stanwell moor',
      'jessica lovelock',
      'the anchor pub',
      'free live music',
      'pub entertainment',
      'stanwell moor events',
      'friday night music',
      'live music near heathrow',
    ],
    accessibilityNotes: 'Ground-floor venue with step-free access.',
  }
}

function buildValidFacts(): NonNullable<SeoValidationOptions['facts']> {
  return {
    name: 'Jessica Lovelock',
    date: '2026-05-23',
    primaryKeywords: ['live music'],
    secondaryKeywords: ['pub entertainment', 'friday night'],
    localSeoKeywords: ['stanwell moor', 'near heathrow'],
  }
}

function buildValidOptions(): SeoValidationOptions {
  return {
    facts: buildValidFacts(),
    requireKeywords: true,
    mode: 'final',
  }
}

// ---------------------------------------------------------------------------
// Existing tests (preserved)
// ---------------------------------------------------------------------------

describe('containsKeyword', () => {
  it('returns false for empty text', () => {
    expect(containsKeyword('', ['live music'])).toBe(false)
  })

  it('returns false for empty keywords', () => {
    expect(containsKeyword('some text', [])).toBe(false)
  })

  it('matches exact phrase', () => {
    expect(containsKeyword('enjoy live music tonight', ['live music'])).toBe(true)
  })

  it('matches at start of text', () => {
    expect(containsKeyword('live music at the pub', ['live music'])).toBe(true)
  })

  it('matches at end of text', () => {
    expect(containsKeyword('enjoy the live music', ['live music'])).toBe(true)
  })

  it('matches with punctuation boundary', () => {
    expect(containsKeyword('enjoy live music, food and drinks', ['live music'])).toBe(true)
  })

  it('matches with period boundary', () => {
    expect(containsKeyword('We have live music. Come along.', ['live music'])).toBe(true)
  })

  it('does NOT match partial words', () => {
    expect(containsKeyword('the startup is alive with musical talent', ['live music'])).toBe(false)
  })

  it('does NOT match "art" inside "start"', () => {
    expect(containsKeyword('start the show', ['art'])).toBe(false)
  })

  it('handles hyphen/space equivalence', () => {
    expect(containsKeyword('enjoy live-music tonight', ['live music'])).toBe(true)
    expect(containsKeyword('enjoy live music tonight', ['live-music'])).toBe(true)
  })

  it('is case insensitive', () => {
    expect(containsKeyword('Live Music Tonight', ['live music'])).toBe(true)
  })

  it('matches any keyword in the array', () => {
    expect(containsKeyword('quiz night at the pub', ['live music', 'quiz night'])).toBe(true)
  })

  it('returns false when no keywords match', () => {
    expect(containsKeyword('pizza and drinks', ['live music', 'quiz night'])).toBe(false)
  })

  it('matches long-tail keyword via prefix -- "live music tonight near me" matches text with "live music"', () => {
    expect(containsKeyword('enjoy live music at the pub', ['live music tonight near me'])).toBe(true)
  })

  it('matches long-tail keyword via intermediate prefix', () => {
    expect(containsKeyword('live music tonight at The Anchor', ['live music tonight near me'])).toBe(true)
  })

  it('does NOT match long-tail keyword when even 2-word prefix is absent', () => {
    expect(containsKeyword('great food and drinks', ['live music tonight near me'])).toBe(false)
  })

  it('does NOT try prefix matching for 2-word keywords', () => {
    expect(containsKeyword('we have live entertainment', ['live music'])).toBe(false)
  })

  it('does NOT match "alive musical" for keyword "live music"', () => {
    expect(containsKeyword('the alive musical performance was great', ['live music'])).toBe(false)
  })
})

describe('countKeywordMatches', () => {
  it('returns 0 for empty text', () => {
    expect(countKeywordMatches('', ['a', 'b'])).toBe(0)
  })

  it('counts matching keywords', () => {
    expect(countKeywordMatches(
      'live music tonight with quiz night after',
      ['live music', 'quiz night', 'karaoke']
    )).toBe(2)
  })
})

describe('keywordCoverage', () => {
  it('returns true when no keywords configured', () => {
    expect(keywordCoverage('any text', [], 2)).toBe(true)
  })

  it('requires min(minRequired, keywords.length) matches', () => {
    expect(keywordCoverage('live music tonight', ['live music'], 2)).toBe(true)
  })

  it('fails when not enough keywords match', () => {
    expect(keywordCoverage(
      'live music tonight',
      ['live music', 'quiz night', 'karaoke'],
      2
    )).toBe(false)
  })

  it('passes when enough keywords match', () => {
    expect(keywordCoverage(
      'live music tonight with a quiz night',
      ['live music', 'quiz night', 'karaoke'],
      2
    )).toBe(true)
  })
})

describe('countWords', () => {
  it('returns 0 for null', () => {
    expect(countWords(null)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
  })

  it('counts words correctly', () => {
    expect(countWords('one two three')).toBe(3)
  })

  it('handles extra whitespace', () => {
    expect(countWords('  one   two   three  ')).toBe(3)
  })
})

describe('getFirstNWords', () => {
  it('returns empty for null', () => {
    expect(getFirstNWords(null, 5)).toBe('')
  })

  it('returns first N words', () => {
    expect(getFirstNWords('one two three four five six', 3)).toBe('one two three')
  })

  it('returns all words if fewer than N', () => {
    expect(getFirstNWords('one two', 5)).toBe('one two')
  })
})

describe('countParagraphs', () => {
  it('returns 0 for null', () => {
    expect(countParagraphs(null)).toBe(0)
  })

  it('counts single paragraph', () => {
    expect(countParagraphs('just one paragraph')).toBe(1)
  })

  it('counts paragraphs split by double newline', () => {
    expect(countParagraphs('para one\n\npara two\n\npara three')).toBe(3)
  })

  it('ignores empty paragraphs', () => {
    expect(countParagraphs('para one\n\n\n\npara two')).toBe(2)
  })

  it('single newlines do not count as paragraph breaks', () => {
    expect(countParagraphs('line one\nline two\nline three')).toBe(1)
  })
})

describe('countValidFaqs', () => {
  it('counts FAQs with non-empty question and answer >= 20 chars', () => {
    expect(countValidFaqs([
      { question: 'What time?', answer: 'The event starts at 8pm sharp on the night.' },
      { question: '', answer: 'This has no question so it should not count.' },
      { question: 'Is it free?', answer: 'Yes' },
      { question: 'Where is it?', answer: 'The Anchor is on Horton Road in Stanwell Moor.' },
    ])).toBe(2)
  })

  it('returns 0 for empty array', () => {
    expect(countValidFaqs([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Backward compatibility tests
// ---------------------------------------------------------------------------

describe('validateGeneratedContent (legacy mode, no options)', () => {
  const validContent = {
    metaTitle: 'Live Music -- Jessica Lovelock',
    metaDescription: 'Join us for free live music at The Anchor with Jessica Lovelock on 23 May!',
    shortDescription: 'Free live music at The Anchor featuring Jessica Lovelock on 23 May.',
    longDescription: Array(100).fill('word word word word five').join('\n\n'),
    slug: 'live-music-jessica-lovelock-2026-05-23',
    imageAltText: 'Jessica Lovelock performing live music at The Anchor pub',
    highlights: ['Free entry', 'Live music', 'Pizza menu'],
    faqs: [
      { question: 'What time does it start?', answer: 'The live music starts at 8pm and runs until 10pm.' },
      { question: 'Is there food?', answer: 'Yes, our pizza kitchen is open throughout the evening.' },
      { question: 'Do I need to book?', answer: 'Walk-ins welcome but booking guarantees your spot.' },
    ],
    accessibilityNotes: 'Ground-floor venue with step-free access.',
  }

  it('passes for valid content', () => {
    const result = validateGeneratedContent(validContent)
    expect(result.passed).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('returns SeoValidationResult with passed boolean and issues array', () => {
    const result = validateGeneratedContent(validContent)
    expect(typeof result.passed).toBe('boolean')
    expect(Array.isArray(result.issues)).toBe(true)
  })

  it('issues are SeoValidationIssue objects with code, severity, message', () => {
    const result = validateGeneratedContent({
      ...validContent,
      metaTitle: 'A'.repeat(41),
    })
    expect(result.passed).toBe(false)
    expect(result.issues[0]).toHaveProperty('code')
    expect(result.issues[0]).toHaveProperty('severity')
    expect(result.issues[0]).toHaveProperty('message')
  })

  it('fails for meta title over 40 chars', () => {
    const result = validateGeneratedContent({
      ...validContent,
      metaTitle: 'A'.repeat(41),
    })
    expect(result.passed).toBe(false)
    expect(result.issues[0].message).toContain('Meta title')
  })

  it('fails for meta description over 155 chars', () => {
    const result = validateGeneratedContent({
      ...validContent,
      metaDescription: 'A'.repeat(156),
    })
    expect(result.passed).toBe(false)
    expect(result.issues[0].message).toContain('Meta description')
  })

  it('fails for long description under 450 words', () => {
    const result = validateGeneratedContent({
      ...validContent,
      longDescription: 'Short text with only a few words here.',
    })
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.message.includes('words'))).toBe(true)
  })

  it('fails for fewer than 4 paragraphs', () => {
    const result = validateGeneratedContent({
      ...validContent,
      longDescription: Array(200).fill('word').join(' '),
    })
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.message.includes('paragraphs'))).toBe(true)
  })

  it('fails for empty required fields', () => {
    const result = validateGeneratedContent({
      ...validContent,
      slug: '',
    })
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.message.includes('slug'))).toBe(true)
  })

  it('fails for fewer than 3 valid FAQs', () => {
    const result = validateGeneratedContent({
      ...validContent,
      faqs: [
        { question: 'Q1?', answer: 'This answer is long enough to count as valid.' },
        { question: 'Q2?', answer: 'Short' },
      ],
    })
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.message.includes('FAQ'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Full validation gate tests
// ---------------------------------------------------------------------------

describe('validateGeneratedContent (full mode, with options)', () => {
  it('should pass for a completely valid draft', () => {
    const draft = buildValidDraft()
    const options = buildValidOptions()
    const result = validateGeneratedContent(draft, options)
    const nonWarnings = result.issues.filter(i => i.severity !== 'warning')
    expect(nonWarnings).toHaveLength(0)
    expect(result.passed).toBe(true)
  })

  // --- Required fields (fatal) ---
  describe('required fields', () => {
    const requiredFields = [
      'metaTitle', 'metaDescription', 'shortDescription',
      'longDescription', 'slug', 'imageAltText',
    ]

    for (const field of requiredFields) {
      it(`should report fatal when ${field} is empty`, () => {
        const draft = buildValidDraft()
        draft[field] = ''
        const result = validateGeneratedContent(draft, buildValidOptions())
        const issue = result.issues.find(
          i => i.code === 'missing_required_field' && i.field === field
        )
        expect(issue).toBeDefined()
        expect(issue!.severity).toBe('fatal')
        expect(result.passed).toBe(false)
      })
    }

    it('should report fatal when highlights array is empty', () => {
      const draft = buildValidDraft()
      draft.highlights = []
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'missing_highlights')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('fatal')
    })

    it('should report fatal when faqs array is empty', () => {
      const draft = buildValidDraft()
      draft.faqs = []
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'missing_faqs')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('fatal')
    })
  })

  // --- Meta title ---
  describe('meta title', () => {
    it('should report fatal when meta title exceeds 60 chars', () => {
      const draft = buildValidDraft()
      draft.metaTitle = 'A'.repeat(61)
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_title_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('fatal')
    })

    it('should report repairable when meta title is under 20 chars', () => {
      const draft = buildValidDraft()
      draft.metaTitle = 'Short Title'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_title_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when meta title lacks primary keyword', () => {
      const draft = buildValidDraft()
      draft.metaTitle = 'Jessica Lovelock at The Anchor Pub'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_title_keyword')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when meta title has venue suffix with pipe', () => {
      const draft = buildValidDraft()
      draft.metaTitle = 'Live Music: Jessica Lovelock | The Anchor'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_title_venue_suffix')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when meta title has venue suffix with dash', () => {
      const draft = buildValidDraft()
      draft.metaTitle = 'Live Music: Jessica Lovelock - The Anchor'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_title_venue_suffix')
      expect(issue).toBeDefined()
    })
  })

  // --- Meta description ---
  describe('meta description', () => {
    it('should report fatal when meta description is under 50 chars', () => {
      const draft = buildValidDraft()
      draft.metaDescription = 'Too short for a meta description.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_desc_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('fatal')
    })

    it('should report fatal when meta description exceeds 160 chars', () => {
      const draft = buildValidDraft()
      draft.metaDescription = 'Live music '.repeat(20)
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_desc_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('fatal')
    })

    it('should report repairable when meta description is 50-90 chars', () => {
      const draft = buildValidDraft()
      draft.metaDescription = 'Enjoy live music with Jessica Lovelock at The Anchor in Stanwell Moor on Friday.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_desc_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when primary keyword not in first 80 chars', () => {
      const draft = buildValidDraft()
      draft.metaDescription = 'Join us at The Anchor in Stanwell Moor for a fantastic evening of entertainment with live music and great food and drinks.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'meta_desc_keyword')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })
  })

  // --- Short description ---
  describe('short description', () => {
    it('should report advisory warning (non-blocking) when short description is under 120 chars', () => {
      const draft = buildValidDraft()
      draft.shortDescription = 'Free live music at The Anchor featuring Jessica Lovelock.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'short_desc_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })

    it('should report repairable when short description exceeds 300 chars', () => {
      const draft = buildValidDraft()
      draft.shortDescription = 'A'.repeat(301)
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'short_desc_length')
      expect(issue).toBeDefined()
    })

    it('should report repairable when short description contains markdown', () => {
      const draft = buildValidDraft()
      draft.shortDescription = 'Free **live music** at The Anchor featuring Jessica Lovelock on Friday 23 May 2026 in Stanwell Moor for a great evening of entertainment.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'short_desc_markdown')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when short description contains URLs', () => {
      const draft = buildValidDraft()
      draft.shortDescription = 'Free live music at The Anchor. Book at https://the-anchor.pub/book for a great evening of entertainment in Stanwell Moor.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'short_desc_urls')
      expect(issue).toBeDefined()
    })
  })

  // --- Long description ---
  describe('long description', () => {
    it('should report fatal when long description is under 200 words', () => {
      const draft = buildValidDraft()
      draft.longDescription = Array(50).fill('word').join(' ')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'long_desc_word_count')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('fatal')
    })

    it('should report warning (not blocking) when long description is 200-349 words', () => {
      const draft = buildValidDraft()
      const para = Array(80).fill('word').join(' ')
      draft.longDescription = [para, para, para, para].join('\n\n')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'long_desc_word_count')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })

    it('should report repairable when long description exceeds 700 words', () => {
      const draft = buildValidDraft()
      const para = Array(150).fill('word').join(' ')
      draft.longDescription = [para, para, para, para, para].join('\n\n')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'long_desc_word_count')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when fewer than 4 paragraphs', () => {
      const draft = buildValidDraft()
      const para = Array(170).fill('word').join(' ')
      draft.longDescription = [para, para, para].join('\n\n')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'long_desc_paragraphs')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when more than 7 paragraphs', () => {
      const draft = buildValidDraft()
      const para = Array(65).fill('word').join(' ')
      draft.longDescription = Array(8).fill(para).join('\n\n')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'long_desc_paragraphs')
      expect(issue).toBeDefined()
    })

    it('should report warning for paragraphs outside 40-150 word range', () => {
      const draft = buildValidDraft()
      const shortPara = Array(20).fill('word').join(' ')
      const normalPara = Array(100).fill('word').join(' ')
      draft.longDescription = [shortPara, normalPara, normalPara, normalPara, normalPara].join('\n\n')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'long_desc_para_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
      expect(issue!.message).toContain('1')
    })
  })

  // --- First paragraph checks ---
  describe('first paragraph', () => {
    it('should report warning when first paragraph lacks event name', () => {
      const draft = buildValidDraft()
      const para = Array(100).fill('word').join(' ')
      draft.longDescription = [
        'Live music at The Anchor in Stanwell Moor on 2026-05-23. ' + Array(80).fill('word').join(' '),
        para, para, para, para,
      ].join('\n\n')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'first_para_name')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })

    it('should report repairable when first paragraph lacks primary keyword', () => {
      const draft = buildValidDraft()
      const para = Array(100).fill('word').join(' ')
      draft.longDescription = [
        'Jessica Lovelock performs at The Anchor in Stanwell Moor. ' + Array(80).fill('word').join(' '),
        para, para, para, para,
      ].join('\n\n')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'first_para_keyword')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report warning when first paragraph lacks date', () => {
      const draft = buildValidDraft()
      const para = Array(100).fill('word').join(' ')
      draft.longDescription = [
        'Live music with Jessica Lovelock at The Anchor in Stanwell Moor. ' + Array(80).fill('word').join(' '),
        para, para, para, para,
      ].join('\n\n')
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'first_para_date')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })
  })

  // --- Local content ---
  describe('local content', () => {
    it('should report warning (not blocking) when long description lacks local SEO keywords', () => {
      const draft = buildValidDraft()
      const para = Array(100).fill('word').join(' ')
      draft.longDescription = [
        'Live music with Jessica Lovelock at The Anchor on 2026-05-23. ' + Array(80).fill('word').join(' '),
        para, para, para, para,
      ].join('\n\n')
      const facts = buildValidFacts()
      facts.localSeoKeywords = ['stanwell moor', 'near heathrow']
      const result = validateGeneratedContent(draft, { facts })
      const issue = result.issues.find(i => i.code === 'local_content')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })
  })

  // --- Highlights ---
  describe('highlights', () => {
    it('should report repairable when fewer than 3 highlights', () => {
      const draft = buildValidDraft()
      draft.highlights = ['Free entry all evening', 'Live music available']
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'highlights_count')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when more than 5 highlights', () => {
      const draft = buildValidDraft()
      draft.highlights = [
        'Free entry all evening long',
        'Live music from eight pm',
        'Pizza kitchen open all night',
        'Great selection of real ales',
        'Family friendly until nine pm',
        'Outdoor seating area available too',
      ]
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'highlights_count')
      expect(issue).toBeDefined()
    })

    it('should report warning when highlights have 3 or fewer words', () => {
      const draft = buildValidDraft()
      draft.highlights = ['Free entry', 'Live music', 'Pizza available', 'Great ales selection tonight']
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'highlights_specific')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })
  })

  // --- Keywords ---
  describe('keywords', () => {
    it('should report repairable when fewer than 6 keywords', () => {
      const draft = buildValidDraft()
      draft.keywords = ['live music', 'pub', 'stanwell']
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'keywords_count')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when more than 10 keywords', () => {
      const draft = buildValidDraft()
      draft.keywords = Array(11).fill(0).map((_, i) => `keyword number ${i + 1}`)
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'keywords_count')
      expect(issue).toBeDefined()
    })

    it('should report repairable when primary keyword missing from keywords list', () => {
      const draft = buildValidDraft()
      draft.keywords = [
        'jessica lovelock',
        'the anchor pub',
        'stanwell moor events',
        'friday night',
        'pub entertainment',
        'near heathrow',
      ]
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'keywords_primary')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })
  })

  // --- Slug ---
  describe('slug', () => {
    it('should report repairable when slug contains uppercase or special chars', () => {
      const draft = buildValidDraft()
      draft.slug = 'Live_Music_Jessica!'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'slug_format')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when slug lacks date', () => {
      const draft = buildValidDraft()
      draft.slug = 'live-music-jessica-lovelock'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'slug_date')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when slug lacks primary keyword', () => {
      const draft = buildValidDraft()
      draft.slug = 'jessica-lovelock-2026-05-23'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'slug_keyword')
      expect(issue).toBeDefined()
    })
  })

  // --- Image alt text ---
  describe('image alt text', () => {
    it('should report repairable when alt text is under 50 chars', () => {
      const draft = buildValidDraft()
      draft.imageAltText = 'Live music at The Anchor'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'alt_text_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when alt text exceeds 180 chars', () => {
      const draft = buildValidDraft()
      draft.imageAltText = 'A'.repeat(181)
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'alt_text_length')
      expect(issue).toBeDefined()
    })

    it('should report repairable when alt text lacks primary keyword', () => {
      const draft = buildValidDraft()
      draft.imageAltText = 'Jessica Lovelock performing at The Anchor pub in Stanwell Moor on a Friday evening with a great audience turnout'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'alt_text_keyword')
      expect(issue).toBeDefined()
    })

    it('should report repairable when alt text starts with "image of"', () => {
      const draft = buildValidDraft()
      draft.imageAltText = 'Image of Jessica Lovelock performing live music at The Anchor pub in Stanwell Moor on a Friday evening'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'alt_text_filler')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when alt text starts with "photo of"', () => {
      const draft = buildValidDraft()
      draft.imageAltText = 'Photo of live music night at The Anchor pub in Stanwell Moor with Jessica Lovelock performing on stage'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'alt_text_filler')
      expect(issue).toBeDefined()
    })
  })

  // --- FAQs ---
  describe('faqs', () => {
    it('should report repairable when fewer than 3 FAQs', () => {
      const draft = buildValidDraft()
      draft.faqs = [
        { question: 'What time does the live music start at The Anchor pub', answer: 'The live music starts at eight pm and runs until approximately ten pm. We recommend arriving early to grab a good seat and enjoy some food before the show.' },
      ]
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'faq_count')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when more than 5 FAQs', () => {
      const draft = buildValidDraft()
      const baseFaq = {
        question: 'What time does the live music start at The Anchor pub on Friday',
        answer: 'The live music starts at eight pm and runs until approximately ten pm. We recommend arriving early to grab a good seat and enjoy some food before the performance begins.',
      }
      draft.faqs = Array(6).fill(baseFaq)
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'faq_count')
      expect(issue).toBeDefined()
    })

    it('should report warning when FAQ question is under 8 words', () => {
      const draft = buildValidDraft()
      const faqs = [...(draft.faqs as { question: string; answer: string }[])]
      faqs[0] = {
        question: 'What time?',
        answer: 'The live music starts at eight pm and runs until approximately ten pm. We recommend arriving early to grab a good seat and enjoy some food before the show.',
      }
      draft.faqs = faqs
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'faq_question_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })

    it('should report warning when FAQ answer is under 30 words', () => {
      const draft = buildValidDraft()
      const faqs = [...(draft.faqs as { question: string; answer: string }[])]
      faqs[0] = {
        question: 'What time does the live music start at The Anchor pub',
        answer: 'The music starts at eight pm.',
      }
      draft.faqs = faqs
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'faq_answer_length')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })
  })

  // --- Formatting checks ---
  describe('formatting', () => {
    it('should report repairable when prose field contains markdown', () => {
      const draft = buildValidDraft()
      draft.metaDescription = 'Enjoy **live music** with Jessica Lovelock at The Anchor in Stanwell Moor on Friday 23 May for a great evening out.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'contains_markdown' && i.field === 'metaDescription')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when prose field contains HTML tags', () => {
      const draft = buildValidDraft()
      draft.shortDescription = 'Free live music at <b>The Anchor</b> featuring Jessica Lovelock on Friday 23 May 2026 in Stanwell Moor for a great evening out.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'contains_html' && i.field === 'shortDescription')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })

    it('should report repairable when prose field contains URLs', () => {
      const draft = buildValidDraft()
      draft.metaTitle = 'Live Music https://example.com Jessica'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'contains_urls' && i.field === 'metaTitle')
      expect(issue).toBeDefined()
    })

    it('should report repairable when field contains placeholder text', () => {
      const draft = buildValidDraft()
      draft.imageAltText = 'TBD live music event at The Anchor pub in Stanwell Moor on a Friday evening with a great audience and entertainment'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'contains_placeholder' && i.field === 'imageAltText')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('repairable')
    })
  })

  // --- Tone checks ---
  describe('tone', () => {
    it('should report warning when more than 2 exclamation marks total', () => {
      const draft = buildValidDraft()
      draft.metaTitle = 'Live Music! Jessica Lovelock! Amazing!'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'excessive_exclamation')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })

    it('should report warning for generic filler phrases', () => {
      const draft = buildValidDraft()
      draft.metaDescription = 'An unforgettable evening of live music with Jessica Lovelock at The Anchor in Stanwell Moor with something for everyone.'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const issue = result.issues.find(i => i.code === 'generic_filler')
      expect(issue).toBeDefined()
      expect(issue!.severity).toBe('warning')
    })

    it('should still pass when only warnings are present', () => {
      const draft = buildValidDraft()
      draft.metaTitle = 'Live Music! Jessica! Wow! At The Anchor'
      const result = validateGeneratedContent(draft, buildValidOptions())
      const warnings = result.issues.filter(i => i.severity === 'warning')
      expect(warnings.length).toBeGreaterThan(0)
      // passed is true as long as no fatal/repairable
      const blockers = result.issues.filter(i => i.severity === 'fatal' || i.severity === 'repairable')
      if (blockers.length === 0) {
        expect(result.passed).toBe(true)
      }
    })
  })

  // --- Multiple failures ---
  describe('multiple failures', () => {
    it('should report all issues when multiple checks fail', () => {
      const draft = buildValidDraft()
      draft.metaTitle = ''
      draft.slug = ''
      draft.highlights = []
      const result = validateGeneratedContent(draft, buildValidOptions())
      expect(result.issues.length).toBeGreaterThan(2)
      expect(result.passed).toBe(false)
    })
  })

  // --- Missing facts ---
  describe('missing facts', () => {
    it('should skip keyword-dependent checks when no facts provided', () => {
      const draft = buildValidDraft()
      const result = validateGeneratedContent(draft, { mode: 'final' })
      const keywordCodes = [
        'meta_title_keyword', 'meta_desc_keyword',
        'first_para_keyword', 'first_para_name',
        'first_para_date', 'local_content',
        'slug_date', 'slug_keyword', 'alt_text_keyword',
        'keywords_primary',
      ]
      const keywordIssues = result.issues.filter(i => keywordCodes.includes(i.code))
      expect(keywordIssues).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Deterministic repair helpers
// ---------------------------------------------------------------------------

describe('trimAndNormalizeWhitespace', () => {
  it('should collapse multiple spaces to single space', () => {
    expect(trimAndNormalizeWhitespace('hello    world')).toBe('hello world')
  })

  it('should preserve intentional paragraph breaks (double newlines)', () => {
    const input = 'paragraph one\n\nparagraph two'
    expect(trimAndNormalizeWhitespace(input)).toBe('paragraph one\n\nparagraph two')
  })

  it('should collapse 3+ newlines to exactly two', () => {
    const input = 'paragraph one\n\n\n\nparagraph two'
    expect(trimAndNormalizeWhitespace(input)).toBe('paragraph one\n\nparagraph two')
  })

  it('should trim leading and trailing whitespace', () => {
    expect(trimAndNormalizeWhitespace('  hello world  ')).toBe('hello world')
  })

  it('should handle tabs and mixed whitespace', () => {
    expect(trimAndNormalizeWhitespace('hello\t\t  world')).toBe('hello world')
  })

  it('should handle empty string', () => {
    expect(trimAndNormalizeWhitespace('')).toBe('')
  })
})

describe('removeMarkdownMarkers', () => {
  it('should strip bold markers', () => {
    expect(removeMarkdownMarkers('this is **bold** text')).toBe('this is bold text')
  })

  it('should strip inline code markers', () => {
    expect(removeMarkdownMarkers('use `code` here')).toBe('use code here')
  })

  it('should strip heading markers at line start', () => {
    expect(removeMarkdownMarkers('## Heading Text')).toBe('Heading Text')
    expect(removeMarkdownMarkers('# Title')).toBe('Title')
  })

  it('should strip list markers at line start', () => {
    expect(removeMarkdownMarkers('- list item')).toBe('list item')
  })

  it('should strip markdown links', () => {
    expect(removeMarkdownMarkers('visit [The Anchor](https://example.com) today')).toBe('visit The Anchor today')
  })

  it('should NOT strip hyphens in the middle of words', () => {
    expect(removeMarkdownMarkers('well-known pub')).toBe('well-known pub')
  })

  it('should handle multiple markers in one string', () => {
    const input = '## **Bold heading**\n- A `list` item\n- [Link](http://x.com)'
    const result = removeMarkdownMarkers(input)
    expect(result).not.toContain('**')
    expect(result).not.toContain('`')
    expect(result).not.toContain('##')
    expect(result).toContain('Bold heading')
    expect(result).toContain('Link')
  })
})

describe('normalizeSlug', () => {
  it('should build slug with keyword, name, and date', () => {
    const result = normalizeSlug('Jessica Lovelock', '2026-05-23', 'live music')
    expect(result).toBe('live-music-jessica-lovelock-2026-05-23')
  })

  it('should omit date when null', () => {
    const result = normalizeSlug('Jessica Lovelock', null, 'live music')
    expect(result).toBe('live-music-jessica-lovelock')
  })

  it('should not duplicate keyword when already in name', () => {
    const result = normalizeSlug('Live Music Night', '2026-05-23', 'live music')
    expect(result).toBe('live-music-night-2026-05-23')
  })

  it('should handle special characters in name', () => {
    // "jazz" is already in the name "O'Brien's Jazz Night!" so it should not be duplicated
    const result = normalizeSlug("O'Brien's Jazz Night!", '2026-06-01', 'jazz')
    expect(result).toBe('o-brien-s-jazz-night-2026-06-01')
  })

  it('should handle null keyword', () => {
    const result = normalizeSlug('Quiz Night', '2026-05-23', null)
    expect(result).toBe('quiz-night-2026-05-23')
  })

  it('should collapse consecutive hyphens', () => {
    const result = normalizeSlug('Test -- Event', '2026-01-01', null)
    expect(result).toBe('test-event-2026-01-01')
  })

  it('should strip leading and trailing hyphens', () => {
    const result = normalizeSlug(' Test Event ', null, null)
    expect(result).not.toMatch(/^-/)
    expect(result).not.toMatch(/-$/)
  })
})

describe('removeRawUrls', () => {
  it('should remove http URLs', () => {
    expect(removeRawUrls('visit http://example.com today')).toBe('visit today')
  })

  it('should remove https URLs', () => {
    expect(removeRawUrls('visit https://example.com/page today')).toBe('visit today')
  })

  it('should collapse double spaces after removal', () => {
    expect(removeRawUrls('before https://example.com after')).toBe('before after')
  })

  it('should handle multiple URLs', () => {
    expect(removeRawUrls('see https://a.com and https://b.com here')).toBe('see and here')
  })

  it('should handle text with no URLs', () => {
    expect(removeRawUrls('no urls here')).toBe('no urls here')
  })

  it('should handle empty string', () => {
    expect(removeRawUrls('')).toBe('')
  })
})

describe('capAndDeduplicate', () => {
  it('should lowercase all items', () => {
    expect(capAndDeduplicate(['Hello', 'WORLD'], 5)).toEqual(['hello', 'world'])
  })

  it('should remove case-insensitive duplicates', () => {
    expect(capAndDeduplicate(['Hello', 'hello', 'HELLO'], 5)).toEqual(['hello'])
  })

  it('should cap at max items', () => {
    expect(capAndDeduplicate(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b', 'c'])
  })

  it('should deduplicate before capping', () => {
    expect(capAndDeduplicate(['a', 'A', 'b', 'B', 'c'], 3)).toEqual(['a', 'b', 'c'])
  })

  it('should handle empty array', () => {
    expect(capAndDeduplicate([], 5)).toEqual([])
  })
})

describe('applyDeterministicRepair', () => {
  it('should not mutate the input', () => {
    const input = { metaTitle: '  Hello  **World**  ' }
    const original = { ...input }
    applyDeterministicRepair(input)
    expect(input.metaTitle).toBe(original.metaTitle)
  })

  it('should trim and normalize whitespace on string fields', () => {
    const input = { metaTitle: '  hello    world  ' }
    const result = applyDeterministicRepair(input)
    expect(result.metaTitle).toBe('hello world')
  })

  it('should remove markdown from prose fields', () => {
    const input = {
      shortDescription: 'This is **bold** text',
      longDescription: '## Heading\n\nSome `code` here',
      metaTitle: '**Title**',
      metaDescription: 'Visit [here](http://x.com)',
      imageAltText: '- list item',
    }
    const result = applyDeterministicRepair(input)
    expect(result.shortDescription).toBe('This is bold text')
    expect((result.longDescription as string)).toContain('Heading')
    expect((result.longDescription as string)).not.toContain('##')
    expect(result.metaTitle).toBe('Title')
    expect((result.metaDescription as string)).not.toContain('[')
    expect((result.imageAltText as string)).toBe('list item')
  })

  it('should remove raw URLs from prose fields', () => {
    const input = {
      shortDescription: 'Visit https://example.com for details',
    }
    const result = applyDeterministicRepair(input)
    expect((result.shortDescription as string)).not.toContain('https://')
  })

  it('should normalize slug when facts provided', () => {
    const input = {
      slug: 'bad-SLUG!!!',
    }
    const facts = buildValidFacts()
    const result = applyDeterministicRepair(input, facts)
    expect(result.slug).toBe('live-music-jessica-lovelock-2026-05-23')
  })

  it('should cap and deduplicate highlights', () => {
    const input = {
      highlights: ['A', 'a', 'B', 'b', 'C', 'D', 'E', 'F'],
    }
    const result = applyDeterministicRepair(input)
    expect((result.highlights as string[]).length).toBeLessThanOrEqual(5)
    expect(new Set(result.highlights as string[]).size).toBe((result.highlights as string[]).length)
  })

  it('should cap and deduplicate keywords', () => {
    const input = {
      keywords: Array(15).fill(0).map((_, i) => `keyword${i % 8}`),
    }
    const result = applyDeterministicRepair(input)
    expect((result.keywords as string[]).length).toBeLessThanOrEqual(10)
  })

  it('should replace placeholder text with empty string', () => {
    const input = {
      metaTitle: 'TBD event title',
      shortDescription: 'This is undefined content placeholder for now',
    }
    const result = applyDeterministicRepair(input)
    expect((result.metaTitle as string)).not.toContain('TBD')
    expect((result.shortDescription as string)).not.toContain('undefined')
    expect((result.shortDescription as string)).not.toContain('placeholder')
  })

  it('should handle a full pipeline: markdown + URLs + bad slug -> cleaned output', () => {
    const input = {
      metaTitle: '**Live Music** Night',
      metaDescription: 'Visit https://example.com for **live music** details at The Anchor',
      shortDescription: '## Event\n- Free entry\n- **Great music** at [The Anchor](https://example.com)',
      longDescription: 'Paragraph one with `code` and a [link](https://x.com).\n\nParagraph two.',
      imageAltText: 'Image of **live music** night',
      slug: 'BAD_SLUG!!',
      highlights: ['A', 'a', 'B', 'C', 'D', 'E'],
      keywords: ['x', 'X', 'y', 'Y', 'z'],
    }
    const facts = buildValidFacts()
    const result = applyDeterministicRepair(input, facts)

    expect((result.metaTitle as string)).not.toContain('**')
    expect((result.metaDescription as string)).not.toContain('https://')
    expect((result.metaDescription as string)).not.toContain('**')
    expect((result.shortDescription as string)).not.toContain('##')
    expect((result.shortDescription as string)).not.toContain('[')
    expect((result.longDescription as string)).not.toContain('`')
    expect(result.slug).toBe('live-music-jessica-lovelock-2026-05-23')
    expect((result.highlights as string[]).length).toBeLessThanOrEqual(5)
    expect((result.keywords as string[]).length).toBe(3) // x, y, z after dedup
  })

  it('should remove markdown from FAQ answers', () => {
    const input = {
      faqs: [
        { question: 'Test question?', answer: 'This is **bold** in the answer with `code`.' },
      ],
    }
    const result = applyDeterministicRepair(input)
    const faqs = result.faqs as { question: string; answer: string }[]
    expect(faqs[0].answer).not.toContain('**')
    expect(faqs[0].answer).not.toContain('`')
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle empty string fields without crashing in full validation', () => {
    const draft = {
      metaTitle: '',
      metaDescription: '',
      shortDescription: '',
      longDescription: '',
      slug: '',
      imageAltText: '',
      highlights: [],
      faqs: [],
      keywords: [],
    }
    const result = validateGeneratedContent(draft, buildValidOptions())
    expect(result.passed).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('should handle null/undefined fields gracefully', () => {
    const draft = {
      metaTitle: null,
      metaDescription: undefined,
    }
    const result = validateGeneratedContent(draft as Record<string, unknown>, buildValidOptions())
    expect(result.passed).toBe(false)
  })

  it('should handle FAQ with empty question or answer', () => {
    const draft = buildValidDraft()
    draft.faqs = [
      { question: '', answer: '' },
      { question: 'Valid question for the live music event at The Anchor pub', answer: '' },
      { question: '', answer: 'A valid answer that is long enough to pass the word count check for FAQ validation.' },
    ]
    const result = validateGeneratedContent(draft, buildValidOptions())
    // Should not throw
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('should handle highlights with very short items', () => {
    const draft = buildValidDraft()
    draft.highlights = ['Hi', 'OK', 'Yep']
    const result = validateGeneratedContent(draft, buildValidOptions())
    const issue = result.issues.find(i => i.code === 'highlights_specific')
    expect(issue).toBeDefined()
  })

  it('should handle empty string in trimAndNormalizeWhitespace', () => {
    expect(trimAndNormalizeWhitespace('')).toBe('')
  })

  it('should handle empty string in removeMarkdownMarkers', () => {
    expect(removeMarkdownMarkers('')).toBe('')
  })

  it('should handle empty string in removeRawUrls', () => {
    expect(removeRawUrls('')).toBe('')
  })

  it('should handle empty array in capAndDeduplicate', () => {
    expect(capAndDeduplicate([], 10)).toEqual([])
  })

  it('should handle empty draft in applyDeterministicRepair', () => {
    const result = applyDeterministicRepair({})
    expect(result).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Type export verification (compile-time check)
// ---------------------------------------------------------------------------

describe('type exports', () => {
  it('should export SeoIssueSeverity type', () => {
    const severity: SeoIssueSeverity = 'fatal'
    expect(severity).toBe('fatal')
  })

  it('should export SeoValidationIssue type', () => {
    const issue: SeoValidationIssue = {
      code: 'test',
      severity: 'warning',
      message: 'test message',
    }
    expect(issue.code).toBe('test')
  })

  it('should export SeoValidationOptions type', () => {
    const options: SeoValidationOptions = { mode: 'draft' }
    expect(options.mode).toBe('draft')
  })

  it('should export SeoValidationResult type', () => {
    const result: SeoValidationResult = { passed: true, issues: [] }
    expect(result.passed).toBe(true)
  })
})
