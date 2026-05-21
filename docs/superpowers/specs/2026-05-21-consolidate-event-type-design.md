# Consolidate `events.event_type` into `event_categories`

**Date:** 2026-05-21  
**Last verified against code/database:** 2026-05-21  
**Complexity:** M (score 5) - UI cleanup plus service/RPC/data/cron compatibility work  
**Status:** Revised, implementation-ready

## Critical Review

The original direction is correct, but the first draft was too narrow for the real codebase.

1. `update_event_transaction` currently preserves the old `event_type` when the incoming value is `null` or blank. Simply sending `event_type: null` will not clear stale values when a category is removed.
2. `event_type` cannot just be removed from `CreateEventInput` / `UpdateEventInput` yet. The service still passes the payload to `create_event_transaction` and `update_event_transaction`, and those RPCs still persist the compatibility column.
3. The backfill must overwrite mismatches, not only blanks. The live database currently has categorized events whose `event_type` does not match the category slug.
4. Category slug changes must update existing events or the denormalized compatibility column will drift.
5. User-facing UI should show `event_categories.name`, not `events.event_type`, because `event_type` becomes a machine slug.
6. The engagement-scoring cron and table-booking reports currently read `events.event_type`; those paths need an explicit decision so customer labels and reports do not become stale or unreadable.

## Verified Reality

Checked the current code paths, migrations, Vercel cron config, and live Supabase data via read-only queries.

Current production-like snapshot:

| Check | Result |
|---|---:|
| Events scanned | 138 |
| Event categories | 14 |
| Events with `category_id` | 78 |
| Events without `category_id` | 60 |
| Categorized events missing `event_type` | 72 |
| Categorized events where `event_type IS DISTINCT FROM event_categories.slug` | 78 |
| Uncategorized events with non-empty `event_type` | 0 |
| Duplicate category slugs | 0 |
| `customer_category_stats` rows | 147 |

Implication: the migration must treat `event_categories.slug` as source of truth for every categorized event. Preserving existing categorized `event_type` values would preserve bad data.

## Decision

`events.category_id` is the canonical event classification.

Keep `events.event_type` for now as a denormalized compatibility field, but make it derived only:

- If `category_id` is set, `events.event_type = event_categories.slug`.
- If `category_id` is `null`, `events.event_type = null` for newly saved events.
- Users cannot enter or edit `event_type`.
- Public API fields named `event_type` continue to exist where they already exist, but they return the category slug.
- Internal/user-facing labels and badges should use the category name, not the slug.

Dropping `events.event_type` is out of scope. This change only makes it derived and safe.

## Implementation Plan

### 1. Server Action: `src/app/actions/events.ts`

In `prepareEventDataFromFormData`:

- Add `slug` to the existing `event_categories` lookup.
- Stop reading `rawData.event_type`.
- Ignore any submitted `event_type` FormData value, including malicious/manual submissions.
- Set `event_type` from the selected category row:

```ts
event_type: category?.slug ?? null,
category_id: categoryId,
```

Current lookup uses the authenticated Supabase client and already loads category defaults. Keep that pattern, but retain the loaded category object so both defaults and slug come from the same row.

If `category_id` is present but no category row is found, prefer returning a clear validation error over letting the RPC fail with a generic FK/database error.

### 2. Service Types and Validation: `src/services/events.ts`

Do not remove `event_type` from `CreateEventInput`, `UpdateEventInput`, or `eventSchema` yet.

Instead:

- Keep `event_type?: string | null` as an internal field.
- Add a short comment that it is server-derived from `category_id` and not user-editable.
- Keep the Zod validation so the RPC payload remains typed and bounded.

Reason: `EventService.createEvent` and `EventService.updateEvent` still pass a JSON payload into database RPCs that write `events.event_type`. Removing the field from the service type before the RPC/column is removed creates type friction without improving safety.

### 3. Database Migration: Supabase RPC and Backfill

Create a new migration after the latest existing migration.

Required changes:

1. Recreate `update_event_transaction` so provided `event_type: null` actually clears the column.
2. Keep `create_event_transaction` writing `event_type` from payload, because the server action now supplies the derived slug.
3. Backfill all categorized events to the category slug.
4. Optionally clear uncategorized non-empty values; current verified data has none.

The important `update_event_transaction` assignment is:

