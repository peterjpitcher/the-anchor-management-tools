# Spec review log

Date: 2026-07-17. Five adversarial reviewers over spec v1, then a verify pass that tried to refute
each critical/high finding against the actual code.

**84 raw findings. 20 verified. 13 CONFIRMED, 7 PARTIAL, 0 REFUTED.** All applied in v2.

Raw: `_raw-review.json`.

---

## Verified findings, all applied

### PARTIAL [medium] §6 The closer rule is undefined on ~7% of real dates and non-deterministic on others

,  the second half is real, the first half is refuted, and both prod magnitudes are wrong.

REFUTED ,  "undefined on ~7% of dates" (no bar shift at the max end_time). decisions.md:100 states the rule as an ordered pair: "The closer = whoever has the latest finish time that date, tie-broken to `department='bar'`", echoed at spec.md:381-382. Under standard tie-break semantics this is unambiguous and total: latest finish is the sole key; `department='bar'` only applies when two shifts share the max. With no bar at the max, the latest finisher wins regardless of department ,  there is no fork. The finding invents a second reading ("fall back to the latest *bar* shift") that neither document supports. spec.md:384-386 reinforces the primary key: "Name-matching finds nobody… **Latest-finish works every day.**"

The 6.8% figure is also wrong because the reviewer excluded the `00:00:00` rows, contradicting the spec's own ordering rule at spec.md:388-393 ("Treat `end_time <= start_time` as next-day"). Re-querying prod `rota_published_shifts` with the spec's three canonical predicates AND its next-day rule (`ORDER BY (end_time<=start_time) DESC, end_time DESC`): 591 dates, **5 dates (0.85%)** have no bar shift at the max ,  2025-02-28 (kitchen 18:00–00:00), 2025-06-13, 2025-11-06, 2026-04-02 (kitchen 18:00–21:00), 2026-05-08 (runner 19:00–22:00). Not 40 dates, and not ambiguous.

CONFIRMED ,  the residual tie. **7 dates (1.2%)**, not 2, have 2+ `department='bar'` shifts sharing the max end_time. There the stated tie-break does not discriminate, the spec supplies no further key, and `resolveAccountable` (listed as a pure tested function at spec.md:716-717) would return whatever order the query happens to yield. That is genuine non-determinism on a person's score, and spec.md:727-736 has no fixture for it. Minor in blast radius ,  both candidates are bar staff finishing the same shift ,  but a pure function should be total.

**Applied:** Two one-line spec edits, not a redesign. (1) In §6 (spec.md:381-382), state the full ordered key: `ORDER BY (end_time <= start_time) DESC, end_time DESC, (department='bar') DESC, start_time ASC, id ASC LIMIT 1` ,  the final `start_time ASC, id ASC` is the only genuinely missing piece. (2) Add one clarifying sentence: "A non-bar shift CAN be the closer ,  the bar preference is a tie-break, not a filter (5 real dates, e.g. 2025-06-13 kitchen 18:00–21:00)." (3) Add one §13 fixture for two bar shifts both ending 22:00, asserting a stable pick. Do NOT add a fixture for the no-bar-at-max case as an am

---

### CONFIRMED [high] §5 The "existing resolver" at foh/schedule/route.ts:241-318 is not a resolver, is not COALESCE, and has a hardcoded 09:00–23:00 fallback the spec never handles

,  all three claims check out, and the real defect is worse than stated.

1. **Not field-by-field COALESCE ,  confirmed.** `src/app/api/foh/schedule/route.ts:292-301` uses row precedence for the booleans: `Boolean(specialHours ? specialHours.is_closed : businessHours?.is_closed)` and the same shape for `is_kitchen_closed`. Only `opens`/`closes`/`kitchen_opens`/`kitchen_closes` use `??` (:302-305). So spec.md:311 ("field-by-field COALESCE") and spec.md:712 (`resolveTradingWindow(date)` ,  "special over business, field-by-field COALESCE") both misdescribe the code. The reviewer's NULL scenario is the weak part: `supabase/migrations/20251123120000_squashed.sql:3344` declares `"is_closed" boolean DEFAULT false` (nullable but defaulted), so an explicit NULL is unlikely, and special-row-wins is arguably the intended semantics for a special opening on a normally-closed day. The defect is that the spec asserts semantics the code does not have, leaving the implementer to pick.

2. **Nothing to extract ,  confirmed.** `:241` is the `Promise.all` loading tables, bookings, business_hours, special_hours and table_areas (:241-258) ,  not a function, not hours-specific. The hours logic is the inline block at :277-321, interleaved with `fallbackServiceWindow` and followed immediately by table/area mapping at :322+. `ServiceWindow` is a route-local type (:145-154). Spec §14 phasing treats "trading-window helper extracted and shared" as free; it is a refactor of a live FOH route with no test coverage.

3. **The fallback is invisible in the spec, and it swallows `is_closed` ,  confirmed and worse.** `:277-286` hardcodes `{ start_time: '09:00', end_time: '23:00', source: 'fallback' }`. `:288` seeds `serviceWindow = fallbackServiceWindow`, and `:317` only overwrites it `if (!isClosed && opens && closes)`. So **a closed day returns the 09:00–23:00 fallback window**, and `ServiceWindow` (:145-154) has **no `is_closed` field at all** ,  the closed signal is destroyed by the return shape. spec.md:315 step 2 ("If `is_closed` → generate nothing") is therefore not implementable by reusing this function as written: the generator would fabricate a 09:00–23:00 day, generate ~45 instances, the sweep marks them all `missed`, and spec.md:444 ("Locked at end of business day. No retroactive recalculation") makes it unfixable. Same path on any query error. spec.md:262-263 ("If `special_hours` says we open at 19:00, the 18:00 check is not generated") only holds when resolution succeeds.

Severity high rather than critical: this is a draft spec with no code written, so nothing is broken in production today ,  but implemented as written it produces silent, permanently-locked wrong data.

**Applied:** Rewrite spec §5 step 1-2 and §13's `resolveTradingWindow` contract:

- State plainly that the FOH logic is a *mix* ,  row precedence for `is_closed`/`is_kitchen_closed`, `??` for the times ,  and that it returns a fabricated 09:00–23:00 window (`source: 'fallback'`) for closed days and query errors, with no `is_closed` on the return type.
- Specify the checklist generator's semantics explicitly. Recommend true field-by-field COALESCE (`specialHours?.is_closed ?? businessHours?.is_closed ?? false`) and a return shape that carries `is_closed` and `source: 'special_hours' | 'business_hours' | 'clos

---

### CONFIRMED [high] §3.5 `checklist_spot_checks.result NOT NULL` makes §11's "persist the draw immediately" impossible

The contradiction is real and unambiguous in the spec text, and I could find nothing that reconciles it.

