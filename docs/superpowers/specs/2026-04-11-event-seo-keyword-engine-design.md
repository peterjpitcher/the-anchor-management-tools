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
- Changes to the brand site rendering (it already consumes the fields we'll populate)

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

### Backwards Compatibility

The existing flat `keywords` column is auto-populated as the union of all three keyword arrays on save. This ensures the `/api/events` endpoint and Schema.org output continue to work unchanged. The `keywords` field is removed from the SEO & Content section UI but remains in the database and API response.

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
| Facebook Copy | ~300 | `social_copy_facebook TEXT` | Engaging hook, key details, CTA. Uses secondary keywords | Distribution |
| WhatsApp Copy | ~200 | `social_copy_whatsapp TEXT` | Short, emoji-friendly, essential info. Uses local keywords | Distribution |
| Previous Event Summary | ~200 | `previous_event_summary TEXT` | 1-2 sentence recap of last occurrence. From brief/prompt | Experience |
| Attendance Note | ~150 | `attendance_note TEXT` | Social proof from capacity/history data | Authority |
| Cancellation Policy | ~200 | `cancellation_policy TEXT` | Generated from event type/price (free vs ticketed) | Trust |
| Accessibility Notes | ~300 | `accessibility_notes TEXT` | NOT AI-generated. Manual, defaults from venue-level setting | Trust |

### Group 4: SEO Health Indicator

Non-editable summary bar at the bottom of the section:

- **Keyword coverage check:** Are primary keywords present in title, meta desc, first paragraph of long description?
- **Content completeness:** Which fields are filled vs empty? (checklist visual)
- **Score:** 0-100 with colour coding:
  - 0-40: Red — significant gaps
  - 41-70: Amber — functional but room for improvement
  - 71-100: Green — well optimised
- **Not a blocking gate** — events can be published at any score

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
Event Brief (required for generation)
Primary Keywords (optional but recommended)
Secondary Keywords (optional)
Local SEO Keywords (optional)
Event Name, Date, Time, Category, Performer, Price, Capacity
Booking Mode, Is Free, Event Status
```

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
  socialCopyFacebook: string
  socialCopyWhatsapp: string
  previousEventSummary: string | null
  attendanceNote: string | null
  cancellationPolicy: string
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

- **Facebook:** 2-3 sentences. Engaging hook, key details (date/time/price), CTA to book. ~250-300 chars. Uses secondary keywords.
- **WhatsApp:** Single message format. Emoji-friendly, essential info only (what/when/where), link placeholder `[LINK]`. ~150-200 chars. Uses local keywords.

### Previous Event Summary Logic

- AI generates a 1-2 sentence recap suggesting what a past occurrence might have looked like
- Phrased as a template the user should edit with real details: "Last [day]'s [event name] saw [X] teams compete, with [Team Name] taking the [prize]. Update this with real details from your last event."
- If the event has never run before, this field is left null

### Cancellation Policy Logic

- Free events: "Free entry — no booking or registration required."
- Ticketed/paid events: "Tickets are non-refundable but may be transferred to another person. Please contact us at least 24 hours before the event for any changes."
- User should edit to match actual venue policy

---

## 4. Database Changes

### New Columns on `events` Table

```sql
ALTER TABLE events ADD COLUMN primary_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN secondary_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN local_seo_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN image_alt_text TEXT;
ALTER TABLE events ADD COLUMN social_copy_facebook TEXT;
ALTER TABLE events ADD COLUMN social_copy_whatsapp TEXT;
ALTER TABLE events ADD COLUMN previous_event_summary TEXT;
ALTER TABLE events ADD COLUMN attendance_note TEXT;
ALTER TABLE events ADD COLUMN cancellation_policy TEXT;
ALTER TABLE events ADD COLUMN accessibility_notes TEXT;
```

### New Columns on `event_categories` Table

Categories provide defaults that cascade to events. Add matching keyword and content columns:

```sql
ALTER TABLE event_categories ADD COLUMN primary_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN secondary_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN local_seo_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN image_alt_text TEXT;
ALTER TABLE event_categories ADD COLUMN social_copy_facebook TEXT;
ALTER TABLE event_categories ADD COLUMN social_copy_whatsapp TEXT;
ALTER TABLE event_categories ADD COLUMN cancellation_policy TEXT;
ALTER TABLE event_categories ADD COLUMN accessibility_notes TEXT;
```

Note: `previous_event_summary` and `attendance_note` are event-instance-specific, so no category default.

### Existing Columns — No Changes

- `keywords JSONB` — stays, auto-populated as union of three keyword arrays on save
- `event_faqs` table — stays, FAQs continue to use this existing relationship
- `slug`, `meta_title`, `meta_description`, `short_description`, `long_description`, `highlights` — all stay as-is

---

## 5. API Changes

### `/api/events` Response

New fields added to the event object in the API response:

```typescript
{
  // ... existing fields ...
  primary_keywords: string[]
  secondary_keywords: string[]
  local_seo_keywords: string[]
  image_alt_text: string | null
  social_copy_facebook: string | null
  social_copy_whatsapp: string | null
  previous_event_summary: string | null
  attendance_note: string | null
  cancellation_policy: string | null
  accessibility_notes: string | null
}
```

The existing `keywords` field continues to be the union of all three keyword arrays (deduplicated, ordered: primary first, then secondary, then local).

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
// Added to form state
primaryKeywords: string[]
secondaryKeywords: string[]
localSeoKeywords: string[]
imageAltText: string
socialCopyFacebook: string
socialCopyWhatsapp: string
previousEventSummary: string
attendanceNote: string
cancellationPolicy: string
accessibilityNotes: string
```

---

## 7. Type Changes

### `src/types/event.ts`

Add to `Event` interface:

```typescript
primary_keywords: string[] | null
secondary_keywords: string[] | null
local_seo_keywords: string[] | null
image_alt_text: string | null
social_copy_facebook: string | null
social_copy_whatsapp: string | null
previous_event_summary: string | null
attendance_note: string | null
cancellation_policy: string | null
accessibility_notes: string | null
```

### `src/types/event-categories.ts`

Add matching fields (excluding event-instance-specific ones).

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
  socialCopyFacebook: string | null
  socialCopyWhatsapp: string | null
  previousEventSummary: string | null
  attendanceNote: string | null
  cancellationPolicy: string | null
}
```

**Updated AI prompt:** Incorporates keyword placement rules and E-E-A-T field generation as specified in Section 3.

### `createEvent()` / `updateEvent()` in `src/app/actions/events.ts`

- Accept new fields in form data
- Auto-populate `keywords` as union of three keyword arrays before save
- Pass new fields through to the RPC transaction

### Zod Schema Update

Add new fields to `eventSchema` in `src/services/events.ts`:

```typescript
primary_keywords: z.array(z.string()).default([]),
secondary_keywords: z.array(z.string()).default([]),
local_seo_keywords: z.array(z.string()).default([]),
image_alt_text: z.string().max(200).nullable().optional(),
social_copy_facebook: z.string().max(500).nullable().optional(),
social_copy_whatsapp: z.string().max(300).nullable().optional(),
previous_event_summary: z.string().max(500).nullable().optional(),
attendance_note: z.string().max(300).nullable().optional(),
cancellation_policy: z.string().max(500).nullable().optional(),
accessibility_notes: z.string().max(500).nullable().optional(),
```

---

## 9. Category Cascading

When a user selects a category on the event form, empty keyword and content fields auto-populate from the category defaults. This extends the existing cascading pattern to include:

- `primary_keywords` — e.g. "Live Music" category defaults: `["live music Heathrow", "live band near me"]`
- `secondary_keywords` — category-level defaults
- `local_seo_keywords` — category-level defaults (likely same across categories since venue is constant)
- `cancellation_policy` — category-level default
- `accessibility_notes` — category-level default (venue constant)
- `image_alt_text` — category-level default template

---

## 10. Brand Site Consumption

The brand site at `OJ-The-Anchor.pub` already consumes event data via the `/api/events` endpoint. The new fields will be available in the API response automatically. The brand site will need separate updates to render the new fields, but that is **out of scope** for this spec. The management tool changes are self-contained.

Fields the brand site can consume when ready:
- `image_alt_text` — for `<img alt>` attributes
- `social_copy_facebook` / `social_copy_whatsapp` — for social share buttons
- `previous_event_summary` — for "Last time..." section
- `attendance_note` — for social proof display
- `cancellation_policy` — for terms section
- `accessibility_notes` — for accessibility info section
- FAQs — already consumed via existing `event_faqs` relationship

---

## 11. Migration Strategy

1. Database migration adds all new columns (non-breaking, all nullable/defaulted)
2. Update RPC functions (`create_event_transaction`, `update_event_transaction`) to handle new columns
3. Update types, Zod schemas, and server actions
4. Update form component with keyword inputs and restructured SEO section
5. Update AI generation prompt and response handling
6. Add SEO health indicator component
7. Update API response to include new fields
8. Update Schema.org output

All changes are additive. No existing data is modified. No breaking changes to the API.
