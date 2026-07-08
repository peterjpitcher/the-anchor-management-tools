# FOH outside toggle + website high-chair message — Implementation Plan

> Execute with `implement-plan`. Spec (authoritative change-map incl. all review corrections): [foh-outside-toggle-spec.md](foh-outside-toggle-spec.md). Two disjoint work streams in two repos → one wave, two agents.

**Goal:** (A) Replace the colliding virtual "Outside" swimlane with an Inside/Outside FOH view toggle + outside cards; (B) show a warm "high chairs unavailable" message on the-anchor.pub when a slot is full.

**Architecture:** Part A is AMS-only (schedule API returns `outside_bookings` instead of a fake lane; header toggle switches the timeline+unassigned view for an outside-cards view). Part B is a website booking-form copy/UI tweak. No DB change.

**Isolation:** each part in its own git worktree off `origin/main` (a parallel session has been active in the AMS tree). Agents edit in place; the orchestrator commits at the gate.

**Held for owner:** commit/merge is fine to do (owner allows direct merges), but the **website manual deploy** and final deploy verification are the release steps.

---

## Shared contracts (both agents / consumers must match)

```ts
// AMS: src/app/(authenticated)/table-bookings/foh/types.ts — FohScheduleResponse.data
outside_bookings?: FohBooking[]           // OPTIONAL — consumers read `?? []` (keeps fixtures compiling)

// AMS: view mode
type FohViewMode = 'inside' | 'outside'

// AMS: outside card → modal (mirror FohUnassignedBookings)
openBookingDetails(booking, { laneTableId: null, laneTableName: null })   // NOT 'Outside'

// AMS: outside sort key (route + cards)
start_datetime || booking_time || id

// Toggle label (one form): `Outside (N)`
```

---

## WAVE 1 — two parallel agents (disjoint repos)

### Task A — AMS FOH Inside/Outside toggle (worktree: AMS)
**Owns (edit/create only these):**
- `src/app/api/foh/schedule/route.ts`
- `src/app/(authenticated)/table-bookings/foh/types.ts`
- `src/app/(authenticated)/table-bookings/foh/components/FohHeader.tsx`
- `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
- `src/app/(authenticated)/table-bookings/foh/components/FohTimeline.tsx`
- **Create:** `src/app/(authenticated)/table-bookings/foh/components/FohOutsideBookings.tsx`
- **Tests:** a schedule-route regression test (new or existing `*.test.ts`); update any schedule fixtures with `outside_bookings: []` (or rely on the optional default).

Steps (per spec §3a–§3f, §5):
1. **Schedule API:** remove the `__outside__` virtual lane (`:838–850`); add `outside_bookings` to `data`, sorted `start_datetime || booking_time || id`. Indoor untabled stay in `unassigned_bookings`.
2. **Types:** `FohScheduleResponse.data` gains `outside_bookings?: FohBooking[]`.
3. **Header:** segmented `Inside | Outside (N)` between Food Order (`:225`) and Walk-in (`:237`); props `viewMode`/`outsideCount`/`onViewModeChange`; `aria-pressed`; **rendered independent of `canEdit`** (outside the action group); honour `manager_kiosk`.
4. **Client:** `viewMode` state (default `inside`); add `outside_bookings` to the totals unique-map (`~:114`) and the optimistic-update map (`:233`); pass `outsideCount = schedule?.outside_bookings?.length ?? 0`; **gate BOTH `FohUnassignedBookings` (`:340`) and `FohTimeline` behind `viewMode==='inside'`**, render `FohOutsideBookings` only when `outside`.
5. **FohOutsideBookings:** card list sorted by the shared key; each card = name, time (`formatBookingWindow`), party, **status pill via `getTableBookingStatusBadgeClasses(getBookingVisualState(booking))` + `getBookingVisualLabel(booking)`** (from `foh/utils.ts`), `High chair ×N` badge when `>0`; tap → `openBookingDetails(booking, { laneTableId: null, laneTableName: null })`; empty state; honour kiosk.
6. **Timeline:** delete the `__outside__` / `isOutsideLane` handling; keep the compact `BookingBadges` for indoor high-chair blocks.
7. **Regression test:** assert (a) no lane `table_id === '__outside__'`, (b) an outside booking lands in `outside_bookings`, (c) two time-overlapping outside bookings both appear in `outside_bookings`.

Verify (in the worktree): `npx tsc --noEmit`, `npx vitest run` on touched dirs. (Orchestrator runs the full cold pipeline at the gate.)

### Task B — Website high-chair-unavailable message (worktree: website)
**Owns (edit only):** `components/features/TableBooking/ManagementTableBookingForm.tsx` (repo `OJ-The-Anchor.pub`).

Steps (per spec Part B):
1. When `highChairMax === 0`, in the high-chair row (`:2395–2434`) hide the +/− stepper + count and render the warm message in its place:
   > "Sorry — all our high chairs are booked for this time. If you need one, please try another time slot; you're very welcome to book here without one."
   Keep the existing `text-xs text-ink-muted` styling (calm inline note, no alert block).
2. `highChairMax >= 1` and fail-open (`=== 2`) → unchanged.
3. **Scope guard:** do NOT touch the "I'd like an outside table" checkbox below (`:2436`) or anything else. No submit-logic change.

Verify (in the worktree): `npx tsc --noEmit`.

---

## Gate + verification (orchestrator)
- **Repo scope:** `git status` + diff every modified file against the ownership lists; revert strays.
- **Full pipeline, per repo:** `npm run lint` (0 warn) → `npx tsc --noEmit` → `npm test` (AMS) → **COLD build** `rm -rf .next && npm run build` (mandatory — a cached build masked a type error before; see `tasks/lessons.md`).
- **Adversarial review** (codex-qa-review) over the AMS diff (Part A has real logic — render switch, totals, optimistic update); Part B is copy-only (light/optional).
- Commit each repo (explicit file staging).

## Release
- **AMS:** push branch → `origin/main` (fast-forward); auto-deploys; **verify Ready + prod alias moved** (deploy-verify).
- **Website:** push branch → `origin/main`; then **manual `vercel --prod`** from the linked website dir; verify the-anchor.pub serves it.
- Remove both worktrees + delete branches.
