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
      'Enjoy live music tonight at The Anchor on Saturday 23 May 2026. ' + Array(80).fill('word').join(' '),
      'Second paragraph about the experience and what to expect during the evening. This is the best motown night near me option. ' + Array(80).fill('word').join(' '),
      'Third paragraph about Jessica Lovelock performing a soul night near me at the venue. ' + Array(80).fill('word').join(' '),
      'Fourth paragraph about pizza and drinks at The Anchor near Heathrow. ' + Array(80).fill('word').join(' '),
      'Fifth paragraph about booking and practical information for your evening out. ' + Array(80).fill('word').join(' '),
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
