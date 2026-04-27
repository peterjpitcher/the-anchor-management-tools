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
} from '@/lib/seo-validation'

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
    // 1 keyword configured, minRequired=2 -> only needs 1
    expect(keywordCoverage('live music tonight', ['live music'], 2)).toBe(true)
  })

  it('fails when not enough keywords match', () => {
    expect(keywordCoverage(
      'live music tonight',
      ['live music', 'quiz night', 'karaoke'],
      2
    )).toBe(false) // only 1 of 3 matches, need 2
  })

  it('passes when enough keywords match', () => {
    expect(keywordCoverage(
      'live music tonight with a quiz night',
      ['live music', 'quiz night', 'karaoke'],
      2
    )).toBe(true) // 2 of 3 match, need 2
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
      { question: 'Is it free?', answer: 'Yes' }, // answer too short
      { question: 'Where is it?', answer: 'The Anchor is on Horton Road in Stanwell Moor.' },
    ])).toBe(2)
  })

  it('returns 0 for empty array', () => {
    expect(countValidFaqs([])).toBe(0)
  })
})

describe('validateGeneratedContent', () => {
  const validContent = {
    metaTitle: 'Live Music — Jessica Lovelock',
    metaDescription: 'Join us for free live music at The Anchor with Jessica Lovelock on 23 May!',
    shortDescription: 'Free live music at The Anchor featuring Jessica Lovelock on 23 May.',
    longDescription: Array(100).fill('word word word word five').join('\n\n'), // 500 words, many paragraphs
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

  it('fails for meta title over 40 chars', () => {
    const result = validateGeneratedContent({
      ...validContent,
      metaTitle: 'A'.repeat(41),
    })
    expect(result.passed).toBe(false)
    expect(result.issues[0]).toContain('Meta title')
  })

  it('fails for meta description over 155 chars', () => {
    const result = validateGeneratedContent({
      ...validContent,
      metaDescription: 'A'.repeat(156),
    })
    expect(result.passed).toBe(false)
    expect(result.issues[0]).toContain('Meta description')
  })

  it('fails for long description under 400 words', () => {
    const result = validateGeneratedContent({
      ...validContent,
      longDescription: 'Short text with only a few words here.',
    })
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('words'))).toBe(true)
  })

  it('fails for fewer than 4 paragraphs', () => {
    const result = validateGeneratedContent({
      ...validContent,
      longDescription: Array(200).fill('word').join(' '), // 200 words, 1 paragraph
    })
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('paragraphs'))).toBe(true)
  })

  it('fails for empty required fields', () => {
    const result = validateGeneratedContent({
      ...validContent,
      slug: '',
    })
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('slug'))).toBe(true)
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
    expect(result.issues.some(i => i.includes('FAQ'))).toBe(true)
  })
})
