# Consolidate event_type into event_categories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `events.event_type` a derived field from `event_categories.slug`, remove the free-text input from all forms, and update analytics/API consumers to prefer category name for display.

**Architecture:** The server action derives `event_type` from the selected category's slug before passing to the RPC. The DB migration fixes the `update_event_transaction` RPC so null values can clear stale data, then backfills all categorised events. UI forms lose the free-text input; badges and reports switch to category name.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase PostgreSQL RPCs, Tailwind CSS

---

### Task 1: Fix update_event_transaction RPC and backfill data

The current `update_event_transaction` uses `COALESCE(NULLIF(...), event_type)` which prevents clearing `event_type` when a category is removed. Fix this first so subsequent application changes can properly null out the field.

**Files:**
- Create: `supabase/migrations/20260701000001_derive_event_type_from_category.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Fix update_event_transaction: allow event_type to be cleared when explicitly sent as null/empty
-- Then backfill all categorised events with their category slug

-- Step 1: Recreate update_event_transaction with fixed event_type handling
-- The current line is:
--   event_type = CASE WHEN p_event_data ? 'event_type' THEN COALESCE(NULLIF(TRIM(p_event_data->>'event_type'), ''), event_type) ELSE event_type END,
-- The COALESCE falls back to the existing event_type, which prevents clearing.
-- New line allows null through:
--   event_type = CASE WHEN p_event_data ? 'event_type' THEN NULLIF(TRIM(p_event_data->>'event_type'), '') ELSE event_type END,

CREATE OR REPLACE FUNCTION public.update_event_transaction(
  p_event_id UUID,
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_event_row RECORD;
  v_result JSONB;
BEGIN
  -- Update the event row
  UPDATE public.events SET
    name              = CASE WHEN p_event_data ? 'name'              THEN COALESCE(p_event_data->>'name', name) ELSE name END,
    date              = CASE WHEN p_event_data ? 'date'              THEN COALESCE((p_event_data->>'date')::DATE, date) ELSE date END,
    time              = CASE WHEN p_event_data ? 'time'              THEN (p_event_data->>'time')::TIME ELSE time END,
    end_time          = CASE WHEN p_event_data ? 'end_time'          THEN (p_event_data->>'end_time')::TIME ELSE end_time END,
    duration_minutes  = CASE WHEN p_event_data ? 'duration_minutes'  THEN (p_event_data->>'duration_minutes')::INTEGER ELSE duration_minutes END,
    doors_time        = CASE WHEN p_event_data ? 'doors_time'        THEN (p_event_data->>'doors_time')::TIME ELSE doors_time END,
    last_entry_time   = CASE WHEN p_event_data ? 'last_entry_time'   THEN (p_event_data->>'last_entry_time')::TIME ELSE last_entry_time END,
    event_status      = CASE WHEN p_event_data ? 'event_status'      THEN COALESCE(p_event_data->>'event_status', event_status) ELSE event_status END,
    booking_mode      = CASE WHEN p_event_data ? 'booking_mode'      THEN COALESCE(NULLIF(p_event_data->>'booking_mode', ''), booking_mode) ELSE booking_mode END,
    booking_open      = CASE WHEN p_event_data ? 'booking_open'      THEN COALESCE((p_event_data->>'booking_open')::BOOLEAN, booking_open) ELSE booking_open END,
    booking_url       = CASE WHEN p_event_data ? 'booking_url'       THEN p_event_data->>'booking_url' ELSE booking_url END,
    event_type        = CASE WHEN p_event_data ? 'event_type'        THEN NULLIF(TRIM(p_event_data->>'event_type'), '') ELSE event_type END,
    performer_name    = CASE WHEN p_event_data ? 'performer_name'    THEN p_event_data->>'performer_name' ELSE performer_name END,
    performer_type    = CASE WHEN p_event_data ? 'performer_type'    THEN p_event_data->>'performer_type' ELSE performer_type END,
    price             = CASE WHEN p_event_data ? 'price'             THEN COALESCE((p_event_data->>'price')::DECIMAL, price) ELSE price END,
    price_per_seat    = CASE WHEN p_event_data ? 'price_per_seat'    THEN (p_event_data->>'price_per_seat')::NUMERIC(10,2) ELSE price_per_seat END,
    is_free           = CASE WHEN p_event_data ? 'is_free'           THEN COALESCE((p_event_data->>'is_free')::BOOLEAN, is_free) ELSE is_free END,
    payment_mode      = CASE WHEN p_event_data ? 'payment_mode'      THEN COALESCE(NULLIF(p_event_data->>'payment_mode', ''), payment_mode) ELSE payment_mode END,
    start_datetime    = CASE WHEN p_event_data ? 'start_datetime'    THEN (p_event_data->>'start_datetime')::TIMESTAMPTZ ELSE start_datetime END,
    capacity          = CASE WHEN p_event_data ? 'capacity'          THEN (p_event_data->>'capacity')::INTEGER ELSE capacity END,
    category_id       = CASE WHEN p_event_data ? 'category_id'       THEN (p_event_data->>'category_id')::UUID ELSE category_id END,
    short_description = CASE WHEN p_event_data ? 'short_description' THEN p_event_data->>'short_description' ELSE short_description END,
    long_description  = CASE WHEN p_event_data ? 'long_description'  THEN p_event_data->>'long_description' ELSE long_description END,
    brief             = CASE WHEN p_event_data ? 'brief'             THEN p_event_data->>'brief' ELSE brief END,
    highlights        = CASE WHEN p_event_data ? 'highlights'        THEN (p_event_data->'highlights')::JSONB ELSE highlights END,
    keywords          = CASE WHEN p_event_data ? 'keywords'          THEN (p_event_data->'keywords')::JSONB ELSE keywords END,
    primary_keywords  = CASE WHEN p_event_data ? 'primary_keywords'  THEN (p_event_data->'primary_keywords')::JSONB ELSE primary_keywords END,
    secondary_keywords = CASE WHEN p_event_data ? 'secondary_keywords' THEN (p_event_data->'secondary_keywords')::JSONB ELSE secondary_keywords END,
    local_seo_keywords = CASE WHEN p_event_data ? 'local_seo_keywords' THEN (p_event_data->'local_seo_keywords')::JSONB ELSE local_seo_keywords END,
    image_alt_text    = CASE WHEN p_event_data ? 'image_alt_text'    THEN p_event_data->>'image_alt_text' ELSE image_alt_text END,
    social_copy_whatsapp = CASE WHEN p_event_data ? 'social_copy_whatsapp' THEN p_event_data->>'social_copy_whatsapp' ELSE social_copy_whatsapp END,
    previous_event_summary = CASE WHEN p_event_data ? 'previous_event_summary' THEN p_event_data->>'previous_event_summary' ELSE previous_event_summary END,
    attendance_note   = CASE WHEN p_event_data ? 'attendance_note'   THEN p_event_data->>'attendance_note' ELSE attendance_note END,
    cancellation_policy = CASE WHEN p_event_data ? 'cancellation_policy' THEN p_event_data->>'cancellation_policy' ELSE cancellation_policy END,
    accessibility_notes = CASE WHEN p_event_data ? 'accessibility_notes' THEN p_event_data->>'accessibility_notes' ELSE accessibility_notes END,
    slug              = CASE WHEN p_event_data ? 'slug'              THEN p_event_data->>'slug' ELSE slug END,
    meta_title        = CASE WHEN p_event_data ? 'meta_title'        THEN p_event_data->>'meta_title' ELSE meta_title END,
    meta_description  = CASE WHEN p_event_data ? 'meta_description'  THEN p_event_data->>'meta_description' ELSE meta_description END,
    hero_image_url    = CASE WHEN p_event_data ? 'hero_image_url'    THEN p_event_data->>'hero_image_url' ELSE hero_image_url END,
    thumbnail_image_url = CASE WHEN p_event_data ? 'thumbnail_image_url' THEN p_event_data->>'thumbnail_image_url' ELSE thumbnail_image_url END,
    poster_image_url  = CASE WHEN p_event_data ? 'poster_image_url'  THEN p_event_data->>'poster_image_url' ELSE poster_image_url END,
    promo_video_url   = CASE WHEN p_event_data ? 'promo_video_url'   THEN p_event_data->>'promo_video_url' ELSE promo_video_url END,
    highlight_video_urls = CASE WHEN p_event_data ? 'highlight_video_urls' THEN (p_event_data->'highlight_video_urls')::JSONB ELSE highlight_video_urls END,
    gallery_image_urls = CASE WHEN p_event_data ? 'gallery_image_urls' THEN (p_event_data->'gallery_image_urls')::JSONB ELSE gallery_image_urls END,
    promo_sms_enabled = CASE WHEN p_event_data ? 'promo_sms_enabled' THEN COALESCE((p_event_data->>'promo_sms_enabled')::BOOLEAN, promo_sms_enabled) ELSE promo_sms_enabled END,
    bookings_enabled  = CASE WHEN p_event_data ? 'bookings_enabled'  THEN COALESCE((p_event_data->>'bookings_enabled')::BOOLEAN, bookings_enabled) ELSE bookings_enabled END,
    date_tbd          = CASE WHEN p_event_data ? 'date_tbd'          THEN COALESCE((p_event_data->>'date_tbd')::BOOLEAN, date_tbd) ELSE date_tbd END,
    updated_at        = NOW()
  WHERE id = p_event_id
  RETURNING * INTO v_event_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', p_event_id;
  END IF;

  -- Handle FAQs if provided
  IF p_faqs IS NOT NULL THEN
    DELETE FROM public.event_faqs WHERE event_id = p_event_id;

    INSERT INTO public.event_faqs (event_id, question, answer, sort_order)
    SELECT
      p_event_id,
      (faq->>'question')::TEXT,
      (faq->>'answer')::TEXT,
      COALESCE((faq->>'sort_order')::INTEGER, idx)
    FROM jsonb_array_elements(p_faqs) WITH ORDINALITY AS t(faq, idx)
    WHERE (faq->>'question') IS NOT NULL AND TRIM(faq->>'question') != '';
  END IF;

  SELECT to_jsonb(v_event_row) INTO v_result;
  RETURN v_result;
END;
$fn$;

-- Step 2: Backfill all categorised events with their category slug
UPDATE public.events e
SET event_type = ec.slug
FROM public.event_categories ec
WHERE e.category_id = ec.id
  AND e.event_type IS DISTINCT FROM ec.slug;

-- Step 3: Clear event_type on uncategorised events (safety net)
UPDATE public.events
SET event_type = NULL
WHERE category_id IS NULL
  AND NULLIF(TRIM(event_type), '') IS NOT NULL;
```

