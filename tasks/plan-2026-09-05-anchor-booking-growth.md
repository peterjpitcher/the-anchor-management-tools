# Anchor Booking Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it easier to complete a valid dining booking, send a useful private-hire enquiry and reserve event seats, then measure attended business rather than clicks.

**Architecture:** Keep the management app as the authority for hours, availability, booking rules and records. The website consumes its existing APIs. Deliver small, independently deployable releases, reusing booking, enquiry, waitlist and analytics infrastructure.

**Tech Stack:** Website: Next.js 14, React 18, TypeScript, Jest. Management: Next.js 15, React 19, TypeScript, Vitest. Existing management API, Supabase and PayPal integrations.

**Spec:** User-supplied booking-growth report at `/Users/peterpitcher/.codex/attachments/606facf1-6f86-4173-b74e-e604cc59c300/pasted-text.txt`, narrowed by the decisions below. This plan supersedes that report where it conflicts with confirmed operational rules.

## Global constraints

- Planning only is authorised. No application edits, production writes, sends, migrations, campaign launch or deployment are authorised by this document.
- Read both project CLAUDE.md files, the workspace rules and relevant skills before execution. Apply systematic-debugging to unproven booking failures, e2e-test to browser testing, Supabase guidance to database work, prod-migrate to any production migration and deploy-verify to deployment verification.
- Management root: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`. Website root: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`. All file lists below are relative to the labelled root.
- This is a cross-repository programme, complexity 5 overall. Split into releases below, targeting 300 to 500 meaningful changed lines per PR. Separate backend and frontend PRs when needed.
- Preserve unrelated work. At planning time both repositories contain another task's local changes; management main is also behind its tracked remote. Refresh remote history and use isolated implementation branches before execution.
- No opening-hours change, deposit-rate change, site redesign, new booking engine or new analytics platform.
- Keep menu item prices without currency symbols. Prices and hours remain live-source values. Never invent dishes, ingredients, capacities, response promises or package inclusions.
- Ordinary group deposit: £10 per person for 15 or more. Christmas: £10 per person at every permitted party size, minimum 6, maximum 20, minimum 24 hours' notice. Reuse existing rule sources.
- Christmas one course does not require pre-order; two and three courses do, with the approved seven-day deadline. Do not silently discard that deadline to accommodate short notice.
- Availability fails closed. No locally invented slots during an API failure. Normal dining cannot gain early-arrival meal slots without an explicitly supported operational rule.
- All dates use Europe/London. Check both London and UTC test runs.
- Live tests must not create bookings, trigger holds, payments, sends or jobs without explicit approval. Use intercepted requests and isolated test data for write-path verification; interception must occur before a real write can leave the browser.
- New database structure is not assumed. Inspect the live schema and existing persistence first. Any required schema extension gets its own reviewed migration and explicit application approval.
- No em dashes. No personal details or free-text notes in analytics. The confirmed Greene King tenancy takes precedence over stale independent-pub wording in source documents.

## Recommendations and scope

1. Clear the booking-reliability questions first, while preparing the small copy corrections.
2. Fix Christmas rules end to end before promoting the seasonal offer more widely.
3. Give private hire a short enquiry alongside the estimator. Retain phone as required initially, allow optional email and record a requested reply method without inventing an automated guarantee.
4. Make event actions reserve event seats. Add dining interest using the existing contract only after proving it reaches staff. Treat arrival as a request requiring validation, never a second dining reservation.
5. Establish comparable baseline measures before conversion changes launch. Measure attended covers, deposit-secured hires and attended event seats separately.
6. Defer paid promotion until the operational and measurement gates pass. Retain the report's £500 ceiling as a maximum, not a spending instruction.

Exclude from initial delivery: homepage rebuild, speculative new SEO pages, new private-hire packages, a new waitlist, bulk promotional messages and email-only enquiries. Review existing proof placement and promotion assets after the core releases demonstrate reliable outcomes.

## Evidence and existing work

Confirmed during this task's read-only checks:

