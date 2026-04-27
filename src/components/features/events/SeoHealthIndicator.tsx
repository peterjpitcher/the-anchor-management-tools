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
