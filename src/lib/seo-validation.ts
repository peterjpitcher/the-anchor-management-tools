// src/lib/seo-validation.ts

/**
 * The quality gate for generated event copy, and the helpers the SEO health
 * score shares with it.
 *
 * Every number comes from src/lib/event-seo/limits.ts and every keyword match
 * from src/lib/event-seo/keyword-match.ts, so the prompt, this gate, the health
 * score and the drawer cannot disagree. The rules are section 5 of
 * tasks/spec-2026-11-24-event-seo-generation.md: an event page holds its dated,
 * themed long tail (the focus phrase) and leaves the head terms to the hub
 * pages; its copy must still read true after the night.
 */

import { checkHouseStyle } from '@/lib/copy/house-style'
import { EVENT_SEO_LIMITS, HOME_PLACE, NEARBY_PLACES, withinRange, withinTolerance } from '@/lib/event-seo/limits'
import type { Range } from '@/lib/event-seo/limits'
import { copyableKeyword, focusPhrase, keywordTokens, matchesKeyword } from '@/lib/event-seo/keyword-match'
import { mentionsDayMonth, mentionsWeekdayAndDate } from '@/lib/event-seo/event-dates'
import { invitationPhrases, readsAsInvitation, titleCarriesDate } from '@/lib/event-seo/website-parity'

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
    /** The Focus tier: the first entry is the focus phrase, the rest are variants. */
    primaryKeywords: string[]
    /** The Supporting tier. */
    secondaryKeywords: string[]
    /** The Local tier. */
    localSeoKeywords: string[]
  }
  /** Kept for callers written before 24 November 2026; the gate always checks keywords now. */
  requireKeywords?: boolean
  mode?: 'draft' | 'final'
}

export type SeoValidationResult = {
  passed: boolean
  issues: SeoValidationIssue[]
}

// ---------------------------------------------------------------------------
// Keyword helpers
// ---------------------------------------------------------------------------

/** True when any of the keywords appears in the text as a whole phrase. */
export function containsKeyword(text: string, keywords: string[]): boolean {
  if (!text || keywords.length === 0) return false
  return keywords.some((kw) => matchesKeyword(text, kw))
}

/** How many of the keywords appear in the text. */
export function countKeywordMatches(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0
  return keywords.filter((kw) => matchesKeyword(text, kw)).length
}

/**
 * True when the text carries at least `minRequired` of the keywords (capped at
 * how many there are). True when there are none to check.
 */
export function keywordCoverage(text: string, keywords: string[], minRequired: number): boolean {
  const usable = keywords.filter((kw) => keywordTokens(copyableKeyword(kw)).length > 0)
  if (usable.length === 0) return true
  return countKeywordMatches(text, usable) >= Math.min(minRequired, usable.length)
}

export { focusPhrase }

/** Stanwell Moor plus at least one other place named in the text. */
export function namesHomeAndNearbyPlace(text: string, localKeywords: string[] = []): boolean {
  if (!matchesKeyword(text, HOME_PLACE)) return false
  const home = keywordTokens(HOME_PLACE).join(' ')
  const others = [...NEARBY_PLACES, ...localKeywords].filter(
    (place) => keywordTokens(copyableKeyword(place)).join(' ') !== home,
  )
  return others.some((place) => matchesKeyword(text, place))
}

export function countWords(text: string | null | undefined): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function getFirstNWords(text: string | null | undefined, n: number): string {
  if (!text) return ''
  return text.trim().split(/\s+/).slice(0, n).join(' ')
}

export function countParagraphs(text: string | null | undefined): number {
  if (!text) return 0
  return text.split(/\n\s*\n+/).filter((p) => p.trim().length > 0).length
}

export function firstParagraph(text: string | null | undefined): string {
  if (!text) return ''
  return text.split(/\n\s*\n+/).find((p) => p.trim().length > 0) ?? ''
}

/** FAQs with a question and an answer of at least the minimum word count. */
export function countValidFaqs(faqs: { question: string; answer: string }[]): number {
  return faqs.filter(
    (f) => f.question?.trim().length > 0 && countWords(f.answer) >= EVENT_SEO_LIMITS.faqAnswerWords.min,
  ).length
}

