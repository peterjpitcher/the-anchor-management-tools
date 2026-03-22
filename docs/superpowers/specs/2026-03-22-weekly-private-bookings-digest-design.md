# Weekly Private Bookings Digest — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Complexity:** M (4-6 files, moderate logic, no schema changes)

---

## Problem Statement

The current daily private bookings email sends every morning with a flat list of all upcoming events. Every booking looks the same regardless of whether it needs action or is fully sorted. This creates noise — the manager has to mentally triage which events need attention, making the email less useful than it should be.

## Success Criteria

1. Email sends once per week (Monday 9 AM London time) instead of daily
2. Events are classified into 3 priority tiers based on actionable triggers
3. The email is scannable — a glance at the header tells you how many items need action
4. Confirmed and paid events are deprioritised (compact list at the bottom)
5. Each event needing action shows exactly *why* it needs attention
6. All existing action detection (expired holds, overdue balances, etc.) is preserved
7. New action triggers added: approaching draft events, stale bookings, missing details

## Out of Scope

- Database migrations or schema changes
- Changes to the private bookings UI
- Multi-recipient or personalised emails
- New environment variables (existing `PRIVATE_BOOKINGS_DAILY_DIGEST_HOUR_LONDON` env var will be renamed to `PRIVATE_BOOKINGS_WEEKLY_DIGEST_HOUR_LONDON`)

---

## Schedule Change

### Current
- `vercel.json` cron: `0 * * * *` (hourly)
- Route handler filters to 9 AM London time
- Idempotency window: 24 hours

### New
- `vercel.json` cron: unchanged (keep hourly)
- Route handler filters to 9 AM London time **AND Monday only** (day-of-week check in `Europe/London` timezone)
- Idempotency key format: `cron:private-bookings-weekly-summary:${mondayDateKey}` (uses the Monday date, not the current date, so `?force=true` on a non-Monday still respects the weekly window)
- Idempotency TTL: 7 days (`24 * 7` hours)
- `?force=true` bypass still works for manual triggers

### Rationale
Keeping the hourly cron with timezone filtering (rather than a `0 9 * * 1` UTC cron) correctly handles BST/GMT transitions, matching the existing pattern.

---

## Email Structure

### Subject Line

```
Private bookings weekly summary — w/c Mon 23 Mar 2026
```

### Header

Top-line stats bar showing counts per tier:

```
3 Action Required | 2 Needs Attention | 8 On Track
```

Quick link to `/private-bookings` in the app.

### Tier 1 — Action Required (red left-border accent)

Events needing immediate action. Each event shows:
- Customer name (bold)
- Event date and time
- Guest count
- Event type
- Action trigger labels (all that apply, as inline tags)

An event appears in Tier 1 if it matches **any** of these triggers:

| Trigger | Condition | Label |
|---------|-----------|-------|
| Draft hold expired | `status = 'draft'` AND `hold_expiry <= now` | `Hold expired` |
| Draft event approaching | `status = 'draft'` AND `event_date` within 14 days | `Event in X days — still draft` |
| Balance overdue | `balance_due_date < today` AND outstanding balance > 0 | `Balance overdue: £X.XX` |
| Stale draft | `status = 'draft'` AND `updated_at` older than 7 days | `Not touched in X days` |
| Missing details | `guest_count` is null, OR `event_type` is null, OR (`contact_email` is null AND `contact_phone` is null) | `Missing: [field list]` |
| Balance due this week | `balance_due_date` between today (Monday, inclusive) and Sunday of the same week (inclusive) AND outstanding balance > 0 | `Balance due: £X.XX by [date]` |

If a booking matches multiple triggers, all labels show on the same row — no duplicate entries.

**Outstanding balance calculation:** Use `balance_remaining` from the `private_bookings_with_details` view (computed by `calculate_private_booking_balance()`, which accounts for all payments via `private_booking_payments`, not just the deposit). A booking has an outstanding balance when `balance_remaining > 0` and `final_payment_date` is null. **The existing manual `calculated_total - deposit_amount` calculation in the route (route.ts:270-274) must be removed entirely — do not keep both.**

**Sort order:** Event date ascending (soonest first), then trigger count descending.

### Tier 2 — Needs Attention (amber left-border accent)

Same card format as Tier 1. Events appear here if they match **any** of:

