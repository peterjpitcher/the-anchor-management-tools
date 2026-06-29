# Spec — Manager-side "Schedule interview" feature review

**Date:** 2026-06-29
**Reviewer:** Claude (multi-agent review: 58 findings, 56 verified, 2 rejected)
**Scope:** New staff scheduling feature + the confirmation-email bug found in live testing.

Files in scope:
- `src/services/recruitment.ts` — `scheduleRecruitmentAppointmentByStaff`
- `src/app/actions/recruitment.ts` — `scheduleRecruitmentInterviewForCandidateAction`
- `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx` — schedule UI
- `src/lib/recruitment/communications.ts` / `calendar.ts` — email, ICS, calendar sync
- Tests: `RecruitmentDashboardA039.test.tsx`, `recruitmentAppointmentAtomicitySource.test.ts`, `recruitmentCommunications.test.ts`

---

## IMPLEMENTATION STATUS (2026-06-29 — built locally, no commits)

**Done & verified** (TSC clean, ESLint clean, full suite 3073 pass, build OK):
- **P1.1 Atomic staff RPC** — `recruitment_staff_schedule_appointment` migration `20260716000000` (+ rollback); `scheduleRecruitmentAppointmentByStaff` rewritten to a single RPC call.
- **P1.2 Per-application duplicate guard** — enforced in the RPC under `FOR UPDATE` (future-scheduled-of-type), and the UI flags now key on `application_id`. **No partial unique index** was added: past appointments stay `'scheduled'` forever (no auto-close cron), so such an index would wrongly block re-scheduling — the row-lock + token-burn close the race instead.
- **P1.3 Manager confirmation email** — `manager@the-anchor.pub` alert on every staff schedule, inside the `allSettled` group, audited as `manager_email_sent`.
- **Trial-shift scheduling (Q3)** — shared action helper + `scheduleRecruitmentTrialForCandidateAction` + a trial UI form (gated on `interviewed`/`trial_offered`/`on_hold`).
- **P2.1/P2.2 ICS** — `SEQUENCE` from `reschedule_count`, `ATTENDEE` line (shared generator).
- **P3.1 Double-submit guard** — `ActionFeedbackForm` wraps children in `<fieldset disabled={pending}>` (benefits all dashboard forms).
- **P3.2 Slot label** — start–end time + location (`formatSlotOptionLabel`).
- **P3.4 Observability** — `console.error` on calendar/manager-alert rejection.
- **Tests** — new `recruitmentStaffSchedule.test.ts`; updated atomicity source test; dashboard test mock updated.

**Now also done (2026-06-29):** P3.3 confirm-before-schedule dialog on both interview + trial forms; P3.5 clearer email-failure message pointing to the Comms-tab retry; P4.2 UI submit→confirm→action round-trip test. **Nothing outstanding.**

**⚠️ Deploy prerequisites (NOT done — all local):**
- Migration `20260716000000_recruitment_staff_schedule_appointment_rpc.sql` must be applied to prod **before/with** deploying this code, or staff scheduling will 404 the missing RPC.
- The §1 email code fix (Bug B) also needs deploying.
- Email-template migration `20260715000000` was already applied to prod earlier.

---

## 0. What is already correct (verified — no change needed)

These were checked and are sound; calling them out so we don't "fix" working behaviour:

- **The claim RPC is genuinely atomic.** Live `recruitment_claim_appointment_slot` burns the token (`booking_token_used_at = now()`), compare-and-set flips the slot `open→booked` (race-safe), inserts the appointment, and transitions status — all in one PL/pgSQL transaction. Slot-level double-booking is impossible.
- **On success, the token is burned** inside the RPC — there is no "re-armed token → candidate books a second slot" hole on the happy path.
- **Email-failure-as-success is correct** (Q4). The committed appointment is the source of truth; a secondary email hiccup must not fail the booking. Matches the candidate self-booking path.
- **No manager alert on staff scheduling is correct** (Q7). Consistent with commit `c6fcc6f3` (deliberate suppression of manager alerts on staff-initiated actions). The candidate path needs the alert because no staff member is in the loop; the staff path does not.
- **`'edit'` permission gate is correct** (Q5) and consistent between UI (`permissions.canEdit`) and server (`requireRecruitmentPermission('edit')`).
- **Calendar-sync failure is recovered by cron** (`recruitment-calendar-retry`), state-driven — the staff path does not silently lose calendar sync on a transient failure.
- **ICS DTSTART/DTEND** are correct (UTC `Z` times; Graph event uses stored Europe/London tz).

