// ──────────────────────────────────────────────────────────────
// Event SEO prompt sections and message builders.
//
// Design: static text appears first in every message array so
// OpenAI prompt caching can hit on repeated calls. Dynamic
// facts/JSON is always appended last.
// ──────────────────────────────────────────────────────────────

import type { EventSeoFacts } from './generation'
import { ANCHOR_VENUE_CONTEXT } from './generation'
import { EVENT_SEO_LIMITS as L, HOME_PLACE, NEARBY_PLACES } from './limits'
import { eventDateLabels, eventTime12h } from './event-dates'
import { copyableKeyword, focusPhrase } from './keyword-match'

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
- Sound like these: "a proper night out", "big laughs", "bring your mates", "get involved", "sing along", "loads of fun", "a brilliant night at your local".
- The page stays on the website after the night, so the short and long descriptions must still read true the morning after. No exclamation marks in them. Never write "join" in any sense, even a factual one ("we can put you with another team", not "join another team"), and never "get ready", "book your", "book now", "come along", "come down", "don't miss", "grab your", "get your tickets", "secure your", "coming up", "see you there" or "this Friday". The warmth comes from what happens on the night, not from commands. State booking and arrival as facts ("Booking is through the form on this page").
- Never sound posh, corporate or salesy. Banned words and phrases, and anything close to them: "premium experience", "elevated entertainment", "curated evening", "sophisticated event", "unforgettable journey/evening", "exclusive night", "hidden gem", "nestled", "boasts", "great atmosphere", "vibrant atmosphere", "something for everyone", "look no further", "a must-visit", "a night to remember", "set to be", "promises to", "guarantees", "filled with entertainment", "plays a vital role", "high-energy experience". Never use: quintessentially, sophisticated, elegant, effervescent, utterly, iconic, premium, artisan, indulgent, luxurious, elevates, sensation, pinnacle.
- No empty hype adjectives (thrilling, exhilarating, unmissable, incredible) and no section labels ("Practical information includes", "Food and drink play a part"). Just say it plainly.
- Write for someone who has never been to a pub night: no in-jokes and no assumed knowledge. Drinking is never the price of entry.
- Don't over-explain and don't repeat yourself. Don't lead with Heathrow or airport talk: name the location plainly and only mention Heathrow if it genuinely helps.
- Name a performer by first name only: "Nikki hosts", never the surname.
- A prize that depends on something (a projected Snowball, a jackpot built from book sales, a prize only some people can win) goes only in the long description, with its condition and who can win it exactly as FACTS_JSON.brief states them. Never put it in the meta description, the short description or the highlights.
- Prices come only from FACTS_JSON. If the brief gives no price for an extra (a dabber, a drink), do not give one.
- Every claim must trace to FACTS_JSON or VENUE_CONTEXT. If neither supports it, drop it.
- UK English throughout. No em dashes: use commas, full stops or brackets. No markdown (no **, *, _, #, [](), or - bullets). No raw URLs in prose.

Aim for this tone:
"Christmas music bingo at The Anchor, Stanwell Moor, on Friday 11 December 2026: two rounds of festive number ones, plenty of singing and a room full of people getting involved. Nikki hosts, and Christmas jumpers earn extra points."

Never write like this (posh, hyped, padded):
"Music Bingo at The Anchor is set to be an exciting event filled with entertainment, promising a lively atmosphere and guaranteeing memorable moments for everyone."`

export const FIELD_RULES = `FIELD RULES:

metaTitle: a short name for the night that names the format, ${L.metaTitleChars.max} characters or fewer ("Christmas Music Bingo"). NEVER a date, a day or a month: the website adds the date itself, and a stored date loses its year after the night. Do not add " | The Anchor" or name the pub; the site adds that.

metaDescription: ${L.metaDescriptionChars.min} to ${L.metaDescriptionChars.max} characters, in this order: what it is (with the focus phrase), weekday and date (copy FACTS_JSON.date_long or date_short), time, place ("at The Anchor, Stanwell Moor"), price, then one action. No exclamation mark. Only this field may end with an action, because the website replaces it after the night.

shortDescription: ${L.shortDescriptionChars.min} to ${L.shortDescriptionChars.max} characters. One statement of fact that still reads true after the night, naming the format, the place and the full date ("Two rounds of Christmas music bingo with Nikki at The Anchor, Stanwell Moor, on Friday 11 December 2026."). No "join us", no "book", no exclamation mark.

longDescription: ${L.longDescriptionParagraphs.min} to ${L.longDescriptionParagraphs.max} short paragraphs separated by a blank line (\\n\\n), ${L.longDescriptionWords.min} to ${L.longDescriptionWords.max} words in total. Every sentence must still read true after the night.
  Paragraph 1: the factual summary. Event name, the focus phrase word for word, the format, weekday and full date with the year (copy FACTS_JSON.date_long), the start time (copy FACTS_JSON.time_12h), the place (The Anchor, ${HOME_PLACE}) and the price.
  Paragraphs 2 and 3: what happens on the night and who hosts, in the house voice. Name the format's hub in plain words once (for example "our monthly music bingo nights").
  Then booking and arrival, stated as fact: "Booking is through the form on this page, or by phone on ${ANCHOR_VENUE_CONTEXT.phone}." and how entry is paid. Mention food only when FACTS_JSON.kitchen_service confirms the event overlaps kitchen hours; then say the full menu is available and when service ends. Never present pizza as the only food. Never suggest turning up on spec instead of booking on a paid event.
  Last paragraph: where the pub is. Name ${HOME_PLACE} and one nearby place (${NEARBY_PLACES.join(', ')}), using the local terms from FACTS_JSON.keywords.local where true, plus parking. Mention Heathrow only if it helps.
  No section labels, no posh words, no padding.

highlights: ${L.highlightsCount.min} to ${L.highlightsCount.max} items, each ${L.highlightWords.min} to ${L.highlightWords.max} words, in sentence case (a capital first letter). Specific facts, not generic. No commas inside a highlight and no full stop at the end.

slug: return "". Code sets the address.

imageAltText: ${L.imageAltTextChars.min} to ${L.imageAltTextChars.max} characters describing what the picture shows for someone who cannot see it, naming the event. No keyword rule. Do not start with "image of" or "photo of".

faqs: ${L.faqCount.min} to ${L.faqCount.max} pairs. Answers ${L.faqAnswerWords.min} to ${L.faqAnswerWords.max} words, each adding something the long description does not say (do I need to know the music, can I come on my own, are under 18s welcome, how long it runs, how to pay). Include:
  one question phrased the way someone would search, containing the focus phrase word for word ("Is there Christmas music bingo near Staines in December?"),
  one on who can come,
  one on getting there.
  At most one question about booking, paying or cancelling: the website hides those after the night.

cancellationPolicy: overwritten by code; return "".

accessibilityNotes: overwritten by code; return "".`

export const KEYWORD_RULES = `KEYWORD RULES: an event page holds its own dated, themed search terms; the hub pages hold the general ones. Keep keywords natural, never at the cost of the voice.
- The focus phrase is FACTS_JSON.keywords.focus. Use it word for word, as a whole phrase, in the meta description, the first paragraph and one FAQ question. Nowhere else needs it.
- "Word for word" means the same words in the same order, not the same capitals. Capitalise it as the sentence and UK English need: "Christmas music bingo" at the start of a sentence, "Christmas" and place names always with a capital, so "a night of Christmas music bingo", never "christmas music bingo" mid-sentence.
- Supporting terms (FACTS_JSON.keywords.supporting): use at least ${L.supportingInBody} in the long description where they are true and read naturally.
- Local terms (FACTS_JSON.keywords.local) are place names. Use them in the location paragraph and one FAQ.
- Never write "near me" in copy: place names do that job.
- Never keyword-stuff. If a keyword would make a sentence sound robotic, leave it out.`

// ── Dynamic builders ────────────────────────────────────────

/**
 * The brief is typed in the drawer and often pasted from a document, headings and bold included.
 * The model copied that markdown straight into the copy, so it is taken out before sending.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The copy already on the event, shown to the model as a draft to improve, never as facts.
 * It used to sit inside FACTS_JSON, so a wrong price or a retired claim in an old draft was
 * read as a fact and written straight back. Null when there is nothing on the event yet.
 */
export function buildPreviousDraftBlock(facts: EventSeoFacts): string | null {
  const existing: Record<string, unknown> = {}
  if (facts.existingContent.metaTitle) existing.meta_title = facts.existingContent.metaTitle
  if (facts.existingContent.metaDescription) existing.meta_description = facts.existingContent.metaDescription
  if (facts.existingContent.shortDescription) existing.short_description = facts.existingContent.shortDescription
  if (facts.existingContent.longDescription) existing.long_description = facts.existingContent.longDescription
  if (facts.existingContent.highlights.length > 0) existing.highlights = facts.existingContent.highlights
  if (Object.keys(existing).length === 0) return null
  return [
    'PREVIOUS DRAFT (not a source of facts):',
    'This is the copy currently on the event. It may be out of date or wrong. Reuse its wording only where FACTS_JSON or VENUE_CONTEXT supports it; where they differ, FACTS_JSON and VENUE_CONTEXT win. Never take a date, time, price, prize, performer or claim from it.',
    JSON.stringify(existing, null, 2),
  ].join('\n')
}

export function buildFactsJson(facts: EventSeoFacts): string {
  // Build a concise object omitting null/empty fields
  const obj: Record<string, unknown> = {}

  obj.name = facts.name
  // Dates and times are worked out here on the London clock. The model copies them and never
  // works out a weekday itself (32 texts once said Thursday for a Friday).
  const dates = eventDateLabels(facts.date)
  if (dates) {
    obj.date_long = dates.dateLong
    obj.date_short = dates.dateShort
  }
  const start = eventTime12h(facts.time)
  if (start) obj.time_12h = start
  const end = eventTime12h(facts.endTime)
  if (end) obj.end_time_12h = end
  if (facts.categoryName) obj.category = facts.categoryName
  if (facts.capacity != null) obj.capacity = facts.capacity
  if (facts.pricingLabel) obj.pricing = facts.pricingLabel
  if (facts.performerName) obj.performer_name = facts.performerName
  if (facts.performerType) obj.performer_type = facts.performerType
  obj.booking_url_present = facts.bookingUrlPresent
  const brief = facts.brief ? stripMarkdown(facts.brief) : ''
  if (brief) obj.brief = brief
  if (facts.kitchenService) obj.kitchen_service = facts.kitchenService
  obj.is_free = facts.isFree

  // Keywords: focus is one phrase ("near me" taken off), supporting and local are lists.
  const kw: Record<string, unknown> = {}
  const focus = focusPhrase(facts.keywords.primary)
  if (focus) kw.focus = focus
  const variants = facts.keywords.primary
    .map(copyableKeyword)
    .filter((k) => k && k !== focus)
    .slice(0, L.focusKeywords.max - 1)
  if (variants.length > 0) kw.focus_variants = variants
  const supporting = facts.keywords.secondary.map(copyableKeyword).filter(Boolean).slice(0, L.supportingKeywords.max)
  if (supporting.length > 0) kw.supporting = supporting
  const local = facts.keywords.local.map(copyableKeyword).filter(Boolean).slice(0, L.localKeywords.max)
  if (local.length > 0) kw.local = local
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

function previousDraftLines(facts: EventSeoFacts): string[] {
  const block = buildPreviousDraftBlock(facts)
  return block ? [block, ''] : []
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
    'Return a single JSON object with keys: metaTitle, metaDescription, shortDescription, longDescription, highlights (string[]), slug, imageAltText, faqs ({question, answer}[]), cancellationPolicy, accessibilityNotes. Use "" for missing string values.',
    '',
    ...previousDraftLines(facts),
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

  // Only act on a blocking word-count issue. A near miss is a warning and must not trigger
  // padding: concise copy is preferred.
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
        currentWordCount > L.longDescriptionWords.max
          ? `LENGTH: the long description is ${currentWordCount} words. Tighten it to ${L.longDescriptionWords.min} to ${L.longDescriptionWords.max} by cutting anything repetitive or padded.`
          : `LENGTH: the long description is only ${currentWordCount} words. Add real, specific detail from FACTS_JSON and VENUE_CONTEXT (the format, the host, kitchen service when confirmed, parking) to reach ${L.longDescriptionWords.min} to ${L.longDescriptionWords.max} words. Never pad with filler or hype.`,
      ].join('\n')
    : ''

  const focus = focusPhrase(facts.keywords.primary)
  const hasFocusIssue = issues.some((i) => ['meta_desc_focus', 'first_para_focus', 'faq_focus'].includes(i.code))
  const keywordDirective = hasFocusIssue && focus
    ? [
        '',
        `FOCUS PHRASE: write "${focus}" word for word, as a whole phrase, in the meta description, the first paragraph and one FAQ question. Same words in the same order; capitalise them as the sentence needs. Keep the sentence natural around it.`,
      ].join('\n')
    : ''

  const invitationDirective = issues.some((i) => i.code === 'reads_as_invitation')
    ? [
        '',
        'AFTER THE NIGHT: the short and long descriptions must read true the morning after the event. Remove every exclamation mark and every invitation ("join", "get ready", "book your", "come along", "don\'t miss", "see you there"). Say what happens and how booking works as plain statements.',
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
    invitationDirective,
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