```sql
event_type = CASE
  WHEN p_event_data ? 'event_type'
    THEN NULLIF(TRIM(p_event_data->>'event_type'), '')
  ELSE event_type
END,
```

Do not keep the current `COALESCE(NULLIF(...), event_type)` pattern. That pattern prevents clearing stale values.

Backfill:

```sql
UPDATE public.events e
SET event_type = ec.slug
FROM public.event_categories ec
WHERE e.category_id = ec.id
  AND e.event_type IS DISTINCT FROM ec.slug;
```

Optional cleanup, safe for the verified current data but still worth checking immediately before migration:

```sql
UPDATE public.events
SET event_type = NULL
WHERE category_id IS NULL
  AND NULLIF(TRIM(event_type), '') IS NOT NULL;
```

Post-migration verification:

```sql
SELECT count(*) AS mismatched_categorized_events
FROM public.events e
JOIN public.event_categories ec ON ec.id = e.category_id
WHERE e.event_type IS DISTINCT FROM ec.slug;
```

Expected result: `0`.

### 4. Category Slug Updates: `src/services/event-categories.ts`

`event_categories.slug` is editable today through `EventCategoryService.updateCategory`. If a category slug changes, update existing events in the same operation:

```ts
if (category.slug !== oldCategory.slug) {
  await admin
    .from('events')
    .update({ event_type: category.slug })
    .eq('category_id', id)
}
```

This keeps the compatibility column aligned for API consumers and for any internal code that still reads `events.event_type`.

### 5. Event Drawer: `src/app/(authenticated)/events/_components/EventDrawer.tsx`

Remove the free-text event type control:

- Remove `eventType` state.
- Remove initialization from `event.event_type`.
- Remove the `FormData` write for `event_type`.
- Remove the `Event Type` `<Input>`.
- Rebalance the layout so `Category` is not paired with a missing field.

The drawer is used for both create and edit, including `/events/[id]`.

### 6. Legacy/Unused Event Form: `src/components/features/events/EventFormGrouped.tsx`

This component is not currently wired into the active `/events` routes, but leaving a stale free-text `event_type` field creates future regression risk.

Remove:

- `eventType` state.
- `event_type` in the submit payload.
- The `<input id="event_type">` field.

If this component is reintroduced later, it must follow the same rule: category selection is the only classification control.

### 7. Admin Event Lists and Cards

Use category name for display.

Files:

- `src/app/(authenticated)/events/_components/EventCard.tsx`
- `src/app/(authenticated)/events/_components/EventListView.tsx`

Current data loading through `EventService.getEvents()` already selects `category:event_categories(*)`, so avoid adding a parallel `category_name` field unless needed. Either:

- extend the local event type with `category?: { name?: string | null; color?: string | null } | null`, or
- add an optional `category` relation to `src/types/database.ts`.

Display:

```tsx
const categoryName = event.category?.name
{categoryName && <Badge tone="info">{categoryName}</Badge>}
```

Do not display the derived slug in badges or list cells.

### 8. Public Events API

`src/app/api/events/[id]/route.ts` already fetches the category separately with `slug`. Change the shaped response to:

```ts
event_type: category?.slug ?? null,
```

Do not use `event.event_type` in shaped API responses when the category relation is available.

For `src/app/api/events/route.ts` and `src/app/api/events/today/route.ts`:

- Add `slug` to the nested `category:event_categories(...)` select.
- If these endpoints expose or add `event_type`, populate it as `event.category?.slug ?? null`.
- `eventToSchema()` does not need an `event_type` field; Schema.org `Event` has no equivalent here.

API compatibility:

- The detail endpoint still returns a field named `event_type`.
- Its value changes from user text/null to the selected category slug.
- No API version bump is needed because the field remains a nullable string.

### 9. Analytics, Reports, and Cron

Do not confuse `events.event_type` with other unrelated `event_type` columns.

Relevant scheduled jobs from `vercel.json`:

- `/api/cron/engagement-scoring` at `0 3 * * *`
- `/api/cron/apply-customer-labels` at `0 2 * * *`
- `/api/cron/event-guest-engagement` every 15 minutes

Findings:

