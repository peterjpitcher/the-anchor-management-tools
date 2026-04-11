'use client'

import { useMemo } from 'react'

interface SeoHealthProps {
  metaTitle: string
  metaDescription: string
  shortDescription: string
  longDescription: string
  slug: string
  highlights: string          // comma-separated string
  primaryKeywords: string[]   // parsed keyword array
  imageAltText: string
  faqCount: number
  accessibilityNotes: string
}

interface SeoCheck {
  label: string
  passed: boolean
  points: number
}

function containsKeyword(text: string, keywords: string[]): boolean {
  if (!text || keywords.length === 0) return false
  const lower = text.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

function countWords(text: string): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

function getFirst100Words(text: string): string {
  if (!text) return ''
  return text.trim().split(/\s+/).slice(0, 100).join(' ')
}

export function SeoHealthIndicator({
  metaTitle,
  metaDescription,
  shortDescription,
  longDescription,
  slug,
  highlights,
  primaryKeywords,
  imageAltText,
  faqCount,
  accessibilityNotes,
}: SeoHealthProps) {
  const checks = useMemo((): SeoCheck[] => {
    const highlightItems = highlights
      ? highlights.split(',').map(h => h.trim()).filter(Boolean)
      : []

    return [
      {
        label: 'Meta title present and under 60 chars',
        passed: !!metaTitle && metaTitle.length > 0 && metaTitle.length <= 60,
        points: 10,
      },
      {
        label: 'Meta description present and under 160 chars',
        passed: !!metaDescription && metaDescription.length > 0 && metaDescription.length <= 160,
        points: 10,
      },
      {
        label: 'Primary keyword in meta title',
        passed: containsKeyword(metaTitle, primaryKeywords),
        points: 10,
      },
      {
        label: 'Primary keyword in meta description',
        passed: containsKeyword(metaDescription, primaryKeywords),
        points: 10,
      },
      {
        label: 'Short description present',
        passed: !!shortDescription && shortDescription.trim().length > 0,
        points: 5,
      },
      {
        label: 'Long description present and 300+ words',
        passed: !!longDescription && countWords(longDescription) >= 300,
        points: 10,
      },
      {
        label: 'Primary keyword in first 100 words of long description',
        passed: containsKeyword(getFirst100Words(longDescription), primaryKeywords),
        points: 10,
      },
      {
        label: 'At least 3 FAQs present',
        passed: faqCount >= 3,
        points: 10,
      },
      {
        label: 'Image alt text present',
        passed: !!imageAltText && imageAltText.trim().length > 0,
        points: 5,
      },
      {
        label: 'Highlights present (3+ items)',
        passed: highlightItems.length >= 3,
        points: 5,
      },
      {
        label: 'Slug is keyword-rich (contains primary keyword)',
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
    imageAltText,
    faqCount,
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