/**
 * The website hides these FAQs once the night is over, so a page should carry
 * at most one (copied from lib/event-copy.ts on the website).
 */
export const BOOKING_QUESTION_PATTERN =
  /\b(book|booking|reserve|reservation|deposit|refund|cancel|cancellation|pay|payment|sold\s*out|still\s+available|get\s+tickets|buy)\b/i

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PROSE_FIELDS = ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'imageAltText'] as const

const MARKDOWN_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|^#{1,6}\s|^- |\[.+?\]\(.+?\))/m

const HTML_PATTERN = /<[a-z/][^>]*>/i

/**
 * No global flag. A global regex used with .test() keeps its lastIndex between
 * calls, so the same text gave three findings on one run and two on the next.
 */
const URL_PATTERN = /https?:\/\/\S+/

const PLACEHOLDER_STRINGS = ['null', 'undefined', 'n/a', 'tbd', 'placeholder', 'lorem ipsum']

const GENERIC_FILLER_PHRASES = [
  'unforgettable evening',
  'something for everyone',
  'nestled',
  'vibrant atmosphere',
  'great atmosphere',
  'hidden gem',
  'look no further',
  'a must-visit',
  'boasts',
  'a night to remember',
  "don't miss out",
]

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function arrStr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function arrFaq(v: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (x): x is { question: string; answer: string } =>
      typeof x === 'object' && x !== null && 'question' in x && 'answer' in x,
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
  return PLACEHOLDER_STRINGS.some((p) => new RegExp(`\\b${p.replace(/[/]/g, '\\/')}\\b`).test(lower))
}

function extractParagraphs(text: string): string[] {
  return text.split(/\n\s*\n+/).filter((p) => p.trim().length > 0)
}

/**
 * A length outside its range is a warning when it is close (models count
 * badly) and repairable when it is not.
 */