Note: The full RPC body is copied from migration `20260615000000_add_event_promo_sms_and_bookings_enabled.sql` with subsequent columns added by later migrations (`date_tbd` from `20260629000000`). The only change is line:
`event_type = CASE WHEN p_event_data ? 'event_type' THEN NULLIF(TRIM(p_event_data->>'event_type'), '') ELSE event_type END,`
— removed `COALESCE(..., event_type)` so null/empty values clear instead of preserving stale data.

Before writing the file, verify the full current RPC definition by reading the latest migration that defines it. The migration above must match every column the current RPC handles, plus any added since `20260615000000`.

- [ ] **Step 2: Verify the migration matches current RPC columns**

Run:
```bash
grep -c 'CASE WHEN p_event_data' supabase/migrations/20260615000000_add_event_promo_sms_and_bookings_enabled.sql
```
Expected: a count of all CASE columns in the update function. Compare with the count in your migration.

Also check for columns added by later migrations:
```bash
grep -l 'update_event_transaction\|ALTER TABLE.*events.*ADD' supabase/migrations/2026070*.sql supabase/migrations/2026069*.sql 2>/dev/null
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260701000001_derive_event_type_from_category.sql
git commit -m "fix: allow event_type to be cleared in update RPC and backfill from category slugs"
```

