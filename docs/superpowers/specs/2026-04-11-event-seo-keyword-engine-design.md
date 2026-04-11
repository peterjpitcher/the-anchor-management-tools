# Event SEO Keyword Engine — Design Spec

## Overview

Optimise the event data published to brand sites by adding a three-tier keyword strategy system and renovating the SEO & Content section of the event edit page. Keywords are manually researched and pasted in by the user, then used as strategic input to AI content generation that produces keyword-aware, E-E-A-T-compliant event page content.

## Goals

1. Enable keyword-driven SEO content generation for every event
2. Add new high-impact content fields (FAQs, social copy, alt text, E-E-A-T signals)
3. Provide an SEO health indicator for content completeness
4. Maintain backwards compatibility with the existing events API and brand site consumption

## Non-Goals

- Per-field regeneration buttons (single generation covers all)
- SERP preview or keyword density analysis tooling
- Automated keyword research within the app
- Changes to the brand site rendering (separate project, out of scope)
- Fixing unrelated existing bugs (except where they directly block this feature)

---

## 1. Keyword Strategy Fields

### Placement

In the **Basic Information** section of the event edit form (`EventFormGrouped.tsx`), immediately after the Event Brief textarea.

### Fields

| Field | Label | Help Text | Storage Column | Type |
|-------|-------|-----------|---------------|------|
| Primary Keywords | Primary Keywords | 1-2 terms. Drives title tag, meta description, slug, first paragraph. | `primary_keywords` | `JSONB DEFAULT '[]'` |
| Secondary Keywords | Secondary Keywords | 3-5 terms. Drives headings, body copy, highlights, FAQ questions. | `secondary_keywords` | `JSONB DEFAULT '[]'` |
| Local SEO Keywords | Local SEO Keywords | 2-4 terms. Drives venue context, FAQ answers, directions copy. | `local_seo_keywords` | `JSONB DEFAULT '[]'` |

### Input Behaviour

- **Textarea** (not single-line input) to accommodate pasted lists
- Accepts both comma-separated and newline-separated entries, and mixed
- Examples of valid input:
  - `pub quiz, quiz night, wednesday pub quiz`
  - `pub quiz\nquiz night\nwednesday pub quiz`
  - `pub quiz, quiz night\nwednesday pub quiz`
- On blur/save: split by commas and newlines, trim whitespace, deduplicate, remove empties
- Display chip/tag count below: "6 keywords entered"
- Visually grouped in a subtle bordered card labelled "Keyword Strategy"

### Keyword Validation

All three keyword fields enforce:
- Maximum 10 items per tier
- Maximum 100 characters per keyword
- Trim whitespace, collapse internal whitespace
- Case-preserved (no forced lowercasing — keywords may include proper nouns)
- Reject HTML tags and control characters
- Deduplicate within each tier (case-insensitive comparison)

### Backwards Compatibility & Migration

The existing flat `keywords` column is auto-populated as the **derived union** of all three keyword arrays on save (deduplicated, ordered: primary first, then secondary, then local). The `keywords` field is removed from the SEO & Content section UI but remains in the database and API response.

**Precedence rule:** The three-tier keyword inputs are the source of truth. The flat `keywords` column is always a derived output — never an input. Remove `keywords` from category cascade sources.

**Legacy data migration:** On first edit of an existing event that has flat `keywords` but empty keyword tiers, pre-populate `secondary_keywords` from the existing `keywords` array. This preserves existing SEO data while migrating to the three-tier model. No bulk migration — happens lazily on edit.

---

## 2. Renovated SEO & Content Section

The section is restructured into four visual groups.

### Group 1: Meta & URL

Existing fields, now keyword-aware when AI-generated:

| Field | Char Limit | AI Keyword Rule |
|-------|-----------|----------------|
| URL Slug | 255 | Generated from primary keywords + event name |
| Meta Title | 60 | Primary keyword front-loaded, venue/location at end |
| Meta Description | 160 | Primary keyword in first clause, date included, CTA at end |

### Group 2: Content