- `apply-customer-labels` uses `customer_category_stats`, which is keyed by `category_id`. No change needed.
- `event-guest-engagement` cross-promo loads `category_id` and calls `get_cross_promo_audience`. No change needed.
- `engagement-scoring` currently selects `event:events(event_type)` and creates labels like `Interested: ${eventType}`.
- `table-booking-reports` also groups interest by `events.event_type`.

Required adjustment:

- Update `src/lib/analytics/engagement-scoring.ts` to prefer `event.category.name` for human-readable labels, with `event.event_type` as a fallback for uncategorized legacy rows.
- Update `src/lib/analytics/table-booking-reports.ts` the same way for report display.
- Keep output shapes stable unless a broader report rename is planned.

This prevents the 03:00 cron from creating customer labels such as `Interested: quiz-night-stanwell-moor` unless that slug fallback is the only available value.

### 10. Explicit Non-Goals / Do Not Touch

- Do not change the `event_categories` table shape.
- Do not remove `events.event_type` from generated database types.
- Do not change private bookings `event_type`; that is a separate free-text/private-booking concept.
- Do not change parking notification `event_type`; that is a separate enum.
- Do not change webhook log `event_type`, PayPal/Stripe event type handling, or `analytics_events.event_type`; those fields represent event kinds, not venue event classification.
- Do not change hiring candidate `event_type`.
- Do not change category defaults behavior.
- Do not change cross-promo audience RPCs; they already use `category_id`.

## Acceptance Criteria

1. Creating an event with a category stores `events.event_type = event_categories.slug`.
2. Creating an event without a category stores `events.event_type = null`.
3. Editing an event to change category overwrites `events.event_type` with the new category slug.
4. Editing an event to remove category clears `events.event_type`.
5. Manually submitted `event_type` FormData is ignored.
6. Updating a category slug updates `events.event_type` for events in that category.
7. The event drawer and legacy grouped event form no longer expose an event type input.
8. Event list/card UI displays category name, not slug.
9. `/api/events/[id]` returns `event_type` as category slug.
10. Post-migration mismatch query returns `0`.
11. Engagement scoring and table-booking reports use category name for human-readable interest labels, with `events.event_type` only as fallback.
12. Private bookings, parking, webhook logs, and analytics event-kind records are unchanged.

## Verification

Run before finishing implementation:

```bash
npm run lint
```

Run targeted read-only DB checks:

```bash
npx tsx scripts/database/check-event-categories-data.ts
```

Run the post-migration mismatch SQL above against the target database.

Recommended manual checks:

- Create a draft event with category `Quiz`; confirm DB `event_type` equals that category slug.
- Edit the event to another category; confirm `event_type` changes.
- Clear the category; confirm `event_type` becomes `null`.
- Open the event list and board; confirm category badges show readable names.
- Fetch `/api/events/{id}`; confirm `event_type` is the category slug.

## Files Touched

| File | Change |
|---|---|
| `src/app/actions/events.ts` | Derive internal `event_type` from selected category slug |
| `src/services/events.ts` | Keep `event_type` as internal RPC payload field, document as derived |
| `src/services/event-categories.ts` | Propagate category slug changes to `events.event_type` |
| `src/app/(authenticated)/events/_components/EventDrawer.tsx` | Remove free-text event type input |
| `src/components/features/events/EventFormGrouped.tsx` | Remove stale free-text event type input |
| `src/app/(authenticated)/events/_components/EventCard.tsx` | Display category name |
| `src/app/(authenticated)/events/_components/EventListView.tsx` | Display category name |
| `src/types/database.ts` | Optionally add typed `category` relation; keep `event_type` |
| `src/app/api/events/[id]/route.ts` | Return `event_type` from category slug |
| `src/app/api/events/route.ts` | Include category slug if exposing `event_type` |
| `src/app/api/events/today/route.ts` | Include category slug if exposing `event_type` |
| `src/lib/analytics/engagement-scoring.ts` | Use category name for interest labels, slug/free-text fallback only |
| `src/lib/analytics/table-booking-reports.ts` | Use category name for interest report labels |
| `supabase/migrations/YYYYMMDDHHMMSS_derive_event_type_from_category.sql` | RPC fix plus data backfill |

## Future Cleanup

Once API consumers no longer depend on `event_type`, remove the compatibility column in a separate migration and delete the internal service/RPC payload field. That is explicitly out of scope for this change.
