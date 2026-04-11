# Event SEO Keyword Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three-tier keyword strategy inputs to the event edit form and renovate the SEO & Content section with keyword-aware AI generation, FAQs, social copy, and E-E-A-T fields.

**Architecture:** New keyword fields added to Basic Information section feed into an expanded AI generation prompt that produces keyword-optimised content across all SEO fields. New DB columns via migration, updated RPC functions, extended Zod validation, and explicit API route updates ensure end-to-end data flow. Two prerequisite bug fixes (FAQ persistence, category cascade) are resolved first.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase PostgreSQL, OpenAI structured output, Tailwind CSS v4, Zod validation.

**Spec:** `docs/superpowers/specs/2026-04-11-event-seo-keyword-engine-design.md`

---

## File Map

### Modified Files

| File | Responsibility |
|------|---------------|
| `src/app/(authenticated)/events/[id]/edit/page.tsx` | Load event_faqs alongside event data |
| `src/app/actions/events.ts` | Fix category cascade bugs, FAQ persistence, add new fields to prepareEventDataFromFormData, keyword union logic |
| `src/app/actions/event-content.ts` | Expand AI input/output, keyword placement rules, increased token budget |
| `src/services/events.ts` | Add keyword validation to Zod schema, new field definitions |
| `src/components/features/events/EventFormGrouped.tsx` | Keyword strategy inputs, restructured SEO section, FAQ state, new fields, SEO health indicator, DebouncedTextarea flush |
| `src/components/features/events/EventCategoryFormGrouped.tsx` | Add new category default fields |
| `src/app/api/events/route.ts` | Add new fields to response shaper |
| `src/app/api/events/[id]/route.ts` | Add new fields to response shaper |
| `src/lib/api/schema.ts` | Add accessibilityFeature, refundPolicy, image alt to Schema.org output |
| `src/types/database.ts` | Extend Event type if manual extensions needed after type generation |
| `src/components/ui-v2/forms/DebouncedTextarea.tsx` | Add imperative flush method via ref |

### New Files

| File | Responsibility |
|------|---------------|
| `supabase/migrations/YYYYMMDD000000_event_seo_keyword_engine.sql` | New columns on events + event_categories, updated RPC functions |
| `src/components/features/events/SeoHealthIndicator.tsx` | Client-side SEO completeness score component |
| `src/components/features/events/KeywordStrategyCard.tsx` | Keyword textarea inputs with parsing and count display |
| `src/components/features/events/FaqEditor.tsx` | FAQ Q&A pair editor for viewing/editing generated FAQs |
| `src/lib/keywords.ts` | Shared keyword parsing, validation, and union utility |

---

## Task 0: Fix FAQ Persistence on Edit (Prerequisite)

**Why:** The edit page doesn't load FAQs, and every save deletes all existing FAQs because missing FAQs default to `[]`. This must be fixed before we can add FAQ generation.

**Files:**
- Modify: `src/app/(authenticated)/events/[id]/edit/page.tsx:27-34`
- Modify: `src/app/actions/events.ts:58-170`
- Modify: `src/components/features/events/EventFormGrouped.tsx:75-166`

- [ ] **Step 1: Update edit page to load event_faqs**

In `src/app/(authenticated)/events/[id]/edit/page.tsx`, change the event query at line 30 from:

```typescript
supabase.from('events').select('*').eq('id', id).single(),
```

to:

```typescript
supabase.from('events').select('*, event_faqs(id, question, answer, sort_order)').eq('id', id).single(),
```

- [ ] **Step 2: Add FAQ state to EventFormGrouped**

In `src/components/features/events/EventFormGrouped.tsx`, add after line 106:

```typescript
const [faqs, setFaqs] = useState<{ question: string; answer: string; sort_order?: number }[]>(
  (event as any)?.event_faqs?.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) ?? []
)
const [faqsModified, setFaqsModified] = useState(false)
```

- [ ] **Step 3: Pass FAQs in handleSubmit only when modified**

In `src/components/features/events/EventFormGrouped.tsx`, inside the `handleSubmit` function's eventData object (around line 140), add:

```typescript
// Only send FAQs if they were explicitly modified in this edit session
...(faqsModified ? { faqs } : {}),
```

- [ ] **Step 4: Fix prepareEventDataFromFormData to distinguish missing vs empty FAQs**

In `src/app/actions/events.ts`, replace lines 163-170:

```typescript
// Handle FAQs
let faqs: EventFaqInput[] = [];
try {
  const faqsJson = formData.get('faqs') as string;
  if (faqsJson) {
    const parsed = JSON.parse(faqsJson);
    if (Array.isArray(parsed) && parsed.length > 0) {
      faqs = parsed.filter(faq => faq.question && faq.answer);
```

with:

```typescript
// Handle FAQs — distinguish "not sent" (preserve existing) from "sent empty" (clear all)
const faqsRaw = formData.get('faqs') as string | null;
const faqsProvided = faqsRaw !== null;
let faqs: EventFaqInput[] | undefined = undefined; // undefined = not modified, preserve existing
try {
  if (faqsProvided) {
    const parsed = JSON.parse(faqsRaw!);
    if (Array.isArray(parsed)) {
      faqs = parsed.filter(faq => faq.question && faq.answer);
    } else {
      faqs = [];
    }
```

- [ ] **Step 5: Update EventService to skip FAQ replacement when undefined**

In `src/services/events.ts`, in the `updateEvent` method, only pass `p_faqs` to the RPC when faqs is explicitly provided. Change the RPC call to conditionally include FAQs:

```typescript
const rpcPayload: Record<string, unknown> = {
  p_event_id: id,
  p_event_data: eventData
};
// Only include p_faqs if FAQs were explicitly modified
if (input.faqs !== undefined) {
  rpcPayload.p_faqs = input.faqs ? JSON.stringify(input.faqs) : null;
} else {
  rpcPayload.p_faqs = null; // null means "don't touch FAQs" — update RPC to handle this
}
```

- [ ] **Step 6: Update the RPC to preserve FAQs when p_faqs is null**

This will be handled in the migration (Task 2). For now, note that `update_event_transaction` must be changed so that when `p_faqs IS NULL`, it skips the delete/reinsert of FAQs entirely.

- [ ] **Step 7: Verify FAQ persistence works**

Run: `npm run build`
Expected: Build succeeds with no type errors.