---

## 1. SHIPPED — Confirmation-email bug (fixed during this review)

Found in live testing (malformed candidate email). **Pre-existing bug, not caused by the new feature** — it also affects candidate self-booking confirmations and reminders. Two defects:

**Bug A — literal `\n` + doubled sign-off.** `interview_confirmation`, `trial_confirmation`, `reminder` were seeded in `20260707000000_recruitment_foundation.sql` as standard SQL strings (`'...\n...'`) → Postgres stored literal backslash-n. The follow-up `20260708000004` migration fixed the invite/rejection/offer templates with `E'...'` but skipped these three. Knock-on: `ensureRecruitmentSignature()` strips the old sign-off via a real-newline regex that didn't match literal `\n`, leaving "Best, The Anchor" **and** the standard signature.

**Bug B — "confirmed for interview on …" (doubled word).** `formatRecruitmentAppointment()` returns `"interview on <datetime>"`; that filled `{{appointment_time}}` in a template already saying "Your **interview** is confirmed for {{appointment_time}}". Same latent double-up in the `reminder` template and the SMS reminder.

**Changes applied (local code):**
1. `src/services/recruitment.ts` — split out `formatRecruitmentAppointmentTime()` (date/time only); `formatRecruitmentAppointment()` now composes it.
2. `src/lib/recruitment/communications.ts` — `appointment_time` merge value now uses `formatRecruitmentAppointmentTime()` (line ~328); SMS reminder (line ~1016) likewise.
3. `src/lib/recruitment/communications.ts` — added `decodeEscapedNewlines()`; applied in `normalizeBodyText()` and (importantly) on the template body **before** `finalizeRecruitmentEmailBody()` so signature de-dup runs on a correctly broken-up body. Defends against any future literal-`\n` template.
4. New regression test in `tests/lib/recruitmentCommunications.test.ts` (literal-`\n` template + appointment → asserts real newlines, single sign-off, no duplicated type).

**Data applied (prod):** migration `20260715000000_fix_recruitment_confirmation_template_newlines.sql` re-seeds the three templates with `E'...'` newlines, scoped to only rows still missing real newlines (idempotent, no customisation clobbered). **Applied to live Anchor DB and verified** — all three now have real newlines, no literal `\n`.

**Verification:** `tsc` clean, ESLint clean, recruitment tests pass (12).
**Note:** Bug A is fixed in prod *now* (data fix, works with currently-deployed code). **Bug B needs a code deploy** to take effect — until then prod emails will render with correct line breaks but still say "for interview on …".

---

## 2. Brief questions — answers