- Website commits `55e781c6`, `47134c8f`, `4d2795ea` and `9ff59f24` address Christmas refund copy, duplicate event/table instructions, popup suppression and enquiry-button wording. Do not rebuild these fixes. Verify their deployed behaviour in Task 1.
- A direct live page fetch still showed editorial prose in Broccoli Cheese and a walk-in-led Sunday introduction. It showed the new enquiry navigation wording too. These were page-content checks, not successful booking tests.
- `components/PrivateBookingSection.tsx` still presents the estimator as the entry route. The canonical management enquiry endpoint accepts an omitted date and requires a phone number. Do not extend the deprecated management `/api/public/private-booking` endpoint.
- `components/layout/StickyCtas.tsx` special-cases Christmas and otherwise opens table quick booking. Event pages already expose `#event-booking`.
- The management event-booking schema accepts `food_intent`; its persistence and staff visibility have not been established. The customer event form does not currently expose the proposed choice.
- Website `ManagementTableBookingForm.tsx` derives pre-order requirement from the seasonal period flag. Course-specific enforcement needs investigation across API, stored records and UI.
- Waitlist infrastructure exists in management `src/lib/events/waitlist-offers.ts`. Website analytics already has table, event and private-hire events.
- Event capacities, live seasonal configuration, full conversion reconciliation and physical mobile browser results have not been rechecked. These are verification tasks, not established defects.

## Release order

| Release | Tasks | Dependency | Deliverable |
|---|---|---|---|
| Baseline | 1 and 7 baseline | None | Current evidence, agreed denominators and exact remaining gaps |
| Dining | 2, plus reproduced fixes from 1 | Baseline | Valid slots and clearer Sunday/menu content |
| Christmas | 3 | Baseline and rule tracing | Course-aware requirements across booking and communications |
| Private hire | 4 | Baseline | Short enquiry with context preserved |
| Events | 5 and 6 | Baseline; verified capacity before scarcity | Relevant booking actions and staff-visible dining requests |
| Measurement | 7 reconciliation | Each released journey | Comparable outcome reporting |
| Promotion | 8 | Prior gates and separate approval | One measured campaign or conversion test at a time |

These are sequencing recommendations, not promised delivery dates. Estimate effort after Task 1 establishes which fixes and schema changes are actually required.

## Task 1: Verify booking reliability and the existing fixes

**Files to inspect, change only for a reproduced defect:**
- Website: `components/features/TableBooking/QuickBookSheet.tsx`, `ManagementTableBookingForm.tsx`, `useAvailabilityRequests.ts` in the same directory; `app/api/table-bookings/availability/route.ts`; `lib/table-booking-service-windows.ts`; `lib/hours-utils.ts`; `components/features/christmas/ChristmasLightbox.tsx`.
- Management: `src/app/api/table-bookings/route.ts` and the live RPC/service it actually calls for availability. Trace the current route before identifying a database function to change.
- Existing tests: website `tests/api/table-availability-contract.test.ts`, `tests/api/table-bookings-availability-combined.test.ts`; management `src/app/api/table-bookings/__tests__/table-availability-contract.test.ts`.
- Create evidence: management `tasks/anchor-booking-growth/verification.md` containing sanitised steps, observations, commit and deployment IDs.

**Interfaces:** Consume the existing availability query/response contract. Preserve it unless a demonstrated gap requires an additive, backward-compatible extension. Produce a reproduced-failure list or explicit cleared observations.

- [ ] Refresh repository and deployment evidence; trace actual route imports. Check the four already-merged changes against the currently served build.
- [ ] Run quick booking and the full form on iPhone Safari and Android Chrome if accessible. Otherwise run WebKit and Chromium emulation and record the physical-device gap explicitly. Repeat with cookie acceptance and rejection.
- [ ] Exercise ordinary food, Sunday lunch, drinks, closed kitchen, split sittings, sold out, API error and a deliberately delayed response using controlled responses. Check both date and refinement changes during an in-flight request.
- [ ] Check selected date, party size and purpose survive quick-book to full-form and alternative selection. Old responses must not repopulate a new search; loading must end in valid slots, closed, sold out or a recoverable error.
- [ ] Reproduce any mismatch using the same date, purpose and party size against the live read-only API. Read relevant deployment logs and browser errors before changing logic.
- [ ] For each reproduced fault, add a regression at the owning layer, prove it fails, make the smallest fix and rerun it. Keep existing fail-closed and effective-date behaviour.
- [ ] Verify Christmas overlays do not take focus over table or enquiry forms, and closing the active form restores focus and scroll. No duplicate table request appears on event instructions.

**Acceptance:** One evidence row per scenario, with actual result and environment. A cleared historical finding results in no implementation change. Failed or unrun scenarios stay explicitly open.

## Task 2: Correct food content and make Sunday booking easier to choose

**Files:** Website `app/sunday-roast/page.tsx`, `docs/SSOT.md`, `SSOT.json` only for genuine mirrored-rule updates; inspect the menu feed and its management editor to find the existing stable dish ID. Do not rename dishes or change pricing.

