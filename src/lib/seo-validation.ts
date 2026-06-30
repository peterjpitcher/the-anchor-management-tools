// src/lib/seo-validation.ts

/**
 * SEO validation utilities shared by server-side post-generation validation
 * and client-side SeoHealthIndicator scoring.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SeoIssueSeverity = 'fatal' | 'repairable' | 'warning'

export type SeoValidationIssue = {
  code: string
  severity: SeoIssueSeverity
  field?: string
  message: string
}

export type SeoValidationOptions = {
  facts?: {
    name: string
    date: string | null
    primaryKeywords: string[]
    secondaryKeywords: string[]
    localSeoKeywords: string[]
  }
  requireKeywords?: boolean
  mode?: 'draft' | 'final'
}

export type SeoValidationResult = {
  passed: boolean
  issues: SeoValidationIssue[]
}

/**
 * Legacy result type kept for backward compatibility.
 */
interface ValidationResult {
  passed: boolean
  issues: string[]
}

// ---------------------------------------------------------------------------
// Keyword helpers (existing, exported)
// ---------------------------------------------------------------------------

/**
 * Check if a phrase appears in text using word-boundary matching.
 * Handles hyphen/space equivalence and punctuation boundaries.
 * Returns false for partial word matches (e.g. "art" does NOT match "start").
 */