| Q | Question | Answer |
|---|----------|--------|
| Q1 | Is the status/token/claim sequence safe enough? | **Mostly. Real but MEDIUM gap on the failure path.** On claim failure the pre-committed `interview_invited` transition + fresh token are not rolled back → orphaned invited state + a live unused token (candidate could self-book another slot) + a misleading "Candidate booked appointment" status event. Recoverable, no security boundary crossed. **Fix recommended (P1).** |
| Q2 | Should it be a single staff-specific atomic RPC? | **Yes — preferred fix.** A `recruitment_staff_schedule_appointment` SECURITY DEFINER RPC doing token+status(force)+claim in one transaction removes the gap and matches the existing pattern. Stop-gap alt: compensating rollback in JS. |
| Q3 | Staff trial-shift scheduling now? | **Interview-only is fine for the release.** The service's `trial_shift` branch is currently unreachable dead-path (action hardcodes `'interview'`, UI interview-only). Decision needed: document interview-only intentionally **or** wire a trial action+UI. Recommend: ship interview-only + comment now; add trial later if wanted. |
| Q4 | Should email failure count as success? | **Yes — keep current behaviour.** Correct and consistent with candidate path. Optional: clearer toast + point to the existing Comms-tab manual retry. |
| Q5 | Show control for new/ai_screened/shortlisted/interview_invited/on_hold? | **Acceptable.** Legal and consistent with the existing invite flow (`canSendInterviewBooking` already allows new/ai_screened). Optional: add a confirm step for pre-screen statuses (new/ai_screened) since it emails the candidate + books a calendar slot. |
| Q6 | Dropdown fields: date/time/duration/location/interviewer? | **Add end-time/duration + a placeholder; keep location; interviewer N/A.** `ends_at` is already loaded (`select('*')`) — show a time range so same-day slots of different length are distinguishable. **There is no interviewer concept in the slot schema** (only `supervisor_staff_id`, used for trials) — don't invent one. |
| Q7 | Manager alert on manual schedule? | **OVERRIDDEN by user request (2026-06-29):** send a manager-facing booking confirmation to `manager@the-anchor.pub` (`RECRUITMENT_NOTIFICATION_EMAIL`) on every staff schedule (interview + trial). The earlier "no alert" recommendation referred to the legacy noisy invite alert; this is a booking-record confirmation to the shared mailbox. See P1.3. |

---

## 3. Recommended changes (prioritised)

### P1 — Correctness / data integrity

**P1.1 Make staff scheduling atomic** (Q1/Q2) — `src/services/recruitment.ts:2013-2117`
Currently three independent committed operations precede the atomic claim with no rollback. Options:
- **Preferred:** new SECURITY DEFINER RPC `recruitment_staff_schedule_appointment(p_slot_id, p_application_id, p_candidate_id, p_actor_user_id, p_appointment_type)` that, in one transaction: sets/refreshes the booking token + clears `used_at`; transitions to invited if needed using `force=true`; then runs the same burn-token + flip-slot + insert-appointment + transition-to-scheduled logic as `recruitment_claim_appointment_slot`. Use a staff-accurate status note (e.g. "Manager scheduled appointment") instead of the RPC's hardcoded "Candidate booked appointment".
- **Stop-gap (no new RPC):** capture prior `status` + token columns before the pre-writes; wrap in try/catch; on `claimError` restore the columns and re-transition (`force=true`) to the original status before re-throwing.
- Either way, add a behavioural test simulating `claimError` (slot raced to booked) asserting status + token are restored.

**P1.2 DB-authoritative duplicate guard** (Q1) — `src/services/recruitment.ts:2047-2064` + new migration
The "one future scheduled per candidate per type" rule is JS-only (TOCTOU vs concurrent staff/candidate booking). Add a partial unique index and translate `23505` into the existing friendly error.
**Decision needed (see §4): per-candidate vs per-application.** The UI flag + server guard currently key on `candidate_id`, which wrongly blocks a candidate who has **two applications to different postings** from getting a second interview. Most likely correct scope is **per-application** — align UI flag (`RecruitmentDashboardClient.tsx:804-816`), server guard (`recruitment.ts:2051-2064`), and the index accordingly.

**P1.3 Manager booking confirmation email** (Q7 — user-requested) — `actions/recruitment.ts`
On every staff schedule (interview + trial), send a confirmation to `manager@the-anchor.pub` (`RECRUITMENT_NOTIFICATION_EMAIL`) summarising candidate name, role, appointment type, date/time, location. Reuse the existing manager-notification mechanism (`sendRecruitmentManagerAlert` / the `manager_alert` template) rather than a new transport. Add it to the `Promise.allSettled` group so a manager-email failure never fails the booking (same as candidate email). Record its outcome in the audit `newValues` (e.g. `manager_email_sent`).

### P2 — Candidate-facing ICS quality (shared generator `src/lib/recruitment/calendar.ts`)