---

### Task 2: Derive event_type from category slug in server action

Stop reading `event_type` from FormData. Instead derive it from the category's slug in `prepareEventDataFromFormData`.

**Files:**
- Modify: `src/app/actions/events.ts:80-175`

- [ ] **Step 1: Add `slug` to the category select and derive event_type**

In `src/app/actions/events.ts`, the `prepareEventDataFromFormData` function already fetches the category at line 87. Add `slug` to the select list and capture it.

Change the select (line 89-116) from:
```ts
    const { data: category } = await supabase
      .from('event_categories')
      .select(`
        default_start_time,
        default_end_time,
        ...
        default_bookings_enabled
      `)
      .eq('id', categoryId)
      .single();
```

To add `slug` at the top of the select:
```ts
    const { data: category } = await supabase
      .from('event_categories')
      .select(`
        slug,
        default_start_time,
        default_end_time,
        ...
        default_bookings_enabled
      `)
      .eq('id', categoryId)
      .single();
```

Then capture the slug before the `categoryDefaults` block:
```ts
    let categorySlug: string | null = null;

    if (categoryId) {
      // ... existing query ...
      if (category) {
        categorySlug = category.slug || null;
        categoryDefaults = { ... };
      }
    }
```

- [ ] **Step 2: Replace event_type in the data object**

