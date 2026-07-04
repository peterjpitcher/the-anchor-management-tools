# Discovery — Customer name changes don't propagate (Paul → Paula)

**Date:** 2026-07-03
**Base commit:** e80a251f20b5b8bc233a049de28626685486dbc7
**Mode:** fix-function, read-only diagnosis
**Reported symptom:** Renaming a customer profile (Paul → Paula) leaves the old name showing on the private-bookings list.

---

## Root cause

`private_bookings` (and `parking_bookings`) store **denormalised copies** of the customer's name, captured when the booking is created. When a customer is renamed, only the `customers` row is updated — nothing refreshes those copies, so the old name persists.

**Proof (live DB):** Paula's customer row is `Paula Campbell` (`customer_id a99116e2-951e-42df-8281-091a9353991a`), but her private booking `11fd3680-95a4-4292-be2c-c90da3b1564e` still holds:
- `customer_name = "Paul Campbell"`
- `customer_first_name = "Paul"`, `customer_last_name = "Campbell"`
- `customer_full_name = "Paul Campbell"` (generated from first/last)

**Data impact right now:** 4 of 32 customer-linked private bookings are stale by name. Parking: 0 of 10 stale currently, but the same latent gap exists.

---

## Column facts (private_bookings)

| Column | Generated? | Nullable | Kept in sync? |
|---|---|---|---|
| `customer_name` | NEVER | **NOT NULL** | ❌ nothing updates it (legacy/deprecated, but still displayed) |
| `customer_first_name` | NEVER | yes | ⚠️ only on booking insert / `customer_id` change |
| `customer_last_name` | NEVER | yes | ⚠️ only on booking insert / `customer_id` change |
| `customer_full_name` | **ALWAYS** (from first+last) | yes | auto — fine once first/last are correct |

`parking_bookings.customer_first_name` / `customer_last_name`: NEVER generated, **no sync mechanism at all**.

---

## Existing (incomplete) safety net

Trigger `sync_customer_name_trigger` on `private_bookings` → `sync_customer_name_from_customers()`:
```sql
-- fires BEFORE INSERT OR UPDATE OF customer_id
IF NEW.customer_id IS NOT NULL THEN
  SELECT first_name, last_name INTO NEW.customer_first_name, NEW.customer_last_name
  FROM customers WHERE id = NEW.customer_id;
END IF;
```
Two defects:
1. **Wrong direction / wrong trigger** — it fires when the *booking* changes, never when the *customer* is renamed. A rename never touches the booking row, so it never runs.
2. **Incomplete** — it syncs `customer_first_name`/`customer_last_name` only. It never sets `customer_name`, the NOT-NULL legacy column the list UI actually shows.

There is **no trigger on `customers`** to push name changes outward.

---

## Write paths (where copies are made)

- `CustomerService.updateCustomer` — `src/services/customers.ts:247` — writes only the `customers` table. No propagation.
- `createBooking` / `updateBooking` — `src/services/private-bookings/mutations.ts` (~304, ~617) — build `customer_name` = `first + last` and store the denormalised trio.
- Parking: `src/services/parking.ts:109` copies `customer.first_name/last_name` onto `parking_bookings` at insert.

---

## Read paths (who shows the copies)

| Path | File | Source | Verdict |
|---|---|---|---|
| Private-bookings **LIST** (the reported screen) | `queries.ts fetchPrivateBookings` → `private_bookings_with_details` view | denormalised cols | **STALE** |
| Dashboard balances | `dashboard/private-booking-balances.ts:53` | denormalised | **STALE** |
| Dashboard data | `dashboard/dashboard-data.ts:1018` | denormalised | **STALE** |
| Global search API | `app/api/search/route.ts:96` | denormalised | **STALE** |
| Weekly summary email cron | `app/api/cron/private-bookings-weekly-summary/route.ts:173` | denormalised | **STALE** |
| Private booking **emails/SMS** (deposit, confirmation) | `lib/email/private-booking-emails.ts` | denormalised (`customer_first_name`/`customer_name`) | **STALE** |
| Parking confirmation/refund emails & SMS | `lib/parking/notifications.ts`, `refundActions.ts:102` | denormalised | **STALE** |
| Single booking fetch | `queries.ts getBookingById` | joins `customers` live | LIVE |
| Detail page header | `PrivateBookingDetailClient.tsx:2081` `customer_full_name \|\| customer_name` | **reads generated denormalised col**, not the join | likely **STALE** ⚠️ |
| Contract PDF | `lib/contract-template.ts:103` `customer_full_name \|\| customer_name` | **reads denormalised col**, not the join | likely **STALE** ⚠️ |

