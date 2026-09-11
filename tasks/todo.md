# Christmas minimum from 6 to 4, 11 September 2026 (applied to production)

- [x] Prove the production ref (`tfcasgxopxegwrabvwat`) from `supabase/.temp/project-ref` and `.env.local`; read live state with read-only SELECTs only.
- [x] Capture both live function definitions and match them to production by md5 before editing.
- [x] Draft `20260911133645_christmas_minimum_four.sql` (two gates, EXECUTE re-stated, one period row) and its rollback in `supabase/rollbacks/`.
- [x] `CHRISTMAS_MIN_PARTY_SIZE` to 4; fixtures that modelled the 6-guest period moved to 4.
- [x] Tests that fail on the old values: `christmas-minimum.test.ts`, `FohCreateBookingModal.test.tsx`.
- [x] Validate on an isolated local database: production state reproduced, migration, re-run, rollback, unhappy paths.
- [x] Gates: lint (0 warnings), typecheck, `npm test` and `npm run test:utc` (791 files, 7,174 passed, 2 existing skips each), cold build. The build ran out of memory at the default heap while type checking and passed with `NODE_OPTIONS=--max-old-space-size=8192`, the same flag the typecheck needs.
- [x] Owner go-ahead (11 September 2026), then applied through `prod-migrate` to `tfcasgxopxegwrabvwat` as production migration `20260911170248 christmas_minimum_four`.
  - Applied as one DO statement rather than by pasting the 66 KB file: it read each function's live `pg_get_functiondef`, required md5 `f8f7f2b84b4fdf9ff7cb5266416a21c8` (core) and `988a2a5ddefd576aef392edaf70c67dc` (v05), made the two Christmas edits, required the edited text to hash to `abfa1c3f725cd01bb5ddfed2a39b23dc` and `1f8074f0034a99dc9b89274cde5f67ee` (the md5 of this file's two CREATE statements plus a newline, so the text run is byte for byte the file's), then ran it, restated the same EXECUTE grants, moved the period row from 6 to 4 and ran this file's own end-state assertions. Anything unexpected would have rolled the whole statement back.
  - After: both function md5s as above; `christmas-2026` min_party_size 4; EXECUTE unchanged (core: service_role only; v05: authenticated and service_role); `resolve_table_booking_deposit` on 4 December 2026 refuses 3 and asks £40, £50 and £60 of 4, 5 and 6; `scripts/security/assert-anon-surface.ts` all 9 checks passed.
  - Rollback unchanged: `supabase/rollbacks/20260911133645_christmas_minimum_four.sql`, or the same guarded pattern in reverse.

Decisions: the period row is matched on its code, not its production id, so a rebuilt database applies it too. Marketing campaign files were left alone: two are records of emails sent in August, the rest are the designer's handover samples that the fidelity tests pin byte for byte.

# Email-first messaging: review fixes for the bounce fallback, 11 September 2026

Integration branch `feat/email-first-integration-2026-09-11`, on top of `dc76b5a9`. Local commits only. With every flag off nothing a guest or staff member sees changes, except the party-size checkbox label and the cancellation email key.

- [x] 1a. A fallback job inside quiet hours (or within five minutes of 21:00) waits for the next 09:00 London: the queue puts the same job row back to pending, unclaimed, so the render and every check run again when the text can go (`069126eb`).
- [x] 1b. Renderers return `validUntil` for time-bound wording; the job skips with `too_late` at or after it. Private deposit received states the deposit paid date, so a deleted deposit is `booking_changed` (`8a75b8ce`).
- [x] 1c. A message that no longer applies (hold paid or gone, balance paid, link used, guest answered, choices in) is skipped as `no_longer_needed`, never failed, in both renderers (`8a75b8ce`).
- [x] 2. The fallback never texts a private booking trigger that needs approval: `needs_approval`, listed for staff (`b8812056`).
- [x] 3. Party-size checkbox reads "Notify guest" (`fdead553`).
- [x] 4. Table cancellation email key includes the booking's `cancelled_at` (`cc2f12ec`).
- [x] 5. The private booking email-first flag is read once per action and passed to the messenger (`3b7bb44b`).
- [x] Gates: lint, uncached tsc, `npm test`, `npm run test:utc`, uncached build.
- [ ] Push, merge and deploy: not asked for; local commits only.