Change line 174 from:
```ts
    event_type: (rawData.event_type as string)?.trim() || null,
```

To:
```ts
    event_type: categorySlug,
```

This ignores any submitted `event_type` FormData value. The value is always derived from the category.

- [ ] **Step 3: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors related to events.ts

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/events.ts
git commit -m "refactor: derive event_type from category slug instead of form input"
```

---

### Task 3: Propagate category slug changes to existing events

When a category's slug changes via `EventCategoryService.updateCategory`, update `events.event_type` for all events in that category.

**Files:**
- Modify: `src/services/event-categories.ts:44-75`

- [ ] **Step 1: Add slug propagation after category update**

In `src/services/event-categories.ts`, after the successful category update (after line 70 where the update returns), add:

```ts
    if (error) {
      console.error('Category update error:', error);
      throw new Error(error.message);
    }

    // Propagate slug change to events.event_type compatibility column
    if (category && oldCategory.slug !== category.slug) {
      await admin
        .from('events')
        .update({ event_type: category.slug })
        .eq('category_id', id)
    }

    return category;
```

This must go after the category update succeeds but before returning. Read the full function first to find the exact insertion point.

- [ ] **Step 2: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/services/event-categories.ts
git commit -m "fix: propagate category slug changes to events.event_type"
```

---

### Task 4: Remove event_type input from EventDrawer

Remove the free-text `event_type` input from the main event form drawer.

**Files:**
- Modify: `src/app/(authenticated)/events/_components/EventDrawer.tsx`

- [ ] **Step 1: Remove eventType state variable**

Delete line 70:
```ts
  const [eventType, setEventType] = useState('')
```

- [ ] **Step 2: Remove eventType initialisation in useEffect**

Delete line 131:
```ts
      setEventType(event.event_type || '')
```

- [ ] **Step 3: Remove eventType from FormData submission**

Delete line 292:
```ts
      if (eventType.trim()) formData.set('event_type', eventType.trim())
```

- [ ] **Step 4: Remove the Event Type input and adjust layout**

Replace lines 450-463 (the `grid-cols-2` wrapper containing Category select and Event Type input):
```tsx
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Category"
                options={categoryOptions}
                value={categoryId}
                onChange={(e) => handleCategoryChange(e.target.value)}
              />
              <Input
                label="Event Type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="e.g. quiz_night"
              />
            </div>
```

