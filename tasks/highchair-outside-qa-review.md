# Adversarial QA Review — High-chair & Outside-table

**Date:** 2026-07-07 · **Tool:** Codex CLI (codex-cli 0.142.5), Mode B code review.
**Reviewers:** AMS core (assumption-breaker, workflow/failure-path, security) over a 200KB pack of the SQL + create/move/edit/availability/comms diff; website (assumption-breaker, workflow/failure-path) over a 105KB pack of the form/proxy/agent diff.

## What the reviewers confirmed sound
- Server-side clamp of high-chair requests to 0–2 before the RPC on both create routes.
- Outside bookings blocked from move-table server-side (409) and hidden from move availability.
- Raw walk-in override inserts `high_chair_count: 0` then calls `reserve_high_chairs` (no JS count-then-insert race).
- Availability served `no-store` once it carries the chair figure.
- Single global advisory lock + self-exclusion in `count_high_chairs_in_window`.
- Customer-form idempotency includes both new fields; missing `high_chairs_remaining` treated as unknown (fail-open).

## Findings fixed (AMS — commit `c3af9e7f`)
1. **FOH dedup missed a clamped retry** (AB-005/WF-002/SEC-002, High). The dedup compared the *requested* chair count to the *stored granted* count, so a retry of "2 chairs" that was clamped to 1 fell through and created a duplicate booking. Fix: dropped `high_chair_count` from the dedup comparison (kept `is_outside_seating` + party/purpose in the SQL fingerprint) — an identical retry now dedupes correctly.
2. **BOH re-window stale response/audit** (AB-001/WF-001, Medium). The edit re-granted chairs via `reserve_high_chairs` but returned + audited the pre-grant payload. Fix: capture the granted count and reflect it in the response `data.high_chair_count` and audit `new_values`.
3. **Outside deposit copy** (AB-006, Low). Pending-payment SMS said "table deposit" for outside bookings → now "deposit".

## Findings fixed (website — commit `4a4664aa`)
4. **Agent path used the wrong outside wire key** (WF-001/AB-001, High). `lib/api/client.ts` (the direct `anchorAPI`/AI-agent path) sent `is_outside_seating` to AMS, which expects `outside_seating` → agent bookings silently lost the outside flag. Fix: outbound payload now uses `outside_seating`. (The customer form path via the proxy was already correct.)
5. **Partial-grant confirmation copy** (AB-003, Medium). The note implied "no high chair reserved" even on a partial grant. Fix: on a partial grant it now reads "we could only reserve N of M high chairs you asked for".

## Verified non-issues (no change)
- **AB-003/AB-004 (AMS): migration outside-branch + move re-grant "unverifiable".** The reviewers could only see the truncated migration in the pack; both were confirmed directly at the Wave-1 gate (outside skips allocation+assignment at the `IF NOT p_outside_seating` guards; `move_table_booking_time_v05` re-grants via `reserve_high_chairs`; pacing still runs for outside food).
- **WF-006 (AMS): comms reads `high_chair_count` vs `high_chairs_granted`.** The RPC returns `high_chair_count = granted`, so reading it is correct.
- **SEC-003 (AMS): `reserve_high_chairs` granted only to `service_role`.** All callers use `auth.supabase` / `params.supabase`, which resolve to `createAdminClient()` (service-role) — verified via `src/lib/api/auth.ts`. The public/FOH create routes already call the service-role-only `create_table_booking_v05` successfully, confirming the client tier.
- **AB-004 (website): response drops requested count.** The agent caller already knows its own requested count; deriving granted-of-requested needs only the echoed `high_chairs_granted`.

## Accepted / deferred (documented, not blocking)
- **WF-005 (AMS): malformed `high_chair_inventory` cast could abort `reserve_high_chairs`.** The setting is admin/DB-only with no UI (spec O2) and the value is controlled (`{"value":2}`). If a settings UI is added later (O2), add validation on write.
- **AB-002/WF-002 (website): picker binds to `high_chairs_remaining`.** This is the spec's deliberate choice (§10 / D7: bind when present, fail-open when absent). A stale/genuine 0 hard-caps the picker but can never oversell (server is the gate). Possible future refinement: replace a hard-disable at 0 with "call us for a high chair".
- **Pre-existing BOH edit non-atomicity** (AB-002/WF-003/SEC-001). The BOH edit updates `booking_table_assignments` then `table_bookings` in two non-transactional statements — this predates and is unrelated to this feature (the feature only added the third `reserve_high_chairs` step, now made result-accurate). Hardening the whole edit into a single RPC transaction is a separate improvement.
- **Website unit tests (AB-005).** The hand-rolled form has no new unit tests; the authoritative server logic is covered by the AMS suite. Tech debt noted.

## Post-fix verification
- AMS: lint 0 · tsc 0 · full suite 3,483 tests pass · build 0.
- Website: tsc 0 · lint 0 · build 0.