**Interfaces:** Existing menu description field and live menu API. No API change. Sunday booking continues to use the current table journey.

- [ ] Read the current menu record and its revision/source history. Prepare the exact before/after description using verified dish facts; do not infer ingredients or replace it with more editorial filler.
- [ ] Review reported truncation in both the stored description and rendered page. Fix whichever layer actually truncates it; leave intentional display-only shortening alone if the full description remains accessible.
- [ ] Lead the Sunday page with choosing a time and keep walk-ins/no-pre-order reassurance immediately beside it. Use the current service-hours source and existing booking action. Preserve menu prices and diet statements.
- [ ] Check deposit wording on the touched page against the existing 15-person rule. Do not repeat stale 10-person text from a cached web result.
- [ ] Present the exact menu record correction as part of the complete production change list. Apply only after explicit live-write approval, preserving the stable ID and recording the previous value for reversal.
- [ ] Visually check mobile and desktop page rendering, menu API output and booking-link destination. Run the SSOT drift guard only if SSOT or its mirror changes.

**Acceptance:** No editorial instructions or accidental clipped prose in the affected menu entries; reservation is prominent; walk-ins remain welcome; no price, ingredient or operational policy is invented. No bespoke tests for a simple description edit.

## Task 3: Align Christmas courses, deadlines and deposits

**Files:**
- Website: `components/features/TableBooking/ManagementTableBookingForm.tsx`, `SeasonalPreorderPicker.tsx`, `useBookingPeriod.ts` in the same directory; `lib/api/bookings.ts`; `app/christmas-parties/page.tsx`, `client-components.tsx`; `components/features/christmas/ChristmasLightbox.tsx` only if package wording conflicts.
- Management: `src/app/api/table-bookings/periods/route.ts`, `src/app/api/table-bookings/route.ts`, `src/lib/table-bookings/periods.ts`, `src/lib/table-bookings/preorder.ts`, `src/lib/table-bookings/period-deposit.ts`. Trace current confirmation/reminder consumers before listing changes to them.
- Existing tests: management `src/app/api/table-bookings/periods/route.test.ts`, `src/lib/table-bookings/christmas-guard.test.ts`, `src/lib/table-bookings/period-deposit.test.ts`. Add website `tests/unit/christmas-course-policy.test.ts` for the final resolved contract.

**Interfaces:** The management period response must expose the selected tier's actual pre-order requirement and deadline. Reuse an existing tier identifier if present. Persist the chosen tier so staff, confirmation and amendment paths use the same rule; an unpersisted browser-only flag is insufficient.

- [ ] Inspect live period configuration and schema, existing tier identifiers, menu associations, booking storage and amendment behaviour. Record the actual contract in the verification document before changing code.
- [ ] Trace the exact seven-day boundary and the 24-hour minimum in current code and live read-only settings. Do not substitute calendar-day arithmetic for elapsed-time arithmetic without matching the approved rule.
- [ ] Use one-course/no-pre-order as the supported short-notice online path. Where two/three-course notice is already insufficient, explain the deadline and offer one course or a staff enquiry; do not promise an exception or alter hours.
- [ ] Prepare the smallest backward-compatible contract extension only if existing fields cannot express the tier. Add a shared management rule resolver and expose its result to the website. Define and test its exact types before the consumer PR begins.
- [ ] Add regression fixtures covering one, two and three courses; 6 and 20 guests; 5 and 21 rejected; 24-hour and seven-day boundaries; party/date/tier changes; retries; amendments; missing tier; and an old client. Required pre-orders cannot disappear after a date or course change.
- [ ] Keep existing bookings and deposits intact. Handle records without a tier explicitly using their existing recorded policy; never silently reinterpret them as one course.
- [ ] Align page, form, payment review, staff display and fixture-rendered confirmations/reminders with the same resolved rule. Test the refund boundary, including exactly seven days, without moving money.
- [ ] If a migration is necessary, use prod-migrate for a separate reviewed draft, validation and explicit application approval. Deploy backward-compatible server support before the website consumer; verify each independently.

**Acceptance:** An isolated six-person one-course booking requires the existing £60 deposit but no menu pre-order. Two/three-course bookings require the correct choices/deadline. Stored tier and communications agree. No real booking or payment is created during routine verification.

## Task 4: Add the short private-hire enquiry