With just the category select at full width:
```tsx
            <Select
              label="Category"
              options={categoryOptions}
              value={categoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
            />
```

- [ ] **Step 5: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authenticated)/events/_components/EventDrawer.tsx"
git commit -m "refactor: remove free-text event_type input from EventDrawer"
```

---

### Task 5: Remove event_type input from EventFormGrouped

Remove the free-text input from the legacy form component.

**Files:**
- Modify: `src/components/features/events/EventFormGrouped.tsx`

- [ ] **Step 1: Remove eventType state**

Delete line 92:
```ts
  const [eventType, setEventType] = useState(event?.event_type ?? '')
```

- [ ] **Step 2: Remove event_type from submit payload**

Delete line 191:
```ts
        event_type: eventType.trim() || null,
```

- [ ] **Step 3: Remove the event_type input element**

Delete lines 529-543 (the `sm:col-span-2` div containing the Event Type input):
```tsx
          <div className="sm:col-span-2">
            <label htmlFor="event_type" className="block text-sm font-medium leading-6 text-gray-900">
              Event Type
            </label>
            <div className="mt-2">
              <Input
                type="text"
                id="event_type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="e.g., open_mic, quiz_night, live_music"
                fullWidth
              />
            </div>
          </div>
```

- [ ] **Step 4: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/features/events/EventFormGrouped.tsx
git commit -m "refactor: remove free-text event_type input from EventFormGrouped"
```

---

### Task 6: Display category name in EventCard badge

Replace the `event_type` slug badge with a human-readable category name badge.

**Files:**
- Modify: `src/app/(authenticated)/events/_components/EventCard.tsx:32-84`

- [ ] **Step 1: Update the EventCard component**

The `Event` type passed to EventCard already includes the category relation from `getEvents()` which selects `category:event_categories(*)`. However the `Event` type in `database.ts` may not have a typed `category` field.

In `EventCard.tsx`, update the badge section. Replace lines 74-77:
```tsx
        {event.event_type && (
          <Badge tone="info">{event.event_type}</Badge>
        )}
```

With:
```tsx
        {(event as any).category?.name && (
          <Badge tone="info">{(event as any).category.name}</Badge>
        )}
```

Note: Using `(event as any)` because the `Event` type doesn't include the joined `category` relation. The query in `EventService.getEvents()` already selects `category:event_categories(*)`, so the data is present at runtime. A proper typed relation could be added in a follow-up, but is not needed for correctness here.

- [ ] **Step 2: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authenticated)/events/_components/EventCard.tsx"
git commit -m "refactor: display category name instead of event_type slug in EventCard"
```

---

### Task 7: Update public API to derive event_type from category slug

Change the `/api/events/[id]` response to source `event_type` from the joined category's slug rather than the raw column.

**Files:**
- Modify: `src/app/api/events/[id]/route.ts:184`

- [ ] **Step 1: Replace event_type source**

The route already loads the category at line 85-98 with `slug` in the select. Change line 184 from:
```ts
      event_type: event.event_type || null,
```

To:
```ts
      event_type: category?.slug ?? event.event_type ?? null,
```

This prefers the category slug (source of truth) with a fallback to the raw column for uncategorised events.

- [ ] **Step 2: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/events/[id]/route.ts"
git commit -m "refactor: derive event_type from category slug in public API response"
```

---

### Task 8: Update engagement scoring to prefer category name

Change the engagement scoring cron to use category name for human-readable interest labels.

**Files:**
- Modify: `src/lib/analytics/engagement-scoring.ts`

- [ ] **Step 1: Update the event relation type and queries**

Change the `EventRelationRecord` type (line 17-19) from:
```ts
type EventRelationRecord = {
  event_type?: string | null
}
```

To:
```ts
type EventRelationRecord = {
  event_type?: string | null
  category?: { name?: string | null } | null
}
```

- [ ] **Step 2: Update the resolveEventType function**