Results (Node 20.19.5): lint clean; uncached `tsc --noEmit` clean; 822 test files, 7,730 passed and 2 skipped in both London and UTC; uncached `npm run build` passes with `NODE_OPTIONS=--max-old-space-size=6144`.

Decisions recorded: "due tomorrow" and "2 days to go" balance wording is held to its relative words (start of the due day, start of the day before), like the event reminder; a used manage link still reports `link_expired`; the quiet-hours decision uses `evaluateSmsQuietHours`, the rule sendSMS applies, so the two cannot disagree.

# Email-first messaging: bounce fallback for table bookings, 11 September 2026

Integration branch `feat/email-first-integration-2026-09-11`. Local commit only. Nothing changes for guests while `bounce_sms_fallback` or the table flags are off.

- [x] Every email-first table booking message writes its booking id, template key, message, stated facts and link form on the delivery row at insert (`deliveryMetadata` on `notifyCustomer`, `fallback-details.ts`). Ids and facts only.
- [x] One text builder per message in `guest-texts.ts`, shared by the email-first sender, the flag-off sender and the fallback.
- [x] Table booking renderer for the five template keys. Links are found through the existing short link and a live token, never made; otherwise `link_not_found`, `link_expired` or `link_not_rebuildable`, in plain words for staff.
- [x] A text that cannot be rebuilt for a booking cancelled, started or changed since is skipped, not raised with staff.
- [x] Tests: sender text equals rebuilt text for all five keys (cancellation in seven refund variants), unavailable paths, changed facts, cancelled and reinstated bookings, one end-to-end run, fixture renders either side of 25 October 2026.
- [ ] Push, merge and deploy: not asked for; local commit only.

Results: lint clean; uncached `tsc --noEmit` clean; 822 test files, 7,637 passed and 2 skipped in both London and UTC; uncached `npm run build` passes with `NODE_OPTIONS=--max-old-space-size=6144`.

# Email-first messaging P2, P3 and P5, 11 September 2026

Same branch as P1. Every change sits behind a `messaging_flags` key that reads as off, so deploying changes nothing for guests. Local commits only.

- [x] P2 `event_promo_last_push`: skip the 7-day intro and 24-hour follow-up; one last push 0 to 3 London days out, before the start, under 25% booked; two promo texts per person per rolling 30 days; keys `event_last_push` and `event_last_push_paid`.
- [x] P2 `event_promo_intro_sms_no_email` (only with the flag above): today's 7-day intro for guests with no usable email, inside the same cap.
- [x] P2 tests: capacity boundaries, timing window (London midnight, both clock changes), third-night cap, no-email intro, reply-to-book, flag off. Gate: lint and tsc clean; 797 files, 7,274 passed and 2 skipped in London and UTC.
- [x] P3 `table_cancelled_email_first`: email first, email-only guests covered, `table_booking_id` in the SMS metadata, staff see a failed notice.
- [x] P3 `table_deposit_confirmed_email_first`: email first, one message for five triggers (claim, pre-check, idempotency key).
- [x] P3 `table_party_size_deposit_email_first`: email first, real channel and outcome in the staff toast.
- [x] P3 `table_preorder_email_first`: email first instead of both.
- [x] P5 `table_confirm_reminder_email_first`: email first, shared short link, email-only guests eligible.
- [x] Fixture renders of every new email in London and UTC (cancellation in all seven refund variants, deposit confirmed, deposit request, pre-order, tap-to-confirm), failing on undefined, Invalid Date, NaN, £0.00, null and banned dashes, with the weekday checked against the calendar.
- [x] Gates after each piece: lint, tsc, `npm test`, `npm run test:utc`; uncached build at the end.
- [ ] Push, merge and deploy: not asked for; local commits only.

Results: lint clean; tsc clean; 804 test files, 7,356 passed and 2 skipped in both London and UTC; no test reads the real flags row (checked with an instrumented run); uncached `npm run build` passes with CI's `NODE_OPTIONS=--max-old-space-size=6144`. At Node's default heap the build's type check runs out of memory, as it already did at P1: tsc peaks at 4.86 GB here against 4.53 GB at P1, and CI gives the build 6 GB.

Found, not changed: the BOH party-size checkbox still reads "Notify guest by SMS" (with the flag on the toast names the channel used); the tap-to-confirm token expiry string noted in the plan is untouched; the no-email intro and the last push can both reach one guest on the same day for two different nights (inside the two-a-month cap).