Existing fields, now keyword-aware:

| Field | Char Limit | AI Keyword Rule |
|-------|-----------|----------------|
| Short Description | 500 | Primary + secondary keywords woven naturally into 1-3 sentences |
| Long Description | No limit | 300-400 words. Opening paragraph (primary), what to expect (secondary), venue/getting here (local SEO) |
| Highlights | 3-5 items | Secondary keywords incorporated into punchy bullet points |

### Group 3: New AI-Generated Fields

| Field | Char Limit | Storage | AI Source | E-E-A-T |
|-------|-----------|---------|-----------|---------|
| Image Alt Text | ~125 | `image_alt_text TEXT` | Primary + local keywords, event type, venue name | Expertise |
| FAQs | 3-5 Q&A pairs | `event_faqs` table (existing) | Event logistics + keywords. Q: 10-15 words, A: 30-60 words | Expertise + Trust |
| Facebook Copy | ~300 | Existing `facebook_event_name` + `facebook_event_description` | Engaging hook, key details, CTA. Uses secondary keywords | Distribution |
| WhatsApp Copy | ~200 | `social_copy_whatsapp TEXT` (new) | Short, emoji-friendly, essential info. Uses local keywords | Distribution |
| Previous Event Summary | ~200 | `previous_event_summary TEXT` (new) | **Manual field** with optional AI-suggested template. User must edit with real details. | Experience |
| Attendance Note | ~150 | `attendance_note TEXT` (new) | **Manual field** — not AI-generated. User enters real attendance/social proof data. | Authority |
| Cancellation Policy | ~200 | `cancellation_policy TEXT` (new) | AI suggests a draft based on event type/price, but marked as **draft requiring approval**. Category-level default takes precedence if set. | Trust |
| Accessibility Notes | ~300 | `accessibility_notes TEXT` (new) | **Not AI-generated.** Manual, defaults from category-level setting. | Trust |

### Group 4: SEO Health Indicator

Non-editable summary bar at the bottom of the section:

- **Keyword coverage check:** Are primary keywords present in title, meta desc, first paragraph of long description?
- **Content completeness:** Which fields are filled vs empty? (checklist visual)
- **Score:** 0-100 with colour coding:
  - 0-40: Red — significant gaps
  - 41-70: Amber — functional but room for improvement
  - 71-100: Green — well optimised
- **Not a blocking gate** — events can be published at any score
- **Execution:** Client-side only. Recomputes on field change (debounced 500ms). Not persisted to database. Not returned by API.

#### Scoring Weights

| Check | Points |
|-------|--------|
| Meta title present and under 60 chars | 10 |
| Meta description present and under 160 chars | 10 |
| Primary keyword appears in meta title | 10 |
| Primary keyword appears in meta description | 10 |
| Short description present | 5 |
| Long description present and 300+ words | 10 |
| Primary keyword in first 100 words of long description | 10 |
| At least 3 FAQs present | 10 |
| Image alt text present | 5 |
| Highlights present (3+ items) | 5 |
| Social copy present (at least one platform) | 5 |
| Slug is keyword-rich (contains primary keyword) | 5 |
| Accessibility notes present | 5 |

---

## 3. AI Generation System

### Trigger

Single "Generate All Content" button in the SEO & Content section header. Replaces the existing "Generate with AI" button.

### Input

All inputs passed to the AI in a single call:

```
Event Brief (required — if empty, show warning: "Add an event brief for better AI content" but allow generation with degraded output)
Primary Keywords (optional but recommended)
Secondary Keywords (optional)
Local SEO Keywords (optional)
Event Name, Date, Time, Category, Performer, Price, Capacity
Booking Mode, Is Free, Event Status
```

**Important:** All DebouncedTextarea fields (brief, descriptions) must be flushed before generation to avoid reading stale parent state. Call a flush/sync method on debounced inputs before triggering the AI call.