Manual test: Edit an event that has FAQs, change only the name, save. Verify FAQs are preserved.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(authenticated\)/events/\[id\]/edit/page.tsx src/app/actions/events.ts src/components/features/events/EventFormGrouped.tsx src/services/events.ts
git commit -m "fix: preserve FAQs on event edit — load, track, and skip replacement when unmodified"
```

---

## Task 1: Fix Category Cascade Bugs (Prerequisite)

**Why:** The server-side cascade reads non-existent column names. Must fix before extending.

**Files:**
- Modify: `src/app/actions/events.ts:64-117`

- [ ] **Step 1: Fix the category select query**

In `src/app/actions/events.ts`, replace the select string at lines 67-89:

```typescript
.select(`
  default_start_time,
  default_end_time,
  default_duration_minutes,
  default_doors_time,
  default_last_entry_time,
  default_price,
  default_is_free,
  short_description,
  long_description,
  highlights,
  keywords,
  meta_title,
  meta_description,
  default_image_url,
  promo_video_url,
  highlight_video_urls,
  gallery_image_urls,
  default_performer_type,
  default_event_status,
  default_booking_url
`)
```

- [ ] **Step 2: Fix the categoryDefaults mapping**

In `src/app/actions/events.ts`, at line 109, change:

```typescript
hero_image_url: category.image_url,
```

to:

```typescript
hero_image_url: category.default_image_url,
```

And remove line 104 (`brief: category.brief,`) since event_categories has no `brief` column.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/events.ts
git commit -m "fix: correct category cascade field names — image_url to default_image_url, remove non-existent brief"
```

---

## Task 2: Database Migration

**Why:** Add all new columns and update RPC functions atomically.

**Files:**
- Create: `supabase/migrations/YYYYMMDD000000_event_seo_keyword_engine.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260411000000_event_seo_keyword_engine.sql`:

