// src/components/features/events/__tests__/SeoHealthIndicator.test.tsx

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SeoHealthIndicator } from '../SeoHealthIndicator'
import { eventSeoHealthChecks } from '@/lib/event-seo/health'
import { SLEIGH_FACTS, validDraft } from '../../../../../tests/fixtures/event-seo/valid-draft'

function makeProps(overrides: Record<string, unknown> = {}) {
  const d = validDraft()
  return {
    date: SLEIGH_FACTS.date,
    metaTitle: d.metaTitle as string,
    metaDescription: d.metaDescription as string,
    shortDescription: d.shortDescription as string,
    longDescription: d.longDescription as string,
    slug: d.slug as string,
    highlights: d.highlights as string[],
    primaryKeywords: SLEIGH_FACTS.primaryKeywords,
    secondaryKeywords: SLEIGH_FACTS.secondaryKeywords,
    localSeoKeywords: SLEIGH_FACTS.localSeoKeywords,
    imageAltText: d.imageAltText as string,
    faqs: d.faqs as { question: string; answer: string }[],
    ...overrides,
  }
}

function failedLabels(overrides: Record<string, unknown>): string[] {
  return eventSeoHealthChecks(makeProps(overrides)).filter((c) => !c.passed).map((c) => c.label)
}

describe('SeoHealthIndicator', () => {
  it('scores 100 for copy that passes the generator gate', () => {
    render(<SeoHealthIndicator {...makeProps()} />)
    expect(screen.getByText('100/100 · Good')).toBeTruthy()
  })

  it('has checks worth exactly 100 points', () => {
    expect(eventSeoHealthChecks(makeProps()).reduce((sum, c) => sum + c.points, 0)).toBe(100)
  })

  it('no longer scores accessibility notes, which code always fills', () => {
    expect(eventSeoHealthChecks(makeProps()).some((c) => /accessib/i.test(c.label))).toBe(false)
  })

  it('no longer passes local terms on "the anchor" and "what\'s on" (spec 4.2)', () => {
    const longDescription = 'The Anchor is the pub. What\'s on this week is music bingo.'
    expect(failedLabels({ longDescription, localSeoKeywords: ['the anchor stanwell moor', "what's on staines"] }))
      .toContain('Stanwell Moor and a nearby place named')
  })

  it('fails "reads true after the night" on an invitation', () => {
    expect(failedLabels({ shortDescription: 'Join us for Christmas music bingo at The Anchor, Stanwell Moor, on Friday 11 December 2026 with Nikki hosting.' }))
      .toContain('Reads true after the night')
  })

  it('fails the date check when the weekday is missing from the meta description', () => {
    expect(failedLabels({ metaDescription: 'Christmas music bingo with Nikki on 11 December 2026 at 7pm, at The Anchor, Stanwell Moor. Entry is £5 cash. Book on this page now.' }))
      .toContain('Weekday and date in meta description')
  })

  it('fails the title check on a dated title', () => {
    expect(failedLabels({ metaTitle: 'Music Bingo | 11 December' })[0]).toMatch(/^Meta title set, no date/)
  })

  it('shows Poor label for empty copy', () => {
    render(<SeoHealthIndicator {...makeProps({
      metaTitle: '', metaDescription: '', shortDescription: '', longDescription: '', slug: '',
      highlights: [], primaryKeywords: [], secondaryKeywords: [], localSeoKeywords: [], imageAltText: '', faqs: [],
    })} />)
    expect(screen.getByText(/Poor/)).toBeTruthy()
  })
})
