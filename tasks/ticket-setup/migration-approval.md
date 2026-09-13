# Ticket setup migration approval packet

Status: local draft, not applied to production. No deployment performed.

## Exact target and SQL

Production: `the-anchor-management-tools`, project ref `tfcasgxopxegwrabvwat`.
The repository `.env.local` public URL resolves to `https://tfcasgxopxegwrabvwat.supabase.co`.

Migration name: `ticket_setup_and_attendees`.
Exact SQL: [20260910065400_ticket_setup_and_attendees.sql](../../supabase/migrations/20260910065400_ticket_setup_and_attendees.sql).
SHA-256: `3c932cde7891ed338c8fcd548343b285d96d0ce804d6db84d002c8b1ab28ee21`.

Apply only through the verified Supabase MCP after the owner approves this exact target, checksum and forward-fix plan. Regenerate this packet if SQL changes.

## Verified live state

Read-only catalogue inspection on 10 September 2026 found 130 events, 1,532 bookings and 136 ticket types. Sizes were approximately 0.9 MB for events, 2.5 MB for bookings and 80 KB for ticket types. Tasting Night (`5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65`) had no bookings. Its event price was 45 and Standard ticket base was zero.

Latest remote migration at inspection: `20260909084500_marketing_monthly_roundup_cap_exempt`. The proposed filename sorts after it. Other remote history entries are not all mirrored in the current checkout, so no production CLI push is permitted.

Read the live columns, constraints, indexes, policies, table grants and triggers on events, bookings, booking_items and event_ticket_types. The three dependent views are customer_communications, recent_reminder_activity and reminder_timing_debug. Their explicit column lists are unaffected, and intentionally do not expose the new attendee answers. No view recreation is needed for this additive change.

The current live v05/v06/v07/default-item sync definitions are captured in [live-booking-functions.sql](live-booking-functions.sql). The migration preserves v05 capacity/allocation rules and v06 hold rules. It replaces v07 and the default-item sync using those exact live definitions with the pricing changes described below.

## Objects and behaviour

- Ordinary free and pay-on-arrival events keep the simple booking form. Guest details are required for online-paid events, or paid events with explicitly configured questions.
- Adds events.online_discount_ends_at and events.booking_questions (empty array by default).
- Adds bookings.attendees (empty array by default) and ticket_price_locked (false for existing records, true on new inserts).
- Explicitly free ticket baskets confirm without creating a PayPal order; their temporary payment holds are consumed atomically.
- Both single-ticket and selected-ticket creation use the ticket base price and stop applying an expired discount. Existing booking item unit prices remain unchanged.
- v08 validates guest counts, stable IDs, names, required answers and choice/yes-no values before booking. The answer labels, types, required flags and choice options are snapshots. Unknown question IDs are rejected, so a concurrent question removal cannot silently discard an answer. Only confirmed/pending_payment results receive attendee writes, so retry conflicts cannot alter an existing booking.
- Paid public events require individual guests. Free events retain their simple booking path.
- Optional p_expected_total is checked against the completed ticket snapshot inside v08. A price_changed exception rolls back the entire new booking and hold.
- Deactivating or deleting the last active ticket is blocked (parent event cascade remains allowed). Changing seats on a named booking requires a matching canonical guest count in the same update.
- New events receive one Standard ticket. Ticket edits mirror the first active price to both legacy event price fields. Explicit legacy price edits update that ticket. Nested trigger calls do not loop.
- Canonical attendee updates mirror names to the booking and matching ticket items in the same transaction.
- Repairs upcoming events with exactly one active Standard ticket at zero and a positive existing event price, taking the amount from the event record. Live review found 12 upcoming zero-Standard mismatches (11 pay-on-arrival events and Tasting Night); the migration also checks the sole-active-type condition at application. It changes ticket configuration and legacy event mirrors only. Historical booking_items prices and guest records are not backfilled.
- New and replaced restricted functions explicitly revoke PUBLIC, anon and authenticated execution, and grant service_role execution. Existing table RLS and grants remain in place. Answers remain on bookings, which has no anon table grant.

## Risks and locks

High-risk statements requiring approval: the guarded upcoming Standard-ticket data updates; function replacements; new SECURITY DEFINER functions; trigger creation; explicit function grants/revokes; and NOT NULL/check constraints on additive columns.

ADD COLUMN takes a brief ACCESS EXCLUSIVE table lock. Constant defaults avoid a row-by-row data rewrite on current PostgreSQL. Checks scan these small tables. A five-second lock timeout aborts if locks cannot be obtained promptly. Run as a single migration transaction so a failure leaves no partial schema. There is no table/column drop, external message, payment capture or batch job.

New answer fields can contain allergy/accessibility information. They inherit existing authorised booking access and must not be added to public responses, analytics, logs or audit payloads by the application. Application staff edit validation still needs to ensure seat counts and canonical guests agree.

## Validation completed

`python3 scripts/testing/ticket-setup-postgres.py` executes the real live v05/v06 and replacement v07/v08 plus triggers on an isolated socket-only PostgreSQL cluster. It passes 45 assertions covering transactional schema rollback, invalid count/name/required answers, duplicate stable IDs, two individual guests, explicit none answers, choice validation, both price/expiry paths, retained hold price, staff name mirroring, retry non-mutation, both pricing editor directions without recursion, free bookings and restricted RPC grants.

`npx tsx scripts/security/assert-anon-surface.ts`: all nine live read-only baseline checks passed. This is a pre-apply baseline, not proof of the unapplied migration on production.

Limitations: fixture capacity/allocation helpers replace the live seating allocator. The fixture does not reproduce every production trigger or permission helper. The harness does not contact PayPal, send confirmations or run the browser. The full app integration and production smoke tests remain separate gates.

## Forward-fix plan

Prefer a forward fix because dropping new columns after use would destroy guest answers. If the transaction fails, PostgreSQL rolls back all changes. If an application regression appears after apply, pause new affected bookings through the existing booking-open control, preserve bookings/items/attendees and deploy a corrected application or narrowly reviewed migration. Do not restore old price calculation while locked holds are in use.

The captured prior function definitions support an explicitly reviewed emergency function restoration, but are not a blanket executable rollback: v08, new triggers and already quoted prices must be considered together. Never delete attendee data or reprice sold items as rollback. A full database restore is a last resort requiring owner approval and a verified backup because it also affects unrelated production bookings.

## Post-apply verification

Reconfirm project identity and checksum immediately before apply; capture returned history version and time. Then inspect every new column, function, trigger, grant and constraint, verify the guarded Tasting Night repair, and run the anon surface script again. Exercise happy, invalid-answer and conflict RPC paths using dedicated synthetic records in a guaranteed rollback transaction, with external communications disabled. Verify permission behaviour as anon, representative authenticated roles and service_role. Finally complete browser checkout and payment-hold checks against the deployed application before reporting the feature live.
