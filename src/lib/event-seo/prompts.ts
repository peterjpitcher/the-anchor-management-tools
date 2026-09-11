// ──────────────────────────────────────────────────────────────
// Event SEO prompt sections and message builders.
//
// Design: static text appears first in every message array so
// OpenAI prompt caching can hit on repeated calls. Dynamic
// facts/JSON is always appended last.
// ──────────────────────────────────────────────────────────────

import type { EventSeoFacts } from './generation'
import { ANCHOR_VENUE_CONTEXT } from './generation'

// ── Static prompt sections ──────────────────────────────────

// The voice is the website SSOT's section 1 (version 2.0, confirmed by the owner on 11 September
// 2026). Keep these rules in step with it and with src/lib/copy/house-style.ts; when they differ,
// section 1 wins.
export const SYSTEM_ROLE = `You write event copy for The Anchor, a proper village pub in Stanwell Moor, near Staines. Your job is to make people want to come along.

Voice: sound like a friendly local telling someone about their favourite pub. Warm, a bit excited, easy to read, and never showing off. The Anchor is the village's pub, not a nightclub, theatre or corporate venue.

It's about them, not us. Write from the reader's side: what they'll enjoy, why they'll want to come, and what to do next. Talk to them as "you". Talk about the pub only as far as it matters to them.

Write in UK English. Never invent facts: every detail must come from the event data (FACTS_JSON) or the venue context (VENUE_CONTEXT). If a detail is missing, leave it out. Do not make it up.`

export const ANCHOR_VENUE_CONTEXT_PROMPT = `VENUE CONTEXT (verified facts; do not invent others):
- Venue name: ${ANCHOR_VENUE_CONTEXT.name}
- Address: ${ANCHOR_VENUE_CONTEXT.address}
- Phone: ${ANCHOR_VENUE_CONTEXT.phone}
- Area: ${ANCHOR_VENUE_CONTEXT.area}, ${ANCHOR_VENUE_CONTEXT.county}
- Description: ${ANCHOR_VENUE_CONTEXT.description}
- Transport: ${ANCHOR_VENUE_CONTEXT.transport.join('; ')}
- Parking: ${ANCHOR_VENUE_CONTEXT.parking}
- Accessibility: ${ANCHOR_VENUE_CONTEXT.accessibility}
- Facilities: ${ANCHOR_VENUE_CONTEXT.facilities.join('; ')}
- Nearby areas: ${ANCHOR_VENUE_CONTEXT.nearby.join(', ')}`

export const OUTPUT_RUBRIC = `HOW TO WRITE, follow strictly:
- Lead with why they'll want to come, then give the details.
- It's about them, not us. Say "you" to the reader, never "guests" or "patrons". Say "the pub", never "venue" or "establishment".
- Keep sentences short: one idea each, and none over 25 words. Use contractions (we're, you'll, it's, there's). Read it back: would a real person say it out loud?
- Show, don't tell. Describe what happens on the night instead of claiming it will be "exciting", "thrilling" or "high-energy". Energy comes from verbs and specifics, not punctuation.
- One exclamation mark in the whole piece at most, and usually none.
- Never open a sentence with a command such as "Indulge in", "Savour", "Delight in", "Treat yourself to", "Experience", "Discover" or "Enjoy".
- Sound like these: "a proper night out", "big laughs", "bring your mates", "get involved", "sing along", "loads of fun", "book your seats", "a brilliant night at your local".
- Never sound posh, corporate or salesy. Banned words and phrases, and anything close to them: "premium experience", "elevated entertainment", "curated evening", "sophisticated event", "unforgettable journey/evening", "exclusive night", "hidden gem", "nestled", "boasts", "great atmosphere", "vibrant atmosphere", "something for everyone", "look no further", "a must-visit", "a night to remember", "set to be", "promises to", "guarantees", "filled with entertainment", "plays a vital role", "high-energy experience". Never use: quintessentially, sophisticated, elegant, effervescent, utterly, iconic, premium, artisan, indulgent, luxurious, elevates, sensation, pinnacle.
- No empty hype adjectives (thrilling, exhilarating, unmissable, incredible) and no section labels ("Practical information includes", "Food and drink play a part"). Just say it plainly.
- Write for someone who has never been to a pub night: no in-jokes and no assumed knowledge. Drinking is never the price of entry.
- Don't over-explain and don't repeat yourself. Don't lead with Heathrow or airport talk: name the location plainly and only mention Heathrow if it genuinely helps.
- Every claim must trace to FACTS_JSON or VENUE_CONTEXT. If neither supports it, drop it.
- UK English throughout. No em dashes: use commas, full stops or brackets. No markdown (no **, *, _, #, [](), or - bullets). No raw URLs in prose.

Aim for this tone:
"Music Bingo is back at The Anchor for another loud, funny, feel-good night out. Expect big tunes, plenty of singing, loads of laughs and a room full of people getting involved. Bring your mates, book your seats and get ready for a proper night at your local."

Never write like this (posh, hyped, padded):
"Music Bingo at The Anchor is set to be an exciting event filled with entertainment, promising a lively atmosphere and guaranteeing memorable moments for everyone."`

