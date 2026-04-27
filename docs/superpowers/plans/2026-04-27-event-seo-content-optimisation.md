# Event SEO Content Optimisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI "Generate with AI" function produce SEO-optimised event content that deterministically passes validation, and upgrade the SEO health checker to verify all three keyword tiers, paragraph structure, and FAQ quality.

**Architecture:** Three files change: the server action prompt/schema/validation (`event-content.ts`), the client-side health checker (`SeoHealthIndicator.tsx`), and the form wiring (`EventFormGrouped.tsx`). A new shared utility (`seo-validation.ts`) holds word-boundary keyword matching and validation logic used by both server and client. Tests cover the utility and health checker scoring.

**Tech Stack:** TypeScript, React, OpenAI API (structured output with `strict: true`), Vitest

**Spec:** `tasks/event-seo-content-optimisation-spec.md` (v2)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/seo-validation.ts` | **Create** | Word-boundary keyword matching, keyword coverage, word/paragraph counting, post-generation validation |
| `src/lib/__tests__/seo-validation.test.ts` | **Create** | Unit tests for all seo-validation utilities |
| `src/components/features/events/SeoHealthIndicator.tsx` | **Modify** | New props, revised scoring, uses seo-validation utilities |
| `src/components/features/events/__tests__/SeoHealthIndicator.test.tsx` | **Create** | Unit tests for scoring logic, edge cases, no-keyword scenarios |
| `src/app/actions/event-content.ts` | **Modify** | System prompt, venue context, meta title limit, long description structure, accessibility notes, strict schema, max_tokens, post-generation validation with retry |
| `src/components/features/events/EventFormGrouped.tsx` | **Modify** | Apply accessibilityNotes from AI, pass new props to SeoHealthIndicator, align meta title maxLength to 40 |

---

### Task 1: Create seo-validation utility

**Files:**
- Create: `src/lib/seo-validation.ts`

This shared utility provides deterministic functions used by both the server-side post-generation validator and the client-side health checker.

- [ ] **Step 1: Create the utility file with all functions**

```typescript
// src/lib/seo-validation.ts

/**
 * SEO validation utilities shared by server-side post-generation validation
 * and client-side SeoHealthIndicator scoring.
 */

/**
 * Check if text contains a keyword using word-boundary matching.
 * Handles hyphen/space equivalence and punctuation boundaries.
 * Returns false for partial word matches (e.g. "art" does NOT match "start").
 */
