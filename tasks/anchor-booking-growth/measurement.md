# Booking growth measurement baseline

Read-only snapshot: 5 September 2026. Source: production Supabase project `tfcasgxopxegwrabvwat`, verified against the repository's configured project. Reproducible query: `baseline.sql` beside this file.

## What this baseline can support

Use unique booking IDs to compare booking acquisition. Do not use raw analytics rows as conversions, and do not use these counts to estimate incremental profit or attendance.

The cohort contains records created from 8 August 2026 00:00 London, inclusive, to 5 September 2026 00:00 London, exclusive. It includes bookings for later service dates. It is not the June to August service-date cohort in the original report. No guest names, contact details or free-text booking notes were exported.

| Measure | Observed result | Meaning |
|---|---:|---|
| Event reservation records, excluding reminder-only rows | 23 | 20 confirmed, 1 completed, 2 cancelled at snapshot |
| Event booking-created analytics rows | 25 | Raw event count overstates unique reservations |
| Distinct event IDs in those analytics | 23 | All 23 matched the actual reservation cohort; none unmatched |
| Private-hire records created | 6 | 2 confirmed with deposit dates, 3 draft, 1 cancelled |
| Nonzero private-hire header totals | 0 of 6 | Header totals are not the effective charge source |
| Private-hire item totals | 2 confirmed bookings: £1,249; 1 draft: £900 | Actual item-level values exist despite zero headers; these are quoted line totals, not verified completed revenue |
| Private-hire confirmation analytics | 5 rows, 3 IDs | Confirmation events are not enquiry-cohort conversion counts |
| Brand-site food booking records | 71 | 34 completed, 10 visited-waiting-for-review, 9 confirmed, 14 cancelled, 4 no-show |
| Table booking-created analytics | 83 unique IDs | Different source/purpose coverage from the food-only website cohort; do not equate totals |
| Event check-in rows occurring in the window | 0 | This check-in table alone cannot establish event attendance |

Two repeated event-creation IDs each have two different recorded sources and identical seat counts. They are not proven duplicate customer bookings. Count distinct booking IDs and keep source conflicts visible. Do not delete analytics records to force a match.

The table query found three records with cancellation/no-show status and an attendance timestamp. It excludes those from the conservative attendance-marked measure and reports them separately. A timestamp alone is not proof of a completed visit. Some visited statuses lack timestamps. Staff interpretation is needed before historical attendance is treated as a reliable denominator.

## Repeatable definitions

- Dining acquisition: unique non-event food booking ID created in the cohort, segmented by source and current state. Show cancellations and no-shows separately.
- Dining attendance: service-date cohort with a trustworthy attended status/timestamp, excluding contradictory terminal states. Report missing and conflicting data rather than impute it.
- Event acquisition: unique non-reminder reservation ID. Sum seats once per reservation and retain cancellations separately.
- Event attendance/fill: attended seats divided by approved sellable seats for the same dated event. A completed reservation, check-in row and individual attended seat are different grains. Do not multiply a lead-booker check-in into full-party attendance without operational confirmation.
- Private hire: enquiry-created cohort followed through quote, deposit and completion. Use actual deposited status rather than a button or repeated confirmation analytics event. Use item-level charge totals (as the current queries service does), reconcile invoices/payment state and discounts/VAT before reporting completed value.
- Web conversion: unique business confirmations divided by eligible consent-aware sessions in the same definition/window. GA4 sessions/device detail are not present in these database aggregates; no conversion rate is published here.
- Contribution: verified sales less relevant variable costs, with deposit receipts excluded from double counting and attendance/substitution limitations stated.

## Weekly operating check

Run the read-only query with a new completed cohort window. Reconcile IDs before interpreting changes. Track late status updates separately; an enquiry cohort must mature before judging close rate. Keep baseline snapshots for comparison and annotate releases, service changes and promotions.

The initial promotion gate remains closed until service capacity and staff coverage are confirmed, a source-tagged campaign can be tied to its booking IDs, and attendance/sales can be established. No dashboard, automation, campaign or live record was changed for this baseline.

## Private-hire follow-up coverage

Independent read-only review of the same six-record cohort found one contract-sent timestamp, two deposit dates, no completed bookings and one cancellation with a populated reason. Existing staff queues cover expiring holds, stale drafts, missing details, unpaid balances and pending SMS. Use these existing queues.

There is no assigned lead owner or first-human-response timestamp in the inspected schema. Created-by, updated-at and automated message timestamps do not establish these measures. Response-time and ownership reporting therefore remain unavailable. Cancellation reasons sometimes use generic defaults, so a populated value is not automatically an actionable commercial loss reason. No fields or retrospective values were invented.