```sql
-- ============================================================
-- Event SEO Keyword Engine — new columns + updated RPCs
-- ============================================================

-- 1. New columns on events
ALTER TABLE events ADD COLUMN IF NOT EXISTS primary_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS secondary_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS local_seo_keywords JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_alt_text TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS social_copy_whatsapp TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS previous_event_summary TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS attendance_note TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancellation_policy TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS accessibility_notes TEXT;

-- 2. New columns on event_categories
ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS primary_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS secondary_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS local_seo_keywords JSONB DEFAULT '[]';
ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS image_alt_text TEXT;
ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS cancellation_policy TEXT;
ALTER TABLE event_categories ADD COLUMN IF NOT EXISTS accessibility_notes TEXT;

-- 3. Update create_event_transaction to include new columns
CREATE OR REPLACE FUNCTION create_event_transaction(
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event events%ROWTYPE;
BEGIN
  INSERT INTO events (
    name, date, time, end_time, duration_minutes, doors_time, last_entry_time,
    capacity, category_id, event_type, booking_mode,
    slug, short_description, long_description, brief, highlights, keywords,
    meta_title, meta_description,
    event_status, performer_name, performer_type,
    price, price_per_seat, is_free, booking_url, payment_mode,
    hero_image_url, thumbnail_image_url, poster_image_url,
    gallery_image_urls, promo_video_url, highlight_video_urls,
    facebook_event_name, facebook_event_description,
    gbp_event_title, gbp_event_description,
    opentable_experience_title, opentable_experience_description,
    -- New SEO keyword engine columns
    primary_keywords, secondary_keywords, local_seo_keywords,
    image_alt_text, social_copy_whatsapp,
    previous_event_summary, attendance_note,
    cancellation_policy, accessibility_notes
  )
  VALUES (
    p_event_data->>'name',
    (p_event_data->>'date')::DATE,
    p_event_data->>'time',
    NULLIF(p_event_data->>'end_time', ''),
    (p_event_data->>'duration_minutes')::INT,
    NULLIF(p_event_data->>'doors_time', ''),
    NULLIF(p_event_data->>'last_entry_time', ''),
    (p_event_data->>'capacity')::INT,
    NULLIF(p_event_data->>'category_id', '')::UUID,
    NULLIF(p_event_data->>'event_type', ''),
    COALESCE(p_event_data->>'booking_mode', 'table'),
    p_event_data->>'slug',
    NULLIF(p_event_data->>'short_description', ''),
    NULLIF(p_event_data->>'long_description', ''),
    NULLIF(p_event_data->>'brief', ''),
    COALESCE(p_event_data->'highlights', '[]'::JSONB),
    COALESCE(p_event_data->'keywords', '[]'::JSONB),
    NULLIF(p_event_data->>'meta_title', ''),
    NULLIF(p_event_data->>'meta_description', ''),
    COALESCE(p_event_data->>'event_status', 'scheduled'),
    NULLIF(p_event_data->>'performer_name', ''),
    NULLIF(p_event_data->>'performer_type', ''),
    COALESCE((p_event_data->>'price')::NUMERIC, 0),
    (p_event_data->>'price_per_seat')::NUMERIC,
    COALESCE((p_event_data->>'is_free')::BOOLEAN, FALSE),
    NULLIF(p_event_data->>'booking_url', ''),
    NULLIF(p_event_data->>'payment_mode', ''),
    NULLIF(p_event_data->>'hero_image_url', ''),
    NULLIF(p_event_data->>'thumbnail_image_url', ''),
    NULLIF(p_event_data->>'poster_image_url', ''),
    COALESCE(p_event_data->'gallery_image_urls', '[]'::JSONB),
    NULLIF(p_event_data->>'promo_video_url', ''),
    COALESCE(p_event_data->'highlight_video_urls', '[]'::JSONB),
    NULLIF(p_event_data->>'facebook_event_name', ''),
    NULLIF(p_event_data->>'facebook_event_description', ''),
    NULLIF(p_event_data->>'gbp_event_title', ''),
    NULLIF(p_event_data->>'gbp_event_description', ''),
    NULLIF(p_event_data->>'opentable_experience_title', ''),
    NULLIF(p_event_data->>'opentable_experience_description', ''),
    -- New SEO keyword engine values
    COALESCE(p_event_data->'primary_keywords', '[]'::JSONB),
    COALESCE(p_event_data->'secondary_keywords', '[]'::JSONB),
    COALESCE(p_event_data->'local_seo_keywords', '[]'::JSONB),
    NULLIF(p_event_data->>'image_alt_text', ''),
    NULLIF(p_event_data->>'social_copy_whatsapp', ''),
    NULLIF(p_event_data->>'previous_event_summary', ''),
    NULLIF(p_event_data->>'attendance_note', ''),
    NULLIF(p_event_data->>'cancellation_policy', ''),
    NULLIF(p_event_data->>'accessibility_notes', '')
  )
  RETURNING * INTO v_event;

  -- Insert FAQs if provided
  IF p_faqs IS NOT NULL AND jsonb_array_length(p_faqs) > 0 THEN
    INSERT INTO event_faqs (event_id, question, answer, sort_order)
    SELECT
      v_event.id,
      faq->>'question',
      faq->>'answer',
      COALESCE((faq->>'sort_order')::INT, row_number() OVER () - 1)
    FROM jsonb_array_elements(p_faqs) AS faq;
  END IF;

  RETURN to_jsonb(v_event);
END;
$$;

-- 4. Update update_event_transaction to include new columns + FAQ preservation
CREATE OR REPLACE FUNCTION update_event_transaction(
  p_event_id UUID,
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event events%ROWTYPE;
BEGIN
  UPDATE events SET
    name = COALESCE(p_event_data->>'name', name),
    date = COALESCE((p_event_data->>'date')::DATE, date),
    time = COALESCE(p_event_data->>'time', time),
    end_time = CASE WHEN p_event_data ? 'end_time' THEN NULLIF(p_event_data->>'end_time', '') ELSE end_time END,
    duration_minutes = CASE WHEN p_event_data ? 'duration_minutes' THEN (p_event_data->>'duration_minutes')::INT ELSE duration_minutes END,
    doors_time = CASE WHEN p_event_data ? 'doors_time' THEN NULLIF(p_event_data->>'doors_time', '') ELSE doors_time END,
    last_entry_time = CASE WHEN p_event_data ? 'last_entry_time' THEN NULLIF(p_event_data->>'last_entry_time', '') ELSE last_entry_time END,
    capacity = CASE WHEN p_event_data ? 'capacity' THEN (p_event_data->>'capacity')::INT ELSE capacity END,
    category_id = CASE WHEN p_event_data ? 'category_id' THEN NULLIF(p_event_data->>'category_id', '')::UUID ELSE category_id END,
    event_type = CASE WHEN p_event_data ? 'event_type' THEN NULLIF(p_event_data->>'event_type', '') ELSE event_type END,
    booking_mode = CASE WHEN p_event_data ? 'booking_mode' THEN COALESCE(p_event_data->>'booking_mode', 'table') ELSE booking_mode END,
    slug = CASE WHEN p_event_data ? 'slug' THEN p_event_data->>'slug' ELSE slug END,
    short_description = CASE WHEN p_event_data ? 'short_description' THEN NULLIF(p_event_data->>'short_description', '') ELSE short_description END,
    long_description = CASE WHEN p_event_data ? 'long_description' THEN NULLIF(p_event_data->>'long_description', '') ELSE long_description END,
    brief = CASE WHEN p_event_data ? 'brief' THEN NULLIF(p_event_data->>'brief', '') ELSE brief END,
    highlights = CASE WHEN p_event_data ? 'highlights' THEN COALESCE(p_event_data->'highlights', '[]'::JSONB) ELSE highlights END,
    keywords = CASE WHEN p_event_data ? 'keywords' THEN COALESCE(p_event_data->'keywords', '[]'::JSONB) ELSE keywords END,
    meta_title = CASE WHEN p_event_data ? 'meta_title' THEN NULLIF(p_event_data->>'meta_title', '') ELSE meta_title END,
    meta_description = CASE WHEN p_event_data ? 'meta_description' THEN NULLIF(p_event_data->>'meta_description', '') ELSE meta_description END,
    event_status = CASE WHEN p_event_data ? 'event_status' THEN COALESCE(p_event_data->>'event_status', 'scheduled') ELSE event_status END,
    performer_name = CASE WHEN p_event_data ? 'performer_name' THEN NULLIF(p_event_data->>'performer_name', '') ELSE performer_name END,
    performer_type = CASE WHEN p_event_data ? 'performer_type' THEN NULLIF(p_event_data->>'performer_type', '') ELSE performer_type END,
    price = CASE WHEN p_event_data ? 'price' THEN COALESCE((p_event_data->>'price')::NUMERIC, 0) ELSE price END,
    price_per_seat = CASE WHEN p_event_data ? 'price_per_seat' THEN (p_event_data->>'price_per_seat')::NUMERIC ELSE price_per_seat END,
    is_free = CASE WHEN p_event_data ? 'is_free' THEN COALESCE((p_event_data->>'is_free')::BOOLEAN, FALSE) ELSE is_free END,
    booking_url = CASE WHEN p_event_data ? 'booking_url' THEN NULLIF(p_event_data->>'booking_url', '') ELSE booking_url END,
    payment_mode = CASE WHEN p_event_data ? 'payment_mode' THEN NULLIF(p_event_data->>'payment_mode', '') ELSE payment_mode END,
    hero_image_url = CASE WHEN p_event_data ? 'hero_image_url' THEN NULLIF(p_event_data->>'hero_image_url', '') ELSE hero_image_url END,
    thumbnail_image_url = CASE WHEN p_event_data ? 'thumbnail_image_url' THEN NULLIF(p_event_data->>'thumbnail_image_url', '') ELSE thumbnail_image_url END,
    poster_image_url = CASE WHEN p_event_data ? 'poster_image_url' THEN NULLIF(p_event_data->>'poster_image_url', '') ELSE poster_image_url END,
    gallery_image_urls = CASE WHEN p_event_data ? 'gallery_image_urls' THEN COALESCE(p_event_data->'gallery_image_urls', '[]'::JSONB) ELSE gallery_image_urls END,
    promo_video_url = CASE WHEN p_event_data ? 'promo_video_url' THEN NULLIF(p_event_data->>'promo_video_url', '') ELSE promo_video_url END,
    highlight_video_urls = CASE WHEN p_event_data ? 'highlight_video_urls' THEN COALESCE(p_event_data->'highlight_video_urls', '[]'::JSONB) ELSE highlight_video_urls END,
    facebook_event_name = CASE WHEN p_event_data ? 'facebook_event_name' THEN NULLIF(p_event_data->>'facebook_event_name', '') ELSE facebook_event_name END,
    facebook_event_description = CASE WHEN p_event_data ? 'facebook_event_description' THEN NULLIF(p_event_data->>'facebook_event_description', '') ELSE facebook_event_description END,
    gbp_event_title = CASE WHEN p_event_data ? 'gbp_event_title' THEN NULLIF(p_event_data->>'gbp_event_title', '') ELSE gbp_event_title END,
    gbp_event_description = CASE WHEN p_event_data ? 'gbp_event_description' THEN NULLIF(p_event_data->>'gbp_event_description', '') ELSE gbp_event_description END,
    opentable_experience_title = CASE WHEN p_event_data ? 'opentable_experience_title' THEN NULLIF(p_event_data->>'opentable_experience_title', '') ELSE opentable_experience_title END,
    opentable_experience_description = CASE WHEN p_event_data ? 'opentable_experience_description' THEN NULLIF(p_event_data->>'opentable_experience_description', '') ELSE opentable_experience_description END,
    -- New SEO keyword engine columns
    primary_keywords = CASE WHEN p_event_data ? 'primary_keywords' THEN COALESCE(p_event_data->'primary_keywords', '[]'::JSONB) ELSE primary_keywords END,
    secondary_keywords = CASE WHEN p_event_data ? 'secondary_keywords' THEN COALESCE(p_event_data->'secondary_keywords', '[]'::JSONB) ELSE secondary_keywords END,
    local_seo_keywords = CASE WHEN p_event_data ? 'local_seo_keywords' THEN COALESCE(p_event_data->'local_seo_keywords', '[]'::JSONB) ELSE local_seo_keywords END,
    image_alt_text = CASE WHEN p_event_data ? 'image_alt_text' THEN NULLIF(p_event_data->>'image_alt_text', '') ELSE image_alt_text END,
    social_copy_whatsapp = CASE WHEN p_event_data ? 'social_copy_whatsapp' THEN NULLIF(p_event_data->>'social_copy_whatsapp', '') ELSE social_copy_whatsapp END,
    previous_event_summary = CASE WHEN p_event_data ? 'previous_event_summary' THEN NULLIF(p_event_data->>'previous_event_summary', '') ELSE previous_event_summary END,
    attendance_note = CASE WHEN p_event_data ? 'attendance_note' THEN NULLIF(p_event_data->>'attendance_note', '') ELSE attendance_note END,
    cancellation_policy = CASE WHEN p_event_data ? 'cancellation_policy' THEN NULLIF(p_event_data->>'cancellation_policy', '') ELSE cancellation_policy END,
    accessibility_notes = CASE WHEN p_event_data ? 'accessibility_notes' THEN NULLIF(p_event_data->>'accessibility_notes', '') ELSE accessibility_notes END
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  -- Only modify FAQs if p_faqs is explicitly provided (not NULL)
  -- NULL means "don't touch FAQs", empty array means "delete all FAQs"
  IF p_faqs IS NOT NULL THEN
    DELETE FROM event_faqs WHERE event_id = p_event_id;

    IF jsonb_array_length(p_faqs) > 0 THEN
      INSERT INTO event_faqs (event_id, question, answer, sort_order)
      SELECT
        p_event_id,
        faq->>'question',
        faq->>'answer',
        COALESCE((faq->>'sort_order')::INT, row_number() OVER () - 1)
      FROM jsonb_array_elements(p_faqs) AS faq;
    END IF;
  END IF;

  RETURN to_jsonb(v_event);
END;
$$;
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push --dry-run`
Expected: No errors. Review output for destructive operations (there should be none).