**Files:**
- Website: create `components/PrivateHireQuickEnquiry.tsx`; modify `components/PrivateBookingSection.tsx`; inspect `components/PrivateBookingInquiryForm.tsx`, `PrivateBookingCalculator.tsx`, `app/api/private-booking-enquiry/route.ts`, `app/api/public/private-booking/route.ts`, `lib/api/private-bookings.ts` and `lib/gtm-events.ts`.
- Management: reuse canonical `src/app/api/private-booking-enquiry/route.ts` and `src/services/private-bookings/mutations.ts`; modify only where a verified contract gap prevents context preservation.
- Tests: create website `tests/unit/private-hire-quick-enquiry.test.tsx`; extend `tests/api/private-booking-idempotency.test.ts`, `tests/api/private-booking-resilience.test.ts`; management `tests/api/privateBookingEnquiryAdminClient.test.ts` if the canonical route changes.

**Interfaces:** Reuse canonical enquiry fields `phone`, `name`, optional `email`, `event_type`, `date`, `time`, `group_size`, `notes` and `communication_consent`. Omit an undecided date rather than sending a dummy date. Never post a new integration directly to the deprecated management public-booking endpoint.

- [ ] Present two visible actions: short date enquiry and existing cost estimator. The short route asks occasion, preferred/undecided date, approximate guests, name and phone; email and notes are optional. Do not force room, catering or entertainment selection.
- [ ] Keep phone required for the first release. An optional requested reply method may be recorded in existing staff-visible enquiry notes; do not claim automatic email-only routing or promise a reply time.
- [ ] Preserve the originating occasion and estimator choices through the current proxy mapping. Verify notes and selected items reach the staff record; do not silently truncate an enquiry context beyond documented limits.
- [ ] Reuse current Turnstile, consent, rate limit and idempotency handling. A rejected or unavailable backend must show a recoverable error and retain inputs, never display a false success.
- [ ] State that the enquiry does not hold the date. Confirm the requested details after successful acceptance and explain that the team will reply, without a new time guarantee.
- [ ] Test dated and undecided enquiries, invalid phone, optional email, large parties within the canonical endpoint limit, double submit, timeout/retry, blocked bot validation, preserved context and no accidental hold/deposit creation using isolated data.
- [ ] Verify that the enquiry appears in the existing staff workflow and that its notification is rendered correctly with a stubbed transport. Reuse current follow-up queues; review ownership and due-date gaps before adding new staff fields.

**Acceptance:** A guest can send an enquiry without completing the estimator or choosing a firm date. A retry produces one enquiry. Staff receive the submitted context and a visible next action. Email-only customer creation is outside this release.

## Task 5: Make persistent actions match the page

**Files:** Website `components/layout/StickyCtas.tsx`; create `lib/booking-cta.ts`, `tests/unit/booking-cta.test.ts`; modify `app/events/[id]/page.tsx`, `app/quiz-night/page.tsx`, `app/cash-bingo/page.tsx`, `app/music-bingo/page.tsx` only where required anchors are absent. Preserve the Christmas-specific action.

**Interfaces:** Add a pure resolver with this complete contract. It selects navigation only; it never infers availability or creates a booking.

```ts
export type BookingCta =
  | { kind: 'table'; label: 'Book a table' }
  | { kind: 'link'; label: 'Reserve seats' | 'View upcoming dates' | 'Enquire about your date'; href: string }
  | { kind: 'christmas'; label: 'Christmas enquiry' }

export function resolveBookingCta(pathname: string): BookingCta {
  if (pathname === '/christmas-parties') return { kind: 'christmas', label: 'Christmas enquiry' }
  if (/^\/events\/[^/]+\/?$/.test(pathname)) return { kind: 'link', label: 'Reserve seats', href: '#event-booking' }
  if (['/quiz-night', '/cash-bingo', '/music-bingo'].includes(pathname)) return { kind: 'link', label: 'View upcoming dates', href: '#upcoming-dates' }
  if (pathname === '/private-hire' || pathname.startsWith('/private-hire/')) return { kind: 'link', label: 'Enquire about your date', href: '#enquiry' }
  return { kind: 'table', label: 'Book a table' }
}
```

Initial scope is these verified route families. Additional hire landing pages join the map only after checking their actual enquiry target. On past, cancelled or closed dated events the page must override/hide the reserve action and expose an honest upcoming-date or existing waitlist action. A route-only resolver cannot decide sales state.

- [ ] Add this behavioural test before the resolver implementation:

