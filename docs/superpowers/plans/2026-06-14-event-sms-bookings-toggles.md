# Event SMS & Bookings Toggles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `promo_sms_enabled` and `bookings_enabled` toggles to events, with category defaults, SMS cron filtering, booking/waitlist guards, and public site UI changes.

**Architecture:** Two boolean columns on `events` + `event_categories`. `bookings_enabled` is an admin override alongside existing `booking_open` runtime flag. `promo_sms_enabled` controls automated/promotional SMS only — transactional SMS always sends. Changes span the full stack: migration → types → service → actions → form UI → cron jobs → management API → public site.

**Tech Stack:** PostgreSQL (PL/pgSQL RPCs), Next.js 15 App Router, React 19, TypeScript, Supabase, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-06-14-event-sms-bookings-toggles-design.md`

---

## Task 1: Database Migration — Add Columns & Update Transaction Functions

**Files:**
- Create: `supabase/migrations/20260615000000_add_event_promo_sms_and_bookings_enabled.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration: add promo_sms_enabled and bookings_enabled toggles
-- Description: Two independent boolean toggles on events and event_categories.
--   promo_sms_enabled controls automated/promotional SMS (transactional always sends).
--   bookings_enabled is an admin override alongside existing booking_open runtime flag.

BEGIN;

-- ============================================================
-- 1. Add columns to events
-- ============================================================
ALTER TABLE events ADD COLUMN promo_sms_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN bookings_enabled BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- 2. Add columns to event_categories
-- ============================================================
ALTER TABLE event_categories ADD COLUMN default_promo_sms_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE event_categories ADD COLUMN default_bookings_enabled BOOLEAN NOT NULL DEFAULT true;