**Note on existing events:** When `eventId` is provided, the current AI action re-reads saved DB values for core fields (name, date, time, etc.), overriding unsaved form edits. This behaviour is preserved — the user should save the event first if they want AI to use updated core fields. Document this in the UI with a tooltip: "AI uses saved event details. Save changes first if you've updated event basics."

### Output

Single structured JSON response containing all fields:

```typescript
{
  slug: string
  metaTitle: string
  metaDescription: string
  shortDescription: string
  longDescription: string
  highlights: string[]
  imageAltText: string
  faqs: { question: string; answer: string }[]
  facebookEventName: string          // Maps to existing facebook_event_name column
  facebookEventDescription: string   // Maps to existing facebook_event_description column
  socialCopyWhatsapp: string
  cancellationPolicy: string | null  // Draft suggestion only — requires user approval
}
```

### AI Prompt — Keyword Placement Rules

| Keyword Tier | Must Appear In |
|-------------|---------------|
| Primary (1-2 terms) | Meta title (front-loaded), meta description (first clause), slug, short description (first sentence), long description (first 100 words), image alt text |
| Secondary (3-5 terms) | Long description body paragraphs, at least 2 highlights, at least 2 FAQ questions, Facebook copy |
| Local SEO (2-4 terms) | Long description venue/directions paragraph, at least 1 FAQ answer, WhatsApp copy, image alt text (if natural) |

### AI Constraints

- No keyword stuffing — each keyword used 1-2 times maximum per field
- Natural language only — skip a keyword rather than force it
- UK English throughout
- Venue personality: warm, inviting, community-focused pub tone
- Must NOT invent details not provided in the input
- Must NOT generate performer bios or testimonials
- Must NOT include markdown formatting in any field
- Must NOT exceed character limits on constrained fields
- If no keywords provided, fall back to current generic generation behaviour

### FAQ Generation Logic