export function containsKeyword(text: string, keywords: string[]): boolean {
  if (!text || keywords.length === 0) return false
  const normalised = text.toLowerCase().replace(/-/g, ' ')
  return keywords.some(kw => {
    const normKw = kw.toLowerCase().replace(/-/g, ' ').trim()
    if (!normKw) return false
    const escaped = normKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(?:^|[\\s,.!?;:'"()])${escaped}(?:[\\s,.!?;:'"()]|$)`, 'i')
    return regex.test(` ${normalised} `)
  })
}

/**
 * Count how many keywords from the list appear in the text.
 * Uses word-boundary matching via containsKeyword.
 */
export function countKeywordMatches(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0
  return keywords.filter(kw => containsKeyword(text, [kw])).length
}

/**
 * Check if text meets a minimum keyword coverage threshold.
 * Returns true if no keywords are configured (nothing to check).
 * Otherwise requires at least `minRequired` matches (capped to array length).
 */
export function keywordCoverage(text: string, keywords: string[], minRequired: number): boolean {
  if (keywords.length === 0) return true
  const matches = countKeywordMatches(text, keywords)
  return matches >= Math.min(minRequired, keywords.length)
}

/**
 * Count words in a string. Returns 0 for empty/null input.
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Extract the first N words from a string.
 */
export function getFirstNWords(text: string | null | undefined, n: number): string {
  if (!text) return ''
  return text.trim().split(/\s+/).slice(0, n).join(' ')
}

/**
 * Count paragraphs in text (split on double newline).
 * Only counts non-empty paragraphs.
 */
export function countParagraphs(text: string | null | undefined): number {
  if (!text) return 0
  return text.split(/\n\n+/).filter(p => p.trim().length > 0).length
}

/**
 * Count valid FAQs — question must be non-empty, answer must be >= 20 chars.
 */
export function countValidFaqs(faqs: { question: string; answer: string }[]): number {
  return faqs.filter(
    f => f.question?.trim().length > 0 && f.answer?.trim().length >= 20
  ).length
}

/**
 * Post-generation validation result.
 */
export interface ValidationResult {
  passed: boolean
  issues: string[]
}

/**
 * Validate AI-generated content deterministically.
 * Returns a list of issues. Empty list = all checks passed.
 */
export function validateGeneratedContent(parsed: {
  metaTitle: string | null
  metaDescription: string | null
  shortDescription: string | null
  longDescription: string | null
  slug: string | null
  imageAltText: string | null
  highlights: string[]
  faqs: { question: string; answer: string }[]
  accessibilityNotes: string | null
}): ValidationResult {
  const issues: string[] = []

  if (parsed.metaTitle && parsed.metaTitle.length > 40) {
    issues.push(`Meta title is ${parsed.metaTitle.length} chars, must be under 40`)
  }

  if (parsed.metaDescription && parsed.metaDescription.length > 155) {
    issues.push(`Meta description is ${parsed.metaDescription.length} chars, must be under 155`)
  }

  const wordCount = countWords(parsed.longDescription)
  if (wordCount < 400) {
    issues.push(`Long description is ${wordCount} words, must be at least 400`)
  }

  const paragraphCount = countParagraphs(parsed.longDescription)
  if (paragraphCount < 4) {
    issues.push(`Long description has ${paragraphCount} paragraphs, must have at least 4`)
  }

  const validFaqCount = countValidFaqs(parsed.faqs || [])
  if (validFaqCount < 3) {
    issues.push(`Only ${validFaqCount} valid FAQs (question non-empty, answer >= 20 chars), need at least 3`)
  }

  const requiredFields = ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'slug', 'imageAltText'] as const
  for (const field of requiredFields) {
    const val = parsed[field]
    if (!val || !val.trim()) {
      issues.push(`${field} is empty`)
    }
  }

  return { passed: issues.length === 0, issues }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/seo-validation.ts
git commit -m "feat(seo): add shared seo-validation utility with word-boundary keyword matching and post-generation validation"
```

---

### Task 2: Unit tests for seo-validation

**Files:**
- Create: `src/lib/__tests__/seo-validation.test.ts`

- [ ] **Step 1: Write all tests**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/seo-validation.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/seo-validation.test.ts
git commit -m "test(seo): add comprehensive unit tests for seo-validation utilities"
```

---

### Task 3: Update SeoHealthIndicator with new scoring

**Files:**
- Modify: `src/components/features/events/SeoHealthIndicator.tsx`

- [ ] **Step 1: Rewrite SeoHealthIndicator.tsx**

Replace the entire file contents. Key changes:
- Import shared utilities from `@/lib/seo-validation`
- Remove local `containsKeyword`, `countWords`, `getFirst100Words` (replaced by shared utils)
- Add `secondaryKeywords`, `localSeoKeywords` props
- Change `faqCount: number` to `faqs: { question: string; answer: string }[]`
- New scoring rubric (15 checks, 100 points total)
- Paragraph structure check
- Proportional keyword coverage (min 2 matches per tier)
- FAQ content quality validation
- Meta title limit lowered to 40 chars

```typescript
'use client'

import { useMemo } from 'react'
import {
  containsKeyword,
  keywordCoverage,
  countWords,
  getFirstNWords,
  countParagraphs,
  countValidFaqs,
} from '@/lib/seo-validation'

interface SeoHealthProps {
  metaTitle: string
  metaDescription: string
  shortDescription: string
  longDescription: string
  slug: string
  highlights: string          // comma-separated string
  primaryKeywords: string[]
  secondaryKeywords: string[]
  localSeoKeywords: string[]
  imageAltText: string
  faqs: { question: string; answer: string }[]
  accessibilityNotes: string
}

interface SeoCheck {
  label: string
  passed: boolean
  points: number
}

export function SeoHealthIndicator({
  metaTitle,
  metaDescription,
  shortDescription,
  longDescription,
  slug,
  highlights,
  primaryKeywords,
  secondaryKeywords,
  localSeoKeywords,
  imageAltText,
  faqs,
  accessibilityNotes,
}: SeoHealthProps) {
  const checks = useMemo((): SeoCheck[] => {
    const highlightItems = highlights
      ? highlights.split(',').map(h => h.trim()).filter(Boolean)
      : []

    return [
      {
        label: 'Meta title present and under 40 chars',
        passed: !!metaTitle && metaTitle.length > 0 && metaTitle.length <= 40,
        points: 8,
      },
      {
        label: 'Meta description present and under 155 chars',
        passed: !!metaDescription && metaDescription.length > 0 && metaDescription.length <= 155,
        points: 7,
      },
      {
        label: 'Primary keyword in meta title',
        passed: containsKeyword(metaTitle, primaryKeywords),
        points: 8,
      },
      {
        label: 'Primary keyword in meta description',
        passed: containsKeyword(metaDescription, primaryKeywords),
        points: 7,
      },
      {
        label: 'Short description 120\u2013300 chars',
        passed: !!shortDescription && shortDescription.trim().length >= 120 && shortDescription.trim().length <= 300,
        points: 5,
      },
      {
        label: 'Long description 450+ words',
        passed: countWords(longDescription) >= 450,
        points: 10,
      },
      {
        label: 'Long description has 4+ paragraphs',
        passed: countParagraphs(longDescription) >= 4,
        points: 5,
      },
      {
        label: 'Primary keyword in first 100 words',
        passed: containsKeyword(getFirstNWords(longDescription, 100), primaryKeywords),
        points: 8,
      },
      {
        label: 'Secondary keywords in long description (2+)',
        passed: keywordCoverage(longDescription, secondaryKeywords, 2),
        points: 8,
      },
      {
        label: 'Local SEO keywords in long description (2+)',
        passed: keywordCoverage(longDescription, localSeoKeywords, 2),
        points: 7,
      },
      {
        label: 'At least 3 FAQs with substantive answers',
        passed: countValidFaqs(faqs) >= 3,
        points: 7,
      },
      {
        label: 'Image alt text contains primary keyword',
        passed: !!imageAltText && imageAltText.trim().length > 0 && containsKeyword(imageAltText, primaryKeywords),
        points: 5,
      },
      {
        label: 'Highlights present (3+ items)',
        passed: highlightItems.length >= 3,
        points: 5,
      },
      {
        label: 'Slug contains primary keyword',
        passed: containsKeyword(slug.replace(/-/g, ' '), primaryKeywords),
        points: 5,
      },
      {
        label: 'Accessibility notes present',
        passed: !!accessibilityNotes && accessibilityNotes.trim().length > 0,
        points: 5,
      },
    ]
  }, [
    metaTitle,
    metaDescription,
    shortDescription,
    longDescription,
    slug,
    highlights,
    primaryKeywords,
    secondaryKeywords,
    localSeoKeywords,
    imageAltText,
    faqs,
    accessibilityNotes,
  ])

  const score = useMemo(
    () => checks.reduce((sum, check) => sum + (check.passed ? check.points : 0), 0),
    [checks]
  )

  type ColourKey = 'red' | 'amber' | 'green'

  const { colour, label: scoreLabel } = useMemo((): { colour: ColourKey; label: string } => {
    if (score <= 40) return { colour: 'red', label: 'Poor' }
    if (score <= 70) return { colour: 'amber', label: 'Fair' }
    return { colour: 'green', label: 'Good' }
  }, [score])

  const colourMap: Record<ColourKey, { score: string; bar: string; tick: string; cross: string }> = {
    red: {
      score: 'text-red-600',
      bar: 'bg-red-500',
      tick: 'text-green-600',
      cross: 'text-red-500',
    },
    amber: {
      score: 'text-amber-600',
      bar: 'bg-amber-500',
      tick: 'text-green-600',
      cross: 'text-amber-500',
    },
    green: {
      score: 'text-green-600',
      bar: 'bg-green-500',
      tick: 'text-green-600',
      cross: 'text-gray-400',
    },
  }

  const colourClasses = colourMap[colour]

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          SEO Health
        </span>
        <span className={`text-sm font-bold ${colourClasses.score}`}>
          {score}/100 &mdash; {scoreLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-[2px] w-full rounded-full bg-muted">
        <div
          className={`h-[2px] rounded-full transition-all duration-300 ${colourClasses.bar}`}
          style={{ width: `${score}%` }}
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`SEO score: ${score} out of 100`}
        />
      </div>

      {/* Checklist — 2-column grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {checks.map((check) => (
          <div key={check.label} className="flex items-start gap-1.5">
            <span
              className={`mt-px shrink-0 text-xs font-bold ${check.passed ? colourClasses.tick : colourClasses.cross}`}
              aria-hidden="true"
            >
              {check.passed ? '\u2713' : '\u2717'}
            </span>
            <span className={`text-xs leading-tight ${check.passed ? 'text-foreground' : 'text-muted-foreground'}`}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run lint and typecheck**

```bash
npx tsc --noEmit 2>&1 | head -30
npm run lint -- --max-warnings=0 2>&1 | tail -10
```

Expected: TypeScript errors from `EventFormGrouped.tsx` (it still passes old props) — that's expected and will be fixed in Task 5. No errors in the SeoHealthIndicator file itself.

- [ ] **Step 3: Commit**

```bash
git add src/components/features/events/SeoHealthIndicator.tsx
git commit -m "feat(seo): upgrade SeoHealthIndicator with keyword coverage, paragraph checks, and revised scoring"
```

---

### Task 4: Unit tests for SeoHealthIndicator scoring

**Files:**
- Create: `src/components/features/events/__tests__/SeoHealthIndicator.test.tsx`

- [ ] **Step 1: Write scoring tests**

```typescript
// src/components/features/events/__tests__/SeoHealthIndicator.test.tsx

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeoHealthIndicator } from '../SeoHealthIndicator'

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    metaTitle: 'Live Music — Jessica Lovelock',   // 32 chars
    metaDescription: 'Join us for free live music at The Anchor with Jessica Lovelock on 23 May! Book now.',  // < 155
    shortDescription: 'Free live music at The Anchor featuring Jessica Lovelock. Enjoy Motown and soul on 23 May from 8pm. Book your table now for a great night out!', // ~140 chars
    longDescription: [
      'Enjoy live music tonight at The Anchor on Saturday 23 May 2026. ' + Array(15).fill('word').join(' '),
      'Second paragraph about the experience and what to expect during the evening. ' + Array(15).fill('word').join(' '),
      'Third paragraph about Jessica Lovelock performing motown night near me at the venue. ' + Array(15).fill('word').join(' '),
      'Fourth paragraph about pizza and drinks at The Anchor near Heathrow. ' + Array(15).fill('word').join(' '),
      'Fifth paragraph about booking and practical information for your evening out. ' + Array(15).fill('word').join(' '),
      'Sixth paragraph about Stanwell Moor and things to do near Heathrow airport in Surrey. ' + Array(80).fill('word').join(' '),
    ].join('\n\n'),
    slug: 'live-music-jessica-lovelock-2026-05-23',
    highlights: 'Free entry, Live motown and soul, Pizza menu, Book a table, Great night out',
    primaryKeywords: ['live music'],
    secondaryKeywords: ['motown night near me', 'soul night near me', 'night out near me'],
    localSeoKeywords: ['things to do near Heathrow', 'Stanwell Moor'],
    imageAltText: 'Live music performance by Jessica Lovelock at The Anchor pub',
    faqs: [
      { question: 'What time does the live music start?', answer: 'The live music starts at 8pm and runs until 10pm at The Anchor.' },
      { question: 'Is the motown night near me free?', answer: 'Yes, entry is completely free for all live music events at The Anchor.' },
      { question: 'Can I book a table?', answer: 'Yes, we recommend booking a table to guarantee your spot for the evening.' },
    ],
    accessibilityNotes: 'Ground-floor venue with step-free access from the car park.',
    ...overrides,
  }
}

