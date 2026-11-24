'use client'

import { useMemo } from 'react'
import { Card, ProgressBar } from '@/ds'
import { seoHealthStyles } from '@/app/(authenticated)/events/_shared/status-ui'
import { eventSeoHealthChecks, eventSeoHealthScore } from '@/lib/event-seo/health'

interface SeoHealthProps {
  /** The event date, YYYY-MM-DD. */
  date: string | null
  metaTitle: string
  metaDescription: string
  shortDescription: string
  longDescription: string
  slug: string
  highlights: string[]
  primaryKeywords: string[]
  secondaryKeywords: string[]
  localSeoKeywords: string[]
  imageAltText: string
  faqs: { question: string; answer: string }[]
}

/**
 * Scores the drawer's copy with the same rules as the generator's quality gate
 * (src/lib/event-seo/health.ts). Accessibility notes are not scored: code always
 * fills them.
 */
export function SeoHealthIndicator(props: SeoHealthProps) {
  const {
    date, metaTitle, metaDescription, shortDescription, longDescription, slug,
    highlights, primaryKeywords, secondaryKeywords, localSeoKeywords, imageAltText, faqs,
  } = props
  const checks = useMemo(
    () => eventSeoHealthChecks({
      date, metaTitle, metaDescription, shortDescription, longDescription, slug,
      highlights, primaryKeywords, secondaryKeywords, localSeoKeywords, imageAltText, faqs,
    }),
    [date, metaTitle, metaDescription, shortDescription, longDescription, slug,
      highlights, primaryKeywords, secondaryKeywords, localSeoKeywords, imageAltText, faqs],
  )

  const score = useMemo(() => eventSeoHealthScore(checks), [checks])

  const colourClasses = seoHealthStyles(score)
  const scoreLabel = colourClasses.label

  return (
    <Card padding="sm">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          SEO Health
        </span>
        <span className={`text-sm font-bold ${colourClasses.score}`}>
          {score}/100 · {scoreLabel}
        </span>
      </div>

      {/* Progress bar */}
      <ProgressBar
        value={score}
        tone={colourClasses.tone}
        label={`SEO score: ${score} out of 100`}
        className="mb-3"
      />

      {/* Checklist: stacks on mobile, 2-column grid from sm up */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-start gap-1.5">
            <span
              className={`mt-px shrink-0 text-xs font-bold ${check.passed ? colourClasses.tick : colourClasses.cross}`}
              aria-hidden="true"
            >
              {check.passed ? '\u2713' : '\u2717'}
            </span>
            <span className={`text-xs leading-tight ${check.passed ? 'text-text' : 'text-text-muted'}`}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