```ts
import { resolveBookingCta } from '@/lib/booking-cta'

test.each([
  ['/sunday-roast', { kind: 'table', label: 'Book a table' }],
  ['/private-hire', { kind: 'link', label: 'Enquire about your date', href: '#enquiry' }],
  ['/events/example', { kind: 'link', label: 'Reserve seats', href: '#event-booking' }],
  ['/cash-bingo', { kind: 'link', label: 'View upcoming dates', href: '#upcoming-dates' }],
  ['/christmas-parties', { kind: 'christmas', label: 'Christmas enquiry' }],
])('%s chooses its own booking journey', (path, expected) => {
  expect(resolveBookingCta(path)).toEqual(expected)
})
```

- [ ] Run `npx jest tests/unit/booking-cta.test.ts --runInBand`, observe failure, implement the resolver, then repeat and observe pass.
- [ ] Connect the existing sticky control to the resolver, retaining current modal focus, keyboard and cookie-banner behaviour. Add anchors only where the destination section exists.
- [ ] Use actual event sales state for overrides; retain existing waitlist policy. Test past, cancelled, sold-out and open events in the browser, plus navigation between route types.
- [ ] Track the correct action using the current analytics helpers. A seat or enquiry click must not emit a table-booking start.

**Acceptance:** Each action reaches the right form or date choice; no wrong table modal on the scoped event/hire pages; no obscured fields, broken anchor or inaccessible focus target at narrow widths.

## Task 6: Finish event dining and capacity handling

**Files:** Website `components/features/EventBooking/ManagementEventBookingForm.tsx`, `app/events/[id]/page.tsx`, `app/api/event-bookings/route.ts`, `lib/api/events.ts`; management `src/app/api/event-bookings/route.ts`, `src/services/event-bookings.ts`, `src/lib/event-booking-sheet-template.ts`, `src/lib/events/waitlist-offers.ts` for inspection, not replacement. Trace confirmation/reminder templates from the service before making edits.

**Interfaces:** Reuse `food_intent` only after confirming where it is persisted. An analytics-only field is not a staff instruction. An optional arrival request must have a validated, durable staff-visible home before exposing it to guests.

- [ ] Read future event records and distinguish maximum venue capacity, configured sellable capacity, reserved seats, holds and remaining availability. Produce one proposed before/after list using actual event IDs. Never copy 80/60/90 into live events as assumed availability.
- [ ] Obtain venue-approved capacities for the dated events before applying that list. Keep all changes within existing authorised event-management paths. Do not send marketing or trigger queue processing as a side effect.
- [ ] Trace food intent from browser through API to staff view, booking sheet and fixture-rendered confirmation. Reuse an existing durable field or prepare a separate additive schema plan if none exists.
- [ ] Offer optional dining interest. Add arrival selection only where existing kitchen/service rules can validate it for the actual date. If an early arrival needs manual agreement, display it as a request and leave the confirmed reservation time unchanged.
- [ ] Keep one event reservation; do not create a second table booking. Do not claim a dining request guarantees kitchen capacity or a particular table unless the existing allocator verifies it.
- [ ] Check cash-bingo per-book wording against the actual ticket/payment contract, and align only verified mismatches. Keep event-specific cash/payment facts in the existing facts strip.
- [ ] Test no dining, dining requested, closed kitchen, changed date, different requested arrival, duplicate submit, missing capacity and sold out. Confirm the existing waitlist and cancellation/release paths still work with isolated data.

**Acceptance:** Staff see the same dining/arrival request the guest submitted. No duplicate table reservation, invalid food promise or invented scarcity. Live capacity changes remain blocked until their exact values are approved.

## Task 7: Reconcile measurement and private-hire follow-up

**Files:** Website `lib/gtm-events.ts`; management `src/lib/analytics/events.ts`, `src/lib/private-bookings/weekly-digest-classifier.ts`, existing private-booking queries and communications. Create management `tasks/anchor-booking-growth/measurement.md` for definitions and validation evidence, not a new dashboard by default.

**Interfaces:** Reuse `trackTableBookingFunnel`, `trackEventBookingComplete`, `trackPrivateHireEnquiryStarted`, `trackPrivateHireEnquirySubmitted` and the existing business-record identifiers. Inspect payloads before adding anything.