| Trigger | Condition | Label |
|---------|-----------|-------|
| Hold expiring soon | `status = 'draft'` AND `hold_expiry` within 48 hours (and not yet expired) | `Hold expires [date/time]` |
| Pending SMS | Booking has entries in `private_booking_sms_queue` with `status = 'pending'` | `X SMS pending approval` |
| Date/time unconfirmed | `internal_notes` contains "Event date/time to be confirmed" | `Date/time TBC` |
| Confirmed but unpaid | `status = 'confirmed'` AND outstanding balance > 0 AND `balance_due_date >= today` (not yet overdue) | `Outstanding: £X.XX` |

**Sort order:** Event date ascending, then trigger count descending.

**Tier precedence:** If a booking qualifies for both Tier 1 and Tier 2, it appears in Tier 1 only.

### Tier 3 — On Track (green left-border accent)

Compact summary — no action labels. Header shows count:

```
8 events confirmed & paid
```

Each event as a single line: customer name, event date, guest count, event type. Simple list or table format — no cards.

**Sort order:** Event date ascending.

**Criteria:** Any upcoming non-cancelled booking that doesn't qualify for Tier 1 or Tier 2.

### Pending SMS Section (separate)

After the tiers, a standalone section listing all pending SMS approvals with a link to `/private-bookings/sms-queue`. This preserves the existing behaviour where SMS approvals are surfaced independently.

### All Clear State

When there are no upcoming events across any tier, send a short email:

```
Subject: Private bookings weekly summary — w/c Mon 23 Mar 2026

All clear — no upcoming private events. Enjoy your week.
```

Stats bar shows `0 | 0 | 0`.

### Footer

```
Sent every Monday at 9am · Manage in Anchor Management Tools
[Link to /private-bookings]
```

---

## Tier Classification Logic

```
for each upcoming non-cancelled booking:
  triggers_t1 = []
  triggers_t2 = []

  // Tier 1 checks
  if draft AND hold_expiry <= now:           triggers_t1.push("Hold expired")
  if draft AND event within 14 days:         triggers_t1.push("Event in X days — still draft")
  if balance_due_date < today AND balance > 0: triggers_t1.push("Balance overdue: £X.XX")
  if draft AND updated_at < 7 days ago:      triggers_t1.push("Not touched in X days")
  if missing guest_count/event_type/contact: triggers_t1.push("Missing: [fields]")
  if balance_due this week AND balance > 0:  triggers_t1.push("Balance due: £X.XX by [date]")

  // Tier 2 checks — always computed, but only used if booking has no Tier 1 triggers.
  // Tier 2 labels are NOT shown on Tier 1 bookings — each booking shows only its assigned tier's labels.
  if draft AND hold_expiry within 48h (not expired): triggers_t2.push("Hold expires [time]")
  if has pending SMS:                        triggers_t2.push("X SMS pending")
  if notes contain date/time TBC:            triggers_t2.push("Date/time TBC")
  if confirmed AND balance > 0 AND not overdue: triggers_t2.push("Outstanding: £X.XX")

  // Assign tier
  if triggers_t1.length > 0: → Tier 1 (with t1 labels)
  else if triggers_t2.length > 0: → Tier 2 (with t2 labels)
  else: → Tier 3
```

---

## Rename Scope

All references to "daily" become "weekly":

| Current | New |
|---------|-----|
| `api/cron/private-bookings-daily-summary` | `api/cron/private-bookings-weekly-summary` |
| `vercel.json` cron path | Updated to new route |
| `sendManagerPrivateBookingsDailyDigestEmail()` | `sendManagerPrivateBookingsWeeklyDigestEmail()` |
| `PrivateBookingDailyDigest*` types | `PrivateBookingWeeklyDigest*` types |
| Idempotency key prefix | Updated from `daily` to `weekly` |
| `PRIVATE_BOOKINGS_DAILY_DIGEST_HOUR_LONDON` env var | Renamed to `PRIVATE_BOOKINGS_WEEKLY_DIGEST_HOUR_LONDON` |
| `tests/api/privateBookingsDailySummaryRoute.test.ts` | Renamed to `tests/api/privateBookingsWeeklySummaryRoute.test.ts` |

---

## Files Modified