export const FIELD_RULES = `FIELD RULES:

metaTitle: 20-40 characters. Include the primary keyword. Do NOT append " | The Anchor" or any venue suffix; the site adds that automatically.

metaDescription: one or two sentences, 20-26 words in total (roughly 120-155 characters), no sentence over 25 words. Put the primary keyword in the first clause and end with a call to action.

shortDescription: 1-2 sentences, 22-45 words (roughly 130-280 characters). Punchy summary for listings and cards. No markdown. No URLs.

longDescription: 5-6 short paragraphs separated by double newlines (\\n\\n), around 320-420 words total. Short sentences. Lead with why they'll want to come, then the facts. Every sentence earns its place: concise and punchy beats long and waffly, so if you are repeating yourself or padding, stop.
  Paragraph 1: hook them. What the night is and why it is a good time, plus the event name, date and time. Work a primary keyword in naturally.
  Paragraph 2: what actually happens on the night: the format, the rounds, the music, whatever the facts say.
  Paragraph 3: the host or performer and what they bring.
  Paragraph 4: drinks and the feel of the room, using VENUE_CONTEXT. Mention food only when FACTS_JSON.kitchen_service confirms the event overlaps kitchen hours. When it does, say the full menu is available and state when service ends. Never present pizza as the only food available. If the kitchen is closed or the event does not overlap its hours, do not claim food is available.
  Paragraph 5: the practical bits, price, capacity and when to arrive. For booking, point at the booking form on this page as the way to reserve, with the phone number as a fallback for anyone who would rather call. Do not invite walk-ins on a paid event and never suggest turning up on spec instead of booking: the page carries a booking form directly below this copy and telling people to pop in undercuts it.
  Paragraph 6: where to find us: Stanwell Moor, parking, nearby areas. Mention Heathrow only if it genuinely adds something.
  Write it the way you'd tell a regular. No section labels, no posh words, no padding.

highlights: 3-5 specific bullet points. Each must be unique and fact-based, not generic.

slug: URL-friendly (lowercase, alphanumeric, hyphens only). The code will override this with a deterministic slug, but suggest one incorporating the primary keyword and date.

imageAltText: write one plain descriptive sentence of 14-26 words (roughly 90-160 characters) describing the event scene. Include the primary keyword. Do not start with "image of" or "photo of".

faqs: 3-5 FAQ pairs.
  Questions: 8-18 words each.
  Answers: 30-70 words each.
  Must cover: logistics (when/where), experience (what to expect), pricing/value, local access (transport/parking).
  Answer with specific facts, not marketing language.

cancellationPolicy: Will be overridden by code; return any reasonable value.

accessibilityNotes: Will be overridden by code; return any reasonable value.

keywords: provide 6-10 keywords in the array. Include the provided primary, secondary, and local keywords, then add specific related ones (performer name, event type, nearby area). The code merges and caps at 10.`

export const KEYWORD_RULES = `KEYWORD RULES: keep them natural, never at the cost of the voice.
- Work a primary keyword into the meta title, the meta description (first clause), the first paragraph, the image alt text and the slug.
- Let secondary keywords appear naturally in the body where they fit.
- Local terms (keywords.local in FACTS_JSON) should appear once in the location paragraph if they read naturally, but do not force them, and do not lead with Heathrow or airport talk. A clear, friendly mention of where the pub is matters more than an exact keyword.
- Never keyword-stuff. If a keyword would make a sentence sound robotic, leave it out.`

// ── Dynamic builders ────────────────────────────────────────

