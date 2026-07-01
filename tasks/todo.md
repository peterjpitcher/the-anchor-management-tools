# Task Tracker

## Current Task: Party-size edit auto-splits across tables (2026-07-01)

**Context:** Editing a booking to a party bigger than any single table (6→9) didn't split
across two tables, while NEW bookings did. Root cause was NOT the server allocator (FOH
timeline already auto-moves via `getMoveTableAvailability`), but the management "Edit party
size" modal (`BookingDetailClient.tsx`) which forced staff to manually pick a combined
"Larger table" and **disabled Save** until they did. Discovery cross-checked by a 4-reader +
adversarial-verify workflow and live DB/prod checks (prod already on latest code).

**Fix (scope: unify + auto-select), create RPC left untouched:**
- [x] Auto-pick smallest sufficient table setup in the modal (new `useEffect`)
- [x] Keep dropdown as optional override; stop disabling Save
- [x] Remove hard pre-submit block; fall back to server `autoMoveTable:true` when nothing fits
- [x] Reword amber notice to reflect auto behaviour
- [x] Update `tests/components/BookingDetailClientPartySize.test.tsx` (auto-select + no-capacity fallback)
- [x] Verify: lint (0 warnings), typecheck (0 errors), targeted tests (2/2), build (exit 0, 117/117 pages)

**Notes:** FOH path unchanged (already auto-moves). Edit path's communal-net + private-booking
checks preserved (newer/more correct than create RPC — see allow_communal_partial_table_sharing).

**Review (part 1 — modal auto-select):** shipped main d4866c13, deployed. Client-only change to
`BookingDetailClient.tsx` (verified live component via `page.tsx`).

## Part 2: communal-event tables must not be shared with food bookings (2026-07-01)

**Real root cause of the FOH 409** (owner tested Benjamin via FOH after part 1): the picker
`getMoveTableAvailability` used partial-sharing maths (`remaining = capacity − communal`), so it
OFFERED a table with communal seats (e.g. Dining Room 6b, 1 Cash Bingo seat). The prod DB trigger
`enforce_booking_table_assignment_integrity_v05` correctly forbids ANY food-on-communal-table, so
the move insert 409'd with a misleading "table setup changed". Owner policy: communal tables can't
be shared with food, ever.