1. **`src/app/api/cron/private-bookings-daily-summary/route.ts`**
   - Rename to `src/app/api/cron/private-bookings-weekly-summary/route.ts`
   - Add Monday-only filter (London timezone day-of-week check)
   - Change idempotency window to 7 days
   - Add `updated_at`, `contact_email`, `contact_phone`, and `balance_remaining` to the select clause of the `private_bookings_with_details` query
   - Build tiered classification logic using these new fields
   - Pass tiered data to email function
   - Add `export const maxDuration = 60` (matches other cron routes; prevents timeout if Graph API is slow)
   - Eliminate the separate draft holds query — filter the main result set for `status = 'draft'` with non-null `hold_expiry` instead
   - Simplify pending SMS handling: group by `booking_id` into a `Map<string, number>` and correlate with the main result set (eliminates the customer name follow-up query)
   - Add `logAuditEvent()` for the weekly digest send (recipient, event count, tier counts)
   - Refactor date formatting to use `dateUtils` utilities where possible (existing route defines inline formatting functions)
   - Day-of-week check must use `Intl.DateTimeFormat` with `timeZone: 'Europe/London'`, not `Date.getDay()` (which uses UTC on Vercel)
   - Preserve existing `POST` handler that delegates to `GET`

2. **`src/lib/private-bookings/manager-notifications.ts`**
   - Rename function and types from `Daily` to `Weekly`
   - New HTML template: stats bar, 3-tier layout with coloured accents, action labels
   - New plain text template: matching tiered structure
   - Updated types: add `tier`, `triggerLabels` fields to digest event type

3. **`tests/api/privateBookingsDailySummaryRoute.test.ts`**
   - Rename to `tests/api/privateBookingsWeeklySummaryRoute.test.ts`
   - Update all references to daily summary route, function names, and idempotency keys
   - Add new test cases for tier classification and weekly schedule logic

4. **`vercel.json`**
   - Update cron path from `private-bookings-daily-summary` to `private-bookings-weekly-summary`

5. **`CLAUDE.md`** (project-level)
   - Add `private-bookings-weekly-summary` to the Scheduled Jobs table

6. **Delete old route directory** (`src/app/api/cron/private-bookings-daily-summary/`)

## Files NOT Changed

- No database migrations
- No new environment variables
- No UI changes
- No changes to the private bookings data model

---

## Risk Assessment

**Risk level:** Low

- Self-contained email change — no user-facing UI or data model impact
- No new external dependencies
- Worst case: one missed weekly email, recoverable via `?force=true`
- All existing action detection preserved; new triggers are additive
- Rollback: revert the 3-4 file changes and the cron path

---

## Testing Plan

**Mock strategy:** Supabase client and email service (`sendEmail`) must be mocked per project standards. Use `vi.mock()` for module-level mocks, `vi.clearAllMocks()` in `beforeEach`.

1. Unit tests for tier classification logic (pure function, easy to test):
   - Booking with expired hold → Tier 1
   - Draft within 14 days → Tier 1
   - Multiple triggers on same booking → single Tier 1 entry with all labels
   - Confirmed but unpaid, not overdue → Tier 2
   - Confirmed and paid → Tier 3
   - Booking matching both Tier 1 and Tier 2 triggers → appears in Tier 1 only
   - Null `event_date` → handle gracefully (no crash)
   - Null `balance_due_date` with `balance_remaining > 0` → falls to Tier 3 (known edge case)
   - Negative or zero `balance_remaining` → no balance triggers fire
   - Boundary dates: event_date exactly 14 days away, balance_due_date exactly today

2. Unit tests for email template generation:
   - All three tiers populated
   - Empty tiers (e.g. no Tier 1 items)
   - All-clear state (no events)
   - Missing fields label construction

3. Route handler error cases:
   - Supabase query failure → returns 500, releases idempotency claim
   - Email send failure → returns 500, releases idempotency claim
   - Auth rejection (missing/invalid CRON_SECRET) → returns 401
   - Non-Monday invocation → returns 200 with "not Monday" message
   - Duplicate invocation (idempotency hit) → returns cached response

4. Manual verification:
   - Trigger with `?force=true` on a non-Monday
   - Verify HTML renders correctly in email client
   - Verify plain text fallback is readable

## Deployment Checklist

1. Rename `PRIVATE_BOOKINGS_DAILY_DIGEST_HOUR_LONDON` to `PRIVATE_BOOKINGS_WEEKLY_DIGEST_HOUR_LONDON` in Vercel environment variables (failing to do this is safe — falls back to default hour 9 — but the old variable becomes orphaned)
2. Deploy the code changes
3. Verify the old cron path is no longer in `vercel.json`
4. Test with `?force=true` on first deployment to confirm email sends correctly