**P2.1 ICS SEQUENCE** (`calendar.ts:80,102`) — currently hardcoded `SEQUENCE:0` with a stable UID, so reschedules/cancels don't supersede the original event in attendee calendars. Use the existing `appointment.reschedule_count` (already incremented by the reschedule RPC): `SEQUENCE:${appointment.reschedule_count ?? 0}`. Fix in the shared generator so staff + candidate + reschedule paths all benefit.

**P2.2 ICS ATTENDEE** (`calendar.ts:86-105`) — no `ATTENDEE` line; add one (escaped) when `appointment.candidate?.email` is present, improving the add-to-calendar experience. Shared generator.

### P3 — UX / observability (UI + action)

**P3.1 Double-submit guard** (`RecruitmentDashboardClient.tsx`, `ActionFeedbackForm` ~528-600) — no in-flight disable. Fix once at `ActionFeedbackForm` level by wrapping children in `<fieldset disabled={pending}>` (or exposing `pending` to the SubmitButton). Benefits every form in the dashboard.

**P3.2 Slot dropdown** (Q6) (`RecruitmentDashboardClient.tsx:1396-1407`) — add a leading disabled placeholder (`"Select a slot…"`) + `required`; show a time range using `ends_at` (already loaded). No interviewer field (not in schema).

**P3.3 Confirm step** (Q5, optional) (`RecruitmentDashboardClient.tsx:1389`) — add a confirm dialog summarising candidate + slot before committing (it emails the candidate and books a calendar slot). At minimum for `new`/`ai_screened`. Pattern already used by the hire form (~1433).

**P3.4 Calendar-sync observability** (`actions/recruitment.ts:974-998`) — when `calendarResult.status === 'rejected'`, `console.error` the reason (matching the candidate route at `booking/[token]/route.ts:104`). Cron still recovers it; this just restores log visibility.

**P3.5 Email-not-sent UX** (Q4, optional) — when the action returns "Confirmation email was not sent", show a clearer toast and point to the existing Comms-tab retry.

### P4 — Tests

**P4.1** Behavioural test for `scheduleRecruitmentAppointmentByStaff`: token-reuse branch, token-mint branch, duplicate rejection, and claim-failure rollback (pairs with P1.1). Use the mocked-client + mocked-rpc pattern from `recruitmentBookingToken.test.ts`.
**P4.2** UI test in `RecruitmentDashboardA039.test.tsx`: submit the schedule form → assert the action is called with `application_id`+`slot_id` and `router.refresh` fires on success; plus an error-path case.

---

## 4. Product decisions (DECIDED 2026-06-29)

1. **Duplicate scope → per APPLICATION.** One scheduled appointment per application per type. Align UI flag, server guard, RPC check, and partial unique index on `application_id`+`type`.
2. **Trial-shift staff scheduling → ADD NOW.** Wire a trial-shift action + UI alongside interviews (sends `trial_confirmation` + ICS, status → `trial_scheduled`).
3. **Atomicity → NEW STAFF RPC.** `recruitment_staff_schedule_appointment` (SECURITY DEFINER, single transaction, `force=true` status transition).
4. **Confirm step (P3.3):** include as low-priority polish (not blocking).

**Deploy:** all changes built **locally only** — no commits/push; the staff RPC migration is NOT yet applied to prod (apply at deploy time with approval). The email code fix (§1) is also held local per user.

---

## 5. Rejected (false positives from the review)
- 2 findings rejected on adversarial verification (token re-arm on *success*, and a feared "second appointment" hole — both refuted because the RPC burns the token atomically).

---

## 6. Complexity / risk
- Email bug fix (done): **S** — low risk, shipped + tested.
- P1.1 + P1.2 (atomicity + duplicate guard): **M** — one migration, one RPC, guard + tests.
- P2 (ICS): **S** — shared generator, no schema change (reuses `reschedule_count`).
- P3 (UX): **S** — UI-only.
- P4 (tests): **S**.
