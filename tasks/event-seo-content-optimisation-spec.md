# Event SEO Content Optimisation Spec (v2)

## Problem Statement

The AI-generated event content for brand website landing pages is underperforming on SEO health checks (scoring 55/100) and is unlikely to rank well due to:

1. Long descriptions are ~190 words — too short for readers and search engines
2. Meta titles exceed 60 characters — no prompt limit, and the brand site appends "| The Anchor Stanwell Moor" (~26 chars) pushing to ~88
3. System prompt says "keep outputs concise" — directly contradicts the 300+ word requirement
4. Accessibility notes are scored but never generated or applied
5. SEO health checker only validates primary keywords — secondary and local SEO keywords are never verified
6. No post-generation validation — we rely entirely on the LLM following instructions
7. Keyword matching uses naive substring (`containsKeyword`) which false-passes partial words
8. The prompt asks the AI to invent venue facts (accessibility, directions) it cannot know

## Success Criteria

- AI-generated content deterministically passes post-generation validation before being returned
- Long descriptions are 450+ words with 4+ paragraph breaks
- Meta titles under 40 characters (composed title with suffix under 66 chars)
- All three keyword tiers verifiably integrated (min 2 matches per non-empty tier)
- SEO health score 85+ after regeneration
- Unit tests cover scoring logic edge cases

## Scope

### In scope

| File | Role |
|------|------|
| `src/app/actions/event-content.ts` | AI prompt, schema, post-generation validation |
| `src/components/features/events/SeoHealthIndicator.tsx` | Health checker logic and scoring |
| `src/components/features/events/EventFormGrouped.tsx` | Wire new props, apply accessibilityNotes, align UI limits |

### Out of scope
- Brand website rendering (the-anchor.pub)
- Keyword-plan skill (no changes needed)
- Database schema changes
- New fields or UI components

---

## Change 1: Fix System Prompt Conflict

**File:** `src/app/actions/event-content.ts`
**Line:** 247

**Current:**
```
Keep outputs concise, engaging, and aligned with UK English.
```

**Proposed:**
```
Write detailed, engaging content aligned with UK English. Longer descriptions rank better and help customers decide — never sacrifice depth for brevity.
```

**Rationale:** "Concise" directly contradicts the word count target. The LLM splits the difference and produces ~190 words.

---

## Change 2: Add Venue Context Block

**File:** `src/app/actions/event-content.ts`
**Location:** User message content, add before the event summary JSON

**Add this fixed block:**
```
VENUE CONTEXT (use these verified facts only — do not invent others):
- Venue name: The Anchor
- Address: Horton Road, Stanwell Moor, Surrey, TW19 6AQ
- Phone: 01753 682707
- Area: near Heathrow Airport, bordering West Drayton and Staines-upon-Thames
- Transport: 7 minutes from Heathrow Terminal 5, free parking (20 spaces)
- Ground-floor venue with step-free access from car park
- Dog and family friendly
- Kitchen serves pizza on event nights
```

**Rationale:** The current prompt says "do not invent venue, price, capacity details" but then asks for local context paragraphs and accessibility notes. The AI either invents or produces vague filler. Providing verified venue facts gives the AI real material to work with, and means accessibility/directions claims are accurate.

---

## Change 3: Meta Title — Align Prompt, Checker, and UI

