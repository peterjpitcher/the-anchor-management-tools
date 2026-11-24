// ──────────────────────────────────────────────────────────────
// What the website does with event copy, copied here so the generator and the
// drawer can check a draft against it before it is saved.
//
// Source: OJ-The-Anchor.pub at origin/main da0c7609 (23 November 2026):
//   getEventPageTitle, stripBrandSuffix  lib/event-seo-strategy.ts, lib/metadata/strip-brand-suffix.ts
//   readsAsInvitation                    lib/event-copy.ts
//   BANNED_FACTUAL_CLAIMS                lib/event-seo-strategy.ts
//   DISCONTINUED_FORMATS                 lib/event-seo-strategy.ts
//
// KEEP IN STEP. These are copies. The shared cases in
// tests/fixtures/event-seo/website-parity-cases.json are the contract: when the
// website changes one of these, change it here in the same week and update the
// cases. A difference means the app passes copy the website then takes out of
// search, or rewrites, after the night.
// ──────────────────────────────────────────────────────────────

import { formatDateInLondon } from '@/lib/dateUtils'
import { EVENT_SEO_LIMITS } from './limits'

// ── Titles ──────────────────────────────────────────────────

const BRAND = String.raw`The\s+Anchor(?:\s+(?:Pub|Stanwell\s+Moor|Village\s+Pub))*`
const TRAILING_BRAND = new RegExp(String.raw`\s*(?:\||,|-|–)?\s*(?:at\s+|from\s+)?${BRAND}\s*$`, 'i')
const INFIX_AT_BRAND = new RegExp(String.raw`\s+at\s+${BRAND}(?=\s*(?:\||,|-|–|$))`, 'i')

export function stripBrandSuffix(title: string | null | undefined): string {
  if (!title) return ''
  const stripped = title
    .replace(TRAILING_BRAND, '')
    .replace(INFIX_AT_BRAND, '')
    .replace(/\s*[|,\-–]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return stripped || title.trim()
}

const TITLE_MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`

/** A day of a month: "7 October", "Wed 16 Sept", "1st July 2026", "October 7", "16/09". */
export const TITLE_DATE = new RegExp(
  String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${TITLE_MONTH}\b|\b${TITLE_MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b`,
  'i',
)

/** True when a title carries a date the website would freeze into the page title. */
export function titleCarriesDate(title: string): boolean {
  return TITLE_DATE.test(title)
}

function isoDateAtLondonNoon(isoDate: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? `${isoDate}T12:00:00Z` : null
}

/**
 * The page title the website builds for an event, before it adds " | The Anchor".
 * `over` picks the after-the-night form, which carries the year instead of the weekday.
 */
export function websiteEventPageTitle(
  event: { name: string; metaTitle?: string | null; date: string | null },
  over: boolean,
): string {
  const recordTitle = stripBrandSuffix(event.metaTitle || event.name)
  if (TITLE_DATE.test(recordTitle)) return recordTitle

  const name = stripBrandSuffix(event.name)
  if (TITLE_DATE.test(name)) return name

  const instant = event.date ? isoDateAtLondonNoon(event.date) : null
  if (!instant || !name) return recordTitle
  const dateLabel = formatDateInLondon(
    instant,
    over
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'short', day: 'numeric', month: 'short' },
  )

  const colon = name.indexOf(':')
  const afterColon = colon > 0 ? name.slice(colon + 1).trim() : ''
  const recordStem = event.metaTitle ? stripBrandSuffix(event.metaTitle) : ''
  const stems = [name, afterColon, recordStem].filter(
    (stem, index, all) => stem.length > 0 && all.indexOf(stem) === index,
  )
  const titles = stems.map((stem) => `${stem}, ${dateLabel}`)
  return (
    titles.find((title) => title.length <= EVENT_SEO_LIMITS.websiteTitleChars) ??
    titles.reduce((shortest, title) => (title.length < shortest.length ? title : shortest))
  )
}