Change `resolveEventType` (line 43-46) from:
```ts
function resolveEventType(relation: EventRelation): string | null {
  const eventRecord = Array.isArray(relation) ? relation[0] : relation
  return normalizeEventType(eventRecord?.event_type)
}
```

To:
```ts
function resolveEventType(relation: EventRelation): string | null {
  const eventRecord = Array.isArray(relation) ? relation[0] : relation
  return normalizeEventType(eventRecord?.category?.name) ?? normalizeEventType(eventRecord?.event_type)
}
```

- [ ] **Step 3: Update the Supabase select queries**

Change the two `.select()` calls that fetch event relations.

Line 178:
```ts
        .select('customer_id, created_at, event:events(event_type)')
```
To:
```ts
        .select('customer_id, created_at, event:events(event_type, category:event_categories(name))')
```

Line 190:
```ts
        .select('customer_id, event:events(event_type)')
```
To:
```ts
        .select('customer_id, event:events(event_type, category:event_categories(name))')
```

- [ ] **Step 4: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/engagement-scoring.ts
git commit -m "refactor: use category name for engagement scoring interest labels"
```

---

### Task 9: Update table-booking-reports to prefer category name

Same pattern as engagement scoring — prefer category name for human-readable interest segment labels.

**Files:**
- Modify: `src/lib/analytics/table-booking-reports.ts`

- [ ] **Step 1: Update the event relation types**

Update the inline types at lines 861-873. Every occurrence of:
```ts
    event?: { event_type?: string | null } | { event_type?: string | null }[] | null
```

Change to:
```ts
    event?: { event_type?: string | null; category?: { name?: string | null } | null } | { event_type?: string | null; category?: { name?: string | null } | null }[] | null
```

- [ ] **Step 2: Update the appendInterest function**

Change line 880 from:
```ts
      const eventType = normalizeEventType(event?.event_type)
```

To:
```ts
      const eventType = normalizeEventType(event?.category?.name) ?? normalizeEventType(event?.event_type)
```

- [ ] **Step 3: Update the Supabase select queries**

Line 663:
```ts
        .select('customer_id, event:events(event_type)')
```
To:
```ts
        .select('customer_id, event:events(event_type, category:event_categories(name))')
```

Line 672:
```ts
        .select('customer_id, event:events(event_type)')
```
To:
```ts
        .select('customer_id, event:events(event_type, category:event_categories(name))')
```

- [ ] **Step 4: Verify build**

Run:
```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/table-booking-reports.ts
git commit -m "refactor: use category name for table-booking-report interest labels"
```

---

### Task 10: Add comment to service types documenting derived field

Document that `event_type` is server-derived in the service types so future developers don't reintroduce a user input.

**Files:**
- Modify: `src/services/events.ts:26`

- [ ] **Step 1: Add documentation comment**

Above line 26 (`event_type?: string | null;`), add:
```ts
  // Derived from event_categories.slug — not user-editable. Set by prepareEventDataFromFormData.
  event_type?: string | null;
```

- [ ] **Step 2: Commit**

```bash
git add src/services/events.ts
git commit -m "docs: document event_type as derived field in CreateEventInput"
```

---

### Task 11: Final verification

Run the full verification pipeline to confirm nothing is broken.

- [ ] **Step 1: Lint**

Run:
```bash
npm run lint
```
Expected: Zero errors, zero warnings

- [ ] **Step 2: Type check**

Run:
```bash
npx tsc --noEmit
```
Expected: Clean compilation

- [ ] **Step 3: Build**

Run:
```bash
npm run build
```
Expected: Successful production build

- [ ] **Step 4: Run tests**

Run:
```bash
npm test
```
Expected: All tests pass

- [ ] **Step 5: Post-migration verification SQL**

After applying the migration to the target database, run:
```sql
SELECT count(*) AS mismatched_categorized_events
FROM public.events e
JOIN public.event_categories ec ON ec.id = e.category_id
WHERE e.event_type IS DISTINCT FROM ec.slug;
```
Expected: `0`