# Email-first messaging P1, safety foundations, 11 September 2026

Branch `feat/email-first-messaging-2026-09-11`. No guest-visible change: every new path is behind a flag that reads as off, and the new levers are kill switches nobody has set.

- [x] Pre-check: `SUSPEND_ALL_COMMS` and `SUSPEND_ALL_EMAIL` are not defined in production (`vercel env ls production`, names only).
- [x] `sendEmail` honours `SUSPEND_ALL_EMAIL` and `SUSPEND_ALL_COMMS` before the suppression lookup; `code: 'email_suspended'`.
- [x] Marketing holds its queue while email is suspended (classifier and cron guard).
- [x] `sendSMS` and `resolveSmsSuspensionReason` honour `SUSPEND_ALL_COMMS`.
- [x] `isMessagingFlagOn()` reads `system_settings.messaging_flags`, 60-second cache, off in every failure mode.
- [x] `notifyCustomer`: idempotency key, accepted-but-unlogged email counts as sent and alerts, `finalStatus` and `fallbackUsed`.
- [x] One `isEmailUsable()` in `channel.ts`, used by `notify.ts`.
- [x] `CLAUDE.md` kill-switch paragraph and `.env.example`.
- [x] Gates: lint, tsc, tests in London and UTC, uncached build.
- [ ] Push, merge and deploy: not asked for; local commits only.

Results: lint clean; `npx tsc --noEmit` clean (it needs `NODE_OPTIONS=--max-old-space-size=8192`, as in CI); 794 test files, 7,208 passed and 2 skipped in both London and UTC; uncached production build passed. The first commit's tree passed the same gates on its own (792 files, 7,177 passed).

Left for later pieces: writing `final_status = 'fallback_sent'` for the daily monitor was not in this brief. `CRON_ALERT_EMAIL` is not in the production environment list, so the new sent-but-unlogged alert reaches the logs only until it is set.

# Email-first messaging P4, P6 and P7, 11 September 2026

Branch `feat/email-first-bookings-2026-09-11` (worktree `OJ-AnchorManagementTools-wt-email-b`), on top of P1. Local commits only. Every guest-visible change sits behind a `messaging_flags` key that reads as off; the only unflagged change is the step 0 bug fix.