function lengthIssue(
  value: number,
  range: Range,
  code: string,
  field: string,
  label: string,
  unit: string,
): SeoValidationIssue | null {
  if (withinRange(value, range)) return null
  return {
    code,
    severity: withinTolerance(value, range) ? 'warning' : 'repairable',
    field,
    message: `${label} is ${value} ${unit}, should be ${range.min} to ${range.max}`,
  }
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function runFullValidation(parsed: Record<string, unknown>, options: SeoValidationOptions): SeoValidationIssue[] {
  const issues: SeoValidationIssue[] = []
  const facts = options.facts
  const L = EVENT_SEO_LIMITS

  const metaTitle = str(parsed.metaTitle)
  const metaDescription = str(parsed.metaDescription)
  const shortDescription = str(parsed.shortDescription)
  const longDescription = str(parsed.longDescription)
  const slug = str(parsed.slug)
  const imageAltText = str(parsed.imageAltText)
  const highlights = arrStr(parsed.highlights)
  const faqs = arrFaq(parsed.faqs)

  const focus = facts ? focusPhrase(facts.primaryKeywords) : null
  const push = (issue: SeoValidationIssue | null) => {
    if (issue) issues.push(issue)
  }

  // --- Required fields ---
  for (const field of ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'imageAltText'] as const) {
    if (!str(parsed[field]).trim()) {
      issues.push({ code: 'missing_required_field', severity: 'fatal', field, message: `${field} is empty` })
    }
  }
  if (highlights.length === 0) {
    issues.push({ code: 'missing_highlights', severity: 'fatal', field: 'highlights', message: 'highlights array is empty' })
  }
  if (faqs.length === 0) {
    issues.push({ code: 'missing_faqs', severity: 'fatal', field: 'faqs', message: 'faqs array is empty' })
  }

  // --- Meta title: a short undated name for the night ---
  if (metaTitle.trim()) {
    push(lengthIssue(metaTitle.length, L.metaTitleChars, 'meta_title_length', 'metaTitle', 'Meta title', 'characters'))
    if (titleCarriesDate(metaTitle)) {
      issues.push({
        code: 'meta_title_date',
        severity: 'repairable',
        field: 'metaTitle',
        message: 'Meta title carries a date. The website adds the date itself, and a stored one loses its year after the night',
      })
    }
    if (/\s*[|\-–,]\s*The Anchor\b|\bat The Anchor\b/i.test(metaTitle)) {
      issues.push({
        code: 'meta_title_venue_suffix',
        severity: 'repairable',
        field: 'metaTitle',
        message: 'Meta title should not name The Anchor; the website adds " | The Anchor" itself',
      })
    }
  }

  // --- Meta description: what, weekday and date, time, place, price, one action ---
  if (metaDescription.trim()) {
    push(
      lengthIssue(
        metaDescription.length,
        L.metaDescriptionChars,
        'meta_desc_length',
        'metaDescription',
        'Meta description',
        'characters',
      ),
    )
    if (focus && !matchesKeyword(metaDescription, focus)) {
      issues.push({
        code: 'meta_desc_focus',
        severity: 'repairable',
        field: 'metaDescription',
        message: `Meta description does not contain the focus phrase "${focus}" exactly`,
      })
    }
    if (facts?.date && !mentionsWeekdayAndDate(metaDescription, facts.date)) {
      issues.push({
        code: 'meta_desc_date',
        severity: 'repairable',
        field: 'metaDescription',
        message: 'Meta description does not give the weekday and date',
      })
    }
    if (metaDescription.includes('!')) {
      issues.push({
        code: 'meta_desc_exclamation',
        severity: 'repairable',
        field: 'metaDescription',
        message: 'Meta description has an exclamation mark',
      })
    }
  }

  // --- Short description: a statement of fact that still reads true after the night ---
  if (shortDescription.trim()) {
    push(
      lengthIssue(
        shortDescription.length,
        L.shortDescriptionChars,
        'short_desc_length',
        'shortDescription',
        'Short description',
        'characters',
      ),
    )
    if (readsAsInvitation(shortDescription)) {
      issues.push({
        code: 'reads_as_invitation',
        severity: 'repairable',
        field: 'shortDescription',
        message: `Short description reads as an invitation (${invitationPhrases(shortDescription).join(', ')}), so the website drops it after the night. State it as fact`,
      })
    }
  }

  // --- Long description ---
  if (longDescription.trim()) {
    const wordCount = countWords(longDescription)
    if (wordCount < Math.floor(L.longDescriptionWords.min * 0.6)) {
      issues.push({
        code: 'long_desc_word_count',
        severity: 'fatal',
        field: 'longDescription',
        message: `Long description is ${wordCount} words, should be ${L.longDescriptionWords.min} to ${L.longDescriptionWords.max}`,
      })
    } else {
      push(
        lengthIssue(wordCount, L.longDescriptionWords, 'long_desc_word_count', 'longDescription', 'Long description', 'words'),
      )
    }

    const paras = extractParagraphs(longDescription)
    if (!withinRange(paras.length, L.longDescriptionParagraphs)) {
      issues.push({
        code: 'long_desc_paragraphs',
        severity: 'repairable',
        field: 'longDescription',
        message: `Long description has ${paras.length} paragraphs, should be ${L.longDescriptionParagraphs.min} to ${L.longDescriptionParagraphs.max}`,
      })
    }

    if (readsAsInvitation(longDescription)) {
      issues.push({
        code: 'reads_as_invitation',
        severity: 'repairable',
        field: 'longDescription',
        message: `Long description reads as an invitation (${invitationPhrases(longDescription).join(', ')}). The website tests the whole text after the night and replaces it, so state booking and arrival as fact`,
      })
    }

    const firstPara = paras[0] ?? ''
    if (firstPara) {
      if (facts?.name && !firstPara.toLowerCase().includes(facts.name.toLowerCase())) {
        issues.push({
          code: 'first_para_name',
          severity: 'warning',
          field: 'longDescription',
          message: 'First paragraph does not contain the event name',
        })
      }
      if (focus && !matchesKeyword(firstPara, focus)) {
        issues.push({
          code: 'first_para_focus',
          severity: 'repairable',
          field: 'longDescription',
          message: `First paragraph does not contain the focus phrase "${focus}" exactly`,
        })
      }
      if (facts?.date && !mentionsDayMonth(firstPara, facts.date)) {
        issues.push({
          code: 'first_para_date',
          severity: 'repairable',
          field: 'longDescription',
          message: 'First paragraph does not give the date',
        })
      }
    }

    if (!namesHomeAndNearbyPlace(longDescription, facts?.localSeoKeywords ?? [])) {
      issues.push({
        code: 'local_places',
        severity: 'repairable',
        field: 'longDescription',
        message: `Long description should name ${HOME_PLACE} and one nearby place (${NEARBY_PLACES.slice(0, 3).join(', ')} or similar)`,
      })
    }

    // Supporting terms stay a warning: older events carry tiers written for the old rules
    // ("interactive music event"), and they must not make a live event impossible to regenerate.
    const supporting = facts?.secondaryKeywords ?? []
    if (supporting.length >= 3 && !keywordCoverage(longDescription, supporting, L.supportingInBody)) {
      issues.push({
        code: 'supporting_keywords',
        severity: 'warning',
        field: 'longDescription',
        message: `Long description carries fewer than ${L.supportingInBody} supporting terms`,
      })
    }
  }

  // --- Highlights ---
  if (highlights.length > 0) {
    if (!withinRange(highlights.length, L.highlightsCount)) {
      issues.push({
        code: 'highlights_count',
        severity: 'repairable',
        field: 'highlights',
        message: `${highlights.length} highlights, should be ${L.highlightsCount.min} to ${L.highlightsCount.max}`,
      })
    }
    const offLength = highlights.filter((h) => !withinRange(countWords(h), L.highlightWords))
    if (offLength.length > 0) {
      issues.push({
        code: 'highlights_length',
        severity: 'warning',
        field: 'highlights',
        message: `${offLength.length} highlight(s) are outside ${L.highlightWords.min} to ${L.highlightWords.max} words`,
      })
    }
  }

  // --- Slug: set by code; checked so a hand edit cannot break it ---
  if (slug.trim()) {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      issues.push({
        code: 'slug_format',
        severity: 'repairable',
        field: 'slug',
        message: 'Slug contains invalid characters (must be lowercase a-z, 0-9, hyphens)',
      })
    }
    if (slug.length > L.slugChars.max) {
      issues.push({
        code: 'slug_length',
        severity: 'warning',
        field: 'slug',
        message: `Slug is ${slug.length} characters, should be ${L.slugChars.max} or fewer`,
      })
    }
  }

  // --- Image alt text: describes the picture ---
  if (imageAltText.trim()) {
    push(
      lengthIssue(imageAltText.length, L.imageAltTextChars, 'alt_text_length', 'imageAltText', 'Image alt text', 'characters'),
    )
    if (/^(image of|photo of|picture of)\s/i.test(imageAltText)) {
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
    if (!withinRange(faqs.length, L.faqCount)) {
      issues.push({
        code: 'faq_count',
        severity: 'repairable',
        field: 'faqs',
        message: `${faqs.length} FAQs, should be ${L.faqCount.min} to ${L.faqCount.max}`,
      })
    }
    faqs.forEach((faq, i) => {
      const aWords = countWords(faq.answer)
      if (!withinRange(aWords, L.faqAnswerWords)) {
        issues.push({
          code: 'faq_answer_length',
          severity: 'warning',
          field: 'faqs',
          message: `FAQ ${i + 1} answer is ${aWords} words, should be ${L.faqAnswerWords.min} to ${L.faqAnswerWords.max}`,
        })
      }
    })
    if (focus && !faqs.some((faq) => matchesKeyword(faq.question, focus))) {
      issues.push({
        code: 'faq_focus',
        severity: 'repairable',
        field: 'faqs',
        message: `No FAQ question contains the focus phrase "${focus}"`,
      })
    }
    const bookingQuestions = faqs.filter((faq) => BOOKING_QUESTION_PATTERN.test(faq.question)).length
    if (bookingQuestions > 1) {
      issues.push({
        code: 'faq_booking_questions',
        severity: 'warning',
        field: 'faqs',
        message: `${bookingQuestions} FAQs are about booking; the website hides those after the night, so keep one`,
      })
    }
  }

  // --- Formatting across prose fields ---
  for (const field of PROSE_FIELDS) {
    const val = str(parsed[field])
    if (!val.trim()) continue
    if (hasMarkdown(val)) {
      issues.push({ code: 'contains_markdown', severity: 'repairable', field, message: `${field} contains markdown formatting` })
    }
    if (hasHtml(val)) {
      issues.push({ code: 'contains_html', severity: 'repairable', field, message: `${field} contains HTML tags` })
    }
    if (hasUrls(val)) {
      issues.push({ code: 'contains_urls', severity: 'repairable', field, message: `${field} contains raw URLs` })
    }
    if (hasPlaceholder(val)) {
      issues.push({ code: 'contains_placeholder', severity: 'repairable', field, message: `${field} contains placeholder text` })
    }
  }
  faqs.forEach((faq, i) => {
    if (hasPlaceholder(faq.answer) || hasPlaceholder(faq.question)) {
      issues.push({ code: 'contains_placeholder', severity: 'repairable', field: 'faqs', message: `FAQ ${i + 1} contains placeholder text` })
    }
    if (hasUrls(faq.answer)) {
      issues.push({ code: 'contains_urls', severity: 'repairable', field: 'faqs', message: `FAQ ${i + 1} answer contains a raw URL` })
    }
  })

  // --- Tone ---
  const proseText = [metaTitle, metaDescription, shortDescription, longDescription, imageAltText, ...faqs.map((f) => `${f.question} ${f.answer}`)]
  const exclamationCount = proseText.reduce((sum, text) => sum + (text.match(/!/g) || []).length, 0)
  if (exclamationCount > 1) {
    issues.push({
      code: 'excessive_exclamation',
      severity: 'warning',
      message: `${exclamationCount} exclamation marks found; the house style allows one at most`,
    })
  }

  const allText = proseText.join(' ').toLowerCase()
  const foundFiller = GENERIC_FILLER_PHRASES.filter((phrase) => allText.includes(phrase))
  if (foundFiller.length > 0) {
    issues.push({ code: 'generic_filler', severity: 'warning', message: `Contains generic filler phrases: ${foundFiller.join(', ')}` })
  }

  // --- The house style: one checker for every surface (SSOT sections 1 and 14) ---
  const houseStyle = checkHouseStyle(
    [...proseText, ...highlights].join('\n'),
    { proseChecks: false },
  ).filter((finding) => finding.rule !== 'anchor-pub-conversational')
  const bannedClaims = houseStyle.filter((finding) => finding.severity === 'error')
  if (bannedClaims.length > 0) {
    issues.push({
      code: 'banned_claim',
      severity: 'repairable',
      message: `Carries a claim the brand rules ban: ${bannedClaims.map((f) => `"${f.matched}"`).join(', ')}. ${bannedClaims[0].message}`,
    })
  }
  const voiceFindings = houseStyle.filter((finding) => finding.severity === 'warning' && finding.rule !== 'filler')
  if (voiceFindings.length > 0) {
    issues.push({
      code: 'house_style_voice',
      severity: 'warning',
      message: `Off the house voice: ${voiceFindings.map((f) => `${f.rule} "${f.matched.trim()}"`).join(', ')}`,
    })
  }

  return issues
}

