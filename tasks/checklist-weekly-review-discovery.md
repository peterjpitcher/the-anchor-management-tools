# Discovery: Weekly checklist review / verification

Owner ask: "Where can I see what was done on previous days? I need to review a full week in one view for what was done and not done, so we can follow up with an employee when things are missed."

Status: discovery only. No code. Findings verified against the live repo and prod DB (2 mapping agents failed structured output; conclusions below are re-verified by hand, not taken from the failed synthesis).

**Developer review (2026-07-20):** a second-dev review is at `tasks/checklist-weekly-review-discovery-review.md` (29 findings, 5 P0). It is accepted as largely correct. Factual corrections have been folded in below (F01 Problems capability, F17/F23 row volume, F22 seed drift). The remaining findings are (a) developer-level spec detail to be written once decisions are made, and (b) ~5 product/security decisions for the owner (see "Open decisions" at the foot of this note). This document stays as discovery; it becomes an implementable spec only after the owner decisions below are answered.

Owner decisions blocking the spec: (1) improve Problems (add missed-task-and-date detail), build the positive weekly grid, or both; (2) do columns mean the task's due day or the day work was actually done; (3) super-admin only or managers too (and if managers, all departments or only theirs); (4) does v1 just identify follow-ups or must it track/assign/close them; (5) week starts Monday (recommended) or Sunday. My recommendations: (1) both, Problems detail first as it is smaller; (2) due day, with actual completion time shown on drill-down; (3) super-admin only for v1; (4) identify only for v1; (5) Monday.

## 1. What already exists (and the owner may not know)

The checklists manage area (`/checklists/manage`) already has SIX tabs, not two. Source: `src/app/(authenticated)/checklists/manage/_components/ManageNav.tsx:6-13`.

- **Setup** - templates.
- **Today** (`/checklists/manage/today`) - today's board for a manager.
- **Insights** (`/checklists/manage/insights`) - aggregated completion metrics over a date range. Super-admin only (`checklists-insights.ts:172` `requireSuperAdmin`).
- **Spot checks** - oversight draws.
- **Problems** (`/checklists/manage/problems`) - over ANY date range, super-admin only. Backed by `getChecklistProblems(from, to)` (`checklists-spotcheck.ts:365`). **Correction after developer review (F01):** the missed query selects only `business_date, slot` (`:380`) and the UI renders "Missed, by closer" (`ProblemsClient.tsx:40,56`). So it shows a **count of missed tasks per rostered closer**, NOT which task was missed or on which day. Alongside that it lists the specific exceptions:
  1. **Miss count per closer** (floating/anytime -> "Venue"). `:376-414`.
  2. **Value breaches** (a reading logged but out of range, e.g. cellar temp). `:416-427`.
  3. **Trading-hours mismatches**. `:429-438`.
  4. **Failed spot checks**. `:440-450`.
  5. **Drawn-but-unrecorded spot checks** (the "nobody walked the floor" signal). `:452+`.
- **Todos** - ad-hoc one-off todos.

So Problems answers "who has misses and how many, plus the specific breaches/failed checks", but NOT "which task was missed on which day". First action: look at it before building anything.

## 2. The genuine gap

Problems is an **exceptions list** (only what went wrong). The owner also asked to see "what was done AND not done... in one view" - a **positive at-a-glance grid**: every task x every day of the week, showing done / missed / skipped / still-pending at once, so you can scan a green wall and spot the gaps. That grid does not exist. That is the net-new piece.

## 3. Recommended shape for the new bit

A read-only **weekly grid**, tasks as rows, the 7 days as columns, grouped by slot (Opening / Closing) then department, with a fourth group for periodic/floating tasks. Each cell is one of the real states with an icon + initials (never colour alone), tap/hover for name + time + any recorded value:

- **done** - tick + completer initials (+ a warning marker if `value_breach` or a failed spot check, so a "green tick" never hides a problem).
- **missed** - cross, plus who was accountable (reuse the closer-resolution from Problems).
- **skipped** / **not_applicable** - muted, with reason on hover (these are two distinct states, not one).
- **pending** - task due that day but not yet actioned or not yet swept to missed (see 4.4). Must render honestly, especially for the current, in-progress day.
- **not scheduled** - blank muted cell (e.g. a Sunday-only task on a Tuesday).