- [ ] Before launching UI changes, save an aggregate baseline by journey, device, source and service/event date. Fix the eligibility and date-window definitions; record unknown sources separately and exclude staff/test activity.
- [ ] Reconcile completed table bookings, event reservations and private enquiries against unique business IDs. Check refresh, retry and payment-return behaviour for double counting and verify consent handling.
- [ ] Trace booked to attended/cancelled/no-show using existing records. Keep event seats separate from booking counts, and private-hire enquiries grouped by enquiry date rather than mixing with event-date cohorts.
- [ ] Measure private-hire contact time, quote/deposit status, completed value and recorded loss reasons where supported. Mark missing data as unknown. Reuse existing staff queues and propose only verified missing fields or ownership controls.
- [ ] Add regression tests only for demonstrated duplicate, missing or personal-data analytics payloads. Validate the outbound payload in a controlled browser run, including rejected analytics consent.
- [ ] Publish a small weekly aggregate readout: dining confirmations and attended covers; private enquiries and deposit-secured hires; event reserved/attended seats and verified capacity. Add contribution only where actual values and costs exist.

**Acceptance:** Journey totals reconcile or have a quantified, explained difference. No invented source attribution or assumed attendance. No deposits counted again as sales. A click never represents a completed booking.

## Task 8: Controlled promotion and conversion tests

**Deliverable:** A separate campaign brief after Tasks 1 to 7, not a live campaign created by this plan.

- [ ] Verify Google Business Profile booking/menu destinations and current source tags without duplicating existing citation work. Check event links reach the actual dated page and old dates lead honestly to upcoming dates.
- [ ] Choose one dining service with verified room and staffing capacity, or private hire once its value and follow-up data are usable. Keep hosted-event order quiz, cash bingo, music bingo; karaoke stays a 2027 item.
- [ ] Prepare the exact audience, landing page, assets, dates, spend ceiling, measurement window and stop criteria as one approval package. Base cost limits on verified incremental contribution; the original uplift cases remain sensitivities, not forecasts.
- [ ] Test one material journey change at a time. Use several comparable services/event cycles and annotate seasonality or concurrent campaigns. Do not claim statistical certainty from one event.
- [ ] Launch only after explicit campaign approval. Do not start an automation, send messages or spend the available £500 because this plan exists.

**Acceptance:** One approved test with traceable booking outcomes and an actual cost ceiling. No budget is spent until it can be reconciled to the agreed outcome.

## Verification and release checklist for every code release

- [ ] Use Node 20 for management. Read `.nvmrc` and package scripts in both checkouts before running commands.
- [ ] Run relevant regression tests, then lint, clean typecheck, full tests and an uncached production build in each changed repository. Run date-sensitive tests in both London and UTC. Website uses Jest; management uses Vitest.
- [ ] Render changed message templates with fixtures; reject undefined values, invalid dates and missing amounts. Transports remain stubbed.
- [ ] Exercise the exact affected browser path, including failure/retry, with production writes blocked. Record screenshots and sanitised network evidence. A build alone is not feature proof.
- [ ] List every changed file and deliberately untouched counterpart in the PR. Record assumptions, test limits and any unapplied migration by its real filename.
- [ ] Present all live data changes, migration applications, deployment actions and any real write-path smoke test together for owner approval. Approval of development is not approval to send messages or apply a production migration.
- [ ] Deploy approved compatible backend changes before dependent website changes. Verify each production alias against commit and deployment ID. Website main does not automatically mean a production deployment.
- [ ] Run post-deployment read-only smoke checks. Do not claim the full payment/confirmation journey verified unless the approved write-path test actually ran.
- [ ] Roll back a faulty UI with the previous verified deployment. Restore any approved menu/capacity data from the recorded prior values. Never automatically drop migrated columns or undo customer bookings; use a reviewed forward repair when records depend on a schema extension.
- [ ] Finish approved merge/push/deploy/verification and tidy only this work's branches. Update checkboxes and evidence with actual outcomes.

## Approval and decision handling

No further business answers are needed to approve development of the bounded releases. Previously approved Christmas course rules remain the default. Event capacity values, production data edits, migrations, deployments and campaign launch each require concrete reviewable evidence before their respective approvals. Do not put questions in this document or invent defaults when a live operational decision is missing; return those decisions together in chat after completing independent work.

## Planning completion

- [x] Compared the supplied report with current route/component code and prior implementation evidence.
- [x] Split the programme into independently reviewable releases with dependencies and acceptance criteria.
- [x] Preserved existing implementations and separated unverified findings from required changes.
- [x] Recorded production safeguards, test coverage, rollout order and deferred scope.
- [x] Development authorised and started in isolated codex/anchor-booking-growth worktrees.

Status: implementation prepared locally in both repositories. See anchor-booking-growth/verification.md for current evidence and release gates. Two migration drafts are not applied. Menu and capacity data remain unchanged; no campaign has run.