1. `tasks/checklists-discovery/spec.md:173` declares `result text not null check (result in ('pass','fail'))` inside the `checklist_spot_checks` DDL block (`:167-178`).
2. `spec.md:631` states: "Persist immediately. **No re-rolling.**" ,  inside §11 Selection (`:624-634`), which fires "When Billy opens the spot-check tab" (`:626`), i.e. before any floor walk. There is no pass/fail value in existence at that moment, so the required-NOT-NULL insert cannot be constructed. The only escape would be writing a placeholder `pass` or `fail`, which the CHECK constraint restricts to exactly those two lying values.
3. The rest of the DDL actively confirms the two-phase lifecycle the finding describes: `drawn_at timestamptz not null` (`:175`) vs `recorded_at timestamptz` ,  nullable (`:176`). The spec already models draw-time and record-time as distinct events and already allows an unrecorded row; `result NOT NULL` is the lone column out of step with its own table.
4. §11 Recording is a separate step (`:636-639`, "Pass/fail + note. Writes `checklist_spot_checks`") ,  and note that §11 says Recording *writes* the row while §11 Selection says the draw *persists* the row. `unique (instance_id)` (`:177`) means both cannot each be an INSERT; one must be an UPDATE. The spec never says which, which is the same ambiguity from the other direction.
5. Downstream consequence confirmed: §1 lists "Billy's spot-check pass rate is visible over time ,  that's the number that says whether the ticks mean anything" as a success criterion (`spec.md:29`), and §9.4's Problems tab is specified to show "failed spot checks" (`spec.md:570`). If the draw cannot persist, stickiness cannot be enforced, a refresh re-rolls, and the audit stops being unpredictable ,  which §11's "Honest note" (`:651-656`) names as the one risk the whole feature rests on.

One partial caveat on the proposed fix's framing, not on the defect: §9.4's Problems tab is currently specified for "failed spot checks" only (`:570`) ,  surfacing drawn-but-never-recorded checks there is a genuine improvement but is a scope addition, not something the spec already asks for.

**Applied:** In §3.5 (`spec.md:173`), make `result` nullable and add an explicit lifecycle column:

```
result   text check (result in ('pass','fail'))
state    text not null default 'drawn' check (state in ('drawn','recorded'))
...
constraint spot_check_recorded_complete check (
  state <> 'recorded' or (result is not null and recorded_at is not null)
)
```