-- ============================================================
-- 3. Recreate create_event_transaction with new fields
-- ============================================================
CREATE OR REPLACE FUNCTION create_event_transaction(
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_faq JSONB;
  v_sort INT := 0;
  v_start_datetime TIMESTAMPTZ;
BEGIN
  -- Compute start_datetime from date + time
  v_start_datetime := CASE
    WHEN p_event_data->>'date' IS NOT NULL AND p_event_data->>'time' IS NOT NULL
    THEN (
      (p_event_data->>'date') || 'T' || (p_event_data->>'time') || ':00'
    )::timestamptz
    ELSE NULL
  END;

  INSERT INTO events (
    name, date, time, capacity, category_id,
    short_description, long_description, brief,
    highlights, keywords, slug,
    meta_title, meta_description,
    end_time, duration_minutes, doors_time, last_entry_time,
    event_status, booking_mode, booking_open, booking_url,
    event_type, performer_name, performer_type,
    price, price_per_seat, is_free, payment_mode,
    start_datetime,
    hero_image_url, thumbnail_image_url, poster_image_url,
    promo_video_url, highlight_video_urls, gallery_image_urls,
    facebook_event_name, facebook_event_description,
    gbp_event_title, gbp_event_description,
    opentable_experience_title, opentable_experience_description,
    primary_keywords, secondary_keywords, local_seo_keywords,
    image_alt_text, social_copy_whatsapp,
    previous_event_summary, attendance_note,
    cancellation_policy, accessibility_notes,
    promo_sms_enabled, bookings_enabled
  ) VALUES (
    p_event_data->>'name',
    (p_event_data->>'date')::date,
    p_event_data->>'time',
    (p_event_data->>'capacity')::int,
    (p_event_data->>'category_id')::uuid,
    p_event_data->>'short_description',
    p_event_data->>'long_description',
    p_event_data->>'brief',
    COALESCE((p_event_data->'highlights')::jsonb, '[]'::jsonb),
    COALESCE((p_event_data->'keywords')::jsonb, '[]'::jsonb),
    p_event_data->>'slug',
    p_event_data->>'meta_title',
    p_event_data->>'meta_description',
    p_event_data->>'end_time',
    (p_event_data->>'duration_minutes')::int,
    p_event_data->>'doors_time',
    p_event_data->>'last_entry_time',
    COALESCE(p_event_data->>'event_status', 'scheduled'),
    COALESCE(p_event_data->>'booking_mode', 'table'),
    COALESCE((p_event_data->>'booking_open')::boolean, true),
    p_event_data->>'booking_url',
    p_event_data->>'event_type',
    p_event_data->>'performer_name',
    p_event_data->>'performer_type',
    COALESCE((p_event_data->>'price')::numeric, 0),
    (p_event_data->>'price_per_seat')::numeric,
    COALESCE((p_event_data->>'is_free')::boolean, true),
    COALESCE(p_event_data->>'payment_mode', 'free'),
    v_start_datetime,
    p_event_data->>'hero_image_url',
    p_event_data->>'thumbnail_image_url',
    p_event_data->>'poster_image_url',
    p_event_data->>'promo_video_url',
    COALESCE((p_event_data->'highlight_video_urls')::jsonb, '[]'::jsonb),
    COALESCE((p_event_data->'gallery_image_urls')::jsonb, '[]'::jsonb),
    p_event_data->>'facebook_event_name',
    p_event_data->>'facebook_event_description',
    p_event_data->>'gbp_event_title',
    p_event_data->>'gbp_event_description',
    p_event_data->>'opentable_experience_title',
    p_event_data->>'opentable_experience_description',
    COALESCE((p_event_data->'primary_keywords')::jsonb, '[]'::jsonb),
    COALESCE((p_event_data->'secondary_keywords')::jsonb, '[]'::jsonb),
    COALESCE((p_event_data->'local_seo_keywords')::jsonb, '[]'::jsonb),
    p_event_data->>'image_alt_text',
    p_event_data->>'social_copy_whatsapp',
    p_event_data->>'previous_event_summary',
    p_event_data->>'attendance_note',
    p_event_data->>'cancellation_policy',
    p_event_data->>'accessibility_notes',
    COALESCE((p_event_data->>'promo_sms_enabled')::boolean, true),
    COALESCE((p_event_data->>'bookings_enabled')::boolean, true)
  )
  RETURNING id INTO v_event_id;

  -- Insert FAQs if provided
  IF p_faqs IS NOT NULL AND jsonb_array_length(p_faqs) > 0 THEN
    FOR v_faq IN SELECT * FROM jsonb_array_elements(p_faqs) LOOP
      INSERT INTO event_faqs (event_id, question, answer, sort_order)
      VALUES (
        v_event_id,
        v_faq->>'question',
        v_faq->>'answer',
        COALESCE((v_faq->>'sort_order')::int, v_sort)
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  RETURN v_event_id;
END;
$$;

-- ============================================================
-- 4. Recreate update_event_transaction with new fields
-- ============================================================
CREATE OR REPLACE FUNCTION update_event_transaction(
  p_event_id UUID,
  p_event_data JSONB,
  p_faqs JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_faq JSONB;
  v_sort INT := 0;
  v_start_datetime TIMESTAMPTZ;
BEGIN
  -- Compute start_datetime if date or time changed
  IF p_event_data ? 'date' OR p_event_data ? 'time' THEN
    v_start_datetime := (
      SELECT
        CASE
          WHEN COALESCE(p_event_data->>'date', e.date::text) IS NOT NULL
            AND COALESCE(p_event_data->>'time', e.time) IS NOT NULL
          THEN (
            COALESCE(p_event_data->>'date', e.date::text) || 'T' ||
            COALESCE(p_event_data->>'time', e.time) || ':00'
          )::timestamptz
          ELSE e.start_datetime
        END
      FROM events e WHERE e.id = p_event_id
    );
  END IF;

  UPDATE events SET
    name = CASE WHEN p_event_data ? 'name' THEN p_event_data->>'name' ELSE name END,
    date = CASE WHEN p_event_data ? 'date' THEN (p_event_data->>'date')::date ELSE date END,
    time = CASE WHEN p_event_data ? 'time' THEN p_event_data->>'time' ELSE time END,
    capacity = CASE WHEN p_event_data ? 'capacity' THEN (p_event_data->>'capacity')::int ELSE capacity END,
    category_id = CASE WHEN p_event_data ? 'category_id' THEN (p_event_data->>'category_id')::uuid ELSE category_id END,
    short_description = CASE WHEN p_event_data ? 'short_description' THEN p_event_data->>'short_description' ELSE short_description END,
    long_description = CASE WHEN p_event_data ? 'long_description' THEN p_event_data->>'long_description' ELSE long_description END,
    brief = CASE WHEN p_event_data ? 'brief' THEN p_event_data->>'brief' ELSE brief END,
    highlights = CASE WHEN p_event_data ? 'highlights' THEN (p_event_data->'highlights')::jsonb ELSE highlights END,
    keywords = CASE WHEN p_event_data ? 'keywords' THEN (p_event_data->'keywords')::jsonb ELSE keywords END,
    slug = CASE WHEN p_event_data ? 'slug' THEN p_event_data->>'slug' ELSE slug END,
    meta_title = CASE WHEN p_event_data ? 'meta_title' THEN p_event_data->>'meta_title' ELSE meta_title END,
    meta_description = CASE WHEN p_event_data ? 'meta_description' THEN p_event_data->>'meta_description' ELSE meta_description END,
    end_time = CASE WHEN p_event_data ? 'end_time' THEN p_event_data->>'end_time' ELSE end_time END,
    duration_minutes = CASE WHEN p_event_data ? 'duration_minutes' THEN (p_event_data->>'duration_minutes')::int ELSE duration_minutes END,
    doors_time = CASE WHEN p_event_data ? 'doors_time' THEN p_event_data->>'doors_time' ELSE doors_time END,
    last_entry_time = CASE WHEN p_event_data ? 'last_entry_time' THEN p_event_data->>'last_entry_time' ELSE last_entry_time END,
    event_status = CASE WHEN p_event_data ? 'event_status' THEN p_event_data->>'event_status' ELSE event_status END,
    booking_mode = CASE WHEN p_event_data ? 'booking_mode' THEN p_event_data->>'booking_mode' ELSE booking_mode END,
    booking_open = CASE WHEN p_event_data ? 'booking_open' THEN (p_event_data->>'booking_open')::boolean ELSE booking_open END,
    booking_url = CASE WHEN p_event_data ? 'booking_url' THEN p_event_data->>'booking_url' ELSE booking_url END,
    event_type = CASE WHEN p_event_data ? 'event_type' THEN p_event_data->>'event_type' ELSE event_type END,
    performer_name = CASE WHEN p_event_data ? 'performer_name' THEN p_event_data->>'performer_name' ELSE performer_name END,
    performer_type = CASE WHEN p_event_data ? 'performer_type' THEN p_event_data->>'performer_type' ELSE performer_type END,
    price = CASE WHEN p_event_data ? 'price' THEN (p_event_data->>'price')::numeric ELSE price END,
    price_per_seat = CASE WHEN p_event_data ? 'price_per_seat' THEN (p_event_data->>'price_per_seat')::numeric ELSE price_per_seat END,
    is_free = CASE WHEN p_event_data ? 'is_free' THEN (p_event_data->>'is_free')::boolean ELSE is_free END,
    payment_mode = CASE WHEN p_event_data ? 'payment_mode' THEN p_event_data->>'payment_mode' ELSE payment_mode END,
    start_datetime = COALESCE(v_start_datetime, start_datetime),
    hero_image_url = CASE WHEN p_event_data ? 'hero_image_url' THEN p_event_data->>'hero_image_url' ELSE hero_image_url END,
    thumbnail_image_url = CASE WHEN p_event_data ? 'thumbnail_image_url' THEN p_event_data->>'thumbnail_image_url' ELSE thumbnail_image_url END,
    poster_image_url = CASE WHEN p_event_data ? 'poster_image_url' THEN p_event_data->>'poster_image_url' ELSE poster_image_url END,
    promo_video_url = CASE WHEN p_event_data ? 'promo_video_url' THEN p_event_data->>'promo_video_url' ELSE promo_video_url END,
    highlight_video_urls = CASE WHEN p_event_data ? 'highlight_video_urls' THEN (p_event_data->'highlight_video_urls')::jsonb ELSE highlight_video_urls END,
    gallery_image_urls = CASE WHEN p_event_data ? 'gallery_image_urls' THEN (p_event_data->'gallery_image_urls')::jsonb ELSE gallery_image_urls END,
    facebook_event_name = CASE WHEN p_event_data ? 'facebook_event_name' THEN p_event_data->>'facebook_event_name' ELSE facebook_event_name END,
    facebook_event_description = CASE WHEN p_event_data ? 'facebook_event_description' THEN p_event_data->>'facebook_event_description' ELSE facebook_event_description END,
    gbp_event_title = CASE WHEN p_event_data ? 'gbp_event_title' THEN p_event_data->>'gbp_event_title' ELSE gbp_event_title END,
    gbp_event_description = CASE WHEN p_event_data ? 'gbp_event_description' THEN p_event_data->>'gbp_event_description' ELSE gbp_event_description END,
    opentable_experience_title = CASE WHEN p_event_data ? 'opentable_experience_title' THEN p_event_data->>'opentable_experience_title' ELSE opentable_experience_title END,
    opentable_experience_description = CASE WHEN p_event_data ? 'opentable_experience_description' THEN p_event_data->>'opentable_experience_description' ELSE opentable_experience_description END,
    primary_keywords = CASE WHEN p_event_data ? 'primary_keywords' THEN (p_event_data->'primary_keywords')::jsonb ELSE primary_keywords END,
    secondary_keywords = CASE WHEN p_event_data ? 'secondary_keywords' THEN (p_event_data->'secondary_keywords')::jsonb ELSE secondary_keywords END,
    local_seo_keywords = CASE WHEN p_event_data ? 'local_seo_keywords' THEN (p_event_data->'local_seo_keywords')::jsonb ELSE local_seo_keywords END,
    image_alt_text = CASE WHEN p_event_data ? 'image_alt_text' THEN p_event_data->>'image_alt_text' ELSE image_alt_text END,
    social_copy_whatsapp = CASE WHEN p_event_data ? 'social_copy_whatsapp' THEN p_event_data->>'social_copy_whatsapp' ELSE social_copy_whatsapp END,
    previous_event_summary = CASE WHEN p_event_data ? 'previous_event_summary' THEN p_event_data->>'previous_event_summary' ELSE previous_event_summary END,
    attendance_note = CASE WHEN p_event_data ? 'attendance_note' THEN p_event_data->>'attendance_note' ELSE attendance_note END,
    cancellation_policy = CASE WHEN p_event_data ? 'cancellation_policy' THEN p_event_data->>'cancellation_policy' ELSE cancellation_policy END,
    accessibility_notes = CASE WHEN p_event_data ? 'accessibility_notes' THEN p_event_data->>'accessibility_notes' ELSE accessibility_notes END,
    promo_sms_enabled = CASE WHEN p_event_data ? 'promo_sms_enabled' THEN (p_event_data->>'promo_sms_enabled')::boolean ELSE promo_sms_enabled END,
    bookings_enabled = CASE WHEN p_event_data ? 'bookings_enabled' THEN (p_event_data->>'bookings_enabled')::boolean ELSE bookings_enabled END,
    updated_at = now()
  WHERE id = p_event_id;

  -- Replace FAQs if provided
  IF p_faqs IS NOT NULL THEN
    DELETE FROM event_faqs WHERE event_id = p_event_id;
    IF jsonb_array_length(p_faqs) > 0 THEN
      FOR v_faq IN SELECT * FROM jsonb_array_elements(p_faqs) LOOP
        INSERT INTO event_faqs (event_id, question, answer, sort_order)
        VALUES (
          p_event_id,
          v_faq->>'question',
          v_faq->>'answer',
          COALESCE((v_faq->>'sort_order')::int, v_sort)
        );
        v_sort := v_sort + 1;
      END LOOP;
    END IF;
  END IF;

  RETURN p_event_id;
END;
$$;

COMMIT;
```

- [ ] **Step 2: Verify migration parses correctly**

Run: `npx supabase db push --dry-run`
Expected: Migration listed, no SQL errors.

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000000_add_event_promo_sms_and_bookings_enabled.sql
git commit -m "feat: add promo_sms_enabled and bookings_enabled to events and event_categories"
```

---

## Task 2: TypeScript Type Updates

**Files:**
- Modify: `src/types/event.ts`
- Modify: `src/types/event-categories.ts`

- [ ] **Step 1: Add fields to Event interface in `src/types/event.ts`**

After line 34 (`faqs: any | null`), add:

```typescript
promo_sms_enabled: boolean
bookings_enabled: boolean
```

Add to `EventFormData` interface after line 106 (`faqs?: any[]`):

```typescript
promo_sms_enabled?: boolean
bookings_enabled?: boolean
```

- [ ] **Step 2: Add fields to EventCategory in `src/types/event-categories.ts`**

Find the `EventCategory` interface (or the one in `src/types/event.ts` if that's where the settings UI imports from). After `default_booking_url`, add:

```typescript
default_promo_sms_enabled: boolean
default_bookings_enabled: boolean
```

- [ ] **Step 3: Run typecheck to confirm no errors introduced**

Run: `npx tsc --noEmit 2>&1 | grep -v "tests/"  | head -20`
Expected: No new errors from our changes (pre-existing test errors are fine).

- [ ] **Step 4: Commit**

```bash
git add src/types/event.ts src/types/event-categories.ts
git commit -m "feat: add promo_sms_enabled and bookings_enabled to Event and EventCategory types"
```

---

## Task 3: Server Action & Service Layer — Wire Fields Through

**Files:**
- Modify: `src/app/actions/events.ts:58-183` (prepareEventDataFromFormData)
- Modify: `src/services/events.ts:195` (eventSchema)

- [ ] **Step 1: Add fields to `prepareEventDataFromFormData` in `src/app/actions/events.ts`**

In the category defaults select (~line 67), add to the select string:

```
default_promo_sms_enabled,
default_bookings_enabled,
```

In the `categoryDefaults` object (~line 98), add:

```typescript
promo_sms_enabled: category.default_promo_sms_enabled,
bookings_enabled: category.default_bookings_enabled,
```

In the `data` object (~line 137), add after `gallery_image_urls` (~line 182):

```typescript
promo_sms_enabled: rawData.promo_sms_enabled === 'true' ? true : rawData.promo_sms_enabled === 'false' ? false : categoryDefaults.promo_sms_enabled ?? true,
bookings_enabled: rawData.bookings_enabled === 'true' ? true : rawData.bookings_enabled === 'false' ? false : categoryDefaults.bookings_enabled ?? true,
```

Note: This uses explicit `=== 'true'` / `=== 'false'` checks rather than the `||` pattern used by `is_free` — the review flagged that `||` loses explicit `false` when category default is `true`.

- [ ] **Step 2: Add fields to `eventSchema` in `src/services/events.ts`**

After the last field in the Zod schema (~line 195 area), add:

```typescript
promo_sms_enabled: z.boolean().optional(),
bookings_enabled: z.boolean().optional(),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "tests/" | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/events.ts src/services/events.ts
git commit -m "feat: wire promo_sms_enabled and bookings_enabled through actions and service layer"
```

---

## Task 4: Event Form UI — Add Toggles

**Files:**
- Modify: `src/components/features/events/EventFormGrouped.tsx`

- [ ] **Step 1: Add state variables**

After the existing state variables (~line 102, after `brief`), add:

```typescript
// Visibility & communications
const [promoSmsEnabled, setPromoSmsEnabled] = useState(event?.promo_sms_enabled ?? true)
const [bookingsEnabled, setBookingsEnabled] = useState(event?.bookings_enabled ?? true)
```

- [ ] **Step 2: Apply category defaults in `handleCategoryChange`**

After the last default application in `handleCategoryChange` (~line 340 area), add:

```typescript
// Apply SMS and bookings defaults from category (only for new events)
if (!event) {
  if (selectedCategory.default_promo_sms_enabled !== undefined) {
    setPromoSmsEnabled(selectedCategory.default_promo_sms_enabled)
  }
  if (selectedCategory.default_bookings_enabled !== undefined) {
    setBookingsEnabled(selectedCategory.default_bookings_enabled)
  }
}
```

- [ ] **Step 3: Add fields to the submit data**

In the `eventData` object construction (~line 179 area), add:

```typescript
promo_sms_enabled: promoSmsEnabled,
bookings_enabled: bookingsEnabled,
```

- [ ] **Step 4: Add the UI section**

Before the `{/* Form Actions */}` section (~line 1069), add:

```tsx
{/* Visibility & Communications */}
<CollapsibleSection
  title="Visibility & Communications"
  description="Control SMS and booking availability"
  icon={MegaphoneIcon}
  defaultOpen={!promoSmsEnabled || !bookingsEnabled}
>
  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <label htmlFor="promo-sms-toggle" className="text-sm font-medium text-gray-900">
          Promotional SMS
        </label>
        <p className="text-sm text-gray-500">
          Send automated reminders, review requests, and cross-promo SMS for this event
        </p>
      </div>
      <button
        id="promo-sms-toggle"
        type="button"
        role="switch"
        aria-checked={promoSmsEnabled}
        onClick={() => setPromoSmsEnabled(!promoSmsEnabled)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 ${promoSmsEnabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${promoSmsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>

    <div className="flex items-center justify-between">
      <div>
        <label htmlFor="bookings-toggle" className="text-sm font-medium text-gray-900">
          Accept bookings
        </label>
        <p className="text-sm text-gray-500">
          Allow customers to book this event on the public site
        </p>
      </div>
      <button
        id="bookings-toggle"
        type="button"
        role="switch"
        aria-checked={bookingsEnabled}
        onClick={() => setBookingsEnabled(!bookingsEnabled)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 ${bookingsEnabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
      >
        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${bookingsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>

    {!bookingsEnabled && (
      <div className="rounded-md bg-blue-50 p-4">
        <div className="flex">
          <InformationCircleIcon className="h-5 w-5 text-blue-400" aria-hidden="true" />
          <p className="ml-3 text-sm text-blue-700">
            Bookings are turned off — this event won&apos;t appear in booking flows on the public site. Staff can still create bookings manually.
          </p>
        </div>
      </div>
    )}
  </div>
</CollapsibleSection>
```

- [ ] **Step 5: Verify the form renders**

Run: `npm run dev`
Navigate to an event edit page. Confirm the new section appears with two toggles.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/events/EventFormGrouped.tsx
git commit -m "feat: add promo SMS and bookings toggles to event form"
```

---

## Task 5: Event Category Form — Add Default Toggles

**Files:**
- Modify: `src/components/features/events/EventCategoryFormGrouped.tsx`
- Modify: `src/app/actions/event-categories.ts`
- Modify: `src/services/event-categories.ts`

- [ ] **Step 1: Add state variables to `EventCategoryFormGrouped.tsx`**

After `defaultBookingUrl` state (~line 113), add:

```typescript
const [defaultPromoSmsEnabled, setDefaultPromoSmsEnabled] = useState(category?.default_promo_sms_enabled ?? true)
const [defaultBookingsEnabled, setDefaultBookingsEnabled] = useState(category?.default_bookings_enabled ?? true)
```

- [ ] **Step 2: Add fields to `categoryData` in the submit handler**

After `default_booking_url` in the `categoryData` object (~line 167 area), add:

```typescript
default_promo_sms_enabled: defaultPromoSmsEnabled,
default_bookings_enabled: defaultBookingsEnabled,
```

- [ ] **Step 3: Add toggle UI to the category form**

Find the "Default Event Settings" section. After the last default field (booking URL), add:

```tsx
<div className="flex items-center justify-between pt-4 border-t border-gray-200">
  <div>
    <label htmlFor="default-promo-sms" className="text-sm font-medium text-gray-900">
      Default promotional SMS
    </label>
    <p className="text-xs text-gray-500">New events in this category will inherit this setting</p>
  </div>
  <button
    id="default-promo-sms"
    type="button"
    role="switch"
    aria-checked={defaultPromoSmsEnabled}
    onClick={() => setDefaultPromoSmsEnabled(!defaultPromoSmsEnabled)}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 ${defaultPromoSmsEnabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
  >
    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${defaultPromoSmsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
  </button>
</div>

<div className="flex items-center justify-between">
  <div>
    <label htmlFor="default-bookings" className="text-sm font-medium text-gray-900">
      Default accept bookings
    </label>
    <p className="text-xs text-gray-500">New events in this category will inherit this setting</p>
  </div>
  <button
    id="default-bookings"
    type="button"
    role="switch"
    aria-checked={defaultBookingsEnabled}
    onClick={() => setDefaultBookingsEnabled(!defaultBookingsEnabled)}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 ${defaultBookingsEnabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
  >
    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${defaultBookingsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
  </button>
</div>
```

- [ ] **Step 4: Update category actions and service**

In `src/app/actions/event-categories.ts`, ensure the new fields are passed through to the service. In `src/services/event-categories.ts`, ensure the update/create methods include the new fields in the Supabase upsert payload.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/events/EventCategoryFormGrouped.tsx src/app/actions/event-categories.ts src/services/event-categories.ts
git commit -m "feat: add default promo SMS and bookings toggles to event category form"
```

---

## Task 6: SMS Cron Filtering — Event Guest Engagement

**Files:**
- Modify: `src/app/api/cron/event-guest-engagement/route.ts`

- [ ] **Step 1: Filter promo events by `promo_sms_enabled`**

In `loadUpcomingEventsForPromo` (~line 1563), add `.eq('promo_sms_enabled', true)` after `.eq('booking_open', true)`:

```typescript
const { data, error } = await supabase
  .from('events')
  .select('id, name, date, payment_mode, category_id')
  .eq('booking_open', true)
  .eq('promo_sms_enabled', true)
  .gte('date', nowIso.slice(0, 10))
  .lte('date', windowEndIso.slice(0, 10))
  .not('category_id', 'is', null)
  .order('date', { ascending: true })
  .limit(50)
```

- [ ] **Step 2: Filter follow-up events by `promo_sms_enabled`**

In `loadFollowUpEvents` (~line 1593), add `.eq('promo_sms_enabled', true)` after `.eq('booking_open', true)`:

```typescript
const { data, error } = await supabase
  .from('events')
  .select('id, name, date, payment_mode, category_id')
  .eq('booking_open', true)
  .eq('promo_sms_enabled', true)
  .eq('event_status', 'scheduled')
  .gte('date', windowStartIso)
  .lte('date', windowEndIso)
  .not('category_id', 'is', null)
  .order('date', { ascending: true })
  .limit(50)
```

- [ ] **Step 3: Filter booking engagement by `promo_sms_enabled`**

In `loadEventBookingsForEngagement` (~line 619), the query joins events via `events!inner(...)`. Add `promo_sms_enabled` to the select and filter in-memory before sending SMS:

In the select string, add `promo_sms_enabled` to the events join:
```
events!inner(id, name, start_datetime, date, time, event_status, promo_sms_enabled)
```

Then in the SMS-sending loop (~line 804 area), add a check before sending:
```typescript
if (booking.events?.promo_sms_enabled === false) continue
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/event-guest-engagement/route.ts
git commit -m "feat: filter event engagement SMS by promo_sms_enabled"
```

---

## Task 7: Waitlist Offers — Check Both Flags

**Files:**
- Modify: `src/app/api/cron/event-waitlist-offers/route.ts`
- Modify: `src/lib/events/waitlist-offers.ts`

- [ ] **Step 1: Add event flag checks to waitlist offer creation**

In `src/lib/events/waitlist-offers.ts`, where the event is loaded before creating an offer (~line 151 area), add `promo_sms_enabled` and `bookings_enabled` to the event select. Then add guards:

```typescript
if (event.bookings_enabled === false) {
  return { success: false, reason: 'bookings_disabled' }
}
```

Before sending the offer SMS (~line 283 area), add:

```typescript
if (event.promo_sms_enabled === false) {
  // Skip SMS but still create the offer record
  return { success: true, sms_skipped: true }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/event-waitlist-offers/route.ts src/lib/events/waitlist-offers.ts
git commit -m "feat: check bookings_enabled and promo_sms_enabled in waitlist offers"
```

---

## Task 8: Booking API Guard

**Files:**
- Modify: `src/app/api/event-bookings/route.ts:114-126`

- [ ] **Step 1: Add `bookings_enabled` to event select and guard**

Change the select at ~line 116 from:
```typescript
.select('id, name, date, start_datetime, booking_mode')
```
to:
```typescript
.select('id, name, date, start_datetime, booking_mode, bookings_enabled')
```

After the `!eventRow` check (~line 126), add:

```typescript
if (eventRow.bookings_enabled === false) {
  return createErrorResponse(
    'Bookings are not available for this event',
    'BOOKINGS_DISABLED',
    409
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/event-bookings/route.ts
git commit -m "feat: guard event bookings API with bookings_enabled check"
```

---

## Task 9: Management API Response Projection

**Files:**
- Modify: `src/app/api/events/route.ts:161`
- Modify: `src/app/api/events/[id]/route.ts:174`

- [ ] **Step 1: Add `bookings_enabled` to list endpoint response**

In `src/app/api/events/route.ts`, in the response object mapping (~line 161), add:

```typescript
bookings_enabled: event.bookings_enabled ?? true,
```

Do NOT add `promo_sms_enabled` — it's backend-only.

- [ ] **Step 2: Add `bookings_enabled` to detail endpoint response**

In `src/app/api/events/[id]/route.ts`, in the `extendedEvent` object (~line 174), add:

```typescript
bookings_enabled: event.bookings_enabled ?? true,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/events/route.ts src/app/api/events/[id]/route.ts
git commit -m "feat: expose bookings_enabled in management API event responses"
```

---

## Task 10: Public Site — Event Type & Lifecycle (OJ-The-Anchor.pub)

**Files:**
- Modify: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/events.ts`
- Modify: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-lifecycle.ts`

- [ ] **Step 1: Add `bookings_enabled` to public Event type**

In `lib/api/events.ts`, add to the Event interface:

```typescript
bookings_enabled?: boolean
```

- [ ] **Step 2: Add `bookings_disabled` to `getEventBookingBlockReason`**

In `lib/event-lifecycle.ts`, update the type (~line 12):

```typescript
export type EventBookingBlockReason = 'draft' | 'cancelled' | 'sold_out' | 'past' | 'bookings_disabled' | null
```

In `getEventBookingBlockReason` (~line 44), add a check after the status checks but before the past check:

```typescript
export function getEventBookingBlockReason(
  event: Pick<Event, 'event_status' | 'eventStatus' | 'startDate' | 'bookings_enabled'>,
  now: number = Date.now()
): EventBookingBlockReason {
  const status = normalizeEventStatus(event)
  if (status === 'draft') return 'draft'
  if (status === 'cancelled') return 'cancelled'
  if (event.bookings_enabled === false) return 'bookings_disabled'
  if (status === 'sold_out') return 'sold_out'
  if (isEventInPast(event, now)) return 'past'
  return null
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub
git add lib/api/events.ts lib/event-lifecycle.ts
git commit -m "feat: add bookings_disabled to event lifecycle block reasons"
```

---

## Task 11: Public Site — EventBookingButton & Availability

**Files:**
- Modify: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/EventBookingButton.tsx`
- Modify: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/EventAvailability.tsx`
- Modify: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/events/[id]/availability/route.ts`

- [ ] **Step 1: Handle `bookings_disabled` in EventBookingButton**

The button already has a disabled state for when `bookingUrl` is null (~line 133). We need to handle the case where `bookings_enabled` is explicitly false. Since the event detail page gates on `bookingBlockReason`, the simplest approach is to check in the parent. But `EventBookingButton` is also used in listings. Add a check at the top of the component:

```typescript
if (event.bookings_enabled === false) {
  return (
    <Button
      className={cn('whitespace-normal break-words', className)}
      disabled
      fullWidth={fullWidth}
      size={size}
      variant="secondary"
    >
      No booking required
    </Button>
  )
}
```

- [ ] **Step 2: Handle `bookings_disabled` in availability endpoint**

In `app/api/events/[id]/availability/route.ts`, after fetching the event, add:

```typescript
if (event.bookings_enabled === false) {
  return NextResponse.json({
    available: false,
    reason: 'bookings_disabled',
    message: 'Bookings are not available for this event'
  })
}
```

- [ ] **Step 3: Handle `bookings_disabled` in EventAvailability component**

In `components/EventAvailability.tsx`, where it displays "Sold out" for unavailable events, add a branch for `bookings_disabled`:

```typescript
if (availability?.reason === 'bookings_disabled') {
  return null // Don't show availability widget at all
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub
git add components/EventBookingButton.tsx components/EventAvailability.tsx app/api/events/[id]/availability/route.ts
git commit -m "feat: handle bookings_disabled in public event booking UI"
```

---

## Task 12: Public Site — Booking & Waitlist API Guards

**Files:**
- Modify: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/route.ts`
- Modify: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-waitlist/route.ts`

- [ ] **Step 1: Add booking guard to public event-bookings API**

The public site's booking API proxies to the management API. The management API already has the guard (Task 8), but for a better customer-facing error, add a pre-check. Before the upstream proxy call (~line 145), if the event data is available, check `bookings_enabled`. If not, the management API will reject it and the public site should catch the `BOOKINGS_DISABLED` error code and return a customer-friendly message:

```typescript
// Handle bookings_disabled rejection from upstream
if (upstreamResponse.status === 409) {
  const body = await upstreamResponse.json()
  if (body.code === 'BOOKINGS_DISABLED') {
    return NextResponse.json(
      { error: 'Bookings are not currently available for this event.' },
      { status: 409 }
    )
  }
}
```

- [ ] **Step 2: Add waitlist guard**

In `app/api/event-waitlist/route.ts`, add a similar check. The upstream waitlist RPC will reject it, but handle the error gracefully on the public side.

- [ ] **Step 3: Commit**

```bash
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub
git add app/api/event-bookings/route.ts app/api/event-waitlist/route.ts
git commit -m "feat: handle bookings_disabled in public booking and waitlist APIs"
```

---

## Task 13: Verification & Push

- [ ] **Step 1: Run full verification on management tools**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
npm run lint
npx tsc --noEmit
npm run build
```

- [ ] **Step 2: Run full verification on public site**

```bash
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub
npm run lint
npx tsc --noEmit
npm run build
```

- [ ] **Step 3: Manual smoke test**

1. Create a new event with both toggles off → verify they save and reload correctly
2. Edit an existing event → verify toggles default to on and can be changed
3. Check the public site event listing → verify the event shows but booking button says "No booking required"
4. Try to book via the API directly → verify 409 rejection

- [ ] **Step 4: Push both repos**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && git push origin main
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub && git push origin main
```
