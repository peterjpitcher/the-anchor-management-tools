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