The brand website composes the final `<title>` as: `{metaTitle} | The Anchor Stanwell Moor` (suffix = 26 chars including pipe and spaces). Google displays approximately 55-60 characters of a page title. To keep the composed title under 66 characters (allowing some flexibility in Google's display):

**Target: generated meta title under 40 characters.**

### 3a. Prompt instruction

**File:** `src/app/actions/event-content.ts`
**Location:** User message, add before the meta description instruction

```
- Keep the meta title UNDER 40 characters. The website appends "| The Anchor Stanwell Moor" automatically. Front-load the primary keyword. Example: "Live Music Tonight — Jessica Lovelock" (37 chars).
```

### 3b. Health checker

**File:** `src/components/features/events/SeoHealthIndicator.tsx`
**Change:** Update the meta title check from 60 to 40 chars.

```typescript
{
  label: 'Meta title present and under 40 chars',
  passed: !!metaTitle && metaTitle.length > 0 && metaTitle.length <= 40,
  points: 8,
}
```

### 3c. Form UI

**File:** `src/components/features/events/EventFormGrouped.tsx`
**Line:** 971

**Current:**
```tsx
maxLength={60}
```
```tsx
<p className="mt-1 text-xs text-gray-500">{metaTitle.length}/60 characters</p>
```

**Proposed:**
```tsx
maxLength={40}
```
```tsx
<p className="mt-1 text-xs text-gray-500">{metaTitle.length}/40 characters (site appends location suffix)</p>
```

**Rationale:** All three layers (prompt, checker, UI) must agree on the same limit. 40 chars + 26 char suffix = 66 chars total, which is within Google's typical display range.

---

## Change 4: Increase Long Description Target and Add Structure

**File:** `src/app/actions/event-content.ts`
**Location:** User message, long description instruction (around line 259)

**Current:**
```
- **Long Description SEO**: Generate a comprehensive description (300+ words) formatted in plain text (no markdown) but structured logically with paragraphs. Focus on ranking for relevant keywords by covering the atmosphere, what to expect, and why it is a must-attend.
```

**Proposed:**
```
- **Long Description SEO**: Generate a rich, informative description of MINIMUM 450 words (aim for 500) formatted in plain text (no markdown). Structure as 5-6 distinct paragraphs separated by double newlines (\n\n):
  1. Opening hook with event name, date, and primary keywords (70-80 words)
  2. What to expect — the experience, sounds, energy, and vibe (80-90 words)
  3. Performer or entertainment details — who they are, their style, why they are worth seeing (80-90 words)
  4. Food, drink, and venue atmosphere — use the VENUE CONTEXT facts above (70-80 words)
  5. Practical info and booking — why to reserve, capacity hints, pricing context (70-80 words)
  6. Local context — use VENUE CONTEXT location facts, transport links, nearby areas (70-80 words)
  Each paragraph must be a complete thought. Do NOT write one long wall of text. No single paragraph should exceed 120 words.
```

**Rationale:** Explicit paragraph structure with per-section word counts prevents single-block output. Referencing VENUE CONTEXT for paras 4 and 6 ensures facts are grounded.

---

## Change 5: Add Accessibility Notes to Schema, Prompt, and Form Handler

**File:** `src/app/actions/event-content.ts`

### 5a. Prompt

Add after the cancellation policy section:
```
ACCESSIBILITY NOTES: Using ONLY the venue facts from VENUE CONTEXT above, write 1-2 sentences about accessibility. Mention step-free access and the phone number for specific requirements. Do NOT claim features not listed in VENUE CONTEXT. Example: "The Anchor is a ground-floor venue with step-free access from the car park. Please call 01753 682707 to discuss any specific accessibility requirements."
```

### 5b. JSON schema

Add to schema properties:
```typescript
accessibilityNotes: { type: ['string', 'null'] },
```

Add to `required` array:
```typescript
required: ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription', 'highlights', 'keywords', 'slug', 'imageAltText', 'faqs', 'cancellationPolicy', 'accessibilityNotes'],
```

### 5c. Add `strict: true` to the JSON schema config

**Current (line 298):**
```typescript
json_schema: {
  name: 'event_seo_content',
  schema: {
```

**Proposed:**
```typescript
json_schema: {
  name: 'event_seo_content',
  strict: true,
  schema: {
```

### 5d. Parsed type and return mapping

Add to the parsed type:
```typescript
accessibilityNotes: string | null
```

Add to the return data:
```typescript
accessibilityNotes: parsed.accessibilityNotes || null,
```

Add to `EventSeoContentResult` data type:
```typescript
accessibilityNotes: string | null
```

### 5e. Form handler — apply accessibilityNotes

**File:** `src/components/features/events/EventFormGrouped.tsx`
**Line:** ~450 (after `setCancellationPolicy`)

**Add:**
```typescript
if (result.data.accessibilityNotes) setAccessibilityNotes(result.data.accessibilityNotes)
```

**Rationale:** Without this line, the AI generates accessibility notes but they are silently discarded and never applied to the form state.

---

## Change 6: Increase max_tokens

**File:** `src/app/actions/event-content.ts`
**Line:** 343

**Current:**
```typescript
max_tokens: 3500,
```

**Proposed:**
```typescript
max_tokens: 4500,
```

**Rationale:** 450-500 word long description + all other fields + JSON structure overhead needs ~2200-2800 tokens. 4500 provides comfortable headroom.

---

## Change 7: Post-Generation Validation

**File:** `src/app/actions/event-content.ts`
**Location:** After JSON parsing (around line 388), before the return statement

Add a deterministic validation layer. If any critical check fails, retry once with corrective feedback. If the retry also fails, return the content with a warning toast rather than failing entirely.

### Validation checks

```typescript
interface ValidationResult {
  passed: boolean
  issues: string[]
}

function validateGeneratedContent(
  parsed: ParsedContent,
  input: EventSeoContentInput
): ValidationResult {
  const issues: string[] = []

  // Meta title length
  if (parsed.metaTitle && parsed.metaTitle.length > 40) {
    issues.push(`Meta title is ${parsed.metaTitle.length} chars (max 40)`)
  }

  // Meta description length
  if (parsed.metaDescription && parsed.metaDescription.length > 155) {
    issues.push(`Meta description is ${parsed.metaDescription.length} chars (max 155)`)
  }

  // Long description word count
  const wordCount = parsed.longDescription
    ? parsed.longDescription.trim().split(/\s+/).filter(Boolean).length
    : 0
  if (wordCount < 400) {
    issues.push(`Long description is ${wordCount} words (min 400)`)
  }

  // Paragraph count (split on double newline)
  const paragraphCount = parsed.longDescription
    ? parsed.longDescription.split(/\n\n+/).filter(p => p.trim().length > 0).length
    : 0
  if (paragraphCount < 4) {
    issues.push(`Long description has ${paragraphCount} paragraphs (min 4)`)
  }

  // FAQ count
  const validFaqs = (parsed.faqs || []).filter(
    f => f.question?.trim().length > 0 && f.answer?.trim().length > 10
  )
  if (validFaqs.length < 3) {
    issues.push(`Only ${validFaqs.length} valid FAQs (min 3)`)
  }

  // Required non-empty fields
  const requiredFields: (keyof ParsedContent)[] = [
    'metaTitle', 'metaDescription', 'shortDescription', 'longDescription',
    'slug', 'imageAltText'
  ]
  for (const field of requiredFields) {
    if (!parsed[field] || (typeof parsed[field] === 'string' && !parsed[field].trim())) {
      issues.push(`${field} is empty`)
    }
  }

  return { passed: issues.length === 0, issues }
}
```

### Retry logic

After initial parse, run validation. If it fails, make one retry call with the issues appended as corrective feedback:

```typescript
const validation = validateGeneratedContent(parsed, mergedInput)

if (!validation.passed) {
  // Retry once with corrective feedback
  const retryResponse = await callOpenAI(baseUrl, apiKey, {
    ...originalBody,
    messages: [
      ...originalBody.messages,
      { role: 'assistant', content: JSON.stringify(parsed) },
      {
        role: 'user',
        content: `The response has these issues — fix them and return the complete JSON again:\n${validation.issues.map(i => `- ${i}`).join('\n')}`
      },
    ],
  })

  // Parse retry, use it if it passes validation, otherwise fall back to original
  const retryParsed = parseResponse(retryResponse)
  if (retryParsed) {
    const retryValidation = validateGeneratedContent(retryParsed, mergedInput)
    if (retryValidation.passed) {
      parsed = retryParsed
    }
    // If retry also fails, use the better of the two (or just the original)
  }
}
```

**Rationale:** Prompt instructions are suggestions; validation is deterministic. A single retry with specific corrective feedback fixes most issues (typically meta title too long or word count too low). If both attempts fail, we still return the content — a slightly short description is better than no content.

---

## Change 8: Strengthen SeoHealthIndicator

**File:** `src/components/features/events/SeoHealthIndicator.tsx`

### 8a. Fix keyword matching — word boundary matching

Replace the current `containsKeyword` function:

**Current:**
```typescript
function containsKeyword(text: string, keywords: string[]): boolean {
  if (!text || keywords.length === 0) return false
  const lower = text.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}
```

**Proposed:**
```typescript
function containsKeyword(text: string, keywords: string[]): boolean {
  if (!text || keywords.length === 0) return false
  const normalised = text.toLowerCase().replace(/-/g, ' ')
  return keywords.some(kw => {
    const normKw = kw.toLowerCase().replace(/-/g, ' ').trim()
    if (!normKw) return false
    // Escape regex special chars, then check word boundaries
    const escaped = normKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(?:^|[\\s,.!?;:'"()])${escaped}(?:[\\s,.!?;:'"()]|$)`, 'i')
    return regex.test(normalised)
  })
}
```

This handles:
- Hyphen/space equivalence ("live-music" matches "live music")
- Word boundary matching (prevents "art" matching "start")
- Punctuation boundaries ("live music," or "live music.")
- Case insensitive

### 8b. Add proportional keyword coverage scoring

Replace the `some()` approach with a coverage function:

```typescript
function keywordCoverage(text: string, keywords: string[], minRequired: number): boolean {
  if (keywords.length === 0) return true // no keywords configured = pass
  const matches = keywords.filter(kw => containsKeyword(text, [kw])).length
  return matches >= Math.min(minRequired, keywords.length)
}
```

### 8c. Add new props

```typescript
interface SeoHealthProps {
  metaTitle: string
  metaDescription: string
  shortDescription: string
  longDescription: string
  slug: string
  highlights: string
  primaryKeywords: string[]
  secondaryKeywords: string[]
  localSeoKeywords: string[]
  imageAltText: string
  faqs: { question: string; answer: string }[]  // Changed from faqCount to full FAQ data
  accessibilityNotes: string
}
```

Note: `faqCount: number` changes to `faqs: { question: string; answer: string }[]` to enable content validation.

### 8d. Revised scoring (100 points total)

| # | Check | Points | Logic |
|---|-------|--------|-------|
| 1 | Meta title present and under 40 chars | 8 | `metaTitle.length > 0 && metaTitle.length <= 40` |
| 2 | Meta description present and under 155 chars | 7 | `metaDescription.length > 0 && metaDescription.length <= 155` |
| 3 | Primary keyword in meta title | 8 | `containsKeyword(metaTitle, primaryKeywords)` |
| 4 | Primary keyword in meta description | 7 | `containsKeyword(metaDescription, primaryKeywords)` |
| 5 | Short description 120-300 chars | 5 | `length >= 120 && length <= 300` |
| 6 | Long description 450+ words | 10 | `countWords(longDescription) >= 450` |
| 7 | Long description has 4+ paragraphs | 5 | `longDescription.split(/\n\n+/).filter(Boolean).length >= 4` |
| 8 | Primary keyword in first 100 words | 8 | `containsKeyword(getFirst100Words(longDescription), primaryKeywords)` |
| 9 | Secondary keywords in long description (2+ matches) | 8 | `keywordCoverage(longDescription, secondaryKeywords, 2)` |
| 10 | Local SEO keywords in long description (2+ matches) | 7 | `keywordCoverage(longDescription, localSeoKeywords, 2)` |
| 11 | At least 3 FAQs with substantive answers | 7 | `validFaqs >= 3` where valid = question non-empty AND answer >= 20 chars |
| 12 | Image alt text contains primary keyword | 5 | `containsKeyword(imageAltText, primaryKeywords)` |
| 13 | Highlights 3+ items | 5 | `highlightItems.length >= 3` |
| 14 | Slug contains primary keyword | 5 | `containsKeyword(slug.replace(/-/g, ' '), primaryKeywords)` |
| 15 | Accessibility notes present | 5 | `accessibilityNotes.trim().length > 0` |
| | **Total** | **100** | |

### 8e. FAQ validation logic

```typescript
const validFaqCount = faqs.filter(
  f => f.question?.trim().length > 0 && f.answer?.trim().length >= 20
).length