Run: `npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 3: Regenerate TypeScript types**

Run: `npx supabase gen types typescript --local > src/types/database.generated.ts`
Expected: File updated with new columns.

- [ ] **Step 4: Verify new types appear**

Open `src/types/database.generated.ts` and confirm `primary_keywords`, `secondary_keywords`, `local_seo_keywords`, `image_alt_text`, `social_copy_whatsapp`, `previous_event_summary`, `attendance_note`, `cancellation_policy`, `accessibility_notes` all appear in the events table Row type.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260411000000_event_seo_keyword_engine.sql src/types/database.generated.ts
git commit -m "feat: add SEO keyword engine columns and update RPC functions"
```

---

## Task 3: Keyword Parsing Utility

**Why:** Shared logic for parsing comma/newline-separated keywords, validation, and building the union for the flat `keywords` field.

**Files:**
- Create: `src/lib/keywords.ts`

- [ ] **Step 1: Create the keyword utility**

Create `src/lib/keywords.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/keywords.ts
git commit -m "feat: add keyword parsing, validation, and union utility"
```

---

## Task 4: Update Zod Schema and Server Actions

**Why:** Add validation for new fields and integrate keyword union logic into event save.

**Files:**
- Modify: `src/services/events.ts`
- Modify: `src/app/actions/events.ts`

- [ ] **Step 1: Add keyword array validation to Zod schema**

In `src/services/events.ts`, add this before the `eventSchema` definition:

```typescript
const keywordArraySchema = z.array(
  z.string()
    .max(100, 'Keyword must be under 100 characters')
    .transform(s => s.trim().replace(/\s+/g, ' '))
    .refine(s => !/<[^>]+>/.test(s), 'Keywords must not contain HTML')
).max(10, 'Maximum 10 keywords per tier').default([])
```

Then add these fields inside the `eventSchema` object:

```typescript
primary_keywords: keywordArraySchema,
secondary_keywords: keywordArraySchema,
local_seo_keywords: keywordArraySchema,
image_alt_text: z.string().max(200).nullable().optional(),
social_copy_whatsapp: z.string().max(300).nullable().optional(),
previous_event_summary: z.string().max(300).nullable().optional(),
attendance_note: z.string().max(200).nullable().optional(),
cancellation_policy: z.string().max(300).nullable().optional(),
accessibility_notes: z.string().max(300).nullable().optional(),
```

- [ ] **Step 2: Add keyword union logic to prepareEventDataFromFormData**

In `src/app/actions/events.ts`, add import at top:

```typescript
import { buildKeywordsUnion } from '@/lib/keywords'
```

In the `data` object inside `prepareEventDataFromFormData`, add the new fields after the existing ones (around line 160):

```typescript
primary_keywords: rawData.primary_keywords ? JSON.parse(rawData.primary_keywords as string) : categoryDefaults.primary_keywords || [],
secondary_keywords: rawData.secondary_keywords ? JSON.parse(rawData.secondary_keywords as string) : categoryDefaults.secondary_keywords || [],
local_seo_keywords: rawData.local_seo_keywords ? JSON.parse(rawData.local_seo_keywords as string) : categoryDefaults.local_seo_keywords || [],
image_alt_text: rawData.image_alt_text as string || null,
social_copy_whatsapp: rawData.social_copy_whatsapp as string || null,
previous_event_summary: rawData.previous_event_summary as string || null,
attendance_note: rawData.attendance_note as string || null,
cancellation_policy: rawData.cancellation_policy as string || categoryDefaults.cancellation_policy || null,
accessibility_notes: rawData.accessibility_notes as string || categoryDefaults.accessibility_notes || null,
```

Then, after building the data object, add the keyword union:

```typescript
// Derive flat keywords as union of three tiers
const primaryKw = data.primary_keywords as string[] || [];
const secondaryKw = data.secondary_keywords as string[] || [];
const localKw = data.local_seo_keywords as string[] || [];
if (primaryKw.length > 0 || secondaryKw.length > 0 || localKw.length > 0) {
  data.keywords = buildKeywordsUnion(primaryKw, secondaryKw, localKw);
}
```

- [ ] **Step 3: Update the category select to include new category columns**

In the category select query (line 67), add:

```sql
primary_keywords,
secondary_keywords,
local_seo_keywords,
image_alt_text,
cancellation_policy,
accessibility_notes,
```

And add to the categoryDefaults mapping:

```typescript
primary_keywords: category.primary_keywords,
secondary_keywords: category.secondary_keywords,
local_seo_keywords: category.local_seo_keywords,
image_alt_text: category.image_alt_text,
cancellation_policy: category.cancellation_policy,
accessibility_notes: category.accessibility_notes,
```