Then make §11 state the two writes explicitly rather than leaving both steps saying "writes": Selection INSERTs `state='drawn', result=NULL, drawn_at=now()`; Recording UPDATEs the existing row to `state='recorded'`, setting `result`, `note`, `recorded

---

### CONFIRMED [high] §12 `isFohOnlyUser` has 7 call sites, not 6 ,  the missed one is a 403 security gate

on all three material claims; the finding's causal reasoning about the 403 gate needs one correction.

1. **Call-site count ,  CONFIRMED.** `grep -rn isFohOnlyUser src` returns 7 call sites, not 6. The spec (§12, "`isFohOnlyUser` has **6 call sites** (`AuthenticatedLayout` + `table-bookings/{page,foh/page,boh/page,[id]/page,reports/page}`)") omits `src/lib/foh/api-auth.ts:23`, inside `requireBohTableBookingPermission()`:
```ts
if (!error && isFohOnlyUser((permissions ?? []) as UserPermission[])) {
  return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
}
```
This is a live API authorization boundary, not a UI convenience. It gates at least 8 BOH route handlers: `src/app/api/boh/table-bookings/route.ts:265`, `preorder-sheet/route.ts:5`, `booking-sheets/route.ts:141`, `[id]/route.ts:54,231`, `[id]/preorder/route.ts:32,42,52`, `[id]/sms/route.ts`.

2. **"No test file" ,  CONFIRMED.** `find . -name '*user-mode*'` (excluding node_modules) returns only `./src/lib/foh/user-mode.ts`. The predicate at `src/lib/foh/user-mode.ts:7-21` has zero direct coverage. The only related tests (`src/app/api/boh/table-bookings/booking-sheets/route.test.ts:39,118`) `vi.mock` `requireBohTableBookingPermission` wholesale, so they exercise none of the predicate's logic.

3. **`isFohPath` second consumer ,  CONFIRMED, and this is the sharpest bite.** `src/app/(authenticated)/AuthenticatedLayout.tsx:35` defines `const isFohPath = pathname.startsWith('/table-bookings/foh')`, consumed at **:97** (the redirect effect the spec cites) *and* at **:130**:
```ts
if (!permissionsLoading && fohOnlyMode && !isFohPath) {
  return (... <p>Redirecting to Front of House...</p> ...)
}
```
This is an early `return` before the real layout renders. Since both gates read the same `:35` constant, broadening it in one place is impossible ,  but the spec's framing ("`AuthenticatedLayout.tsx:35` hardcodes… make it an allowlist" while citing only `:92-100`) shows the render gate was not analysed. If an implementer follows the cited line range and patches only the effect, FOH-only users navigating to `/checklists` hit `:130` and get a permanent "Redirecting to Front of House…" dead screen ,  the redirect no longer fires, so nothing ever resolves it.

**Correction to the finding's reasoning.** It claims the 403 gate "happens to stay correct… but that is luck." The direction is actually the reverse: today a hypothetical `table_bookings`+`checklists` user is **not** FOH-only, so they'd **pass** the BOH gate; after `FOH_MODULES = new Set(['table_bookings','checklists'])` they'd **403**. The change *tightens* the gate. It's moot today because the `checklists` module does not yet exist in `ModuleName` (`src/types/rbac.ts:31-63`), so no user can hold that permission ,  but it is a real, intended semantic change to an authz boundary that the spec does not acknowledge. §14's rollback note ("Phase 2's `isFohOnlyUser` change is the only one that touches live behaviour") is therefore true but under-scoped: it reads as though the blast radius is chromeless UI, when it also covers API authz.

Severity high stands on my own assessment ,  driven by the `:130` dead-screen risk on a live kiosk with zero test coverage, not by the 403 nuance.

**Applied:** Three corrections to §12:

1. Change "6 call sites" to "7 call sites" and name `src/lib/foh/api-auth.ts:23` explicitly, flagging it as an **API authz boundary** (403 for FOH-only users on BOH routes), distinct from the six UI call sites. Note that broadening `FOH_MODULES` *tightens* this gate ,  a `table_bookings`+`checklists` user newly 403s where they previously passed. This is the intended semantics and affects no existing user (the `checklists` module doesn't exist yet in `src/types/rbac.ts:31-63`), but it must be a stated decision, not a side effect.

2. Rewrite the allowlist instruction t

---

### CONFIRMED [medium] §3.5's justification for the sibling table is exactly backwards

The spec at `tasks/checklists-discovery/spec.md:180-183` says the scorer is an "exhaustive switch with no default ,  new events would pollute the reliability score". The code refutes the mechanism.

1. The switch runs `src/lib/employee-reliability-scoring.ts:128-176` (spec says 128-178; the switch closes at :176, the loop at :177 ,  minor citation slip). `grep -n "default"` over the whole file returns **nothing**: there is genuinely no default arm, and no `never`-exhaustiveness assertion either.
2. Every accumulator (`counts.*`, `acceptanceCredit`, `responseHours`) is mutated **only inside a matched `case`** (:129-175). An unrecognised `event_type` falls through the switch untouched ,  it is silently ignored, not scored. That is the opposite of pollution.
3. Both denominators exclude it too. `shiftDecisionCount` (:179) filters on `SHIFT_DECISION_EVENTS`, a closed `Set` of four types (:79-84); `responseHours` (:125) is only pushed to inside `shift_accepted`/`shift_rejected`. So a new type contributes to neither numerator nor denominator, and `isLowSample` keys off `counts.eligibleShiftSignals` (:211), which it also never touches. `score` (:201) is byte-identical with or without the extra rows.

The conclusion (sibling table) is nonetheless right, for the reason the finding gives: the `event_type` CHECK at `supabase/migrations/20260706000000_employee_reliability_events.sql:6-17` is a closed `IN` list of nine values, so a checklist-event insert is rejected outright by Postgres.

One addition the proposed fix misses, which strengthens the real argument: `eventTypeLabel` (`:228-242`) is a `Record<ReliabilityEventType, string>` lookup with no fallback, so widening the DB CHECK without widening the TS union would return `undefined` in the events timeline UI. That is a second concrete cost of widening ,  the score stays clean, the display breaks.

**Applied:** In `spec.md:180-183`, replace the "would pollute the reliability score" claim with the actual blocker and the actual cost of widening:

> **Verify refuted extending `employee_reliability_events`**: its `event_type` CHECK is a closed `IN` list (`supabase/migrations/20260706000000_employee_reliability_events.sql:6-17`), so an insert of a checklist event is rejected by Postgres. Widening it would mean also widening `ReliabilityEventType` and the scorer's switch (`src/lib/employee-reliability-scoring.ts:128-176`), which has no default ,  an un-widened type is silently ignored by the score (safe) bu

---

### PARTIAL [medium] Decision 2 + 17 ,  the tick is demoted to a secondary number; the headline score is rota-based

The finding's description of the spec is accurate, but its characterisation as a straight inversion of a settled decision is not.

Accurate parts: spec.md:423 does define the **Completion score** "over instances where the person was **accountable**", with `accountable_employee_id` resolved from the rota (spec.md:137, spec.md:378-386, spec.md:322). The tick-derived number is only a **Contribution count** (spec.md:436-437) with no bands, no denominator, and no scoring weight. spec.md:439-440 makes it explicit: "if Amanda does Lance's closing task on time: Lance scores 10 (it happened on his watch), Amanda's contribution +1." And decisions.md:15 does read "Score people, not the shift. Attribution is by ticking your name", with decisions.md:98 "One tick per task; the first person gets the credit."

Where the finding overreaches:
1. **It ignores decision 8**, which is at least as explicit and points the other way: decisions.md:21 ,  "**Tie lists to rota shifts** so we know who didn't do it. **The closer is responsible for all checks.**" Decision 19 (decisions.md:100) then specifies exactly how to resolve that closer from the rota (latest finish time, tie-broken to bar). "The closer is responsible for all checks" cannot be implemented by tick-attribution alone ,  a closer who ticks nothing would, under the proposed fix, be responsible for nothing except literal no-shows. The spec at spec.md:380 cites decision 8 by name as the basis for the accountable resolution. This is an implementation of a decision, not a re-argument against one.
2. **The killed item is mis-quoted as broader than it is.** decisions.md:65 kills "Shift-level-**only** scoring". The spec does not do shift-level-only scoring ,  it carries a per-person tick attribution (spec.md:536-544), a per-person contribution count, and a per-person accountable score. Both numbers are per-person; neither is a shift-level aggregate. The killed model was one with no per-person tick attribution at all, which decision 2's picker replaces. The spec keeps the picker.
3. **"Credit" (decision 17) is not synonymous with "the score".** Decision 17's stated purpose is recorded at decisions.md:46-48 ,  it exists to settle credit-*splitting* ("no credit-splitting question to answer"), not to name the scoring denominator. The spec honours it: one tick, one completer, contribution +1 to that one person.

Where the finding lands a real point: decisions 2 and 8 are in genuine tension ("attribution is by ticking your name" vs "the closer is responsible for all checks"), and nothing in decisions.md resolves it. The spec resolves it unilaterally at spec.md:418-421 ("Two numbers, not one") and prosecutes the case in its own prose ("Scoring only the completer means nobody owns a miss"). Dual metrics were never an owner decision, and the spec's choice of which one is the headline ,  the rota-derived one ,  is the spec author's call. That is a real gap needing an owner sign-off. It is not, however, a critical decision-fidelity breach, and the proposed fix (score the ticker; use rota for misses only) would break decision 8's "responsible for all checks" and should not be applied without the same owner input the finding rightly asks for.

**Applied:** Do not apply the proposed fix as written ,  it contradicts decision 8 (decisions.md:21) and decision 19 (decisions.md:100). Instead, surface the unresolved tension to the owner as a single question, and record the answer in decisions.md before the spec is built:

"Decision 2 says attribution is by ticking your name. Decision 8 says the closer is responsible for all checks. When Amanda does Lance's closing task, who does the completion score belong to? (a) Lance ,  it happened on his watch, Amanda gets a separate contribution count [what the spec currently does]; (b) Amanda ,  she did it, Lance on

---

### CONFIRMED [high] Decision 14 ,  the spec invents an amber tier that does not email, narrowing "out-of-threshold"

, and slightly worse than stated. decisions.md:27 records a single behaviour: "**Out-of-threshold value** → email manager@the-anchor.pub immediately, and tell the staff member on screen to **contact Billy or Peter**." decisions.md:136 repeats it as one trigger ("Value out of threshold (14)"). Nowhere in decisions.md do the words amber, red, or hard threshold appear against value capture ,  grep returns only line 27 and 136.

The spec invents a second tier. spec.md:101-104 defines four columns: `value_min -- amber below`, `value_max -- amber above`, `value_hard_min -- red / email`, `value_hard_max`. spec.md:142 stores `value_breach text check (value_breach in ('amber','red'))`. spec.md:555-556 gates the owner's behaviour on red only: "On a **red** breach: the tick still saves ..., the row goes red, and the screen says **\"Contact Billy or Peter\"** (decision 14). Email fires (§10)." spec.md:590 confirms the email is "Value breach (red) | manager@the-anchor.pub | Immediate". So a reading outside value_min/value_max ,  out of threshold by any plain reading of decision 14 ,  produces neither the email nor the on-screen instruction the owner asked for.

Two aggravating points beyond the original finding. (1) The amber tier has **no specified behaviour at all**. It is stored at spec.md:142 and named in the column comments, but no section of the spec says what amber does on screen, in reporting, or in the Problems tab ,  it is a dead enum value. (The word amber at spec.md:432 is the unrelated completion-score band.) (2) The split is undisclosed. spec.md:788-805 (§16 Assumptions) lists ten assumptions and this is not among them, and spec.md:808-810 (§17 Open) states "Nothing blocking." So the one place a reader would look for "here is where I deviated from the owner" does not mention it. The "(decision 14)" citation at spec.md:556 is false as written ,  decision 14 covers out-of-threshold, not out-of-hard-threshold.

**Applied:** Collapse to a single threshold pair (`value_min`/`value_max`) with one behaviour per decision 14: out of range = save the tick, email manager@the-anchor.pub, show "Contact Billy or Peter". Drop `value_hard_min`/`value_hard_max` and reduce `value_breach` to a boolean (or drop it and derive from the snapshotted min/max). If a two-tier design is genuinely wanted, do not build it silently ,  put it to the owner as a question with a recommendation, and until he answers, record it in §16 Assumptions and remove "Nothing blocking" from §17. Either way, delete the "(decision 14)" citation at spec.md:556

---

### PARTIAL [high] Decision 11 ,  "so they can't be missed" is engineered away, then deferred to the last phase

The textual core is CONFIRMED; the reasoning about why is materially wrong.

Confirmed: decisions.md:24 states "Mid-shift tasks → **modal**, so they can't be missed" ,  unmissability is the owner's explicit rationale. spec.md:519-521 reduces this to two prompt attempts, both gated and both dismissible: "Fires on the tick when a `pending` instance passes `window_start`" / "**Never interrupts active FOH work** ,  reuse `hasActiveFohWork` (`:174-178`)" / "Dismissible. Re-prompts once at `due_at`. Never blocks." spec.md:756-759 confirms the deferral and the stated reason: "Mid-shift modal auto-open, todos, seasonal boundary prompt. **Order matters:** the mid-shift modal is last deliberately". So the owner's one explicit UI requirement does ship last, with unmissability traded away.

Refuted: the finding's central mechanism claim ,  "suppressed whenever anyone is mid-booking", "on a busy Friday FOH work is continuous, so the mechanism is most suppressed precisely when it matters most". src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx:173-179 shows `hasActiveFohWork` is transient per-action state (`bookingActionInFlight || createBooking.submittingBooking || submittingFoodOrderAlert || createBooking.isCreateModalOpen || selectedBookingContext || showCancelBookingConfirmation || partySizeEditOpen || walkoutModalOpen`) ,  true only while a specific modal is open or a single mutation is in flight, typically seconds. It is not a busy-night mode and does not suppress continuously. Also refuted: "the only night with a 22:00 check" ,  spec.md:252 schedules it Fri–Sat (`by_weekday={5,6}`). And spec.md:504 already gives the FOH button a persistent "outstanding-count badge" in Phase 2, so the proposed "unmissable persistent badge" is partly specced already.

The genuine defect, which the finding reaches by faulty reasoning: with exactly two attempts and no retry rule, a tick suppressed by `hasActiveFohWork` is lost permanently. If a booking modal happens to be open at the `window_start` tick and again at the `due_at` tick, the check is never surfaced at all and is silently swept to `missed` (spec.md:338). That is a real hole in decision 11's guarantee ,  but it is a missing-retry bug, not systemic suppression.

**Applied:** Two spec edits, one decision to get in writing.

1. spec.md:519-521 ,  replace "Re-prompts once at `due_at`" with a deferred-retry rule: the `hasActiveFohWork` / focus guard **defers** a prompt rather than consuming it. Keep a per-instance `promptState`; on every minute tick, if an instance is `pending`, past `window_start`, and its prompt is owed, attempt it ,  if the guard blocks, leave it owed and retry on the next clear tick. This closes the silent-loss hole without changing the focus-steal protection (which is correct and should stay verbatim).

2. spec.md:519-521 ,  escalate past `due_at`: 

---

### CONFIRMED [medium] Decision 6 ,  "2 spot checks per day" becomes "up to 2, only on days Billy opens a tab, only on tasks already ticked"

on its core claim, with one sub-claim refuted and the proposed fix technically unworkable as written.

Confirmed:
- decisions.md:19 states flatly "**2 spot checks per day.**" No qualifier, no "when Billy's in".
- spec.md:626-634 makes the draw live and open-triggered: "When Billy opens the spot-check tab: If today's draw exists → show it. Else draw **2** ..." and "Drawing on open means it only happens on days Billy's actually in ,  no separate rota check needed." So on any day the tab isn't opened, the count is zero and no row exists to record the zero ,  an absence, not a measurable value.
- The spec's own stated mitigation is logically broken. spec.md:655: "2/day is the stated number; the spot-check pass rate over time will show whether it's real." Pass rate is computed over *recorded* checks ,  zero checks produce no pass rate at all, so the metric that is supposed to prove Billy walks the floor is blind to exactly the failure it is named for. Same flaw at spec.md:29 ("Billy's spot-check pass rate is visible over time ,  that's the number that says whether").
- No coverage metric exists anywhere. grep for "coverage"/"per day"/"2/day" across spec.md returns only lines 621/655 (prose) and the setting at spec.md:223 (`spot_checks_per_day int default 2`). The Insights tab (spec.md:567-568) and the Problems tab (spec.md:570-571, which lists "failed spot checks") report no checks-done-vs-expected figure. §11's Honest note (spec.md:651-656) concedes the exposure and then designs it to be invisible.

Refuted sub-claim: "the one thing a spot check most needs to catch ,  a task ticked but not done ... is only half covered". Drawing only from `done` instances (spec.md:628) is precisely what catches a ticked-but-not-done task. The other case ("quietly left") is a *missed* instance and is already caught without a physical walk ,  scored 0 at spec.md:429 and surfaced on the Problems tab (spec.md:570). The `done` restriction is a sound reading of decision 6, not a drift from it.

Refuted fix: moving the draw into the daily generation job (§5) cannot work as proposed ,  generation runs at the start of the business day, when no instance is yet `done`, so a pre-drawn pair would contradict spec.md:628. The fidelity gap is in reporting, not in draw timing.

**Applied:** Keep the live, sticky, no-re-roll draw exactly as specified at spec.md:626-631. Add the measurement the owner's number implies:

1. Record the daily expectation, not just the outcome. On generation, write a per-business-date expectation row (or derive it) of `checklist_settings.spot_checks_per_day` (spec.md:223) for every trading day. A day with no draw is then a stored 0-of-2, not an absence.
2. Report against it. On Insights and Problems (spec.md:567-571) show "spot checks completed vs expected" for the rolling 30 days alongside pass rate, with days-with-zero-checks called out. The owner set

---

### CONFIRMED [critical] §5 ,  nothing ever triggers generation

spec.md:309 states "One job per business day, enqueued at ~05:00 London for that day" in the passive voice, and no actor is ever named. The only mechanism §5 cites is spec.md:304-305: "**No new cron.** The `* * * * *` jobs queue already exists: `/api/jobs/process?process=true&batch=30`" ,  but that route is a pure processor. Its entire body of work is `await jobQueue.processJobs(batchSize)` (src/app/api/jobs/process/route.ts:34); there is no `enqueue` call in the file. It drains `jobs`, it cannot create them.

No fallback exists. The job queue has no recurrence primitive ,  grepping src/lib/unified-job-queue.ts for recurring/repeat/cron/reschedule yields only the `send_event_reschedule_notifications` job *type* and a retry-backoff `rescheduleFor` at :702. No existing cron route enqueues jobs either (`grep -rl "enqueue" src/app/api/cron/` returns nothing), so there is no house idiom to infer from. The only cron the spec defines is the weekly summary, `0 8 * * 1` (spec.md:613). §14 Phase 2 (spec.md:748) commissions the "Generation job (3 job types registered in all three places)" ,  the handler ,  but never its trigger.

The finding actually understates the problem. This is not a passive omission: Decision 21 (decisions.md:102, "Task instances generate via the existing jobs queue, not a new cron") and §5's "**No new cron.**" heading actively steer the implementer away from the one obvious remedy. An implementer following the spec faithfully ships a system where no instance is ever created ,  and §5:333's claim that "no cron needs to know the trading hours" is true only of the *per-slot* jobs, which never exist because their parent never runs.

Secondary confirmation: spec.md:224 sets `business_day_start_hour int default 6` while spec.md:309 says ~05:00. The spec never reconciles the two, so even the intended fire time is ambiguous.

**Applied:** Specify the trigger explicitly in §5 and reword Decision 21 to "no new *processing* cron ,  generation is enqueued by a thin trigger and executed by the existing queue", so the implementer isn't steered away from the fix.

Recommended: option (a), a daily cron route `/api/cron/checklists-generate` at `0 4 * * *` UTC, added to `vercel.json`, guarded by `authorizeCronRequest()` (src/lib/cron-auth.ts:22), that enqueues `checklist_generate_day` for the London business date. Re-check London wall time and bail outside a 04:00–06:00 window to absorb DST, per the verified pattern at src/app/api/cron/ro

---

### CONFIRMED [critical] §3.3/§5 ,  `window_start` and `due_at` are never defined

, with one overstated consequence.

The core claim holds. `tasks/checklists-discovery/spec.md:132-133` declares both columns `not null`:
```
window_start              timestamptz not null
due_at                    timestamptz not null
```
Neither is ever derived. §5's generation job is the only place that could do it, and `spec.md:317` says in full: `- Resolve slot instants; **clamp to `[opens, closes]`**; skip out-of-window slots.` "Slot instant" is singular and undefined ,  it yields at most one timestamp, not two, and no rule maps `anchor='open'|'close'|'at_times'|'anytime'` onto either column. `decisions.md` contains zero occurrences of `window_start`, `due_at`, or `grace` (grepped). `checklist_settings` (`spec.md:223`) exposes `grace_minutes int default 30` but no window or due offsets.

`window_start` is the strongest part of the finding: it appears in exactly two places in the whole spec ,  the DDL at `:132` and the modal rule at `:519` ("Fires on the tick when a `pending` instance passes `window_start`"). A NOT NULL column that the generator has no rule to populate and the UI depends on is not buildable. §9.2 is dead as written.

`due_at` is weaker than the finding claims. `spec.md:361` states it in prose for one anchor: "a closing task's `due_at` is at close, and the only shift covering it is the last one" ,  and §6's whole accountability rule (`:358`) depends on that value. So `due_at` for `anchor='close'` *is* pinned, incidentally, in a section about something else; it is `open`, `at_times`, and `anytime` that are unpinned. That makes this a scattered/incomplete definition rather than a total absence.

The "every closing task is late by definition" consequence is overstated. §7 (`spec.md:428`) scores 5 only for "Done late (past `due_at` **+ grace**)", and grace defaults to 30 min (`:223`). A close task ticked at close+5 scores 10. The real defect is narrower: 30 minutes does not cover a pub close-down, so most closing tasks will land at 5 ,  a mis-calibrated default, not an arithmetic impossibility. Similarly `open` scoring 5 at opens+5 only follows *if* `due_at=opens`, which is an inference, not something the spec says.

Net: the derivation table is genuinely missing, `window_start` is unbuildable, and the scoring model is not computable for three of four anchors. Critical stands.

**Applied:** Add a per-anchor derivation table to §5 step 3, before "clamp to `[opens, closes]`", defining both columns for all four anchors ,  e.g. open → `window_start = opens - open_lead_minutes`, `due_at = opens + open_grace_minutes`; close → `window_start = closes - close_lead_minutes`, `due_at = closes + close_grace_minutes`; at_times → `window_start = t - slot_lead_minutes`, `due_at = t + grace_minutes`; anytime/floating → `window_start = opens`, `due_at = closes`. Put the offsets in `checklist_settings` (§3.8) alongside the existing `grace_minutes`, with a per-template override column if any task ne

---

### PARTIAL [high] §4/§5 ,  `floating` cadence is not computable from the stated columns

The naming defect is real, but the central claim ("not computable") is refuted.

CONFIRMED ,  `last_completed_at` does not exist. spec.md:320-321 says "For each active `floating` template with no open instance and `last_completed_at + interval_days <= today`". No such column appears in §3.2 `checklist_task_templates` (spec.md:75-109), §3.3 `checklist_task_instances` (spec.md:112-155), §3.8 `checklist_settings` (spec.md:217-226), or any other §3 table. Grep across spec.md and decisions.md returns zero hits for `last_completed`, `next_due`, or `due_on`. As written, step 4's predicate references an undefined identifier.

REFUTED ,  "not computable from the stated columns". §3.3 stores `completed_at` (spec.md:141) and `template_id` (spec.md:114) on every instance, so `last_completed_at` is exactly `max(completed_at) where template_id = t`. It is derived state, not missing state. The spec's error is that it names a column instead of a derivation.

REFUTED ,  "the clamp requires storing the original/next due date, which also has no column". §3.3:104 stores `due_at timestamptz not null` on each instance. The clamp at spec.md:279-280 ("completing early never pulls the next one earlier than the original due date") is computable as `next_due = max(last_instance.due_at, last_instance.completed_at) + interval_days` ,  both operands are stored columns. `unique (template_id, business_date, slot)` (spec.md:150) plus "at most one open instance" (spec.md:277) make "the last instance" unambiguous.

REFUTED ,  "The 12 bar items cannot be generated" (the severity driver). They can, from a `max()` over `checklist_task_instances`. The performance cost is trivial and the index `(state, due_at) where state='pending'` (spec.md:153) already exists.

CONFIRMED, and the residual real bug ,  seeding is undefined. For a newly created `floating` template no instance exists, so `max(completed_at)` is NULL, step 4's predicate evaluates to NULL, and the template never generates its first instance. spec.md:320-321 has no seed branch, and decisions.md is silent on floating entirely. This is a genuine never-fires defect, not merely a naming gap.

Downgraded from critical: no new columns are required, no data is lost, and the fix is a wording change plus one seed branch.

**Applied:** Do not add `last_completed_at` / `next_due_on` columns ,  the state is already derivable and duplicating it invites drift with the instance history. Instead, rewrite §5 step 4 to state the derivation and the seed:

1. Replace step 4 (spec.md:320-321) with: "For each active `floating` template with no `pending` instance, let `last` = the most recent instance for that template (by `business_date`). Generate one instance with `slot='anytime'` when either (a) `last` is NULL (never generated ,  seed on the first generation run after the template becomes active), or (b) `max(last.due_at::date, last.co

---

### CONFIRMED [high] §14 ,  Phase 2 has a forward dependency on Phase 3

on the substance; one sub-claim overstated.

1. Phase 2's scope contains no way to create a checklist or task. spec.md:746-749 ,  "### Phase 2 ,  capture (score 4) / Generation job (3 job types registered in all **three** places), open/close screen, attribution picker, value capture + breach email, notes. FOH button. **The chromeless fix + iPad test.** Billy can build and run the bar list."
2. The only authoring surface is Phase 3. spec.md:751-753 ,  "### Phase 3 ,  oversight (score 3) / Setup UI, insights, scoring, problems view, spot checks…", and spec.md:565 defines that Setup tab as "**Setup** ,  CRUD checklists, tasks, cadence, thresholds, spot-check flag." So Billy cannot *build* anything in Phase 2.
3. No seed migration exists. `grep -rn -i "seed" spec.md decisions.md` returns only spec.md:677 (`DO $$` pattern for **RBAC permissions**) and spec.md:743 ("RBAC module + seeding" in Phase 1). Neither seeds `checklists` / `checklist_task_templates`. Decision 5 (decisions.md:18, "Build the full list as supplied") and decision 13 (decisions.md:26) mandate the bar list but no phase delivers its rows.
4. Consequence: the Phase 2 generation job (spec.md:307-325) reads `checklist_task_templates` (spec.md:75-110), which will be empty, so the open/close screen ships with nothing to capture ,  and success criterion 1 (spec.md:26, "Billy can build the bar checklist without a developer") is met in Phase 3, not 2 as the closing line asserts.

OVERSTATED: the finding's claim that this "breaks the §14 promise 'Each phase independently deployable, no broken intermediates'" (spec.md:740) does not survive. Phase 2 is additive and deploys cleanly; an empty screen is inert, not broken, and spec.md:763 ("Phases 1–3 are additive; revert the deploy, tables sit unused") is consistent. The defect is a false capability claim and a mis-placed success criterion, not a broken intermediate. Severity lowered from critical to high on that basis: it misroutes phase scoping and would have a builder discover mid-Phase-2 that there is no data, but it corrupts no live behaviour.

**Applied:** Add an explicit Phase 2 deliverable ,  a seed migration inserting the bar-checklist rows from bar-checklist.md verbatim into `checklists` + `checklist_task_templates` per decisions.md:18 (decision 5) ,  rather than pulling Setup CRUD forward. Reason: Setup UI belongs with the insights/scoring screens it shares `/checklists/manage` tabs with (spec.md:558-572); splitting that route across two phases costs more than a seed file, and Phase 2's stated purpose is proving capture on the iPad, which a seeded list exercises fully. Then correct spec.md:749 to read "Staff can run the seeded bar list on the

---

### PARTIAL [low] §14/§12 ,  Phase 1 breaks live chromeless mode before Phase 2 fixes it

,  the breakage claim is refuted; only the documentation half stands.

1. FOH-only status is role-derived and the FOH role is bespoke. `src/lib/foh/user-mode.ts:7-24` requires `table_bookings:view` AND `permissions.every(p => p.module_name === 'table_bookings')`. Permissions come only from roles ,  the live DB has `permissions`, `role_permissions`, `roles`, `user_roles` and **no `user_permissions` table** (information_schema query against project `tfcasgxopxegwrabvwat`), so a user's module set is exactly their roles' union.

2. Live role → module counts (same DB): `foh_staff` = 1 module (`table_bookings`) ,  this is the only role that can satisfy `isFohOnlyUser`. `Deputy` = 3 (bookings, customers, table_bookings), `staff` = 15, `manager` = 31, `super_admin` = 35. Any user holding `staff`/`manager`/`super_admin` already fails `.every(...)` today and is not in chromeless mode.

3. Phase 1 seeds only roles that are already non-FOH. spec.md:666-668 grants `checklists:view` to "staff, manager, super_admin" and `manage` to "manager, super_admin". `foh_staff` is not in that list, and the seeding pattern the spec names (spec.md:678; `supabase/migrations/20260703090000_feedback_rbac_permissions.sql:23-24`) resolves role ids by literal name (`super_admin`, `manager`) ,  it cannot touch `foh_staff` implicitly. So the Phase 1 deploy adds no module to any FOH-only user, `isFohOnlyUser` still returns true for them, and the sidebar/redirect at `src/app/(authenticated)/AuthenticatedLayout.tsx:31-35` is unchanged. Phase 1 does ship dark.

4. The phasing is therefore internally consistent, not inverted: the grant that would actually flip an FOH-only user (`checklists:view` → `foh_staff`) is not in Phase 1's list at all, and the `FOH_MODULES` fix sits in Phase 2 (spec.md:746-750) where the FOH capture screen ,  and hence that grant ,  lands. spec.md:762-765 correctly names the `isFohOnlyUser` change as Phase 2's only live-behaviour touch.

5. What does stand: §12's role table never mentions `foh_staff`, so the `foh_staff` grant is invisible in the spec ,  a reader can't tell it is deliberately deferred to Phase 2 rather than forgotten, and if an implementer adds it to the Phase 1 migration "for completeness" the iPad breaks exactly as the finding describes. That is a spec-clarity gap, not a phase-ordering defect.

**Applied:** Add one line to §12 and to the Phase 1 bullet in §14: Phase 1 creates the `checklists` permission rows and grants them to `staff`, `manager` and `super_admin` only ,  **`foh_staff` is deliberately granted nothing in Phase 1**, because `foh_staff` is the only role that satisfies `isFohOnlyUser` (live: 1 module, `table_bookings`). State that the `checklists:view` → `foh_staff` grant must ship in the **same deploy** as the `FOH_MODULES` change in Phase 2, and add it to Phase 2's iPad test checklist. Do not move the `isFohOnlyUser` fix into Phase 1 ,  there is nothing for it to guard against there.

---

### CONFIRMED [high] §3.5 vs §11 ,  a drawn spot check cannot be persisted

spec.md:628-631 (§11 Selection) states the draw happens when Billy opens the tab, before any check is walked: "Else draw **2** from today's `is_spot_checkable` instances that are **`done`**... Persist immediately. **No re-rolling.**" Recording is a separate later step ,  spec.md:636-639 (§11 Recording): "Pass/fail + note. Writes `checklist_spot_checks`...". But the §3.5 schema (spec.md:167-178) declares `result text not null check (result in ('pass','fail'))` with no third state. At draw time there is no pass/fail, so the INSERT the spec mandates is impossible: it would violate the NOT NULL. The two-phase intent is proven by the timestamp pair in the same block ,  `drawn_at timestamptz not null` (spec.md:175) vs `recorded_at timestamptz` (spec.md:176, deliberately nullable). A single-phase table would not need both. Nothing in decisions.md:19-20 (decisions 6 and 7) resolves this ,  they fix the 2/day count and the no-void/no-notify behaviour, not the write lifecycle. The secondary claim about the 2/day cap is weaker but stands: `unique (instance_id)` (spec.md:177) only stops the same instance being drawn twice; nothing at DB level stops a third or fourth row for the same `business_date`. §11's "If today's draw exists → show it" is an application-level read guard only, so a concurrent open or a retried action can over-draw.

**Applied:** In §3.5, make the two-phase lifecycle explicit rather than implied by the timestamp pair. Either (a) simply make `result` nullable ,  `result text check (result in ('pass','fail'))` ,  and add a CHECK tying it to the recorded phase: `check ((recorded_at is null and result is null) or (recorded_at is not null and result is not null))`; or (b) add `status text not null default 'drawn' check (status in ('drawn','recorded'))` with `check (status = 'drawn' or result is not null)`. Option (a) is lighter and needs no new column ,  `recorded_at` already carries the state. Separately, enforce the 2/day ca

---

### PARTIAL [medium] §4 ,  the model cannot express bar-checklist row 8 (pool table)

The count error and the dropped row are real; the buildability claim is refuted.

CONFIRMED ,  wrong count: bar-checklist.md:123-132 is a table with 8 data rows (header + separator + 8). spec.md:242 states "The bar list alone needs seven shapes." The eighth row, bar-checklist.md:132 ("Weekly, tied to a more frequent task | Spray pool table (once a week) vs brush (more often)"), has no counterpart in §4's mapping table at spec.md:246-256.

CONFIRMED ,  actively mis-bucketed, not just omitted: spec.md:272 reads "For the 12 'between daily and weekly' items (wipe chairs, glass racks, plants)." bar-checklist.md:103-115 has exactly 12 items, and item 6 (line 109) is "Brush pool table (only spray once a week)". The spec therefore assigns that row wholesale to `floating`, silently absorbing the weekly spray into a floating brush template. This commits to the wrong shape rather than merely leaving a gap.

CONFIRMED ,  decision unrecorded: grep across spec.md, decisions.md and open-questions.md returns zero hits for pool/spray/brush. bar-checklist.md:155 (Note 5) says "Probably should be split" but no decision records it. spec.md:810 declares "Nothing blocking" and §16 (spec.md:784-804) does not cover it, so the implementer decides unaided.

REFUTED ,  the headline claim "the model cannot express" it: §4 already supplies both halves. `floating` with `interval_days`/`tolerance_days` (spec.md:270-283) and `calendar` with `freq=weekly, by_weekday` (spec.md:253) express the pool table cleanly as two templates. No schema change is needed; the escape hatch exists. This is an unrecorded decision plus an arithmetic error, not a buildability failure ,  hence medium, not high.

REFUTED ,  the fix's extras: decision 5 (decisions.md:18, "Build the full list as supplied") already settles that typos ship verbatim; re-opening "Cultery"/"Condaments"/"celler" here is padding. "Restock Caddies" (bar-checklist.md:43) vs "Refill caddies" (line 111), flagged at bar-checklist.md:148, is genuinely unresolved but is a task-seeding question, not a §4 cadence question.

**Applied:** Two edits, both narrow:

1. spec.md:242 ,  change "seven shapes" to "eight shapes".

2. spec.md:270-283 (`floating`) ,  record the split as a decision and fix the count. Change "For the 12 'between daily and weekly' items" to "For the 'between daily and weekly' items", and add:

   > **Pool table is two templates, not one.** bar-checklist.md item 5.6 ("Brush pool table ,  only spray once a week") is two cadences in one row (bar-checklist Note 5). It seeds as: **Brush pool table** ,  `floating, interval_days=4`; **Spray pool table** ,  `calendar, freq=weekly, by_weekday={1}`. This makes the variable

---

### CONFIRMED [high] §7 vs §16 ,  grace both does and does not affect the score

, and the contradiction is worse than stated. tasks/checklists-discovery/spec.md:428 scores "Done late (past `due_at` + grace)" as **5**, making grace the load-bearing boundary of the scoring table. spec.md:790 states "**Grace = 30 minutes**, presentational only ,  never touches `completed_at` or the score's truth." The clause "or the score's truth" is explicit and directly contradicts :428 ,  both cannot hold, since grace is the only thing separating 10 from 5.

A third problem sits inside §7 itself: the table has no row for the grace band. :428 says 10 points for "Done within the window", and the window is `window_start` → `due_at` (spec.md:132-133). A completion at `due_at + 10min` is neither "within the window" (10) nor "past `due_at` + grace" (5) nor "Missed" (0) ,  it falls through every row. So even an implementer who ignores §16 cannot score the grace band from §7 alone.

Compounding it, `was_late boolean not null default false` exists at spec.md:140 but the spec never defines how or when it is computed, nor against which `grace_minutes` value. `grace_minutes` is a mutable settings row (spec.md:223), so absent a rule, a later change to it silently rewrites historical scores. Grace is also reused for a second, unrelated purpose at spec.md:338 (the sweep runs at "business-day end + grace"), which is genuinely non-scoring and is probably the source of the "presentational only" belief ,  but the spec never distinguishes the two uses.

**Applied:** Make grace scoring-material (§7 is right) and pin it at completion time.

1. Rewrite assumption 2 (spec.md:790) to: "**Grace = 30 minutes** and is the 10-vs-5 boundary. It never rewrites `completed_at` ,  the recorded time is always the true time. Grace is also the sweep delay (§9), which is a separate, non-scoring use."

2. Replace the §7 table rows (spec.md:426-430) with bands that tile the whole timeline, leaving no gap:
   | Done at or before `due_at` | 10 |
   | Done after `due_at`, within `grace_minutes` | 10 |  ← or 5; pick one and say so
   | Done after `due_at + grace_minutes` | 5 |
  

---

### PARTIAL [medium] §7 ,  "locked at end of business day" is unimplementable, and the override has no columns

,  the two stated gaps are real, but the mechanism the finding blames is wrong.

CONFIRMED (a): no lock mechanism exists. spec.md:444 states "**Locked at end of business day.** No retroactive recalculation." as a hard rule, but §3.3 (spec.md:116-149) has no `locked_at`, no frozen `points`, and there is no locked-score table anywhere in §3 (spec.md:60-236). Nothing in §5's sweep job (spec.md:338) or §9.4 gates writes after business-day end. An implementer cannot build "locked" from this spec ,  the rule is asserted with no enforcement point.

CONFIRMED (b): the override has no home and no clear referent. spec.md:454 "Manager override with a logged reason" sits in §7's Scoring rules list, implying a score override, yet there is no `score_override`/`override_reason`/`overridden_by` column anywhere. It may instead mean the closer override (spec.md:407-409, decisions.md:100, assumption 7 at spec.md:798), which does have a home (`accountable_employee_id`, spec.md:137) and whose "logged" is satisfiable by the existing `logAuditEvent`. The defect is the ambiguity plus the missing columns if a score override is genuinely intended.

REFUTED (c): "Every read recomputes from live data" and "any edit to `checklist_settings.grace_minutes` ... silently rewrites past scores" is not supported. Scoring inputs are already frozen on the instance row: `was_late boolean` (spec.md:140) and `state` (spec.md:134-135) are stored columns, and §7's table (spec.md:427-431) maps 10/5/0 off state + lateness, with §13's `scoreInstances(instances)` (spec.md:718) taking instances rather than settings. Changing `grace_minutes` later therefore does not rewrite past `was_late` values. §9.4's "Aggregate in TypeScript, not SQL views or RPCs" (spec.md:575) governs aggregation, not input storage, so it does not force recomputation and does not conflict with a locked-score table. The proposed `checklist_daily_scores` table is therefore not required ,  the genuine residual exposure is narrower: manual accountable reassignment (spec.md:407-409) and post-hoc `skipped`/`not_applicable` state changes can still move an instance between denominators after the day closes, and nothing forbids it.

Severity lowered to medium: the fix is a small write-gate plus wording, not a new scoring subsystem.

**Applied:** 1. Add `locked_at timestamptz` to `checklist_task_instances` (§3.3), set by the existing `checklist_sweep_missed` sweep at business-day end + grace (spec.md:338). Gate every instance mutation server-side on `locked_at is null`. No new table and no frozen `points` column is needed ,  `state` and `was_late` are already stored, so scores are reproducible from the instance row.
2. Disambiguate spec.md:454. If it means the closer override, move the bullet out of §7 into §6 and say so explicitly (it already has `accountable_employee_id` + `logAuditEvent`). If a manager may genuinely amend a locked in

---

### CONFIRMED [high] §12 vs §7 ,  managers get the scores the spec says are superadmin-only

The spec contradicts itself and the contradiction is load-bearing. spec.md:451 states under Scoring: "**Superadmin-visible only** (decision 3 + the brief). Staff do not see scores." spec.md:672-673 grants the `manage` action to "manager, super_admin" for "setup, insights, spot checks". spec.md:561 gates the whole `/checklists/manage` screen ,  Insights and Problems tabs included ,  on `permission: { module: 'checklists', action: 'manage' }`, with no separate super_admin gate anywhere in §9.4. spec.md:674-676 only notes that super_admin *bypasses* permission rows (src/services/permission.ts:187 short-circuits on getCachedIsSuperAdmin) ,  it does not restrict anything to super_admin. `manager` is a real, independently assignable role in the RBAC system (src/types/rbac.ts defines Role/UserRole as DB-driven rows, not a fixed super_admin-only hierarchy), so granting `checklists:manage` to the manager role is sufficient to expose per-person completion scores. An implementer following §12 ships scores to managers; one following §7 does not. There is no third statement resolving it. The decisions.md source of truth does not settle it either: decision 3 (decisions.md:16) says only "no consequences", and decision 10 (decisions.md:23) says only Peter and Billy read manager@the-anchor.pub ,  neither says who may hold the `manager` RBAC role. Neither decisions.md nor spec.md states which roles Billy and Peter actually hold, so the ambiguity cannot be closed from the documents. Combined with decision 4 (decisions.md:17, staff not told they are scored) and the concealment risk decisions.md:76-89 explicitly flags, guessing wrong means a scored staff member with the manager role sees colleagues' scores ,  the exact failure decisions.md records as the residual risk.

**Applied:** Resolve the contradiction explicitly in §12 rather than leaving it to the implementer. Preferred: split the permission surface ,  keep `manage` (manager, super_admin) for Setup, Today and Spot checks, and gate the Insights and Problems tabs (and the server actions behind them, e.g. the per-person scoring aggregation) on an explicit `getCachedIsSuperAdmin` check in addition to `checkUserPermission`, since super_admin bypass alone cannot express "super_admin only". Add a route/tab-level note in §9.4 mirroring the §7 rule, and a Phase 3 test asserting a manager-role user gets no per-person figures

---

### CONFIRMED [high] §2 vs §3.2 vs §3.6 ,  todos are defined three different ways

All three definitions are present and mutually exclusive.

1. `tasks/checklists-discovery/spec.md:51` ,  glossary: "| **Todo** | A one-off task. Same table, no cadence. Not scored (decision 2). |". The preceding glossary rows are "Task template" (:45) and "Task instance" (:46), so "same table" reads as `checklist_task_templates`.
2. `spec.md:86` ,  inside §3.2 `checklist_task_templates` (block starts :75): `schedule_kind text not null check (schedule_kind in ('calendar','floating','todo'))`. A todo is a template row with `schedule_kind='todo'`.
3. `spec.md:196-203` ,  §3.6 defines a **separate** table `checklist_todos` with its own columns (`title, description, department, assigned_employee_id, due_date, state ('open'|'done'|'cancelled'), completed_by_employee_id, completed_at, notes, ...`).
4. `spec.md:285-287` ,  §4: "### `todo` ,  no cadence / One-off. `checklist_todos`." ,  i.e. §4 documents `todo` as a *cadence kind* but points the reader at the separate table.

The contradiction is load-bearing, not cosmetic:
- `spec.md:797` ,  assumption 6: "**Todos aren't scored** (decision 2) and don't generate instances." A `checklist_task_templates` row that never expands into a `checklist_task_instances` row is a template that isn't a template; that assumption only coheres if todos live in `checklist_todos`. Under reading (2) the expander needs an explicit `where schedule_kind <> 'todo'` guard that the spec never states.
- The two shapes carry different data. `checklist_todos` has `assigned_employee_id`, `due_date`, `state`, `notes`, `completed_by_employee_id` (:197-199). `checklist_task_templates` has none of those ,  it has `checklist_id not null` (:77), `freq`, `anchor`, `at_times`, `season_start/end` (:87-95), all meaningless for a one-off. A builder taking reading (2) has nowhere to put the assignee or the due date; a builder taking reading (3) writes a `CHECK` value no row can ever legally hold.
- §3.6's body is one line plus a comma-list of column names ,  no types, no nullability, no FKs, no `checklist_id`, no RLS/permission note, unlike every sibling section (§3.7 at :207-214 has the same problem but at least pins its CHECK values).

One clarification to the original finding: it cites "decision 2" as the todo decision, but `decisions.md:32` shows decision 2 is the **attribution model** ("No PIN… everyone currently clocked in… first person gets the credit"), and `decisions.md:62-63` lists its rejects as PIN-per-action and shift-level-only scoring. Nothing in `decisions.md` decides todo storage at all. So the spec's three-way split isn't a drafting slip against a settled decision ,  the decision was never taken, and the two "(decision 2)" citations at `spec.md:51`, `:196` and `:797` are mis-attributions that make an open question look closed.

**Applied:** Pick reading (3) ,  `checklist_todos` as its own table ,  since it's the only one consistent with assumption 6 and the only one that has somewhere to store `assigned_employee_id`/`due_date`/`state`. Then:

1. `spec.md:86` ,  drop `'todo'`: `schedule_kind text not null check (schedule_kind in ('calendar','floating'))`. It is unreachable once todos live elsewhere.
2. `spec.md:51` ,  glossary: "| **Todo** | A one-off, non-recurring task. Its own table (`checklist_todos`, §3.6) ,  not a task template, generates no instances, not scored. |"
3. `spec.md:285-287` ,  remove `todo` from §4 (§4 is the cadence

---


## Not individually verified

The remaining 64 raw findings were medium/low severity and were not put
through the refute pass. They are in `_raw-review.json`.
