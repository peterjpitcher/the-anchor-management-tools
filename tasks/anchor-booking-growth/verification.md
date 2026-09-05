# Booking growth implementation evidence

Status: implementation pushed to the paired codex/anchor-booking-growth branches, awaiting exact production approval. Release checks completed; production application remains blocked on approval. No production data, customer communication or campaign changed.

## Implemented scope

- Reservation-led Sunday copy, with walk-ins still welcome.
- A reproduced quick-book outage no longer remains on Checking times after the request ends. The sheet shows a failed-check state and retry action. The drinks-purpose handoff to the full form preserves the explicit choice.
- Page-specific persistent actions for private hire, regular events and dated events. Existing Christmas and Nations actions retained. Closed, cancelled, expired and sold-out event states do not advertise a reservable form.
- Short private-hire enquiry alongside the estimator, including undecided dates, retained error inputs, consent, spam protection, duplicate protection and truthful emailed-versus-saved confirmation.
- Promotion suppression persists while the short enquiry is active, including after focus leaves a field.
- Optional event dining and early-arrival discussion requests, stored transactionally in staff-visible notes with the event booking. These do not reserve a second table or guarantee food.
- Christmas per-guest course snapshots, mixed-course party support, one-course pre-order exemption, selected-course validation, staff amendment controls and matching confirmation wording. Existing booking snapshots and payment rules remain intact. Capability defaults off pending the approved rollout.
- Aggregate baseline, guarded menu corrections, dated-capacity review and a prepared promotion brief.
- Analytics page/referrer URLs have query strings, fragments and credentials removed in the browser dispatcher and server endpoint. Existing campaign attribution remains separate. Controlled tests cover an email in the URL and rejected analytics consent.

## Read-only production evidence

The public availability API returned complete answers for 6 and 7 September. On Sunday, early slots were labelled drinks-only; on Monday all returned slots were drinks-only. The live quick sheet was opened without submitting and returned HTTP 200 availability. Wider live browser testing was not completed; isolated browser scenarios are recorded separately.

Production baseline and capacities were queried from the verified management project tfcasgxopxegwrabvwat. Measurement definitions and limitations are in measurement.md. Eight exact editorial descriptions are captured in menu-corrections.json. They have not been replaced. Capacity-review.md lists the dated records needing venue input.

## Review and test limits

Independent review inspected the live inner SQL creator interfaces and reviewed both new wrappers. Event request hashing was corrected after review so changed requests under one explicit key receive a conflict. Christmas review found no remaining issue after an accidental email property reference was corrected.

SQL validation ran only on an isolated PostgreSQL 17 fixture, while production uses PostgreSQL 15. Existing booking creators were substituted locally. This validates the new transaction, state gates, permissions and rollback, but does not replay the entire live allocator dependency tree. No real customer booking, deposit, refund or message was used as a smoke test.

Both final production builds passed after the quick-book corrections and integration with the latest main branches (management 418ce1ac, website 565cf3ef). Final management build used Node 20 and an 8 GB heap after the earlier build process exhausted its default heap. The website browser fixture now uses its own temporary app root/cache, after the first concurrent dev/build attempt conflicted. Neither failure was treated as a deployed application defect.

Full management London run: 722 suites passed, 6,198 tests passed and two existing skips. Full management UTC override run: 6,197 passed, one timezone-configuration assertion failed because its expected-zone flag was omitted. That unchanged suite was rerun with SCREENING_TEST_TZ=UTC and all 12 tests passed. The override is necessary because the repository's usual Vitest configuration pins London.

Website full London run: 184 suites passed, 1,987 tests passed and one existing skip. Final UTC run including added tracking coverage: 185 suites passed, 1,990 tests passed and one existing skip. The three tracking suites separately passed in both timezones. Both repositories passed lint and typecheck; website content/layout audits passed.

A passing build is not proof of a live booking or payment.

## Release gates

Apply the two exact reviewed migrations only after approval of the project, SQL checksums and rollback plans. Deploy the compatible management API before the dependent website. Enable Christmas capability only according to its packet after all consumers are present. Verify deployment aliases and read-only production responses before a live completion claim.

The event request UI must not reach production before its wrapper exists. Menu replacement requires approval of the eight guarded changes. Event capacities require venue-confirmed dated values. Promotion remains a brief until service capacity, attribution, exact assets and spend are approved.

## Deliberately retained

Existing table availability purpose handling, waitlist allocation, deposit/refund arithmetic, PayPal capture, staff notes print template, currency presentation, published food hours and unrelated Nations changes remain in place. No new dashboard, queue, marketing automation or waitlist was introduced.

Management coverage run under Node 20 passed all 722 suites and 6,198 tests, with two existing skips. Coverage: 52.89% lines, 42.50% branches and 60.79% functions, above the configured floors.

## Final integrated gate

Management: lint, typecheck, 722 suites with 6,208 passing tests (two existing skips), and production build passed on the integrated branch. Typecheck/build used Node 20 with an 8 GB heap. Website: all layout/content lint audits, typecheck, 188 suites with 2,013 passing tests (one existing skip) in both London and UTC, and production build passed. No application sources changed after these gates.

## Browser evidence

Private hire: short undecided-date enquiry and existing estimator, error retention, retry key, duplicate prevention, consent, no overflow at 320/375/768/1440, and active-form promotion suppression passed with isolated requests.

Quick table booking: all 28 checks passed across Chromium and WebKit with accepted and rejected cookie choices. Covered Sunday 13:00 food start, no noon food, closed Monday food versus drinks, failure exiting loading, sold-out slots, retry recovery and full-form date/time/party/drinks handoff. WebKit logged blocked web-vitals transport errors during navigation; functional assertions passed.

Full legacy table form: synthetic confirmations passed in Chromium and WebKit, with the actual website proxy forwarding the selected date, time, party size and drinks purpose. No real management booking was created.

Page-specific persistent actions: 18 checks passed in Chromium and WebKit across private hire, quiz, cash bingo, music bingo, open/past/cancelled/sold-out dated events, and Nations. Event food/early-arrival request submissions passed in both browsers through the actual website proxy to the isolated upstream, with unconfirmed-request acknowledgement.

Sanitised evidence is in /tmp/anchor-growth/private-hire and /tmp/anchor-growth/tables. Browser scripts are saved in the website scripts directory. The temporary fixture has a copied app root and separate cache, guards upstream sockets/fetch, and never targets production for writes.

Christmas browser check passed with the two-screen feature enabled, matching the read-only live flag. Six one-course guests were not asked for dishes. Mixed one/two/three-course choices blocked progression until the required dishes were selected, then allowed progression. After the cutoff, two/three-course options were disabled. External requests and all POST requests were blocked; expected blocked telemetry errors were recorded. Screenshots and sanitised evidence: /tmp/anchor-growth/christmas/.

The enabled two-screen full table form also completed synthetic bookings in Chromium and WebKit. The actual website proxy forwarded purpose=drinks, four guests and the retained date/time. Both enabled and fallback full-form variants therefore have browser confirmation evidence.

Draft pull requests: management #122 and the paired website booking-growth pull request. No production merge, migration, activation, menu edit or campaign has occurred.
