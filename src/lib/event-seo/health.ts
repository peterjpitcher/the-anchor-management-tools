// The SEO health score shown in the event drawer. Same matcher, same limits
// and same rules as the generator's quality gate (src/lib/seo-validation.ts),
// so a draft the gate passes scores well and one it rejects does not.

import { EVENT_SEO_LIMITS, withinRange } from './limits'
import { mentionsWeekdayAndDate } from './event-dates'
import { readsAsInvitation, titleCarriesDate } from './website-parity'
import { matchesKeyword } from './keyword-match'
import {
  countParagraphs,
  countValidFaqs,
  countWords,
  firstParagraph,
  focusPhrase,
  keywordCoverage,
  namesHomeAndNearbyPlace,
} from '@/lib/seo-validation'

export type EventSeoHealthInput = {
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

export type EventSeoHealthCheck = { label: string; passed: boolean; points: number }

export function eventSeoHealthChecks(input: EventSeoHealthInput): EventSeoHealthCheck[] {
  const L = EVENT_SEO_LIMITS
  const focus = focusPhrase(input.primaryKeywords)
  const metaTitle = input.metaTitle.trim()
  const shortDescription = input.shortDescription.trim()
  const longDescription = input.longDescription.trim()

  return [
    {
      label: `Meta title set, no date, ${L.metaTitleChars.max} characters or fewer`,
      passed: metaTitle.length > 0 && metaTitle.length <= L.metaTitleChars.max && !titleCarriesDate(metaTitle),
      points: 8,
    },
    {
      label: `Meta description ${L.metaDescriptionChars.min} to ${L.metaDescriptionChars.max} characters`,
      passed: withinRange(input.metaDescription.trim().length, L.metaDescriptionChars),
      points: 7,
    },
    {
      label: 'Focus phrase in meta description',
      passed: Boolean(focus && matchesKeyword(input.metaDescription, focus)),
      points: 8,
    },
    {
      label: 'Weekday and date in meta description',
      passed: mentionsWeekdayAndDate(input.metaDescription, input.date),
      points: 7,
    },
    {
      label: `Short description ${L.shortDescriptionChars.min} to ${L.shortDescriptionChars.max} characters`,
      passed: withinRange(shortDescription.length, L.shortDescriptionChars),
      points: 5,
    },
    {
      label: `Long description ${L.longDescriptionWords.min} to ${L.longDescriptionWords.max} words`,
      passed: withinRange(countWords(longDescription), L.longDescriptionWords),
      points: 8,
    },
    {
      label: `Long description in ${L.longDescriptionParagraphs.min} to ${L.longDescriptionParagraphs.max} paragraphs`,
      passed: withinRange(countParagraphs(longDescription), L.longDescriptionParagraphs),
      points: 5,
    },
    {
      label: 'Focus phrase in first paragraph',
      passed: Boolean(focus && matchesKeyword(firstParagraph(longDescription), focus)),
      points: 8,
    },
    {
      label: 'Reads true after the night',
      passed:
        shortDescription.length > 0 &&
        longDescription.length > 0 &&
        !readsAsInvitation(shortDescription) &&
        !readsAsInvitation(longDescription),
      points: 10,
    },
    {
      label: `Supporting terms in long description (${L.supportingInBody}+)`,
      passed: longDescription.length > 0 && keywordCoverage(longDescription, input.secondaryKeywords, L.supportingInBody),
      points: 7,
    },
    {
      label: 'Stanwell Moor and a nearby place named',
      passed: namesHomeAndNearbyPlace(longDescription, input.localSeoKeywords),
      points: 7,
    },
    {
      label: `${L.faqCount.min} to ${L.faqCount.max} FAQs with full answers`,
      passed: withinRange(input.faqs.length, L.faqCount) && countValidFaqs(input.faqs) >= L.faqCount.min,
      points: 5,
    },
    {
      label: 'Focus phrase in an FAQ question',
      passed: Boolean(focus && input.faqs.some((faq) => matchesKeyword(faq.question, focus))),
      points: 4,
    },
    {
      label: `Image alt text ${L.imageAltTextChars.min} to ${L.imageAltTextChars.max} characters`,
      passed: withinRange(input.imageAltText.trim().length, L.imageAltTextChars),
      points: 3,
    },
    {
      label: `${L.highlightsCount.min} to ${L.highlightsCount.max} highlights`,
      passed: withinRange(input.highlights.length, L.highlightsCount),
      points: 4,
    },
    {
      label: `Address ${L.slugChars.max} characters or fewer, with the date`,
      passed: input.slug.length > 0 && input.slug.length <= L.slugChars.max && /\d{4}-\d{2}-\d{2}$/.test(input.slug),
      points: 4,
    },
  ]
}

export function eventSeoHealthScore(checks: EventSeoHealthCheck[]): number {
  return checks.reduce((sum, check) => sum + (check.passed ? check.points : 0), 0)
}