{
  label: 'At least 3 FAQs with substantive answers',
  passed: validFaqCount >= 3,
  points: 7,
}
```

---

## Change 9: Update EventFormGrouped.tsx

**File:** `src/components/features/events/EventFormGrouped.tsx`

### 9a. Apply accessibilityNotes from AI generation (line ~450)

Add after `setCancellationPolicy`:
```typescript
if (result.data.accessibilityNotes) setAccessibilityNotes(result.data.accessibilityNotes)
```

### 9b. Pass new props to SeoHealthIndicator (line ~1126)

**Current:**
```tsx
<SeoHealthIndicator
  metaTitle={metaTitle}
  metaDescription={metaDescription}
  shortDescription={shortDescription}
  longDescription={longDescription}
  slug={slug}
  highlights={highlights}
  primaryKeywords={parseKeywords(primaryKeywords)}
  imageAltText={imageAltText}
  faqCount={faqs.length}
  accessibilityNotes={accessibilityNotes}
/>
```

**Proposed:**
```tsx
<SeoHealthIndicator
  metaTitle={metaTitle}
  metaDescription={metaDescription}
  shortDescription={shortDescription}
  longDescription={longDescription}
  slug={slug}
  highlights={highlights}
  primaryKeywords={parseKeywords(primaryKeywords)}
  secondaryKeywords={parseKeywords(secondaryKeywords)}
  localSeoKeywords={parseKeywords(localSeoKeywords)}
  imageAltText={imageAltText}
  faqs={faqs.map(f => ({ question: f.question || '', answer: f.answer || '' }))}
  accessibilityNotes={accessibilityNotes}