Note: the detail page and contract template *join* `customers` but then render `booking.customer_full_name` — which is the denormalised generated column, not the joined `booking.customer.first_name`. So even "LIVE-joined" fetches can still print the stale copy. This is why the reliable fix is at the data source, not per read path.

---

## Views inherit the staleness

- `private_bookings_with_details` — serves `customer_name`, `customer_first_name`, `customer_last_name`, `customer_full_name` straight from the table.
- `private_booking_summary` — serves denormalised `customer_name` **and** live `c.first_name`/`c.last_name` (mixed).

---

## Intentional snapshots — leave alone

- `table_bookings.guest_name` — order-time snapshot.
- `bookings.attendee_names[]`, `booking_items.attendee_names[]` — per-ticket attendee names supplied by the purchaser, not the customer's master name.

---

## Recommended fix (data-layer, self-healing)

Single migration, no app-code changes required; every read path (join or denormalised) becomes correct:

1. **Backfill** the 4 stale `private_bookings` rows (and any parking) from `customers` — fixes Paula and the other 3 immediately.
2. **Repair `sync_customer_name_from_customers()`** to also set `customer_name` (legacy NOT-NULL col), so booking-side syncs are complete.
3. **Add an `AFTER UPDATE OF first_name, last_name` trigger on `customers`** that updates linked `private_bookings` (first/last/customer_name; full_name auto-regenerates) and `parking_bookings` (first/last). Guarded with `IS DISTINCT FROM` to avoid needless writes; no recursion (it doesn't touch `customer_id`).

Result: renaming a customer flows everywhere — list, dashboard, search, emails, SMS, contracts, parking — from one source of truth.

### Optional hardening (follow-up, not required)
- Point email/SMS senders and the list view at the live customer join where a `customer_id` exists, as defence-in-depth.
- Plan eventual removal of the deprecated `customer_name` column in favour of `customer_full_name`.

### Out of scope / risk notes
- Backfill + triggers are DB changes → require explicit approval and a prod migration (applied via Supabase MCP `apply_migration`).
- Non-destructive: no drops, no data loss; only refreshes name copies to match the source.

---

## OUTCOME — SHIPPED 2026-07-03

Approved approach: **data-layer self-heal**. Migration `20260724000000_sync_customer_name_to_bookings.sql`
written to repo and applied to prod via Supabase MCP `apply_migration` (name `sync_customer_name_to_bookings`).

Delivered:
1. Repaired `sync_customer_name_from_customers()` to also maintain the legacy NOT-NULL `customer_name`.
2. New `propagate_customer_name_trigger` on `customers` (AFTER UPDATE OF first_name/last_name) → updates
   linked `private_bookings` (first/last/customer_name; full_name regenerates) and `parking_bookings` (first/last).
3. Backfilled existing stale rows.

Verification (live prod):
- Paula's booking now reads **Paula Campbell** across customer_name / first / last / full_name.
- Stale count: `private_bookings = 0`, `parking_bookings = 0`.
- Trigger installed and confirmed.
- Live propagation proven: renamed customer inside an aborted block → booking copy updated to the new
  name, then rolled back (RAISE EXCEPTION). Paula's source record confirmed unchanged afterwards.
- No recursion: existing booking-side trigger fires only on `UPDATE OF customer_id`, which this path never touches.

No app-code changes required — every read path (live join or denormalised copy) is now correct.

### Follow-ups (NOT done — separate concern, flagged for decision)
- Same drift risk exists for **email/phone** copies: `parking_bookings.customer_email/customer_mobile`,
  `private_bookings.contact_phone/contact_email`. Reported issue was name only; these were left untouched.
- Eventual removal of the deprecated `private_bookings.customer_name` column in favour of `customer_full_name`.
- Repo migration file is uncommitted (prod already updated via MCP); commit is a separate main/remote op.