- [x] `move-table.ts` getMoveTableAvailability: exclude ANY table with active communal seats; use raw capacity
- [x] `staff-seat-updates.ts`: clearer blocked message (mentions event tables can't be shared)
- [x] Remove unapplied repo migration `20260701000002_allow_communal_partial_table_sharing.sql`
      (contradicts policy; never applied to prod — prod's trigger already strict via 20260611000000)
- [x] New test `tests/lib/moveTableCommunalExclusion.test.ts` (excludes communal, still offers valid combo)
- [x] Verify: tests 11/11, tsc 0, eslint 0; build pending
- [x] Follow-up: make create_table_booking_v05 skip communal tables in enumeration
      — SHIPPED main 886be62c; applied to PROD via Supabase MCP apply_migration
      (repo file 20260719000000). Added communal NOT EXISTS to Step 1 + Step 2.
      Verified: deployed fn byte-identical to original except the 2 communal blocks
      (comment/ws-stripped md5 match), and behaviourally excludes communal tables.
      DB-only change — no app deploy needed.

**Whole communal gap now closed** across all three surfaces: modal auto-select (d4866c13),
move-picker exclusion (1eac3f1a), and new-booking allocator (886be62c).

---

## Previous Task: Harden recruitment application pipeline (2026-06-12)

**Context:** Application from Chloe Rogers (12 Jun 07:04) arrived only as a fallback email — never
reached the DB. Root cause: management intake does AI work inline and blew the website proxy's 15s
timeout; Vercel killed the invocation just after the idempotency claim, leaving a stale
`{state: processing}` claim that blocks same-key retries for 24h. Latent bug: idempotency request
hash includes per-request `consent_at`, so any same-key retry 409-CONFLICTs instead of replaying.

### Management app (this repo)
- [x] `src/lib/api/idempotency.ts` — add `claimed_at` to processing claims; reclaim stale
      processing claims (>10 min — provably dead; Vercel max duration ≤ 300s) via
      optimistic-lock conditional update. Affects all idempotent routes; strictly safer.
- [x] `src/services/recruitment.ts` — new `processRecruitmentApplicationAi()` (idempotent;
      callable from `after()` and cron): CV extraction + scoring for `new` apps missing scores.
- [x] `src/app/api/recruitment/applications/route.ts` — drop volatile `consent_at` from hash
      input (stable hash → retries replay); best-effort `phone_e164` normalisation;
      `skipAi: true` (request path = DB/storage only); defer AI + manager alert via `after()`;
      `export const maxDuration = 120`; split rate limit (authenticated callers 60/h —
      website egress IPs are shared, 8/h would bounce real applicants in an ad burst).
- [x] New cron `/api/cron/recruitment-ai-sweep` + vercel.json `*/30 * * * *`: catch-up scoring
      and missing manager alerts for apps 10 min–48 h old (safety net if deferred work dies).
- [x] Tests: `src/lib/api/__tests__/idempotency.test.ts` (12 new) + updated
      `tests/lib/idempotency.test.ts` (stale-reclaim semantics; mock gained `.filter()`).
- [x] Pipeline: lint ✓, typecheck ✓, tests 2729/2729 ✓, build ✓.

### Website (/Users/peterpitcher/Cursor/OJ-The-Anchor.pub)
- [x] `app/api/enquiry/recruitment/route.ts` — retry management call (2 attempts, 25s/20s, same
      idempotency key — replay-safe); 409 retryable (replay resolves "possible duplicate");
      429 → email fallback instead of bouncing the applicant; `possibleDuplicate` only when
      last failure was abort/408/409; attempt count in fallback email; `maxDuration = 90`.
- [x] Update Jest tests `tests/api/recruitment-enquiry-proxy.test.ts` (4 → 8 cases).
- [x] Pipeline: lint ✓, typecheck ✓, route tests 8/8 ✓, build ✓ (pre-existing failures in
      `tests/unit/ManagementTableBookingForm.test.tsx` confirmed unrelated by stash-test).

### Out of scope (flagged to user)
- Re-entering Chloe Rogers' application (production data write — needs explicit go-ahead).
- Reconciling historic fallback emails into the DB.

## Previous Task: Email-equivalent comms + Resend migration — Discovery & Spec

**Goal:** Cut Twilio SMS cost by sending email to customers who have an email on file. Produce a thorough, critical spec covering:
1. Every communication that needs an email equivalent
2. The channel-selection logic to prefer email when available (with safe SMS fallback)
3. Migration of email sends from `peter@orangejelly.co.uk` (Microsoft Graph) → **Resend**

### Brainstorming checklist (superpowers)
- [x] 1. Explore project context (discovery via agent team) — DONE, 6 findings files
- [~] 2. Visual companion — N/A (non-visual topic)
- [x] 3. Clarifying questions — DONE (4 decisions answered)
- [x] 4. Propose approaches — DONE (logging model, rollout, transport scope choices in spec)
- [x] 5. Present design — DONE, approved ("proceed as detailed")
- [x] 6. Write design doc / spec — docs/superpowers/specs/2026-05-31-email-comms-channel-and-resend-migration-design.md
- [x] 7. Spec self-review — DONE (fixed urgency/policy contradiction)
- [~] 8. User reviews spec — AWAITING REVIEW
- [ ] 9. Transition to writing-plans (only after spec approved)

### Discovery agent team (parallel) → findings/ — ALL COMPLETE
- [x] A1 SMS communications inventory (35 SMS, single sendSMS chokepoint)
- [x] A2 Email communications inventory (47 emails, 2 Graph transports)
- [x] A3 Customer contactability & channel-preference model (NO email consent model)
- [x] A4 Email infra & Resend migration surface (greenfield, 2 transports)
- [x] A5 Orchestration: crons/jobs/webhooks + dual-channel hook points
- [x] A6 SMS cost model & savings (18% email coverage; cost_usd is an estimate)

### Key discovery facts
- SMS chokepoint: `src/lib/twilio.ts:207` sendSMS (25 callers); only messages.create
- Email: `src/lib/email/emailService.ts` sendEmail + `src/lib/microsoft-graph.ts` (invoicing) — BOTH need migration
- 758 customers, 138 (18.2%) have email; 90d SMS ~1,060 (halved YoY)
- cost_usd = hardcoded $0.04×segments estimate, never backfilled from Twilio
- Email consent/bounce/suppression/unsubscribe: ABSENT — must be built
- Resend: not installed; returns {error} (no throw); needs verified domain + webhook

## 2026-06-10: Wire SMS emergency suspension kill switch (audit finding F4) — DONE

- [x] Call `resolveSmsSuspensionReason` at top of `sendSMS` (src/lib/twilio.ts) before any side effects
- [x] Return blocked result `{ success: false, code: 'sms_suspended' }` — no throw; `console.warn` the reason (logger.warn is silent outside development)
- [x] Read flags from `process.env` at call time (matches safety.ts `parseBooleanEnv` pattern)
- [x] Add `tests/lib/twilioSmsSuspension.test.ts`: SUSPEND_ALL_SMS blocks, normal send passes, event-scoped block/pass
- [x] Lint, typecheck and tests green

**Result:** lint 0 warnings, tsc clean, 2710/2710 tests pass (TDD: red → green). One unrelated suite fails to *load* (`tests/actions/fixPhoneNumbersActions.test.ts`) because a concurrent GSD quick task has staged the deletion of `src/app/actions/fix-phone-numbers.ts` without yet removing its test — belongs to that task, not this one.

## Completed

- 2026-06-10: Whole-application review (5 parallel audits: security, payments/domain rules, consistency, reliability/ops, build health). 30 findings → `docs/audits/2026-06-10-application-review.md`. Headline: deposit threshold code(10+) vs CLAUDE.md(7+) needs ruling; guest cancel never refunds deposit; private-booking delete cascades payment records; SMS kill switch unwired. Pipeline fully green (2707/2707 tests).

## Review Notes