AI generates 3-5 FAQs covering:
- Event logistics (time, booking, parking, accessibility) — local keywords
- Event experience (what to expect, who it's for) — secondary keywords
- Pricing/value (cost, what's included) — primary keywords where natural
- Each Q&A: question 10-15 words, answer 30-60 words

### Social Copy Generation

- **Facebook:** AI populates the existing `facebook_event_name` (short title, ~100 chars) and `facebook_event_description` (2-3 sentences, ~300 chars, engaging hook, key details, CTA). Uses secondary keywords. This repurposes the existing promotion copy fields rather than adding new columns.
- **WhatsApp:** Single message format. Emoji-friendly, essential info only (what/when/where), link placeholder `[LINK]`. ~150-200 chars. Uses local keywords. New `social_copy_whatsapp` column.

### Previous Event Summary (Manual Field)

- **Not AI-generated.** This is a manual text field where the user enters a real recap of the last occurrence.
- Placeholder text guides the user: "e.g. Last Wednesday's quiz night saw 12 teams compete, with Team Brainwave taking the £50 cash prize."
- If the event has never run before, leave empty.

### Attendance Note (Manual Field)

- **Not AI-generated.** This is a manual text field for real social proof data.
- Placeholder text: "e.g. Over 200 people attended last month's Six Nations screening" or "Sold out 3 weeks running"
- Only the user can provide factual attendance claims.

### Cancellation Policy Logic

- AI generates a **draft suggestion** based on event type/price:
  - Free events: "Free entry — no booking or registration required."
  - Ticketed/paid events: "Tickets are non-refundable but may be transferred to another person. Please contact us at least 24 hours before the event for any changes."
- **Category-level default takes precedence:** If the event's category has a `cancellation_policy` set, use that instead of AI generation.
- The field is marked as "Draft — review before publishing" in the UI until the user explicitly confirms or edits it.
- **Legal note:** This is a suggestion, not legal advice. The user must verify it matches actual venue policy.

---

## 4. Database Changes

### New Columns on `events` Table

```sql
ALTER TABLE events ADD COLUMN primary_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN secondary_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN local_seo_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN image_alt_text TEXT;
ALTER TABLE events ADD COLUMN social_copy_whatsapp TEXT;
ALTER TABLE events ADD COLUMN previous_event_summary TEXT;
ALTER TABLE events ADD COLUMN attendance_note TEXT;
ALTER TABLE events ADD COLUMN cancellation_policy TEXT;
ALTER TABLE events ADD COLUMN accessibility_notes TEXT;
```

Note: No `social_copy_facebook` column — Facebook copy uses the existing `facebook_event_name` and `facebook_event_description` columns.

### New Columns on `event_categories` Table

Categories provide defaults that cascade to events. Add matching keyword and content columns:

```sql
ALTER TABLE event_categories ADD COLUMN primary_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN secondary_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN local_seo_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN image_alt_text TEXT;
ALTER TABLE event_categories ADD COLUMN cancellation_policy TEXT;
ALTER TABLE event_categories ADD COLUMN accessibility_notes TEXT;
```

Note: `previous_event_summary`, `attendance_note`, and `social_copy_whatsapp` are event-instance-specific, so no category default.

### RPC Function Updates (Required)

The PostgreSQL functions `create_event_transaction` and `update_event_transaction` enumerate columns explicitly. They **must** be updated via `CREATE OR REPLACE FUNCTION` in the same migration to include all new columns. Without this, new columns will be silently ignored on create/update.

### Existing Columns — No Changes

- `keywords JSONB` — stays, auto-populated as derived union of three keyword arrays on save
- `event_faqs` table — stays, FAQs continue to use this existing relationship
- `facebook_event_name`, `facebook_event_description` — stays, now also populated by AI generation
- `slug`, `meta_title`, `meta_description`, `short_description`, `long_description`, `highlights` — all stay as-is

---

## 5. API Changes

### `/api/events` Response

**Important:** Both `/api/events/route.ts` and `/api/events/[id]/route.ts` manually shape their responses — they do NOT spread raw DB rows. New columns will NOT appear automatically. Both routes must be explicitly updated to include new fields in their response objects.

New fields added to the event object in the API response:

```typescript
{
  // ... existing fields ...
  primary_keywords: string[]
  secondary_keywords: string[]
  local_seo_keywords: string[]
  image_alt_text: string | null
  social_copy_whatsapp: string | null
  previous_event_summary: string | null
  attendance_note: string | null
  cancellation_policy: string | null
  accessibility_notes: string | null
}
```

The existing `keywords` field continues to be the union of all three keyword arrays (deduplicated, ordered: primary first, then secondary, then local). The existing `facebook_event_name` and `facebook_event_description` fields are already in the API response.

### Schema.org Output Enhancement

The `eventToSchema()` function in `src/lib/api/schema.ts` is updated to include:

- `image[].alt` — from `image_alt_text`
- `accessibilityFeature` — from `accessibility_notes` (if present)
- `refundPolicy` — from `cancellation_policy` (if present)
- `attendeeCount` or description enhancement — from `attendance_note`

The FAQ schema output already works via the `event_faqs` table.

---

## 6. Form Component Changes

### `EventFormGrouped.tsx`

**Basic Information section — additions after Event Brief:**
- New "Keyword Strategy" card containing three textareas (primary, secondary, local SEO)
- Each textarea with help text and keyword count indicator

**SEO & Content section — restructure:**
- Group 1 header: "Meta & URL"
- Group 2 header: "Content"
- Group 3 header: "AI-Generated Content" (new fields)
- Group 4: SEO Health Indicator bar
- "Generate All Content" button replaces "Generate with AI" in section header
- Remove the standalone "Keywords" field (replaced by three-tier inputs above)

### New Form State

```typescript
// Added to form state (individual useState per field, matching existing pattern)
primaryKeywords: string       // Raw textarea value (comma/newline separated)
secondaryKeywords: string     // Raw textarea value
localSeoKeywords: string      // Raw textarea value
imageAltText: string
socialCopyWhatsapp: string
previousEventSummary: string  // Manual field
attendanceNote: string        // Manual field
cancellationPolicy: string
accessibilityNotes: string
// FAQs: loaded from event_faqs, managed as { question: string; answer: string }[]
faqs: { question: string; answer: string }[]
```

Note: Facebook copy uses existing `facebookEventName` and `facebookEventDescription` state (already in the form for the promotion copy feature). Keyword textareas store raw input; parsing to arrays happens on save/generate.

---

## 7. Type Changes

### Primary type source: `src/types/database.generated.ts`

**Important:** The live app imports `Event` from `src/types/database.ts`, which re-exports from `database.generated.ts`. The file `src/types/event.ts` is **stale** (still has removed columns like `description`, `price_currency`, `image_urls`) and is not used by the event form/actions. Do NOT target `event.ts` for type changes.

New columns added via migration will automatically appear in `database.generated.ts` after running `npx supabase gen types typescript`. The generated types are the source of truth.

### `src/types/database.ts`

If any manual type extensions are needed (e.g. joined types, form-specific types), add them here. The new fields from the migration will be:

```typescript
// These will be auto-generated in database.generated.ts from the migration:
primary_keywords: string[] | null    // JSONB
secondary_keywords: string[] | null  // JSONB
local_seo_keywords: string[] | null  // JSONB
image_alt_text: string | null
social_copy_whatsapp: string | null
previous_event_summary: string | null
attendance_note: string | null
cancellation_policy: string | null
accessibility_notes: string | null
```

### `src/types/event-categories.ts`

Same approach — types generated from migration. Category-level fields only (no `previous_event_summary`, `attendance_note`, or `social_copy_whatsapp`).

---

## 8. Server Action Changes

### `generateEventSeoContent()` in `src/app/actions/event-content.ts`

**Extended input:**
```typescript
primaryKeywords?: string[]
secondaryKeywords?: string[]
localSeoKeywords?: string[]
```

**Extended output:**
```typescript
{
  // ... existing fields ...
  imageAltText: string | null
  faqs: { question: string; answer: string }[]
  facebookEventName: string | null         // Maps to existing column
  facebookEventDescription: string | null  // Maps to existing column
  socialCopyWhatsapp: string | null
  cancellationPolicy: string | null        // Draft suggestion only
  // NOTE: previousEventSummary and attendanceNote are NOT AI-generated
}
```

**Updated AI prompt:** Incorporates keyword placement rules as specified in Section 3. Keywords are clearly delimited as data (not instructions) in the prompt to mitigate prompt injection. Post-generation validation rejects any output containing HTML tags, URLs not in the input, or text exceeding field limits.

**Token budget:** The current AI call uses `max_tokens: 1500` for 7 fields. With the expanded output (FAQ Q&A pairs + additional fields), increase to `max_tokens: 3500`. Prototype with real event data to verify quality and latency are acceptable.

### `createEvent()` / `updateEvent()` in `src/app/actions/events.ts`

- Accept new fields in form data
- Auto-populate `keywords` as union of three keyword arrays before save
- Pass new fields through to the RPC transaction

### Zod Schema Update

Add new fields to `eventSchema` in `src/services/events.ts`:

```typescript
// Keyword validation helper — shared across all three tiers
const keywordArray = z.array(
  z.string()
    .max(100, 'Keyword must be under 100 characters')
    .transform(s => s.trim().replace(/\s+/g, ' '))  // collapse whitespace
    .refine(s => !/<[^>]+>/.test(s), 'Keywords must not contain HTML')
).max(10, 'Maximum 10 keywords per tier').default([]);

primary_keywords: keywordArray,
secondary_keywords: keywordArray,
local_seo_keywords: keywordArray,
image_alt_text: z.string().max(200).nullable().optional(),
social_copy_whatsapp: z.string().max(300).nullable().optional(),
previous_event_summary: z.string().max(300).nullable().optional(),
attendance_note: z.string().max(200).nullable().optional(),
cancellation_policy: z.string().max(300).nullable().optional(),
accessibility_notes: z.string().max(300).nullable().optional(),
```

Note: `social_copy_facebook` is not needed — Facebook copy uses existing `facebook_event_name` / `facebook_event_description` fields which already have validation.

---

## 9. Category Cascading

### Prerequisite: Fix existing cascade bugs

Before extending, fix these existing defects in `prepareEventDataFromFormData()` (`src/app/actions/events.ts`):
- Fix `event_categories.image_url` → should be `default_image_url` (matches actual schema)
- Remove reference to non-existent `event_categories.brief`
- Remove `keywords` from cascade sources (now a derived field, not a cascade target)

### Extended cascade fields

When a user selects a category on the event form, empty keyword and content fields auto-populate from the category defaults:

- `primary_keywords` — e.g. "Live Music" category defaults: `["live music Heathrow", "live band near me"]`
- `secondary_keywords` — category-level defaults
- `local_seo_keywords` — category-level defaults (likely same across categories since venue is constant)
- `cancellation_policy` — category-level default
- `accessibility_notes` — category-level default (venue-wide constant, set once per category but typically identical)
- `image_alt_text` — category-level default template

### Category edit form

The category edit form (`EventCategoryFormGrouped.tsx`) and category actions must also be updated to support editing the new default fields. This is in scope for this feature.

---

## 10. Brand Site Consumption

The brand site at `OJ-The-Anchor.pub` consumes event data via the `/api/events` endpoint. New fields will be available in the API response **only after the API routes are explicitly updated** (see Section 5). The brand site will need separate updates to render the new fields — that is **out of scope** for this spec.

Fields the brand site can consume when ready:
- `image_alt_text` — for `<img alt>` attributes
- `social_copy_whatsapp` — for WhatsApp share button
- `facebook_event_name` / `facebook_event_description` — already consumed, now keyword-optimised
- `previous_event_summary` — for "Last time..." section
- `attendance_note` — for social proof display
- `cancellation_policy` — for terms section
- `accessibility_notes` — for accessibility info section
- FAQs — already consumed via existing `event_faqs` relationship

**Security note:** The brand site must render all text fields safely (React's default text rendering is safe; avoid `dangerouslySetInnerHTML` or unescaped markdown rendering for these fields).

---

## 11. Migration Strategy

### Prerequisites (fix existing bugs that block this feature)

0a. **Fix FAQ persistence on edit** — the edit page must load `event_faqs`, the form must manage FAQ state, `prepareEventDataFromFormData` must distinguish "no FAQs sent" (preserve existing) from "empty FAQs sent" (delete all), and the RPC must only delete/replace FAQs when explicitly changed. Without this, AI-generated FAQs will be wiped on every subsequent edit save.

0b. **Fix category cascade field names** — repair `image_url` → `default_image_url` and remove non-existent `brief` reference in `prepareEventDataFromFormData`.

### Implementation steps

1. Database migration: add all new columns on `events` and `event_categories` (non-breaking, all nullable/defaulted)
2. Database migration: `CREATE OR REPLACE FUNCTION` for `create_event_transaction` and `update_event_transaction` to include all new columns in their INSERT/UPDATE statements
3. Regenerate types: `npx supabase gen types typescript` to update `database.generated.ts`
4. Update Zod schemas in `src/services/events.ts` with new field validation (including keyword array validation)
5. Update server actions (`events.ts`, `event-content.ts`) — add keyword union logic, pass new fields to RPCs, flush DebouncedTextarea before generation
6. Update form component (`EventFormGrouped.tsx`) — keyword inputs in Basic Information, restructured SEO section with new fields
7. Update category edit form (`EventCategoryFormGrouped.tsx`) — add new default fields
8. Update AI generation prompt and response handling — keyword placement rules, expanded output schema, increased token budget
9. Add SEO health indicator component (client-side only)
10. Update API routes (`/api/events/route.ts`, `/api/events/[id]/route.ts`) — explicitly add new fields to response shapers
11. Update Schema.org output (`src/lib/api/schema.ts`) — add `accessibilityFeature`, `refundPolicy`, image alt text

All changes are additive. No existing data is modified. No breaking changes to the API. Legacy `keywords` field continues to work as a derived union.