// ── After the night ─────────────────────────────────────────

/**
 * Whether copy reads as an invitation. The website tests the WHOLE short and
 * long description with this after the night, and swaps in a stock "took place"
 * line when it is true.
 */
export function readsAsInvitation(text: string): boolean {
  const plain = text.replace(/[‘’ʼ]/g, "'")
  if (plain.includes('!')) return true
  return /\b(get ready|join|book (your|now|online|early|ahead)|don't miss|grab your|get your (tickets?|seats?|places?|table)|secure your|coming up|come (along|down)|see you (there|then)|this (friday|saturday|sunday|monday|tuesday|wednesday|thursday))\b/i.test(
    plain,
  )
}

/** The phrases that made `readsAsInvitation` true, for a message a person can act on. */
export function invitationPhrases(text: string): string[] {
  const plain = text.replace(/[‘’ʼ]/g, "'")
  const found = new Set<string>()
  if (plain.includes('!')) found.add('!')
  const pattern =
    /\b(get ready|join|book (your|now|online|early|ahead)|don't miss|grab your|get your (tickets?|seats?|places?|table)|secure your|coming up|come (along|down)|see you (there|then)|this (friday|saturday|sunday|monday|tuesday|wednesday|thursday))\b/gi
  for (const match of plain.matchAll(pattern)) found.add(match[0].toLowerCase())
  return [...found]
}

// ── Taken out of search ─────────────────────────────────────

/**
 * Claims that take an event page out of search when they appear in its name,
 * descriptions or highlights. The website's check is NOT denial aware: "we don't
 * have an accessible toilet" in a long description removes the page too, so the
 * gate treats any mention as a fault.
 */
export const WEBSITE_BANNED_CLAIMS: ReadonlyArray<{ pattern: RegExp; claim: string }> = [
  { pattern: /accessible\s+toilet/i, claim: 'accessible toilet' },
  { pattern: /\bgluten[-\s]?free\b/i, claim: 'gluten free' },
  { pattern: /baby[-\s]?changing/i, claim: 'baby changing' },
  { pattern: /air[-\s]?condition(ed|ing)|climate[-\s]?controlled/i, claim: 'air conditioning' },
  { pattern: /wedding\s+reception/i, claim: 'wedding reception' },
  { pattern: /champions\s+league/i, claim: 'Champions League' },
  { pattern: /\b(sky|tnt)\s+sports\b/i, claim: 'Sky or TNT Sports' },
]

export function findWebsiteBannedClaims(texts: ReadonlyArray<string | null | undefined>): string[] {
  const haystack = texts.filter((v): v is string => typeof v === 'string').join(' ')
  if (!haystack.trim()) return []
  return WEBSITE_BANNED_CLAIMS.filter(({ pattern }) => pattern.test(haystack)).map(({ claim }) => claim)
}

/**
 * Retired formats. The website takes a page out of search when its name, slug,
 * descriptions, keywords, highlights or category carry one of these. "music
 * bingo" is removed before looking for "live music", because "live music bingo"
 * is a Music Bingo search phrase. The website also retires open mic pages by
 * slug; "open mic" and "drag show" are here because neither format runs any more.
 */
export const RETIRED_FORMATS: ReadonlyArray<{ token: string; ignoredPhrases?: ReadonlyArray<string> }> = [
  { token: 'games night' },
  { token: 'drag cabaret' },
  { token: 'live music', ignoredPhrases: ['music bingo'] },
  { token: 'open mic' },
  { token: 'drag show' },
]

export function findRetiredFormats(texts: ReadonlyArray<string | null | undefined>): string[] {
  const haystack = texts
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
  return RETIRED_FORMATS.filter(({ token, ignoredPhrases }) => {
    const text = (ignoredPhrases ?? []).reduce((remaining, phrase) => remaining.split(phrase).join(' '), haystack)
    return text.includes(token)
  }).map(({ token }) => token)
}