- [ ] **Step 4: Remove `keywords` from cascade (it's now derived)**

Remove `keywords: category.keywords,` from the categoryDefaults mapping and remove `keywords` from the category select query.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/services/events.ts src/app/actions/events.ts
git commit -m "feat: add keyword tier validation, union logic, and new field handling to server actions"
```

---

## Task 5: Keyword Strategy Card Component

**Why:** Reusable component for the three keyword textarea inputs in Basic Information.

**Files:**
- Create: `src/components/features/events/KeywordStrategyCard.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/features/events/KeywordStrategyCard.tsx`:

```typescript
'use client'

import { parseKeywords } from '@/lib/keywords'

interface KeywordStrategyCardProps {
  primaryKeywords: string
  secondaryKeywords: string
  localSeoKeywords: string
  onPrimaryChange: (value: string) => void
  onSecondaryChange: (value: string) => void
  onLocalChange: (value: string) => void
}

function KeywordCount({ raw }: { raw: string }) {
  const count = parseKeywords(raw).length
  if (count === 0) return null
  return (
    <span className="text-xs text-muted-foreground">
      {count} keyword{count !== 1 ? 's' : ''} entered
    </span>
  )
}

export default function KeywordStrategyCard({
  primaryKeywords,
  secondaryKeywords,
  localSeoKeywords,
  onPrimaryChange,
  onSecondaryChange,
  onLocalChange,
}: KeywordStrategyCardProps) {
  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-purple-400 mb-1">Keyword Strategy</h4>
        <p className="text-xs text-muted-foreground">
          Paste your researched keywords here — these drive all AI-generated content.
          Accepts comma-separated or one per line.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-foreground/80 block mb-1">
            Primary Keywords
            <span className="text-muted-foreground font-normal ml-1">(1-2 terms — title, meta, slug, first paragraph)</span>
          </label>
          <textarea
            value={primaryKeywords}
            onChange={e => onPrimaryChange(e.target.value)}
            placeholder={"pub quiz Heathrow\nquiz night near airport"}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <KeywordCount raw={primaryKeywords} />
        </div>

        <div>
          <label className="text-xs font-medium text-foreground/80 block mb-1">
            Secondary Keywords
            <span className="text-muted-foreground font-normal ml-1">(3-5 terms — headings, body, highlights)</span>
          </label>
          <textarea
            value={secondaryKeywords}
            onChange={e => onSecondaryChange(e.target.value)}
            placeholder={"Wednesday quiz night\nteam quiz evening\npub trivia prizes"}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <KeywordCount raw={secondaryKeywords} />
        </div>

        <div>
          <label className="text-xs font-medium text-foreground/80 block mb-1">
            Local SEO Keywords
            <span className="text-muted-foreground font-normal ml-1">(2-4 terms — venue context, directions, local search)</span>
          </label>
          <textarea
            value={localSeoKeywords}
            onChange={e => onLocalChange(e.target.value)}
            placeholder={"things to do Sipson\nWest Drayton evening out\nnear Heathrow pubs"}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <KeywordCount raw={localSeoKeywords} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/features/events/KeywordStrategyCard.tsx
git commit -m "feat: add KeywordStrategyCard component for three-tier keyword inputs"
```

---

## Task 6: FAQ Editor Component

**Why:** Display and edit AI-generated FAQ Q&A pairs in the SEO section.

**Files:**
- Create: `src/components/features/events/FaqEditor.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/features/events/FaqEditor.tsx`:

```typescript
'use client'

import { useState } from 'react'

interface FaqItem {
  question: string
  answer: string
  sort_order?: number
}

interface FaqEditorProps {
  faqs: FaqItem[]
  onChange: (faqs: FaqItem[]) => void
  onModified: () => void
}

export default function FaqEditor({ faqs, onChange, onModified }: FaqEditorProps) {
  const updateFaq = (index: number, field: 'question' | 'answer', value: string) => {
    const updated = faqs.map((faq, i) =>
      i === index ? { ...faq, [field]: value } : faq
    )
    onChange(updated)
    onModified()
  }

  const removeFaq = (index: number) => {
    const updated = faqs.filter((_, i) => i !== index)
    onChange(updated)
    onModified()
  }

  const addFaq = () => {
    onChange([...faqs, { question: '', answer: '', sort_order: faqs.length }])
    onModified()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground/80">
          FAQs
          <span className="text-muted-foreground font-normal ml-1">({faqs.length} items — feeds FAQ schema markup)</span>
        </label>
        {faqs.length < 8 && (
          <button
            type="button"
            onClick={addFaq}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Add FAQ
          </button>
        )}
      </div>

      {faqs.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No FAQs yet. Generate with AI or add manually.
        </p>
      )}

      {faqs.map((faq, index) => (
        <div key={index} className="rounded-md border border-border bg-background/50 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2">
              <input
                type="text"
                value={faq.question}
                onChange={e => updateFaq(index, 'question', e.target.value)}
                placeholder="Question..."
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <textarea
                value={faq.answer}
                onChange={e => updateFaq(index, 'answer', e.target.value)}
                placeholder="Answer..."
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="button"
              onClick={() => removeFaq(index)}
              className="text-xs text-red-400 hover:text-red-300 mt-1"
              aria-label={`Remove FAQ ${index + 1}`}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/features/events/FaqEditor.tsx
git commit -m "feat: add FaqEditor component for viewing and editing FAQ Q&A pairs"
```

---

## Task 7: SEO Health Indicator Component

**Why:** Client-side SEO completeness score with colour-coded feedback.

**Files:**
- Create: `src/components/features/events/SeoHealthIndicator.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/features/events/SeoHealthIndicator.tsx`:

```typescript
'use client'

import { useMemo } from 'react'

interface SeoHealthProps {
  metaTitle: string
  metaDescription: string
  shortDescription: string
  longDescription: string
  slug: string
  highlights: string
  primaryKeywords: string[]
  imageAltText: string
  faqCount: number
  socialCopyPresent: boolean
  accessibilityNotes: string
}

interface Check {
  label: string
  points: number
  pass: boolean
}

function containsKeyword(text: string, keywords: string[]): boolean {
  if (!text || keywords.length === 0) return false
  const lower = text.toLowerCase()
  return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export default function SeoHealthIndicator(props: SeoHealthProps) {
  const checks = useMemo<Check[]>(() => {
    const {
      metaTitle, metaDescription, shortDescription, longDescription,
      slug, highlights, primaryKeywords, imageAltText, faqCount,
      socialCopyPresent, accessibilityNotes
    } = props

    const highlightItems = highlights.split(',').map(s => s.trim()).filter(Boolean)

    return [
      { label: 'Meta title present & under 60 chars', points: 10, pass: metaTitle.length > 0 && metaTitle.length <= 60 },
      { label: 'Meta description present & under 160 chars', points: 10, pass: metaDescription.length > 0 && metaDescription.length <= 160 },
      { label: 'Primary keyword in meta title', points: 10, pass: containsKeyword(metaTitle, primaryKeywords) },
      { label: 'Primary keyword in meta description', points: 10, pass: containsKeyword(metaDescription, primaryKeywords) },
      { label: 'Short description present', points: 5, pass: shortDescription.length > 0 },
      { label: 'Long description 300+ words', points: 10, pass: wordCount(longDescription) >= 300 },
      { label: 'Primary keyword in first 100 words', points: 10, pass: containsKeyword(longDescription.split(/\s+/).slice(0, 100).join(' '), primaryKeywords) },
      { label: 'At least 3 FAQs', points: 10, pass: faqCount >= 3 },
      { label: 'Image alt text present', points: 5, pass: imageAltText.length > 0 },
      { label: '3+ highlights', points: 5, pass: highlightItems.length >= 3 },
      { label: 'Social copy present', points: 5, pass: socialCopyPresent },
      { label: 'Keyword-rich slug', points: 5, pass: containsKeyword(slug, primaryKeywords) },
      { label: 'Accessibility notes present', points: 5, pass: accessibilityNotes.length > 0 },
    ]
  }, [props])

  const score = checks.reduce((sum, c) => sum + (c.pass ? c.points : 0), 0)
  const colour = score >= 71 ? 'text-green-400' : score >= 41 ? 'text-amber-400' : 'text-red-400'
  const bgColour = score >= 71 ? 'bg-green-400' : score >= 41 ? 'bg-amber-400' : 'bg-red-400'
  const barWidth = `${score}%`

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground/80">SEO Health</span>
        <span className={`text-sm font-bold ${colour}`}>{score}/100</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden mb-2">
        <div className={`h-full rounded-full ${bgColour} transition-all duration-300`} style={{ width: barWidth }} />
      </div>
      <div className="grid grid-cols-2 gap-1">
        {checks.map((check, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span className={check.pass ? 'text-green-400' : 'text-muted-foreground'}>
              {check.pass ? '\u2713' : '\u2717'}
            </span>
            <span className={check.pass ? 'text-foreground/70' : 'text-muted-foreground'}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/features/events/SeoHealthIndicator.tsx
git commit -m "feat: add SeoHealthIndicator component with scoring and colour-coded checks"
```

---

## Task 8: DebouncedTextarea Flush Support

**Why:** Need to flush debounced fields before AI generation to avoid stale state reads.

**Files:**
- Modify: `src/components/ui-v2/forms/DebouncedTextarea.tsx`

- [ ] **Step 1: Add forwardRef and imperative flush handle**

Read the current `DebouncedTextarea.tsx` and update it to expose a `flush()` method via `useImperativeHandle`:

```typescript
'use client'

import { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react'
import { Textarea, type TextareaProps } from '@/components/ui/textarea'

export interface DebouncedTextareaRef {
  flush: () => void
}

interface DebouncedTextareaProps extends Omit<TextareaProps, 'value' | 'onChange'> {
  value: string
  onValueChange: (value: string) => void
  debounceMs?: number
}

const DebouncedTextarea = forwardRef<DebouncedTextareaRef, DebouncedTextareaProps>(
  function DebouncedTextarea({ value, onValueChange, debounceMs = 300, ...props }, ref) {
    const [localValue, setLocalValue] = useState(value)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const latestLocalRef = useRef(localValue)

    useEffect(() => {
      setLocalValue(value)
    }, [value])

    useEffect(() => {
      latestLocalRef.current = localValue
    }, [localValue])

    const flush = useCallback(() => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      if (latestLocalRef.current !== value) {
        onValueChange(latestLocalRef.current)
      }
    }, [value, onValueChange])

    useImperativeHandle(ref, () => ({ flush }), [flush])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setLocalValue(newValue)
      latestLocalRef.current = newValue

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        onValueChange(newValue)
      }, debounceMs)
    }

    return <Textarea {...props} value={localValue} onChange={handleChange} />
  }
)

export default DebouncedTextarea
export type { DebouncedTextareaProps }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui-v2/forms/DebouncedTextarea.tsx
git commit -m "feat: add flush() method to DebouncedTextarea via forwardRef"
```

---

## Task 9: Update EventFormGrouped — Keyword Inputs and New Fields

**Why:** Add keyword strategy card to Basic Information, add new fields to SEO section, restructure into groups.

**Files:**
- Modify: `src/components/features/events/EventFormGrouped.tsx`

- [ ] **Step 1: Add imports**

Add at the top of EventFormGrouped.tsx:

```typescript
import KeywordStrategyCard from './KeywordStrategyCard'
import FaqEditor from './FaqEditor'
import SeoHealthIndicator from './SeoHealthIndicator'
import { parseKeywords, keywordsToDisplay, buildKeywordsUnion } from '@/lib/keywords'
import DebouncedTextarea, { type DebouncedTextareaRef } from '@/components/ui-v2/forms/DebouncedTextarea'
```

- [ ] **Step 2: Add new state variables**

After the existing useState declarations (around line 106), add:

```typescript
// Keyword strategy (raw textarea values)
const [primaryKeywords, setPrimaryKeywords] = useState(keywordsToDisplay((event as any)?.primary_keywords))
const [secondaryKeywords, setSecondaryKeywords] = useState(keywordsToDisplay((event as any)?.secondary_keywords))
const [localSeoKeywords, setLocalSeoKeywords] = useState(keywordsToDisplay((event as any)?.local_seo_keywords))

// Legacy keyword migration: if event has flat keywords but no tiers, pre-populate secondary
const hasLegacyKeywordsOnly = event?.keywords?.length > 0
  && !(event as any)?.primary_keywords?.length
  && !(event as any)?.secondary_keywords?.length
  && !(event as any)?.local_seo_keywords?.length
if (hasLegacyKeywordsOnly && !secondaryKeywords) {
  setSecondaryKeywords(keywordsToDisplay(event.keywords))
}

// New SEO fields
const [imageAltText, setImageAltText] = useState((event as any)?.image_alt_text ?? '')
const [socialCopyWhatsapp, setSocialCopyWhatsapp] = useState((event as any)?.social_copy_whatsapp ?? '')
const [previousEventSummary, setPreviousEventSummary] = useState((event as any)?.previous_event_summary ?? '')
const [attendanceNote, setAttendanceNote] = useState((event as any)?.attendance_note ?? '')
const [cancellationPolicy, setCancellationPolicy] = useState((event as any)?.cancellation_policy ?? '')
const [accessibilityNotes, setAccessibilityNotes] = useState((event as any)?.accessibility_notes ?? '')

// DebouncedTextarea refs for flushing
const briefRef = useRef<DebouncedTextareaRef>(null)
const shortDescRef = useRef<DebouncedTextareaRef>(null)
const longDescRef = useRef<DebouncedTextareaRef>(null)
```

- [ ] **Step 3: Add new fields to handleSubmit eventData**

In the handleSubmit function, add to the eventData object:

```typescript
primary_keywords: parseKeywords(primaryKeywords),
secondary_keywords: parseKeywords(secondaryKeywords),
local_seo_keywords: parseKeywords(localSeoKeywords),
keywords: buildKeywordsUnion(
  parseKeywords(primaryKeywords),
  parseKeywords(secondaryKeywords),
  parseKeywords(localSeoKeywords)
),
image_alt_text: imageAltText || null,
social_copy_whatsapp: socialCopyWhatsapp || null,
previous_event_summary: previousEventSummary || null,
attendance_note: attendanceNote || null,
cancellation_policy: cancellationPolicy || null,
accessibility_notes: accessibilityNotes || null,
...(faqsModified ? { faqs } : {}),
```

- [ ] **Step 4: Add keyword inputs to Basic Information section**

After the Brief textarea (around line 447), add:

```tsx
<KeywordStrategyCard
  primaryKeywords={primaryKeywords}
  secondaryKeywords={secondaryKeywords}
  localSeoKeywords={localSeoKeywords}
  onPrimaryChange={setPrimaryKeywords}
  onSecondaryChange={setSecondaryKeywords}
  onLocalChange={setLocalSeoKeywords}
/>
```

- [ ] **Step 5: Restructure the SEO & Content section**

Replace the entire SEO & Content section (lines 652-794) with the new grouped layout. The section should contain:

**Group 1: Meta & URL** — slug, metaTitle (60 char), metaDescription (160 char)

**Group 2: Content** — shortDescription (500 char), longDescription, highlights

**Group 3: AI-Generated & E-E-A-T Content** — imageAltText, FaqEditor, facebookEventName + facebookEventDescription (existing fields), socialCopyWhatsapp, previousEventSummary (manual, with placeholder), attendanceNote (manual, with placeholder), cancellationPolicy (with "Draft" label), accessibilityNotes

**Group 4: SEO Health Indicator**

The "Generate All Content" button replaces "Generate with AI" in the section header. Add a tooltip or help text near the button: "AI uses saved event details. Save changes first if you've updated event basics."

Remove the standalone "Keywords" field (comma-separated input) from this section — it's replaced by the three-tier inputs in Basic Information.

- [ ] **Step 6: Add DebouncedTextarea flush before AI generation**

In the handleGenerateSeo function, add at the beginning (before any data reads):

```typescript
// Flush debounced fields to ensure we read current values
briefRef.current?.flush()
shortDescRef.current?.flush()
longDescRef.current?.flush()
```

And attach refs to the corresponding DebouncedTextarea components:

```tsx
<DebouncedTextarea ref={briefRef} value={brief} onValueChange={setBrief} ... />
<DebouncedTextarea ref={shortDescRef} value={shortDescription} onValueChange={setShortDescription} ... />
<DebouncedTextarea ref={longDescRef} value={longDescription} onValueChange={setLongDescription} ... />
```

- [ ] **Step 7: Update handleCategoryChange for new fields**

Add cascading for the new fields in handleCategoryChange (only fill empty fields):

```typescript
if (!primaryKeywords && cat.primary_keywords?.length) setPrimaryKeywords(keywordsToDisplay(cat.primary_keywords))
if (!secondaryKeywords && cat.secondary_keywords?.length) setSecondaryKeywords(keywordsToDisplay(cat.secondary_keywords))
if (!localSeoKeywords && cat.local_seo_keywords?.length) setLocalSeoKeywords(keywordsToDisplay(cat.local_seo_keywords))
if (!cancellationPolicy && cat.cancellation_policy) setCancellationPolicy(cat.cancellation_policy)
if (!accessibilityNotes && cat.accessibility_notes) setAccessibilityNotes(cat.accessibility_notes)
if (!imageAltText && cat.image_alt_text) setImageAltText(cat.image_alt_text)
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/features/events/EventFormGrouped.tsx
git commit -m "feat: add keyword strategy inputs, restructured SEO section, FAQ editor, and SEO health indicator"
```

---

## Task 10: Update AI Generation — Keyword-Aware Prompt

**Why:** The AI must use keywords to produce targeted content across all fields.

**Files:**
- Modify: `src/app/actions/event-content.ts`

- [ ] **Step 1: Extend the input type**

Add to `EventSeoContentInput`:

```typescript
primaryKeywords?: string[]
secondaryKeywords?: string[]
localSeoKeywords?: string[]
```

- [ ] **Step 2: Update the AI prompt**

Update the system message and user message to include keyword placement rules. The user message should include:

```typescript
const keywordContext = [
  input.primaryKeywords?.length ? `PRIMARY KEYWORDS (use in title, meta description, slug, first paragraph): ${input.primaryKeywords.join(', ')}` : '',
  input.secondaryKeywords?.length ? `SECONDARY KEYWORDS (use in headings, body, highlights, FAQ questions, Facebook copy): ${input.secondaryKeywords.join(', ')}` : '',
  input.localSeoKeywords?.length ? `LOCAL SEO KEYWORDS (use in venue context, FAQ answers, WhatsApp copy): ${input.localSeoKeywords.join(', ')}` : '',
].filter(Boolean).join('\n')
```

Add keyword placement rules to the prompt:
- Primary keywords: meta title (front-loaded), meta description (first clause), slug, short description (first sentence), long description (first 100 words), image alt text
- Secondary keywords: long description body, at least 2 highlights, at least 2 FAQ questions, Facebook copy
- Local SEO keywords: long description venue paragraph, at least 1 FAQ answer, WhatsApp copy
- No keyword stuffing — each keyword 1-2 times max per field
- Natural language only — skip if it doesn't fit

- [ ] **Step 3: Expand the structured output schema**

Update the `json_schema` response format to include new fields:

```typescript
properties: {
  metaTitle: { type: 'string' },
  metaDescription: { type: 'string' },
  shortDescription: { type: 'string' },
  longDescription: { type: 'string' },
  highlights: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
  keywords: { type: 'array', items: { type: 'string' }, minItems: 6, maxItems: 12 },
  slug: { type: 'string' },
  imageAltText: { type: 'string' },
  faqs: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        answer: { type: 'string' }
      },
      required: ['question', 'answer']
    },
    minItems: 3,
    maxItems: 5
  },
  facebookEventName: { type: 'string' },
  facebookEventDescription: { type: 'string' },
  socialCopyWhatsapp: { type: 'string' },
  cancellationPolicy: { type: ['string', 'null'] }
},
required: ['metaTitle', 'metaDescription', 'shortDescription', 'longDescription',
           'highlights', 'keywords', 'slug', 'imageAltText', 'faqs',
           'facebookEventName', 'facebookEventDescription', 'socialCopyWhatsapp']
```

- [ ] **Step 4: Increase token budget**

Change `max_tokens: 1500` to `max_tokens: 3500`.

- [ ] **Step 5: Update the return value**

Add the new fields to the success return:

```typescript
return {
  success: true,
  data: {
    ...existingFields,
    imageAltText: parsed.imageAltText || null,
    faqs: parsed.faqs || [],
    facebookEventName: parsed.facebookEventName || null,
    facebookEventDescription: parsed.facebookEventDescription || null,
    socialCopyWhatsapp: parsed.socialCopyWhatsapp || null,
    cancellationPolicy: parsed.cancellationPolicy || null,
  }
}
```

- [ ] **Step 6: Update handleGenerateSeo in EventFormGrouped to pass keywords and handle new outputs**

In the handleGenerateSeo function, add keywords to the input:

```typescript
primaryKeywords: parseKeywords(primaryKeywords),
secondaryKeywords: parseKeywords(secondaryKeywords),
localSeoKeywords: parseKeywords(localSeoKeywords),
```

And handle new outputs:

```typescript
if (result.data.imageAltText) setImageAltText(result.data.imageAltText)
if (result.data.faqs?.length) {
  setFaqs(result.data.faqs.map((faq, i) => ({ ...faq, sort_order: i })))
  setFaqsModified(true)
}
if (result.data.facebookEventName) setFacebookEventName(result.data.facebookEventName)
if (result.data.facebookEventDescription) setFacebookEventDescription(result.data.facebookEventDescription)
if (result.data.socialCopyWhatsapp) setSocialCopyWhatsapp(result.data.socialCopyWhatsapp)
if (result.data.cancellationPolicy) setCancellationPolicy(result.data.cancellationPolicy)
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/actions/event-content.ts src/components/features/events/EventFormGrouped.tsx
git commit -m "feat: keyword-aware AI generation with expanded output — FAQs, social copy, alt text, cancellation policy"
```

---

## Task 11: Update API Routes

**Why:** New fields must be explicitly added to the response shapers.

**Files:**
- Modify: `src/app/api/events/route.ts`
- Modify: `src/app/api/events/[id]/route.ts`

- [ ] **Step 1: Update the events list route response shaper**

In `src/app/api/events/route.ts`, in the event mapping (around line 161), add the new fields to each event object:

```typescript
primary_keywords: event.primary_keywords || [],
secondary_keywords: event.secondary_keywords || [],
local_seo_keywords: event.local_seo_keywords || [],
image_alt_text: event.image_alt_text || null,
social_copy_whatsapp: event.social_copy_whatsapp || null,
previous_event_summary: event.previous_event_summary || null,
attendance_note: event.attendance_note || null,
cancellation_policy: event.cancellation_policy || null,
accessibility_notes: event.accessibility_notes || null,
```

- [ ] **Step 2: Update the single event route response shaper**

In `src/app/api/events/[id]/route.ts`, add the same fields to the response object.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/events/route.ts src/app/api/events/\[id\]/route.ts
git commit -m "feat: expose new SEO keyword fields in events API response"
```

---

## Task 12: Update Schema.org Output

**Why:** Add accessibilityFeature, refundPolicy, and image alt to structured data.

**Files:**
- Modify: `src/lib/api/schema.ts`

- [ ] **Step 1: Update SchemaEvent interface**

Add to the SchemaEvent interface:

```typescript
accessibilityFeature?: string[]
refundPolicy?: string
```

- [ ] **Step 2: Update eventToSchema function**

In the `eventToSchema` function, add:

```typescript
// Accessibility features from accessibility_notes
if (event.accessibility_notes) {
  schema.accessibilityFeature = [event.accessibility_notes]
}

// Refund policy from cancellation_policy
if (event.cancellation_policy) {
  schema.refundPolicy = event.cancellation_policy
}

// Image alt text — add to image objects if available
if (event.image_alt_text && schema.image && Array.isArray(schema.image)) {
  // Schema.org images can be strings or ImageObject — we keep as strings but add alt via separate property
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/schema.ts
git commit -m "feat: add accessibilityFeature and refundPolicy to Schema.org event output"
```

---

## Task 13: Update Category Edit Form

**Why:** Categories need a UI for editing the new default fields.

**Files:**
- Modify: `src/components/features/events/EventCategoryFormGrouped.tsx`

- [ ] **Step 1: Add state for new fields**

Add state variables for the new category fields:

```typescript
const [primaryKeywords, setPrimaryKeywords] = useState(keywordsToDisplay(category?.primary_keywords))
const [secondaryKeywords, setSecondaryKeywords] = useState(keywordsToDisplay(category?.secondary_keywords))
const [localSeoKeywords, setLocalSeoKeywords] = useState(keywordsToDisplay(category?.local_seo_keywords))
const [imageAltText, setImageAltText] = useState(category?.image_alt_text ?? '')
const [cancellationPolicy, setCancellationPolicy] = useState(category?.cancellation_policy ?? '')
const [accessibilityNotes, setAccessibilityNotes] = useState(category?.accessibility_notes ?? '')
```

- [ ] **Step 2: Add the new fields to the SEO & Content section**

Add keyword strategy inputs and the new fields (image alt text, cancellation policy, accessibility notes) to the category form's SEO section.

- [ ] **Step 3: Add new fields to handleSubmit**

Include the new fields in the categoryData object passed to onSubmit:

```typescript
primary_keywords: parseKeywords(primaryKeywords),
secondary_keywords: parseKeywords(secondaryKeywords),
local_seo_keywords: parseKeywords(localSeoKeywords),
image_alt_text: imageAltText || null,
cancellation_policy: cancellationPolicy || null,
accessibility_notes: accessibilityNotes || null,
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/events/EventCategoryFormGrouped.tsx
git commit -m "feat: add keyword and SEO default fields to category edit form"
```

---

## Task 14: Full Verification

**Why:** End-to-end verification that everything builds, lints, and types correctly.

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: Zero errors, zero warnings.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful production build.

- [ ] **Step 5: Manual smoke test**

1. Start dev server: `npm run dev`
2. Navigate to an existing event edit page
3. Verify keyword strategy card appears after Brief in Basic Information
4. Verify SEO & Content section shows restructured groups
5. Enter keywords in all three tiers
6. Click "Generate All Content"
7. Verify all fields populate (meta, descriptions, highlights, alt text, FAQs, social copy)
8. Verify SEO health indicator updates
9. Save the event
10. Reload the page — verify all fields persisted including FAQs
11. Edit the event again (change only name) — verify FAQs are preserved

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