export function buildFactsJson(facts: EventSeoFacts): string {
  // Build a concise object omitting null/empty fields
  const obj: Record<string, unknown> = {}

  obj.name = facts.name
  if (facts.date) obj.date = facts.date
  if (facts.time) obj.time = facts.time
  if (facts.endTime) obj.end_time = facts.endTime
  if (facts.categoryName) obj.category = facts.categoryName
  if (facts.capacity != null) obj.capacity = facts.capacity
  if (facts.pricingLabel) obj.pricing = facts.pricingLabel
  if (facts.performerName) obj.performer_name = facts.performerName
  if (facts.performerType) obj.performer_type = facts.performerType
  obj.booking_url_present = facts.bookingUrlPresent
  if (facts.brief) obj.brief = facts.brief
  if (facts.kitchenService) obj.kitchen_service = facts.kitchenService
  obj.is_free = facts.isFree

  // Existing content: only non-empty fields
  const existing: Record<string, unknown> = {}
  if (facts.existingContent.metaTitle) existing.meta_title = facts.existingContent.metaTitle
  if (facts.existingContent.metaDescription) existing.meta_description = facts.existingContent.metaDescription
  if (facts.existingContent.shortDescription) existing.short_description = facts.existingContent.shortDescription
  if (facts.existingContent.longDescription) existing.long_description = facts.existingContent.longDescription
  if (facts.existingContent.highlights.length > 0) existing.highlights = facts.existingContent.highlights
  if (facts.existingContent.keywords.length > 0) existing.keywords = facts.existingContent.keywords
  if (Object.keys(existing).length > 0) obj.existing_content = existing

  // Keywords
  const kw: Record<string, string[]> = {}
  if (facts.keywords.primary.length > 0) kw.primary = facts.keywords.primary
  if (facts.keywords.secondary.length > 0) kw.secondary = facts.keywords.secondary
  if (facts.keywords.local.length > 0) kw.local = facts.keywords.local
  if (Object.keys(kw).length > 0) obj.keywords = kw

  // Venue summary
  obj.venue = {
    name: facts.venue.name,
    area: facts.venue.area,
    county: facts.venue.county,
    postcode: facts.venue.postcode,
    phone: facts.venue.phone,
  }

  return JSON.stringify(obj, null, 2)
}

export function buildGenerationMessages(
  facts: EventSeoFacts
): Array<{ role: 'system' | 'user'; content: string }> {
  const userContent = [
    ANCHOR_VENUE_CONTEXT_PROMPT,
    '',
    OUTPUT_RUBRIC,
    '',
    FIELD_RULES,
    '',
    KEYWORD_RULES,
    '',
    'Return a single JSON object with keys: metaTitle, metaDescription, shortDescription, longDescription, highlights (string[]), keywords (string[]), slug, imageAltText, faqs ({question, answer}[]), cancellationPolicy, accessibilityNotes. Use "" for missing string values.',
    '',
    'FACTS_JSON:',
    buildFactsJson(facts),
  ].join('\n')

  return [
    { role: 'system', content: SYSTEM_ROLE },
    { role: 'user', content: userContent },
  ]
}

export function buildRepairMessages(
  facts: EventSeoFacts,
  failedDraft: Record<string, unknown>,
  issues: Array<{ code: string; severity: string; field?: string; message: string }>
): Array<{ role: 'system' | 'user'; content: string }> {
  const issueList = issues
    .map((i) => `- [${i.severity}] ${i.field ? `${i.field}: ` : ''}${i.message} (${i.code})`)
    .join('\n')

  // Only act on a blocking word-count issue (too long, or genuinely too thin).
  // A "little short" warning must NOT trigger padding; concise copy is preferred.
  const blockingWordCount = issues.find(
    (i) => i.code === 'long_desc_word_count' && i.severity !== 'warning',
  )
  const currentWordCount = String(failedDraft.longDescription ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

  const lengthDirective = blockingWordCount
    ? [
        '',
        currentWordCount > 700
          ? `LENGTH: the long description is ${currentWordCount} words, which is too long. Tighten it to under 700 by cutting anything repetitive or padded. Keep the voice punchy.`
          : `LENGTH: the long description is only ${currentWordCount} words, which is too thin to be useful. Add real, specific detail from FACTS_JSON and VENUE_CONTEXT (the format, the host, drinks, kitchen service when confirmed, parking) to reach about 280-360 words. Keep sentences short and human; never pad with filler or hype.`,
      ].join('\n')
    : ''

  const hasKeywordIssue = issues.some(
    (i) => i.code === 'keywords_primary' || i.code === 'meta_desc_keyword' || i.code === 'keywords_count',
  )
  const keywordDirective = hasKeywordIssue
    ? [
        '',
        'KEYWORDS: make sure each primary keyword appears in the meta description first clause, and that the keywords array has 6-10 entries including the provided ones. Keep it natural: do not stuff keywords or let them spoil the voice.',
      ].join('\n')
    : ''

  const userContent = [
    ANCHOR_VENUE_CONTEXT_PROMPT,
    '',
    OUTPUT_RUBRIC,
    '',
    FIELD_RULES,
    '',
    KEYWORD_RULES,
    '',
    'FACTS_JSON:',
    buildFactsJson(facts),
    '',
    'FAILED DRAFT:',
    JSON.stringify(failedDraft, null, 2),
    '',
    'VALIDATION ISSUES:',
    issueList,
    lengthDirective,
    keywordDirective,
    '',
    'Repair the draft so it passes every validation issue listed above.',
    'Preserve accurate facts. Do not introduce facts outside FACTS_JSON or VENUE_CONTEXT.',
    'Return the complete JSON object, not a patch.',
    'Focus on fixing the specific issues listed. Do not rewrite content that already passes.',
  ].join('\n')

  return [
    { role: 'system', content: SYSTEM_ROLE },
    { role: 'user', content: userContent },
  ]
}