/**
 * Check a generated draft. Passes when nothing is fatal or repairable; warnings
 * are reported but never block.
 */
export function validateGeneratedContent(
  parsed: Record<string, unknown>,
  options: SeoValidationOptions = {},
): SeoValidationResult {
  const issues = runFullValidation(parsed, options)
  return {
    passed: !issues.some((i) => i.severity === 'fatal' || i.severity === 'repairable'),
    issues,
  }
}

// ---------------------------------------------------------------------------
// Deterministic repair helpers
// ---------------------------------------------------------------------------

/**
 * Collapse multiple spaces, collapse 3+ newlines to a paragraph break, trim.
 */
export function trimAndNormalizeWhitespace(text: string): string {
  let result = text.replace(/\r\n?/g, '\n')
  result = result.replace(/\n{3,}/g, '\n\n')
  result = result.replace(/[^\S\n]+/g, ' ')
  result = result.split('\n').map((line) => line.trim()).join('\n')
  return result.trim()
}

/**
 * Strip markdown markers: **bold**, `code`, # headings and "- " list markers at
 * the start of a line, and [text](url) links.
 */
export function removeMarkdownMarkers(text: string): string {
  let result = text
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1')
  result = result.replace(/`([^`]+)`/g, '$1')
  result = result.replace(/^#{1,6}\s+/gm, '')
  result = result.replace(/^- /gm, '')
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  return result
}

function slugWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * The event's address: `<focus words the name lacks>-<name>-<YYYY-MM-DD>`, at
 * most EVENT_SEO_LIMITS.slugChars.max characters. Focus words the name already
 * has are not repeated, so "christmas music bingo" on "Sleigh My Name: Festive
 * Music Bingo" gives christmas-sleigh-my-name-festive-music-bingo-2026-12-11.
 * When it is too long, words come off the end of the name; the date stays.
 */
export function normalizeSlug(name: string, date: string | null, focusKeyword: string | null): string {
  const nameWords = slugWords(name)
  const focusWords = focusKeyword ? slugWords(copyableKeyword(focusKeyword)) : []
  const lead = focusWords.filter((word, i) => !nameWords.includes(word) && focusWords.indexOf(word) === i)
  const dateMatch = date?.match(/(\d{4}-\d{2}-\d{2})/)
  const tail = dateMatch ? [dateMatch[1]] : []

  const build = (words: string[]) => [...lead, ...words, ...tail].join('-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
  let body = [...nameWords]
  let slug = build(body)
  while (slug.length > EVENT_SEO_LIMITS.slugChars.max && body.length > 1) {
    body = body.slice(0, -1)
    slug = build(body)
  }
  return slug
}

export function removeRawUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/**
 * Remove duplicates (ignoring case) and keep the first `max`. The first spelling
 * is kept as written: highlights keep their capitals. Pass `lowercase` for
 * lists that are stored in lower case.
 */
export function capAndDeduplicate(items: string[], max: number, options: { lowercase?: boolean } = {}): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const trimmed = item.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(options.lowercase ? key : trimmed)
    }
    if (result.length >= max) break
  }
  return result
}

/**
 * Repairs that need no model: whitespace, markdown, raw URLs, placeholders and
 * duplicate highlights. Returns a copy. The slug is not touched here: the
 * caller decides it, because a published event's address must not move.
 */
export function applyDeterministicRepair(
  draft: Record<string, unknown>,
  _facts?: SeoValidationOptions['facts'],
): Record<string, unknown> {
  const patched = { ...draft }

  for (const key of Object.keys(patched)) {
    if (typeof patched[key] === 'string') {
      patched[key] = trimAndNormalizeWhitespace(patched[key] as string)
    }
  }

  const proseKeys = ['shortDescription', 'longDescription', 'metaTitle', 'metaDescription', 'imageAltText']
  for (const key of proseKeys) {
    if (typeof patched[key] === 'string') {
      patched[key] = removeRawUrls(removeMarkdownMarkers(patched[key] as string))
    }
  }

  if (Array.isArray(patched.faqs)) {
    patched.faqs = arrFaq(patched.faqs).map((faq) => ({
      question: trimAndNormalizeWhitespace(faq.question),
      answer: removeRawUrls(removeMarkdownMarkers(trimAndNormalizeWhitespace(faq.answer))),
    }))
  }

  if (Array.isArray(patched.highlights)) {
    patched.highlights = capAndDeduplicate(
      arrStr(patched.highlights).map((h) => removeMarkdownMarkers(trimAndNormalizeWhitespace(h)).replace(/[.;]+$/, '')),
      EVENT_SEO_LIMITS.highlightsCount.max,
    )
  }

  for (const key of Object.keys(patched)) {
    if (typeof patched[key] === 'string') {
      const val = patched[key] as string
      if (hasPlaceholder(val)) {
        let cleaned = val
        for (const placeholder of PLACEHOLDER_STRINGS) {
          cleaned = cleaned.replace(new RegExp(`\\b${placeholder.replace(/[/]/g, '\\/')}\\b`, 'gi'), '')
        }
        patched[key] = cleaned.replace(/ {2,}/g, ' ').trim()
      }
    }
  }

  return patched
}
