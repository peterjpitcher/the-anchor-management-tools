# Database Field Mismatches Report

## Summary
This report identifies places in the Anchor Management Tools codebase where database field references don't match the current schema.

## Critical Mismatches Found

### 1. Events Table - Image Fields Mismatch

**Issue**: The database schema shows that `events` table now uses a single `image_url` field (as of migration `20250127_simplify_images_and_add_category_fields.sql`), but several files still reference the old image fields that were dropped.

**Database Schema (Current)**:
- `image_url` (TEXT) - Single square image for the event

**Old Fields (Dropped)**:
- `hero_image_url`
- `thumbnail_image_url` 
- `poster_image_url`
- `gallery_image_urls`

**Files with Mismatches**:

1. **`/src/components/EventFormSimple.tsx`** (Lines 33, 65-68)
   - Uses `event?.hero_image_url` instead of `event?.image_url`
   - Submits data with `hero_image_url`, `thumbnail_image_url`, `poster_image_url` fields

2. **`/src/app/actions/eventsEnhanced.ts`** (Lines 56, 77-114, 343, 373-383)
   - Schema still validates `image_urls` (array) instead of `image_url` (string)
   - Still accepts and processes `hero_image_url`, `gallery_image_urls`, `poster_image_url`, `thumbnail_image_url`

3. **`/src/types/database.ts`** (Lines 17, 29-32)
   - Event interface still declares old fields:
     - `image_urls?: string[]`
     - `hero_image_url?: string | null`
     - `gallery_image_urls?: string[]`
     - `poster_image_url?: string | null`
     - `thumbnail_image_url?: string | null`

### 2. Events Table - FAQs Field Mismatch

**Issue**: Some files reference `faqs` as a field on the events table, but FAQs are actually stored in a separate `event_faqs` table.

**Database Schema (Current)**:
- FAQs are in the `event_faqs` table with columns: `id`, `event_id`, `question`, `answer`, `sort_order`

**Files with Issues**:

1. **`/src/types/event.ts`** (Line 30)
   - Declares `faqs: any | null` as a field on the Event interface
   - This field doesn't exist on the events table

2. **`/src/app/actions/eventsEnhanced.ts`** (Lines 453-478, 503-520)
   - Correctly handles FAQs as a separate table (good!)
   - But the type definitions might be misleading

### 3. Type Definition Inconsistencies

**Issue**: Multiple Event type definitions exist with different field sets:

1. **`/src/types/database.ts`** - Uses old field names
2. **`/src/types/event.ts`** - Uses new `image_url` field but incorrectly includes `faqs`

## Recommendations

1. **Update EventFormSimple.tsx**:
   - Change line 33 to use `event?.image_url`
   - Remove lines 65-68 and just submit `image_url`

2. **Update eventsEnhanced.ts**:
   - Update schema to validate `image_url` (string) instead of `image_urls` (array)
   - Remove validation for old image fields

3. **Consolidate Type Definitions**:
   - Use the Event interface from `/src/types/event.ts` as the canonical definition
   - Update `/src/types/database.ts` to match
   - Remove the `faqs` field from the Event interface

4. **Run Migration Script**:
   - Consider creating a script to update any existing code that references the old fields

## Database Schema Reference

### Events Table (Current)
```sql
- id (UUID)
- name (TEXT)
- date (DATE)
- time (TEXT)
- capacity (INTEGER)
- category_id (UUID)
- description (TEXT)
- end_time (TIME)
- event_status (VARCHAR)
- performer_name (VARCHAR)
- performer_type (VARCHAR)
- price (NUMERIC)
- price_currency (VARCHAR)
- is_free (BOOLEAN)
- booking_url (TEXT)
- image_url (TEXT) -- Single image field
- slug (VARCHAR)
- short_description (TEXT)
- long_description (TEXT)
- highlights (JSONB)
- meta_title (VARCHAR)
- meta_description (TEXT)
- keywords (JSONB)
- promo_video_url (TEXT)
- highlight_video_urls (JSONB)
- doors_time (TIME)
- duration_minutes (INTEGER)
- last_entry_time (TIME)
- created_at (TIMESTAMPTZ)
```

### Event FAQs Table (Separate)
```sql
- id (UUID)
- event_id (UUID)
- question (TEXT)
- answer (TEXT)
- sort_order (INTEGER)
- created_at (TIMESTAMPTZ)
- updated_at (TIMESTAMPTZ)
```

## Notes

- The `image_urls` field in the baseline schema (line 17) appears to be a JSONB array, but the migration converted this to a single `image_url` text field
- Event categories also underwent the same image field simplification
- The codebase needs to be updated to reflect these schema changes consistently