function phraseMatchesText(normalised: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(?:^|[\\s,.!?;:'"()])${escaped}(?:[\\s,.!?;:'"()]|$)`, 'i')
  return regex.test(` ${normalised} `)
}

/**
 * Check if text contains a keyword using word-boundary matching.
 * Handles hyphen/space equivalence and punctuation boundaries.
 * Returns false for partial word matches (e.g. "art" does NOT match "start").
 *
 * For long-tail keywords (3+ words), also tries progressively shorter prefixes
 * down to 2 words. This handles search-intent modifiers like "near me", "tonight",
 * "this weekend" that wouldn't appear verbatim in content.
 * Example: "live music tonight near me" matches if text contains "live music".
 */
export function containsKeyword(text: string, keywords: string[]): boolean {
  if (!text || keywords.length === 0) return false
  const normalised = text.toLowerCase().replace(/-/g, ' ')
  return keywords.some(kw => {
    const normKw = kw.toLowerCase().replace(/-/g, ' ').trim()
    if (!normKw) return false

    // Try exact phrase first
    if (phraseMatchesText(normalised, normKw)) return true

    // For multi-word keywords, try progressively shorter prefixes (down to 2 words)
    const words = normKw.split(/\s+/)
    if (words.length >= 3) {
      for (let len = words.length - 1; len >= 2; len--) {
        const prefix = words.slice(0, len).join(' ')
        if (phraseMatchesText(normalised, prefix)) return true
      }
    }

    return false
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
 * Count valid FAQs -- question must be non-empty, answer must be >= 20 chars.
 */
export function countValidFaqs(faqs: { question: string; answer: string }[]): number {
  return faqs.filter(
    f => f.question?.trim().length > 0 && f.answer?.trim().length >= 20
  ).length
}

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

const PROSE_FIELDS = ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'imageAltText'] as const

const MARKDOWN_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|^#{1,6}\s|^- |\[.+?\]\(.+?\))/m

const HTML_PATTERN = /<[a-z/][^>]*>/i

const URL_PATTERN = /https?:\/\/\S+/g

const PLACEHOLDER_STRINGS = ['null', 'undefined', 'n/a', 'tbd', 'placeholder', 'lorem ipsum']

const GENERIC_FILLER_PHRASES = [
  'unforgettable evening',
  'something for everyone',
  'nestled',
  'vibrant atmosphere',
  'hidden gem',
  'a night to remember',
  'don\'t miss out',
]

function str(v: unknown): string {
  if (typeof v === 'string') return v
  return ''
}

function arrStr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return []
}

function arrFaq(v: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (x): x is { question: string; answer: string } =>
      typeof x === 'object' && x !== null && 'question' in x && 'answer' in x
  )
}

function hasMarkdown(text: string): boolean {
  return MARKDOWN_PATTERN.test(text)
}

function hasHtml(text: string): boolean {
  return HTML_PATTERN.test(text)
}

function hasUrls(text: string): boolean {
  return URL_PATTERN.test(text)
}

function hasPlaceholder(text: string): boolean {
  const lower = text.toLowerCase()
  return PLACEHOLDER_STRINGS.some(p => lower.includes(p))
}

function extractParagraphs(text: string): string[] {
  return text.split(/\n\n+/).filter(p => p.trim().length > 0)
}

// ---------------------------------------------------------------------------
// Full validation gate
// ---------------------------------------------------------------------------

function runFullValidation(
  parsed: Record<string, unknown>,
  options: SeoValidationOptions
): SeoValidationIssue[] {
  const issues: SeoValidationIssue[] = []
  const facts = options.facts

  const metaTitle = str(parsed.metaTitle)
  const metaDescription = str(parsed.metaDescription)
  const shortDescription = str(parsed.shortDescription)
  const longDescription = str(parsed.longDescription)
  const slug = str(parsed.slug)
  const imageAltText = str(parsed.imageAltText)
  const highlights = arrStr(parsed.highlights)
  const faqs = arrFaq(parsed.faqs)
  const keywords = arrStr(parsed.keywords)

  // --- Required fields ---
  const requiredStringFields = [
    'metaTitle', 'metaDescription', 'shortDescription',
    'longDescription', 'slug', 'imageAltText',
  ] as const
  for (const field of requiredStringFields) {
    const val = str(parsed[field])
    if (!val.trim()) {
      issues.push({
        code: 'missing_required_field',
        severity: 'fatal',
        field,
        message: `${field} is empty`,
      })
    }
  }

  if (highlights.length === 0) {
    issues.push({
      code: 'missing_highlights',
      severity: 'fatal',
      message: 'highlights array is empty',
    })
  }

  if (faqs.length === 0) {
    issues.push({
      code: 'missing_faqs',
      severity: 'fatal',
      message: 'faqs array is empty',
    })
  }

  // --- Meta title ---
  if (metaTitle.trim()) {
    if (metaTitle.length > 60) {
      issues.push({
        code: 'meta_title_length',
        severity: 'fatal',
        field: 'metaTitle',
        message: `Meta title is ${metaTitle.length} chars, max 60`,
      })
    } else if (metaTitle.length < 20) {
      issues.push({
        code: 'meta_title_length',
        severity: 'repairable',
        field: 'metaTitle',
        message: `Meta title is ${metaTitle.length} chars, should be 20-60`,
      })
    }

    if (facts?.primaryKeywords?.length) {
      if (!containsKeyword(metaTitle, facts.primaryKeywords)) {
        issues.push({
          code: 'meta_title_keyword',
          severity: 'repairable',
          field: 'metaTitle',
          message: 'Meta title does not contain a primary keyword',
        })
      }
    }

    if (/\s*[|\-]\s*The Anchor/i.test(metaTitle)) {
      issues.push({
        code: 'meta_title_venue_suffix',
        severity: 'repairable',
        field: 'metaTitle',
        message: 'Meta title should not have appended venue suffix like "| The Anchor" or "- The Anchor"',
      })
    }
  }

  // --- Meta description ---
  if (metaDescription.trim()) {
    if (metaDescription.length < 50) {
      issues.push({
        code: 'meta_desc_length',
        severity: 'fatal',
        field: 'metaDescription',
        message: `Meta description is ${metaDescription.length} chars, min 50`,
      })
    } else if (metaDescription.length > 160) {
      issues.push({
        code: 'meta_desc_length',
        severity: 'fatal',
        field: 'metaDescription',
        message: `Meta description is ${metaDescription.length} chars, max 160`,
      })
    } else if (metaDescription.length < 90) {
      issues.push({
        code: 'meta_desc_length',
        severity: 'repairable',
        field: 'metaDescription',
        message: `Meta description is ${metaDescription.length} chars, should be 90-160`,
      })
    }

    if (facts?.primaryKeywords?.length) {
      const first80 = metaDescription.slice(0, 80)
      if (!containsKeyword(first80, facts.primaryKeywords)) {
        issues.push({
          code: 'meta_desc_keyword',
          severity: 'repairable',
          field: 'metaDescription',
          message: 'Primary keyword not found in first 80 chars of meta description',
        })
      }
    }
  }

  // --- Short description ---
  if (shortDescription.trim()) {
    if (shortDescription.length > 300) {
      issues.push({
        code: 'short_desc_length',
        severity: 'repairable',
        field: 'shortDescription',
        message: `Short description is ${shortDescription.length} chars, trim to 300 or fewer`,
      })
    } else if (shortDescription.length < 120) {
      // Advisory only: concise, on-brand copy is preferred over padded length.
      issues.push({
        code: 'short_desc_length',
        severity: 'warning',
        field: 'shortDescription',
        message: `Short description is ${shortDescription.length} chars, a little short (aim for 120+)`,
      })
    }
    if (hasMarkdown(shortDescription)) {
      issues.push({
        code: 'short_desc_markdown',
        severity: 'repairable',
        field: 'shortDescription',
        message: 'Short description contains markdown formatting',
      })
    }
    if (hasUrls(shortDescription)) {
      issues.push({
        code: 'short_desc_urls',
        severity: 'repairable',
        field: 'shortDescription',
        message: 'Short description contains raw URLs',
      })
    }
  }

  // --- Long description ---
  if (longDescription.trim()) {
    const wordCount = countWords(longDescription)
    if (wordCount < 200) {
      issues.push({
        code: 'long_desc_word_count',
        severity: 'fatal',
        field: 'longDescription',
        message: `Long description is ${wordCount} words, min 200`,
      })
    } else if (wordCount > 700) {
      issues.push({
        code: 'long_desc_word_count',
        severity: 'repairable',
        field: 'longDescription',
        message: `Long description is ${wordCount} words, trim to 700 or fewer`,
      })
    } else if (wordCount < 350) {
      // Advisory only: concise, on-brand copy is preferred over padded length.
      issues.push({
        code: 'long_desc_word_count',
        severity: 'warning',
        field: 'longDescription',
        message: `Long description is ${wordCount} words, a little short (aim for 350+)`,
      })
    }

    const paras = extractParagraphs(longDescription)
    const paraCount = paras.length
    if (paraCount < 4 || paraCount > 7) {
      issues.push({
        code: 'long_desc_paragraphs',
        severity: 'repairable',
        field: 'longDescription',
        message: `Long description has ${paraCount} paragraphs, should be 4-7`,
      })
    }

    // Per-paragraph word count
    const outOfRange: number[] = []
    paras.forEach((p, i) => {
      const wc = countWords(p)
      if (wc < 40 || wc > 150) {
        outOfRange.push(i + 1)
      }
    })
    if (outOfRange.length > 0) {
      issues.push({
        code: 'long_desc_para_length',
        severity: 'warning',
        field: 'longDescription',
        message: `Paragraphs ${outOfRange.join(', ')} are outside the 40-150 word range`,
      })
    }

    // First paragraph checks
    if (paras.length > 0) {
      const firstPara = paras[0]

      if (facts?.name) {
        if (!firstPara.toLowerCase().includes(facts.name.toLowerCase())) {
          issues.push({
            code: 'first_para_name',
            severity: 'warning',
            field: 'longDescription',
            message: 'First paragraph does not contain the event name',
          })
        }
      }

      if (facts?.primaryKeywords?.length) {
        if (!containsKeyword(firstPara, facts.primaryKeywords)) {
          issues.push({
            code: 'first_para_keyword',
            severity: 'repairable',
            field: 'longDescription',
            message: 'First paragraph does not contain a primary keyword',
          })
        }
      }

      if (facts?.date) {
        if (!firstPara.includes(facts.date)) {
          issues.push({
            code: 'first_para_date',
            severity: 'warning',
            field: 'longDescription',
            message: 'First paragraph does not contain the event date',
          })
        }
      }
    }

    // Local SEO keyword check — advisory only. The Anchor brand voice forbids
    // forcing Heathrow/airport keywords into copy that does not need them, so a
    // missing local keyword must not block an otherwise good, on-brand draft.
    if (facts?.localSeoKeywords?.length) {
      if (!containsKeyword(longDescription, facts.localSeoKeywords)) {
        issues.push({
          code: 'local_content',
          severity: 'warning',
          field: 'longDescription',
          message: 'Long description does not contain any local SEO keywords',
        })
      }
    }
  }

  // --- Highlights ---
  if (highlights.length > 0) {
    if (highlights.length < 3 || highlights.length > 5) {
      issues.push({
        code: 'highlights_count',
        severity: 'repairable',
        field: 'highlights',
        message: `${highlights.length} highlights, should be 3-5`,
      })
    }
    const tooShort = highlights.filter(h => countWords(h) <= 3)
    if (tooShort.length > 0) {
      issues.push({
        code: 'highlights_specific',
        severity: 'warning',
        field: 'highlights',
        message: `${tooShort.length} highlight(s) have 3 or fewer words`,
      })
    }
  }

  // --- Keywords ---
  if (keywords.length < 6 || keywords.length > 10) {
    issues.push({
      code: 'keywords_count',
      severity: 'repairable',
      field: 'keywords',
      message: `${keywords.length} keywords, should be 6-10`,
    })
  }

  if (facts?.primaryKeywords?.length && keywords.length > 0) {
    const keywordsJoined = keywords.join(' ')
    for (const pk of facts.primaryKeywords) {
      if (!containsKeyword(keywordsJoined, [pk])) {
        issues.push({
          code: 'keywords_primary',
          severity: 'repairable',
          field: 'keywords',
          message: `Primary keyword "${pk}" not found in keywords list`,
        })
      }
    }
  }

  // --- Slug ---
  if (slug.trim()) {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      issues.push({
        code: 'slug_format',
        severity: 'repairable',
        field: 'slug',
        message: 'Slug contains invalid characters (must be lowercase a-z, 0-9, hyphens)',
      })
    }

    if (facts?.date) {
      const dateMatch = facts.date.match(/^(\d{4}-\d{2}-\d{2})/)
      if (dateMatch && !slug.includes(dateMatch[1])) {
        issues.push({
          code: 'slug_date',
          severity: 'repairable',
          field: 'slug',
          message: 'Slug does not contain the event date (YYYY-MM-DD)',
        })
      }
    }

    if (facts?.primaryKeywords?.length) {
      const slugWords = slug.replace(/-/g, ' ')
      if (!containsKeyword(slugWords, facts.primaryKeywords)) {
        issues.push({
          code: 'slug_keyword',
          severity: 'repairable',
          field: 'slug',
          message: 'Slug does not contain a primary keyword',
        })
      }
    }
  }

  // --- Image alt text ---
  if (imageAltText.trim()) {
    if (imageAltText.length < 50 || imageAltText.length > 180) {
      issues.push({
        code: 'alt_text_length',
        severity: 'repairable',
        field: 'imageAltText',
        message: `Image alt text is ${imageAltText.length} chars, should be 50-180`,
      })
    }

    if (facts?.primaryKeywords?.length) {
      if (!containsKeyword(imageAltText, facts.primaryKeywords)) {
        issues.push({
          code: 'alt_text_keyword',
          severity: 'repairable',
          field: 'imageAltText',
          message: 'Image alt text does not contain a primary keyword',
        })
      }
    }

    if (/^(image of|photo of)\s/i.test(imageAltText)) {
      issues.push({
        code: 'alt_text_filler',
        severity: 'repairable',
        field: 'imageAltText',
        message: 'Image alt text starts with "image of" or "photo of"',
      })
    }
  }

  // --- FAQs ---
  if (faqs.length > 0) {
    if (faqs.length < 3 || faqs.length > 5) {
      issues.push({
        code: 'faq_count',
        severity: 'repairable',
        field: 'faqs',
        message: `${faqs.length} FAQs, should be 3-5`,
      })
    }

    faqs.forEach((faq, i) => {
      const qWords = countWords(faq.question)
      if (qWords < 8 || qWords > 18) {
        issues.push({
          code: 'faq_question_length',
          severity: 'warning',
          field: 'faqs',
          message: `FAQ ${i + 1} question is ${qWords} words, should be 8-18`,
        })
      }
      const aWords = countWords(faq.answer)
      if (aWords < 30 || aWords > 70) {
        issues.push({
          code: 'faq_answer_length',
          severity: 'warning',
          field: 'faqs',
          message: `FAQ ${i + 1} answer is ${aWords} words, should be 30-70`,
        })
      }
    })
  }

  // --- Formatting checks across all prose fields ---
  for (const field of PROSE_FIELDS) {
    const val = str(parsed[field])
    if (!val.trim()) continue

    if (hasMarkdown(val)) {
      issues.push({
        code: 'contains_markdown',
        severity: 'repairable',
        field,
        message: `${field} contains markdown formatting`,
      })
    }

    if (hasHtml(val)) {
      issues.push({
        code: 'contains_html',
        severity: 'repairable',
        field,
        message: `${field} contains HTML tags`,
      })
    }

    if (hasUrls(val)) {
      issues.push({
        code: 'contains_urls',
        severity: 'repairable',
        field,
        message: `${field} contains raw URLs`,
      })
    }

    if (hasPlaceholder(val)) {
      issues.push({
        code: 'contains_placeholder',
        severity: 'repairable',
        field,
        message: `${field} contains placeholder text`,
      })
    }
  }

  // Also check FAQ answers for placeholders
  faqs.forEach((faq, i) => {
    if (hasPlaceholder(faq.answer)) {
      issues.push({
        code: 'contains_placeholder',
        severity: 'repairable',
        field: 'faqs',
        message: `FAQ ${i + 1} answer contains placeholder text`,
      })
    }
    if (hasPlaceholder(faq.question)) {
      issues.push({
        code: 'contains_placeholder',
        severity: 'repairable',
        field: 'faqs',
        message: `FAQ ${i + 1} question contains placeholder text`,
      })
    }
  })

  // --- Tone: exclamation marks ---
  let exclamationCount = 0
  for (const field of PROSE_FIELDS) {
    const val = str(parsed[field])
    exclamationCount += (val.match(/!/g) || []).length
  }
  faqs.forEach(faq => {
    exclamationCount += (faq.answer.match(/!/g) || []).length
    exclamationCount += (faq.question.match(/!/g) || []).length
  })
  if (exclamationCount > 2) {
    issues.push({
      code: 'excessive_exclamation',
      severity: 'warning',
      message: `${exclamationCount} exclamation marks found, max 2 recommended`,
    })
  }

  // --- Tone: generic filler phrases ---
  const allText = [
    metaTitle, metaDescription, shortDescription, longDescription, imageAltText,
    ...faqs.map(f => `${f.question} ${f.answer}`),
  ].join(' ').toLowerCase()

  const foundFiller = GENERIC_FILLER_PHRASES.filter(phrase => allText.includes(phrase))
  if (foundFiller.length > 0) {
    issues.push({
      code: 'generic_filler',
      severity: 'warning',
      message: `Contains generic filler phrases: ${foundFiller.join(', ')}`,
    })
  }

  return issues
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate AI-generated content deterministically.
 * When called without options, runs legacy 7-check validation (backward compat).
 * When called with options, runs the full 30+ check quality gate.
 */
export function validateGeneratedContent(
  parsed: Record<string, unknown>,
  options?: SeoValidationOptions
): SeoValidationResult {
  // Full validation mode with options
  if (options) {
    const issues = runFullValidation(parsed, options)
    const hasFatalOrRepairable = issues.some(i => i.severity === 'fatal' || i.severity === 'repairable')
    return {
      passed: !hasFatalOrRepairable,
      issues,
    }
  }

  // Legacy mode: backward-compatible validation (7 original checks)
  const legacyIssues: string[] = []

  const metaTitle = str(parsed.metaTitle)
  if (metaTitle && metaTitle.length > 40) {
    legacyIssues.push(`Meta title is ${metaTitle.length} chars, must be under 40`)
  }

  const metaDescription = str(parsed.metaDescription)
  if (metaDescription && metaDescription.length > 155) {
    legacyIssues.push(`Meta description is ${metaDescription.length} chars, must be under 155`)
  }

  const wordCount = countWords(str(parsed.longDescription))
  if (wordCount < 450) {
    legacyIssues.push(`Long description is ${wordCount} words, must be at least 450`)
  }

  const paragraphCount = countParagraphs(str(parsed.longDescription))
  if (paragraphCount < 4) {
    legacyIssues.push(`Long description has ${paragraphCount} paragraphs, must have at least 4`)
  }

  const validFaqCount = countValidFaqs(arrFaq(parsed.faqs) || [])
  if (validFaqCount < 3) {
    legacyIssues.push(`Only ${validFaqCount} valid FAQs (question non-empty, answer >= 20 chars), need at least 3`)
  }

  const requiredFields = ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'slug', 'imageAltText'] as const
  for (const field of requiredFields) {
    const val = str(parsed[field])
    if (!val || !val.trim()) {
      legacyIssues.push(`${field} is empty`)
    }
  }

  // Map legacy string issues to SeoValidationIssue objects
  return {
    passed: legacyIssues.length === 0,
    issues: legacyIssues.map(msg => ({
      code: 'legacy_check',
      severity: 'fatal' as SeoIssueSeverity,
      message: msg,
    })),
  }
}

// ---------------------------------------------------------------------------
// Deterministic repair helpers
// ---------------------------------------------------------------------------

/**
 * Collapse multiple spaces to single space, collapse 3+ newlines to double
 * newline, trim. Preserves intentional paragraph breaks (double newlines).
 */
export function trimAndNormalizeWhitespace(text: string): string {
  let result = text
  // Collapse 3+ consecutive newlines to exactly 2
  result = result.replace(/\n{3,}/g, '\n\n')
  // Collapse multiple spaces (but not newlines) to single space
  result = result.replace(/[^\S\n]+/g, ' ')
  // Trim each line
  result = result.split('\n').map(line => line.trim()).join('\n')
  // Trim overall
  return result.trim()
}

/**
 * Strip markdown markers from text:
 * **bold** -> bold, `code` -> code, # headings -> headings (line start),
 * - list -> list (line start), [text](url) -> text.
 * Does NOT strip hyphens in the middle of words.
 */
export function removeMarkdownMarkers(text: string): string {
  let result = text
  // Remove bold markers
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1')
  // Remove inline code
  result = result.replace(/`([^`]+)`/g, '$1')
  // Remove heading markers at line start
  result = result.replace(/^#{1,6}\s+/gm, '')
  // Remove list markers at line start (only "- " at start of line)
  result = result.replace(/^- /gm, '')
  // Remove markdown links [text](url) -> text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  return result
}

/**
 * Build a URL-safe slug from name, date, and primary keyword.
 * Format: {keyword}-{name}-{YYYY-MM-DD}
 * Deduplicates keyword if already present in name.
 */
export function normalizeSlug(
  name: string,
  date: string | null,
  primaryKeyword: string | null
): string {
  const nameLower = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  const parts: string[] = []

  if (primaryKeyword) {
    const kwLower = primaryKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    // Only prepend keyword if name doesn't already contain it
    const nameNorm = nameLower.replace(/-/g, ' ')
    const kwNorm = kwLower.replace(/-/g, ' ')
    if (!nameNorm.includes(kwNorm)) {
      parts.push(kwLower)
    }
  }

  parts.push(nameLower)

  if (date) {
    const dateMatch = date.match(/(\d{4}-\d{2}-\d{2})/)
    if (dateMatch) {
      parts.push(dateMatch[1])
    }
  }

  return parts
    .join('-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Remove http:// and https:// URLs from text.
 * Collapses any resulting double spaces.
 */
export function removeRawUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/**
 * Lowercase all items, remove exact duplicates (case-insensitive),
 * return first `max` items.
 */
export function capAndDeduplicate(items: string[], max: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const lower = item.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      result.push(lower)
    }
    if (result.length >= max) break
  }
  return result
}

/**
 * Apply all deterministic repairs to a draft.
 * Returns a shallow copy -- does NOT mutate the input.
 */
export function applyDeterministicRepair(
  draft: Record<string, unknown>,
  facts?: SeoValidationOptions['facts']
): Record<string, unknown> {
  const patched = { ...draft }

  // 1. Trim and normalize whitespace on all string fields
  for (const key of Object.keys(patched)) {
    if (typeof patched[key] === 'string') {
      patched[key] = trimAndNormalizeWhitespace(patched[key] as string)
    }
  }

  // 2. Remove markdown from prose fields
  const proseKeys = ['shortDescription', 'longDescription', 'metaTitle', 'metaDescription', 'imageAltText']
  for (const key of proseKeys) {
    if (typeof patched[key] === 'string') {
      patched[key] = removeMarkdownMarkers(patched[key] as string)
    }
  }

  // Also remove markdown from FAQ answers
  if (Array.isArray(patched.faqs)) {
    patched.faqs = (patched.faqs as { question: string; answer: string }[]).map(faq => ({
      ...faq,
      answer: removeMarkdownMarkers(trimAndNormalizeWhitespace(faq.answer)),
      question: trimAndNormalizeWhitespace(faq.question),
    }))
  }

  // 3. Remove raw URLs from prose fields
  for (const key of proseKeys) {
    if (typeof patched[key] === 'string') {
      patched[key] = removeRawUrls(patched[key] as string)
    }
  }

  // 4. Normalize slug if facts provided
  if (facts) {
    patched.slug = normalizeSlug(
      facts.name,
      facts.date,
      facts.primaryKeywords[0] ?? null
    )
  }

  // 5. Cap and deduplicate highlights and keywords
  if (Array.isArray(patched.highlights)) {
    patched.highlights = capAndDeduplicate(
      patched.highlights.filter((x): x is string => typeof x === 'string'),
      5
    )
  }
  if (Array.isArray(patched.keywords)) {
    patched.keywords = capAndDeduplicate(
      patched.keywords.filter((x): x is string => typeof x === 'string'),
      10
    )
  }

  // 6. Replace placeholder text with empty string in all string fields
  for (const key of Object.keys(patched)) {
    if (typeof patched[key] === 'string') {
      const val = patched[key] as string
      if (hasPlaceholder(val)) {
        let cleaned = val
        for (const placeholder of PLACEHOLDER_STRINGS) {
          cleaned = cleaned.replace(new RegExp(placeholder, 'gi'), '')
        }
        patched[key] = cleaned.replace(/ {2,}/g, ' ').trim()
      }
    }
  }

  return patched
}