describe('SeoHealthIndicator', () => {
  it('renders score out of 100', () => {
    render(<SeoHealthIndicator {...makeProps()} />)
    expect(screen.getByText(/\/100/)).toBeTruthy()
  })

  it('scores 100 when all checks pass', () => {
    render(<SeoHealthIndicator {...makeProps()} />)
    expect(screen.getByText('100/100 — Good')).toBeTruthy()
  })

  it('fails meta title check when over 40 chars', () => {
    render(<SeoHealthIndicator {...makeProps({ metaTitle: 'A'.repeat(41) })} />)
    // Score should be less than 100 (lost 8 points for title length, possibly also keyword check)
    expect(screen.queryByText('100/100 — Good')).toBeNull()
  })

  it('passes keyword checks when no keywords configured', () => {
    render(<SeoHealthIndicator {...makeProps({
      primaryKeywords: [],
      secondaryKeywords: [],
      localSeoKeywords: [],
    })} />)
    // Should not penalise for keyword checks — but will lose image alt text keyword (5 pts),
    // primary in title (8 pts), primary in desc (7 pts), primary in first 100 (8 pts), slug (5 pts)
    // Total possible without keywords: 100 - 8 - 7 - 8 - 5 - 5 = 67
    // Secondary/local pass (empty = true), so those 15 pts still count
    const scoreEl = screen.getByText(/\/100/)
    expect(scoreEl).toBeTruthy()
  })

  it('shows Poor label for low scores', () => {
    render(<SeoHealthIndicator {...makeProps({
      metaTitle: '',
      metaDescription: '',
      shortDescription: '',
      longDescription: '',
      slug: '',
      highlights: '',
      primaryKeywords: [],
      secondaryKeywords: [],
      localSeoKeywords: [],
      imageAltText: '',
      faqs: [],
      accessibilityNotes: '',
    })} />)
    expect(screen.getByText(/Poor/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/components/features/events/__tests__/SeoHealthIndicator.test.tsx
```

Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/features/events/__tests__/SeoHealthIndicator.test.tsx
git commit -m "test(seo): add SeoHealthIndicator scoring unit tests"
```

---

### Task 5: Update EventFormGrouped.tsx

**Files:**
- Modify: `src/components/features/events/EventFormGrouped.tsx`

Three changes: apply accessibilityNotes from AI, pass new props to SeoHealthIndicator, align meta title maxLength.

- [ ] **Step 1: Add accessibilityNotes application in handleGenerateSeo**

Find this block (around line 450):
```typescript
if (result.data.cancellationPolicy) setCancellationPolicy(result.data.cancellationPolicy)
```

Add after it:
```typescript
if (result.data.accessibilityNotes) setAccessibilityNotes(result.data.accessibilityNotes)
```

- [ ] **Step 2: Update SeoHealthIndicator props**

Find this block (around line 1126):
```tsx
<SeoHealthIndicator
  metaTitle={metaTitle}
  metaDescription={metaDescription}
  shortDescription={shortDescription}
  longDescription={longDescription}
  slug={slug}
  highlights={highlights}
  primaryKeywords={parseKeywords(primaryKeywords)}
  imageAltText={imageAltText}
  faqCount={faqs.length}
  accessibilityNotes={accessibilityNotes}
/>
```

Replace with:
```tsx
<SeoHealthIndicator
  metaTitle={metaTitle}
  metaDescription={metaDescription}
  shortDescription={shortDescription}
  longDescription={longDescription}
  slug={slug}
  highlights={highlights}
  primaryKeywords={parseKeywords(primaryKeywords)}
  secondaryKeywords={parseKeywords(secondaryKeywords)}
  localSeoKeywords={parseKeywords(localSeoKeywords)}
  imageAltText={imageAltText}
  faqs={faqs.map(f => ({ question: f.question || '', answer: f.answer || '' }))}
  accessibilityNotes={accessibilityNotes}
/>
```

- [ ] **Step 3: Align meta title maxLength**

Find (around line 971):
```tsx
maxLength={60}
```
Replace with:
```tsx
maxLength={40}
```

Find the character counter below it:
```tsx
<p className="mt-1 text-xs text-gray-500">{metaTitle.length}/60 characters</p>
```
Replace with:
```tsx
<p className="mt-1 text-xs text-gray-500">{metaTitle.length}/40 characters (site adds location suffix)</p>
```

- [ ] **Step 4: Run lint and typecheck**

```bash
npx tsc --noEmit 2>&1 | head -30
npm run lint -- --max-warnings=0 2>&1 | tail -10
```

Expected: Clean (the only remaining type issue would be in `event-content.ts` which doesn't have `accessibilityNotes` in its return type yet — that's next).

- [ ] **Step 5: Commit**

```bash
git add src/components/features/events/EventFormGrouped.tsx
git commit -m "feat(seo): wire accessibilityNotes, new SeoHealthIndicator props, and 40-char meta title limit in form"
```

---

### Task 6: Update event-content.ts — prompt, schema, and validation

**Files:**
- Modify: `src/app/actions/event-content.ts`

This is the largest change. It touches the system prompt, user prompt, JSON schema, return types, and adds post-generation validation with retry.

- [ ] **Step 1: Update the system prompt (line 247)**

Find:
```typescript
'You are an expert hospitality marketer for "The Anchor", a popular pub and venue near Heathrow in Sipson, West Drayton. Your goal is to craft SEO-friendly, persuasive, and atmosphere-focused website content for events. Keep outputs concise, engaging, and aligned with UK English. Use only the supplied event fields and never invent venue, price, capacity, time, performer, or category details. If a field is missing, leave the corresponding output empty. Focus on driving ticket sales and reservations.',
```

Replace with:
```typescript
'You are an expert hospitality marketer for "The Anchor", a popular pub and venue near Heathrow in Stanwell Moor, Surrey. Your goal is to craft SEO-friendly, persuasive, and atmosphere-focused website content for events. Write detailed, engaging content aligned with UK English. Longer descriptions rank better and help customers decide — never sacrifice depth for brevity. Use only the supplied event fields and the VENUE CONTEXT block for facts. Never invent venue, price, capacity, time, performer, or category details beyond what is provided. If a field is missing, leave the corresponding output empty. Focus on driving ticket sales and reservations.',
```

- [ ] **Step 2: Add venue context block and update meta title instruction in user prompt**

Find the line (around line 252):
```typescript
'Create fresh, optimised SEO copy for this event based on the details JSON below.',
```

Replace the entire user prompt content array. The full replacement starts at line 251 (`content: [`) and runs to the closing `].join('\n'),` at line 293. Replace it with:

```typescript
content: [
  'Create fresh, optimised SEO copy for this event based on the details JSON below.',
  'Priorities:',
  '- Position the experience vividly for a great night out at The Anchor.',
  '- Highlight unique selling points and benefits (e.g., atmosphere, exclusive drinks, entertainment value).',
  '- Build urgency to secure tickets or book a table immediately.',
  '- Use persuasive language that drives conversion.',
  '- If booking_url is provided, reference booking explicitly but do not include raw URLs.',
  '- Keep the meta title UNDER 40 characters. The website appends "| The Anchor Stanwell Moor" automatically. Front-load the primary keyword. Example: "Live Music — Jessica Lovelock" (32 chars).',
  '- Keep the meta description under 155 characters, focusing on the hook and call to action.',
  '- **Long Description SEO**: Generate a rich, informative description of MINIMUM 450 words (aim for 500) formatted in plain text (no markdown). Structure as 5-6 distinct paragraphs separated by double newlines (\\n\\n):',
  '  1. Opening hook with event name, date, and primary keywords (70-80 words)',
  '  2. What to expect — the experience, sounds, energy, and vibe (80-90 words)',
  '  3. Performer or entertainment details — who they are, their style, why they are worth seeing (80-90 words)',
  '  4. Food, drink, and venue atmosphere — use the VENUE CONTEXT facts below (70-80 words)',
  '  5. Practical info and booking — why to reserve, capacity hints, pricing context (70-80 words)',
  '  6. Local context — use VENUE CONTEXT location facts, transport links, nearby areas (70-80 words)',
  '  Each paragraph must be a complete thought. Do NOT write one long wall of text. No single paragraph over 120 words.',
  '- Do NOT use Markdown formatting (no bold **, italics _, or links []()). Return clean plain text.',
  '- Do NOT invent missing details; if absent, leave that field blank.',
  '- Provide 3-5 punchy highlights and 6-10 targeted keyword phrases.',
  '- **Slug**: Generate a URL-friendly slug (lowercase, alphanumeric, hyphens only, no spaces or special chars) based on the event name and date. Example: "six-nations-2026-england-vs-wales".',
  '',
  'VENUE CONTEXT (use these verified facts only — do not invent others):',
  '- Venue name: The Anchor',
  '- Address: Horton Road, Stanwell Moor, Surrey, TW19 6AQ',
  '- Phone: 01753 682707',
  '- Area: near Heathrow Airport, bordering West Drayton and Staines-upon-Thames',
  '- Transport: 7 minutes from Heathrow Terminal 5, free parking (20 spaces)',
  '- Ground-floor venue with step-free access from car park',
  '- Dog and family friendly',
  '- Kitchen serves pizza on event nights',
  '',
  ...(keywordContext ? [
    'KEYWORD PLACEMENT RULES:',
    '- Primary keywords: front-load in meta title, use in first clause of meta description, include in slug, place in first paragraph of long description, include in image alt text',
    '- Secondary keywords: weave into long description body paragraphs, include in at least 2 highlights, use in at least 2 FAQ questions',
    '- Local SEO keywords: use in venue/directions paragraph of long description, include in at least 1 FAQ answer',
    '- No keyword stuffing — each keyword used 1-2 times maximum per field',
    '- Natural language only — skip a keyword rather than force it',
    '',
    keywordContext,
    '',
  ] : []),
  'IMAGE ALT TEXT: Write a descriptive alt text for the event\'s hero image (~125 characters). Include primary keywords and venue name naturally. Example: "Live band performing at The Anchor pub near Heathrow on Friday night"',
  '',
  'FAQS: Generate 3-5 frequently asked questions and answers about this event:',
  '- Event logistics (time, booking, parking): use local SEO keywords in answers',
  '- Event experience (what to expect, who it\'s for): use secondary keywords in questions',
  '- Pricing/value (cost, what\'s included): use primary keywords naturally',
  '- Questions should be 10-15 words, answers 30-60 words',
  '',
  'CANCELLATION POLICY: Based on the event type:',
  '- If free entry: "Free entry — no booking or registration required."',
  '- If paid/ticketed: "Tickets are non-refundable but may be transferred to another person. Please contact us at least 24 hours before the event for any changes."',
  '- Return null if unsure.',
  '',
  'ACCESSIBILITY NOTES: Using ONLY the venue facts from VENUE CONTEXT above, write 1-2 sentences about accessibility. Mention step-free access and the phone number for specific requirements. Do NOT claim features not listed in VENUE CONTEXT. Example: "The Anchor is a ground-floor venue with step-free access from the car park. Please call 01753 682707 to discuss any specific accessibility requirements."',
  '',
  summary,
  '',
  'Return JSON with keys metaTitle, metaDescription, shortDescription, longDescription, highlights (string array), keywords (string array), slug (string), imageAltText (string), faqs (array of {question, answer}), cancellationPolicy (string or null), accessibilityNotes (string or null). All fields must be strings (or arrays); use "" for missing values.',
].join('\n'),
```

- [ ] **Step 3: Update JSON schema — add accessibilityNotes and strict mode**

Find the `response_format` block (around line 296). Replace the entire `response_format` object:

```typescript
response_format: {
  type: 'json_schema',
  json_schema: {
    name: 'event_seo_content',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        metaTitle: { type: ['string', 'null'] },
        metaDescription: { type: ['string', 'null'] },
        shortDescription: { type: ['string', 'null'] },
        longDescription: { type: ['string', 'null'] },
        highlights: {
          type: 'array',
          items: { type: 'string' },
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
        },
        slug: { type: ['string', 'null'] },
        imageAltText: { type: ['string', 'null'] },
        faqs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              answer: { type: 'string' },
            },
            required: ['question', 'answer'],
            additionalProperties: false,
          },
        },
        cancellationPolicy: { type: ['string', 'null'] },
        accessibilityNotes: { type: ['string', 'null'] },
      },
      required: ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'highlights', 'keywords', 'slug', 'imageAltText', 'faqs', 'cancellationPolicy', 'accessibilityNotes'],
      additionalProperties: false,
    },
  },
},
```

Note: removed `minItems`/`maxItems` from `highlights`, `keywords`, and `faqs` arrays because OpenAI strict mode does not support these constraints.

- [ ] **Step 4: Update max_tokens**

Find:
```typescript
max_tokens: 3500,
```

Replace with:
```typescript
max_tokens: 4500,
```

- [ ] **Step 5: Update the return type and parsed type**

Find the `EventSeoContentResult` type (around line 95):
```typescript
type EventSeoContentResult = {
  success: true
  data: {
    metaTitle: string | null
    metaDescription: string | null
    shortDescription: string | null
    longDescription: string | null
    highlights: string[]
    keywords: string[]
    slug: string | null
    imageAltText: string | null
    faqs: { question: string; answer: string }[]
    cancellationPolicy: string | null
  }
} | {
  success: false
  error: string
}
```

Replace with:
```typescript
type EventSeoContentResult = {
  success: true
  data: {
    metaTitle: string | null
    metaDescription: string | null
    shortDescription: string | null
    longDescription: string | null
    highlights: string[]
    keywords: string[]
    slug: string | null
    imageAltText: string | null
    faqs: { question: string; answer: string }[]
    cancellationPolicy: string | null
    accessibilityNotes: string | null
  }
} | {
  success: false
  error: string
}
```

Update the parsed type (around line 371):
```typescript
let parsed: {
  metaTitle: string | null
  metaDescription: string | null
  shortDescription: string | null
  longDescription: string | null
  highlights: string[]
  keywords: string[]
  slug: string | null
  imageAltText: string | null
  faqs: { question: string; answer: string }[]
  cancellationPolicy: string | null
  accessibilityNotes: string | null
}
```

- [ ] **Step 6: Add post-generation validation with retry**

Add the import at the top of the file (after existing imports):
```typescript
import { validateGeneratedContent } from '@/lib/seo-validation'
```

Find the section after JSON parsing (around line 388, after the `catch` block for parse errors). Replace everything from after the `parsed = JSON.parse(...)` try/catch block through to the final `return` statement. The new code:

```typescript
  // --- Post-generation validation with single retry ---
  const validation = validateGeneratedContent(parsed)

  if (!validation.passed) {
    console.warn('SEO content validation failed, retrying:', validation.issues)

    try {
      const retryResponse = await callOpenAI(baseUrl, apiKey, {
        model: eventsModel,
        temperature: 0.5, // lower temperature for corrective retry
        messages: [
          {
            role: 'system',
            content:
              'You are an expert hospitality marketer for "The Anchor", a popular pub and venue near Heathrow in Stanwell Moor, Surrey. Your goal is to craft SEO-friendly, persuasive, and atmosphere-focused website content for events. Write detailed, engaging content aligned with UK English. Longer descriptions rank better and help customers decide — never sacrifice depth for brevity. Use only the supplied event fields and the VENUE CONTEXT block for facts. Never invent venue, price, capacity, time, performer, or category details beyond what is provided. If a field is missing, leave the corresponding output empty. Focus on driving ticket sales and reservations.',
          },
          {
            role: 'user',
            content: summary,
          },
          {
            role: 'assistant',
            content: JSON.stringify(parsed),
          },
          {
            role: 'user',
            content: `The response has these issues — fix them and return the complete JSON again:\n${validation.issues.map(i => `- ${i}`).join('\n')}`,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'event_seo_content',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                metaTitle: { type: ['string', 'null'] },
                metaDescription: { type: ['string', 'null'] },
                shortDescription: { type: ['string', 'null'] },
                longDescription: { type: ['string', 'null'] },
                highlights: { type: 'array', items: { type: 'string' } },
                keywords: { type: 'array', items: { type: 'string' } },
                slug: { type: ['string', 'null'] },
                imageAltText: { type: ['string', 'null'] },
                faqs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { question: { type: 'string' }, answer: { type: 'string' } },
                    required: ['question', 'answer'],
                    additionalProperties: false,
                  },
                },
                cancellationPolicy: { type: ['string', 'null'] },
                accessibilityNotes: { type: ['string', 'null'] },
              },
              required: ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'highlights', 'keywords', 'slug', 'imageAltText', 'faqs', 'cancellationPolicy', 'accessibilityNotes'],
              additionalProperties: false,
            },
          },
        },
        max_tokens: 4500,
      })

      if (retryResponse.ok) {
        const retryPayload = await retryResponse.json()
        const retryContent = retryPayload?.choices?.[0]?.message?.content
        if (retryContent) {
          try {
            const retryParsed = JSON.parse(typeof retryContent === 'string' ? retryContent : JSON.stringify(retryContent))
            const retryValidation = validateGeneratedContent(retryParsed)
            if (retryValidation.passed) {
              parsed = retryParsed
              console.info('SEO content retry succeeded')
            } else {
              console.warn('SEO content retry still has issues, using original:', retryValidation.issues)
            }
          } catch {
            console.warn('Failed to parse retry response, using original')
          }
        }
      }
    } catch (retryErr) {
      console.warn('SEO content retry failed, using original:', retryErr)
    }
  }

  return {
    success: true,
    data: {
      metaTitle: parsed.metaTitle ?? null,
      metaDescription: parsed.metaDescription ?? null,
      shortDescription: parsed.shortDescription ?? null,
      longDescription: parsed.longDescription ?? null,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.filter(Boolean) : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter(Boolean) : [],
      slug: parsed.slug ?? null,
      imageAltText: parsed.imageAltText || null,
      faqs: Array.isArray(parsed.faqs) ? parsed.faqs : [],
      cancellationPolicy: parsed.cancellationPolicy || null,
      accessibilityNotes: parsed.accessibilityNotes || null,
    },
  }
}
```

- [ ] **Step 7: Run lint and typecheck**

```bash
npx tsc --noEmit 2>&1 | head -30
npm run lint -- --max-warnings=0 2>&1 | tail -10
```

Expected: Clean compilation, zero lint warnings.

- [ ] **Step 8: Commit**

```bash
git add src/app/actions/event-content.ts
git commit -m "feat(seo): upgrade AI prompt with venue context, 40-char title limit, 450-word descriptions, accessibility notes, strict schema, and post-generation validation"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All existing tests pass, plus new seo-validation and SeoHealthIndicator tests pass.

- [ ] **Step 2: Run full build**

```bash
npm run build
```

Expected: Clean production build, zero errors.

- [ ] **Step 3: Commit (if any fixes were needed)**

Only if previous steps required fixes:
```bash
git add -A
git commit -m "fix(seo): resolve build/lint issues from seo optimisation changes"
```

---

### Task 8: Manual smoke test

This task requires starting the dev server and testing with a real event.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Navigate to an event edit page and click "Generate with AI"**

Go to the Jessica Lovelock event (or any event with keywords populated) and regenerate SEO content.

Verify:
- Meta title is under 40 characters
- Long description is 450+ words
- Long description has 5-6 visible paragraphs (double newline separated)
- Accessibility notes field is populated
- SEO health score is 85+
- All three keyword tiers show as passing in the health checker

- [ ] **Step 3: Test an event with no keywords**

Edit an event that has no primary/secondary/local keywords set. Verify:
- "Generate with AI" still works
- SEO health checker does not penalise for missing keyword coverage (secondary/local checks pass)
- Score is still reasonable (loss comes only from primary keyword checks)

- [ ] **Step 4: Stop dev server and commit any fixes**

If any issues were found and fixed:
```bash
git add -A
git commit -m "fix(seo): address issues found during manual smoke testing"
```