Week nav: prev / this week / next, defaulting to the current London week. Filters: department, slot.

## 4. Technical realities that MUST be respected (these correct the first-pass plan)

1. **"missed" is a STORED state, not computed.** Instances are pre-generated per due-date; the daily sweep flips `pending -> missed` once `grace_until` passes. So you just read `checklist_task_instances` for the 7-day `business_date` range and read `state`. Do NOT cross-join templates against dates to infer absence (the first-pass plan had this backwards). Prod proof: the 21 close tasks on 2026-07-19 are real `missed` rows.
2. **Service-role client only.** `checklist_*` tables are RLS deny-all. Existing reads use `createAdminClient()` + an explicit permission check (`checklists-spotcheck.ts:374`). The cookie/anon client returns zero rows.
3. **Paginate (defensively).** Correction after review (F17/F23): only the **bar** department is active today, so a week is ~294 rows (42/day x 7), well under Supabase's 1000-row cap. The >1000 case is a FUTURE scenario (more departments / timed periodic tasks). Still paginate: follow the existing `fetchAllRows()` pattern in Problems/Insights (note it is a **private** helper in each action file, not yet shared, so either copy the pattern or extract a small shared checklist-scoped helper).
4. **Business day is 06:00 -> 06:00 London, not midnight**, and today's rows only exist after the ~04:00-06:00 generation window. "Missed" only materialises at the next daily sweep, so mid-week the current/recent day legitimately shows many `pending` cells that are effectively-but-not-yet missed. Signal which days are final (locked) vs still settling; do not silently show pending as done or missed.
5. **State enum is 5 values**: `pending | done | missed | skipped | not_applicable` (`src/lib/checklists/... checklists.ts`). Handle all five.
6. **Periodic / weekly / floating tasks** (e.g. the "Spray pool table") are `slot='anytime'`, venue-level, and due on some days only. They must have a home in the grid and must NOT read as six misses across the six not-due days. NOTE: prod was changed to **Sunday** this session, but the seed migration (`20260731000100_seed_bar_checklist.sql:156`) still says **Monday** (`ARRAY[1]`). That is a data-vs-source drift to fix separately (capture the Mon->Sun change as a migration), independent of this feature.
7. **Value tasks and spot-check failures** must be visible, or the grid hides exactly the problems it is meant to surface.
8. **Employee name resolution** must not filter on active status (people who have left still need initials) and must handle a null/removed employee gracefully.

## 5. Open decisions (owner)

1. **Is the existing Problems tab enough?** Recommendation: look at it first. It may cover the follow-up need; if so, the only add is the positive grid for reassurance/scanning.
2. **Do you want the positive weekly grid too?** Recommendation: yes, as a new "Weekly review" tab, because Problems does not show the all-green picture.
3. **Access level: super-admin (like Insights/Problems) or open to managers?** Recommendation: match the existing bar - super-admin - because the grid is individual-attributable; loosen later if you want shift leads to self-check.
4. **New tab vs enhance Problems?** Recommendation: new tab "Weekly review"; keep Problems as the exceptions feed.
5. **Week start Monday or Sunday?** Recommendation: Monday-Sunday.
6. **Retro-tick a missed task?** Recommendation: no for v1 (locked rows hard-block edits anyway); if wanted, a separate audited action.
7. **CSV export?** Recommendation: Phase 2.

## 6. Effort and risk

- Complexity: **2-3 (S-M)**. New route + client grid component + one read action + one ManageNav entry + types. ~300-450 lines. **No migration** (read-only over existing data).
- Main risk: rendering the current in-progress day and periodic tasks honestly (pending vs missed vs not-due), and not hiding breaches/spot-check fails behind a green tick. Verify against a real week before shipping. Reproduce date logic with `TZ=UTC` (this codebase has prior London-vs-UTC bugs; weekday is `getUTCDay`, Sun=0).

## 7. Phasing

- **MVP**: read-only weekly grid (tasks x 7 days), real 5 states, breach/spot-check markers, week nav, department + slot filters, super-admin gated, admin client + pagination.
- **Phase 2**: CSV export; per-employee pivot/filter.
- **Phase 3**: flag-for-follow-up workflow (a mutation; needs audit + contends with locked rows).
