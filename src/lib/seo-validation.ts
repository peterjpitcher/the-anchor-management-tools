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