- [x] P6 step 0: the queue bulk-cancel stops writing the missing `updated_at` column and checks its error (three paths in `mutations.ts`, one in the expire-holds cron); regression tests. No clean-up of existing stale rows. Gates: lint and tsc clean; 796 files, 7,217 passed and 2 skipped in London and UTC.
- [x] P4 (`bounce_sms_fallback`): the Resend webhook enqueues one `notification_delayed_fallback` job per bounced, failed or suppressed transactional email; the job claims the delivery once, re-renders the text from the live booking, skips cancelled, past or changed bookings, sends through `sendSMS`, and marks failures with an audit row and a staff alert; "Undelivered guest messages" on `/settings/sms-failures`. Gates: lint and tsc clean; 800 files, 7,253 passed and 2 skipped in London and UTC. No renderer is registered yet: P6 adds the private booking one, and table booking keys from P3 and P5 need theirs before they set `delayedFallbackAllowed`.
- [x] P6 (`private_booking_email_first`): `sendPrivateBookingMessage` chooses email when the booking has a usable address (contact email first, then the customer's), falls back to the queued text on failure, and records the delivery for P4; every automated caller switched; Send Now chooses the channel at send time; email builders for the text-only messages and the six cancellation variants; waived-deposit wording; emails on the Communications tab and timeline. Gates: lint and tsc clean; 807 files, 7,358 passed and 2 skipped in London and UTC.
- [x] P7 (`staff_message_email_option`): email choice on the BOH "Message guests" modal, the single-guest card and the private booking Messages tab, defaulting to email for a guest with a usable address; permissions unchanged; toasts show the real outcome. Gates: lint and tsc clean; 811 files, 7,386 passed and 2 skipped in London and UTC.
- [x] Fixture renders of every new email in London and UTC (no `undefined`, `Invalid Date`, `NaN` or `£0.00`; weekday matches the date): `tests/lib/privateBookingMessageEmails.fixtures.test.ts`, four event dates including both 2026 clock changes.
- [x] Gates after each piece: lint, `tsc --noEmit`, `npm test`, `npm run test:utc`; uncached build at the end (`rm -rf .next && npm run build` with CI's `NODE_OPTIONS=--max-old-space-size=6144`; the default 4 GB heap runs out during the type check).
- [ ] Push, merge and deploy: not asked for; local commits only.

# AI event copy builder layout, 6 September 2026

- [x] Inspect live panel and trace card padding.
- [x] Apply spacing inside CardBody, align with app tokens and wrap narrow-screen content.
- [x] Verify desktop/mobile layout and existing copy controls with fixtures.
  Browser checks: desktop, 390px and 320px; no horizontal overflow. Switched to GBP, selected a custom link, generated fixture copy and copied it successfully.
- [x] Run quality gates: lint, typecheck, 734 test files (6,331 tests passed, two existing skips), production build.
- [ ] Merge and verify production deployment.

Scope: UI only. Existing generation prompts and server action unchanged. The card previously combined outer padding with its automatic inner padding, while outer space-y never reached the form sections.

# Event checklist rapid completion, 6 September 2026

- [x] Confirm the active event detail card reloads after each completion.
- [x] Update only the changed task, with independent pending and rollback state.
- [x] Verify overlapping saves, failures and reopening in six component tests and browser fixtures.
- [x] Complete build gate: lint, typecheck, 734 test files (6,331 passed) and production build passed.
- [ ] Merge, deploy and verify the production release.

Browser evidence: five ticks produced four saved tasks and one isolated rollback; checklist reads stayed at one while other tasks remained usable.

No database migration. Assumption: completing prep tasks refers to the event detail checklist. Other checklist views already update local state without explicitly reloading the checklist.

# Friday manager report, 5 September 2026

Detailed plan: [Friday manager report](./plan-2026-09-05-friday-manager-report.md).

- [x] Discover existing manager emails and record the owner's timing decisions.
- [x] Implement the report queue, renderer and protected delivery route without a migration.
- [x] Connect selected manager notifications and Friday snapshots.
- [ ] Complete regression checks and release verification.

# Nav pills: make every pill a clearable to-do

Goal: a pill means "there is something here you can action now", and working
through the app drives every pill to zero.

## Findings that shaped the plan

- Approving a charge request can never succeed. `decide_charge_request_v05`
  returns `stripe_payment_method_id` hard-coded to NULL, and
  `charge-approvals.ts` fails any charge with "No card on file" when that is
  missing. 28 requests created, 0 charged, 1 waived, 27 stuck pending.
  So the in-app queue is waive-only. No Approve button, because it would be a
  button guaranteed to fail.
- Feedback needs no schema change. The inbox is backed by `review_feedback`,
  which already has `status` plus `handled_by`/`handled_at`, and the actions
  file already defines `OPEN_STATUSES = ['new','in_progress']`.
- Parking has no staff-actionable queue. All 9 bookings are terminal
  (paid/expired/cancelled); `payment_status='pending'` only ever means "waiting
  on the guest" and self-resolves. Dropping parking from the counts entirely.

## Tasks

- [x] 1. Counts action-only: invoices drop `sent`/`partially_paid`; table
      bookings drop `pending_payment`; remove parking from the type and query
- [x] 2. Add rota (leave requests pending), checklists (tasks still open and due),
      feedback (`new`/`in_progress`) to `OutstandingCounts`
- [x] 3. Map the three new ids in `navCount`, drop parking
- [x] 4. In-app charge-request queue under /table-bookings, waive-only, with
      permission check and audit logging
- [x] 5. Tests for the new count semantics and the waive action
- [x] 6. Verify: typecheck, lint, full test suite, production build

## Review

Two problems found during the build that the plan had not anticipated.

**RLS made two of the new counts silently zero.** `checklist_task_instances`
has a service_role-only policy and `review_feedback` has RLS enabled with no
policies at all, so both return zero rows through the cookie-based client the
action was using. Nothing errors: the badge would simply have stayed empty
forever. Those two counts now read through the admin client, gated on an
authenticated user, with the rest left on the cookie client so no existing
count changed behaviour.

**A client component pulled server-only code into the browser bundle.**
Importing `formatChargeRequestType` from `charge-approvals.ts` dragged Stripe
and the email stack in with it and the production build failed on missing
`net`/`fs`/`tls`. The formatter now lives in `charge-request-labels.ts`, a pure
module, re-exported from `charge-approvals.ts` so existing callers are
unaffected. Worth remembering: `npx tsc --noEmit` and the dev server both pass
this, only a production build catches it.

Verified: typecheck clean, lint clean, 4,671 tests pass, clean production build,
and the queue UI checked in a browser (render, selection, empty state).

Pill values at the time of writing: menu 121, table bookings 27, private
bookings 13, checklists 55, rota 4, invoices 4, receipts 1, feedback 1.

# Event QR pack: printed media only

## Tasks

- [x] Exclude screen-only QR channels from the event QR pack
- [x] Keep screen QR channels available everywhere else
- [x] Add a regression test for print, screen and digital channel inclusion
- [x] Run focused tests, typecheck and lint

## Review

The event QR pack now creates, renders and lists only the 23 print channels. The
five screen channels and all digital channels are excluded from this export, but
their shared catalogue and event tools are unchanged.

Verified on Node 20: 19 focused QR-pack tests and all 5,257 project tests pass;
typecheck, full lint, diff checks and the production build are clean.

Deployed to production as Vercel deployment
`dpl_EiqZdHqDgXXgTWRgdVwzvm7FqgAm`; the production aliases report Ready.

# FOH selected-customer walk-in hardening

## Tasks

- [x] Require the current FOH booking client contract and reject stale screens
- [x] Carry explicit selected/phone/anonymous customer intent to both booking APIs
- [x] Refresh long-lived FOH screens when the deployed version changes
- [x] Reject non-today walk-ins and direct staff to create a normal booking
- [x] Add regression tests for identity, stale clients, refresh checks and seating
- [x] Verify focused tests, typecheck and lint; confirm the branch is `main`

## Review

The faulty booking came from an old FOH screen that did not send the selected
customer id. Current FOH requests now state whether the operator selected a
customer, entered a phone number, or intentionally chose an anonymous walk-in.
The APIs reject stale clients instead of silently creating a Walk-in customer,
and long-lived FOH screens reload after a deployment when it is safe to do so.

Non-today walk-ins are rejected by the screen and both APIs, including the manual
override path. Staff are told to use Add booking instead. Verified on `main`:
80 focused FOH tests and all 5,121 project tests pass;
typecheck, lint and diff checks are clean. The production build compiled and
typechecked, but its final page-data step could not be checked while the live
development server was writing to the same `.next` directory.

# Public citation baseline, 4 September 2026

## Tasks

- [x] Confirm the canonical public identity, contact details and live hours source
- [x] Research current official standards for core maps and directory platforms
- [x] Find and verify existing public listings across maps, social, hospitality and local directories
- [x] Record missing, incorrect, duplicate and inaccessible listings with confidence and evidence
- [x] Produce a prioritised baseline for a later change plan, without changing any live listing

## Review

Completed a read-only audit of 45 public surfaces, passive references and
realistic placement opportunities. The
baseline, standards, evidence limits and priority findings are recorded in
`tasks/seo-powerhouse/2026-09-04-the-anchor-citations/`. No live listing was
changed.

# Public citation corrections, 4 September 2026

## Tasks

- [x] Record the owner's batched approval and account guardrails
- [x] Correct the dead CAMRA URL in the website SSOT
- [x] Retire the obsolete Tabology ordering profile
- [ ] Submit the prepared Tabology support request to replace its residual public `orders@the-anchor.pub` email
- [ ] Retire the obsolete Uber Eats ordering profile
- [ ] Correct P0 misinformation on Cylex, SquareMeal and inapub
- [x] Claim Apple Maps and submit its corrected location, actions and brand media
- [x] Correct OpenTable hours and verify its dietary options
- [x] Submit TripAdvisor business information and menu corrections
- [ ] Correct or claim Bing and Yell listings
- [x] Correct the claimed Yelp listing
- [x] Find and claim the existing free Nextdoor Business Page
- [x] Correct OpenStreetMap and submit corrections for dependent local listings
- [ ] Work through remaining actionable P2 and P3 citations
- [ ] Verify every submitted or live change and update the change log

## Review

In progress. OpenStreetMap and Pubs Galore corrections are live. Apple is claimed
and verified, with four gallery photos published and its location, actions, logo
and cover photo in review. SquareMeal,
CAMRA, Yell, Restaurant Guru, Useyourlocal, inapub, Barrel & Stone and Staines
Online corrections are submitted. Uber Eats retirement is with support. OpenTable
hours are corrected and its accurate gluten-free and vegan options are published.
Cylex is submitted and awaiting moderation. The beerintheevening registration
email did not arrive, so its direct support form is prepared and awaits one
owner CAPTCHA. TripAdvisor's canonical hours, address, tenant description and cuisines
are submitted and processing. Its false Buffet attribute is removed, both stale
2025 rich menus are unpublished, and its link now points to the live menu.
Nextdoor is claimed without a duplicate and now publishes the correct logo,
cover photo, public contact details, website, hours, categories and tenant
description. Its public page is confirmed accessible while signed out. Yelp's
canonical hours and tenant description are now live, and its payment attributes
have been checked. Tabology Mobile Ordering and click and collect are disabled,
both signed-out ordering routes refuse orders, and its public address, hours and
social links are corrected. Its information page still shows
`orders@the-anchor.pub` because the Venue details contact fields reject input in
the current owner session. Its support request is prepared and awaits the visible
reCAPTCHA and Submit. Bing remains locked pending verification. Paid placements
remain excluded.

## API connections, 5 September 2026

See `tasks/fix-function/2026-09-05-api-connections/todo.md` for the isolated remediation run, verified fixes and production rollout.

## 5 September 2026: Anchor booking growth

- [x] Implement event dining requests and Christmas course snapshots in the isolated booking-growth branch.
- [x] Complete independent SQL/code review and isolated migration/rollback tests.
- [x] Save baseline, guarded menu corrections, dated-capacity review and release approval package in `tasks/anchor-booking-growth/`.
- [x] Complete paired browser verification and refreshed integration gates.
- [x] Obtain approval of exact production migration, activation and menu payloads before application.
- [x] Deploy the paired approved release, verify production aliases, activate Christmas courses and exercise the live one-course journey without customer submission.
- [x] Configure the 15 venue-confirmed dated capacities, with matching live booking snapshots and audit records; campaign remains a prepared brief.


# QR branding fixes, 6 September 2026

- [x] Check live schema and current production code in an isolated worktree.
- [x] Lower editor and geometry minimum to 10%; draft and locally validate storage constraint.
- [x] Render BOOK NOW without runtime font dependencies.
- [ ] Validate migration and run checks, then deploy and verify the actual download.

Scope: QR branding only. Existing artwork unchanged until saved again. Database constraint update is an independently deployable prerequisite; application changes follow. No new columns, grants, functions or data rewrites. Website and unrelated checkout work unchanged.

QR verification: Node 20 lint, uncached typecheck, all 759 test files (6832 tests passed, two skipped) and clean production build passed. Actual minimum-size rendered image visually inspected with readable vector lettering. Isolated PostgreSQL validates boundaries and rollback. Production migration approval pending; no live changes applied.

## Event artwork adjustments, 10 September 2026
- [x] Strengthen soft logo shadows and reserve branding space in prompts.
- [x] Remove printed cut marks and update printing instructions.
- [x] Run checks and visually verify generated artwork and PDF.
- [ ] Deploy and verify production.

Verification notes: generated white and black logo composites and rendered the three-panel A4 PDF. Both shadows fade smoothly; the PDF contains three images and no stroked cut marks. Existing saved artwork needs branding reapplied to pick up the shadow. No database migration is needed.

Changed files for this request: src/lib/events/imageVariants.ts; src/lib/events/artwork/geometry.ts; src/lib/events/artwork/composite.ts; src/lib/events/artwork/composite.test.ts; src/lib/events/artwork/branding-service.test.ts; src/lib/events/artwork/table-talker-pdf.ts; src/lib/events/artwork/table-talker-pdf.test.ts; src/app/(authenticated)/events/_components/EventImagePanel.tsx; src/app/(authenticated)/events/_components/ArtworkBrandingModal.test.tsx; src/components/features/events/TableTalkerSheetButton.tsx; src/components/features/events/tableTalkerSheet.ts; tasks/todo.md.
Deliberately unchanged: print-sheet.ts and print-sheet.test.ts retain the existing panel geometry; ArtworkBrandingModal.tsx already reads the shared shadow settings. Other work in the original checkout is untouched.

Checks passed: zero-warning lint, uncached typecheck, 788 test files (7,144 passing tests, 2 skipped) in both Europe/London and UTC, and a cold production build.