/>
```

### 9c. Align meta title UI limits (line ~971)

**Current:**
```tsx
maxLength={60}
...
<p className="mt-1 text-xs text-gray-500">{metaTitle.length}/60 characters</p>
```

**Proposed:**
```tsx
maxLength={40}
...
<p className="mt-1 text-xs text-gray-500">{metaTitle.length}/40 characters (site adds location suffix)</p>
```

---

## Implementation Order

1. `event-content.ts` — system prompt fix, venue context block, meta title instruction, long description structure, accessibility notes, strict schema, max_tokens, post-generation validation (Changes 1-7)
2. `SeoHealthIndicator.tsx` — new keyword matching, props, scoring, paragraph/FAQ checks (Change 8)
3. `EventFormGrouped.tsx` — wire new props, apply accessibilityNotes, align UI limits (Change 9)
4. Unit tests for SeoHealthIndicator scoring logic
5. Manual verification — regenerate content for an existing event

## Complexity Score

**3 (M)** — 3 files touched, no database or schema changes. Post-generation validation adds logic complexity but is self-contained.

## Testing Plan

### Unit tests (SeoHealthIndicator)

- [ ] `containsKeyword` with word boundaries: "live music" matches "live music tonight", does NOT match "alive musical"
- [ ] `containsKeyword` hyphen equivalence: "live-music" matches "live music"
- [ ] `keywordCoverage` with 0 configured keywords returns true
- [ ] `keywordCoverage` with 1 configured keyword and minRequired=2 passes with 1 match
- [ ] `keywordCoverage` with 5 configured keywords and minRequired=2 requires at least 2 matches
- [ ] FAQ validation: empty question or answer < 20 chars does not count
- [ ] Paragraph count: text with `\n\n` separators counted correctly
- [ ] Score totals 100 when all checks pass
- [ ] Score handles edge case: all keyword arrays empty (no penalisation)
- [ ] Meta title at exactly 40 chars passes, 41 fails

### Post-generation validation (event-content.ts)

- [ ] Content with meta title > 40 chars triggers retry
- [ ] Content with < 400 words triggers retry
- [ ] Content with < 4 paragraphs triggers retry
- [ ] Content with < 3 valid FAQs triggers retry
- [ ] Retry produces improved content
- [ ] Double-failure returns original content (does not error)

### Integration (manual)

- [ ] Regenerate AI content for Jessica Lovelock event
- [ ] Meta title under 40 chars
- [ ] Long description 450+ words with 5+ paragraphs
- [ ] Accessibility notes generated and applied to form
- [ ] All keyword tiers present in content
- [ ] SEO health score 85+
- [ ] Events with no keywords configured score reasonably (keyword checks pass)
- [ ] `npm run build` and `npm run lint` — zero errors
