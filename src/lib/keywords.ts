/**
 * Keyword parsing, validation, and union utilities for the SEO keyword engine.
 */

const MAX_KEYWORDS_PER_TIER = 10
const MAX_KEYWORD_LENGTH = 100
const HTML_TAG_REGEX = /<[^>]+>/g

/**
 * Parse a raw textarea value (comma and/or newline separated) into a clean keyword array.
 * Trims whitespace, collapses internal whitespace, deduplicates (case-insensitive),
 * rejects HTML tags and control characters, and enforces limits.
 */
export function parseKeywords(raw: string): string[] {
  if (!raw || !raw.trim()) return []

  const items = raw
    .split(/[,\n]+/)
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(s => s.length > 0)
    .filter(s => !HTML_TAG_REGEX.test(s))
    .filter(s => !/[\x00-\x1f]/.test(s))
    .map(s => s.slice(0, MAX_KEYWORD_LENGTH))

  // Deduplicate case-insensitively, preserving first occurrence's casing
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const item of items) {
    const lower = item.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      deduped.push(item)
    }
  }

  return deduped.slice(0, MAX_KEYWORDS_PER_TIER)
}

/**
 * Build the flat keywords union from three keyword tiers.
 * Order: primary first, then secondary, then local. Deduplicated case-insensitively.
 */
export function buildKeywordsUnion(
  primary: string[],
  secondary: string[],
  local: string[]
): string[] {
  const all = [...primary, ...secondary, ...local]
  const seen = new Set<string>()
  const result: string[] = []
  for (const kw of all) {
    const lower = kw.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      result.push(kw)
    }
  }
  return result
}

/**
 * Format a keyword array back to a display string for textarea.
 * Uses newline separation for readability.
 */
export function keywordsToDisplay(keywords: string[] | null | undefined): string {
  if (!keywords || keywords.length === 0) return ''
  return keywords.join('\n')
}
