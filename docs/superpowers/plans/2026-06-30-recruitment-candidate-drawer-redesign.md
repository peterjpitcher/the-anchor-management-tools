# Recruitment candidate drawer redesign — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the recruitment candidate drawer the single, complete, findable home for a candidate — surfacing the interview date/time, the candidate's own answers, outcomes/scorecards, comms, right-to-work and consents that we hold but don't show — laid out as a tabbed drawer with a persistent summary header.

**Architecture:** Refactor the existing `Drawer` block inside `RecruitmentDashboardClient.tsx` into a persistent header + 5 tabs (Overview / Schedule / Comms / Activity / Profile), re-parenting existing JSX into the right tab and rendering already-loaded-but-unrendered data. Small service-query additions surface cross-tab data (interviewer name, scorecards, other applications). Calendar sync is unchanged (Graph/ICS). No schema migrations.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, `@/ds` design system, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-30-recruitment-candidate-drawer-redesign-design.md`

---

## File structure

- Modify: `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx`
  - Add a drawer tab state + a small `DrawerTabs` inline structure; re-parent the drawer
    JSX (~1282–1735) into tab panels; render `selectedApplicationAppointments`, candidate
    answers, grouped AI, RTW pill, consents; make stat cards clickable; add kanban badge.
  - Add/keep date helper usage (`formatSlotDateTime`, line 137) for appointment displays.
- Modify: `src/services/recruitment.ts`
  - `getRecruitmentDashboard()` appointments query (~529–536): add supervisor employee
    embed; raise `.limit(10)` → `.limit(200)`.
  - Add `getRecruitmentCandidateExtras(applicationId, candidateId)`: returns interview
    scorecards for the candidate's appointments + the candidate's other applications.
- Create: `src/services/__tests__/recruitment-drawer.test.ts` (Vitest) — covers the new
  query shapes with a mocked Supabase client.

---

## Phase 1 — Tabbed shell + surface already-loaded data

No backend change. Fixes the original complaint (interview date/time visible) and surfaces
candidate answers, grouped AI, RTW, consents.

### Task 1.1: Add drawer tab state

**Files:** Modify `RecruitmentDashboardClient.tsx` (near line 641 where `activeTab` is declared).

- [ ] **Step 1: Add state** — after the existing `activeTab` useState, add:

```tsx
const [drawerTab, setDrawerTab] = useState<'overview' | 'schedule' | 'comms' | 'activity' | 'profile'>('overview')
```

- [ ] **Step 2: Reset to overview when a new candidate opens** — find `openApplicationDetail`
(the handler that sets `selectedApplication` + `setDetailDrawerOpen(true)`) and add
`setDrawerTab('overview')` inside it so each candidate opens on Overview.

- [ ] **Step 3: Verify build** — Run: `npx tsc --noEmit`. Expected: clean (no usage yet).

### Task 1.2: Build the header + tab bar inside the Drawer

**Files:** Modify `RecruitmentDashboardClient.tsx` drawer (~1282–1334).

- [ ] **Step 1:** Read the current drawer opening JSX (1282–1334) to capture the exact
candidate/role/buttons markup to reuse.

- [ ] **Step 2:** Replace the top of the drawer body with a persistent header containing:
candidate name + status `Badge` + AI score chip; pills for right-to-work
(`selectedApplication.candidate?.right_to_work_status`), SMS consent, future consent; the
existing `nextActionHint` CTA; and the existing Open CV / Interview kit / Trial brief
buttons. Then a tab bar of 5 buttons calling `setDrawerTab(...)`, styled with the
`@/ds` patterns already used by `SectionNav`/tabs in this file (reuse the existing tab
styling approach — `border-b` active state). Each tab panel is
`{drawerTab === '<name>' && ( ... )}`.

- [ ] **Step 3: Verify** — Run: `npx tsc --noEmit` then `npm run lint`. Expected: clean.

### Task 1.3: Schedule tab — render the appointments (the core fix)

**Files:** Modify `RecruitmentDashboardClient.tsx`. Uses `selectedApplicationAppointments`
(already computed at line 827) and `formatSlotDateTime` (line 137).

- [ ] **Step 1:** In the Schedule tab panel, render each appointment as a card:

```tsx
{selectedApplicationAppointments.length === 0 && (
  <p className="text-sm text-text-muted">No interview or trial scheduled yet.</p>
)}
{selectedApplicationAppointments.map((apt: any) => (
  <div key={apt.id} className="space-y-1 rounded border border-border bg-surface-2 p-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-text-strong">
        {apt.type === 'trial_shift' ? 'Trial shift' : 'Interview'}
      </span>
      <Badge tone="secondary">{String(apt.status).replaceAll('_', ' ')}</Badge>
    </div>
    <p className="text-sm text-text">{formatSlotDateTime(apt.scheduled_start)}</p>
    <p className="text-xs text-text-muted">
      {apt.location || 'The Anchor'}
      {apt.calendar_sync_status ? ` · Calendar: ${calendarSyncLabel(apt.calendar_sync_status)}` : ''}
    </p>
    {apt.outcome && <p className="text-xs text-text-muted">Outcome: {apt.outcome}</p>}
  </div>
))}
```

- [ ] **Step 2:** Add a small helper near the other formatters (top of file):

```tsx
function calendarSyncLabel(status: string | null | undefined) {
  switch (status) {
    case 'synced': return 'synced'
    case 'ics_fallback': return 'email invite only'
    case 'failed': return 'sync failed'
    case 'pending': return 'syncing…'
    default: return status || 'not synced'
  }
}
```

- [ ] **Step 3:** Move the existing "Booking links", "Schedule interview for candidate" and
"Schedule trial shift for candidate" forms (currently ~1373–1483) into this Schedule tab
panel (cut/paste the JSX unchanged; they keep their existing server actions).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npm run lint`. Expected: clean.

### Task 1.4: Overview tab — contact, their answers, grouped AI, RTW, consents

**Files:** Modify `RecruitmentDashboardClient.tsx`.

- [ ] **Step 1:** In the Overview panel, keep the contact + role blocks. Add a
"Their answers" block (only render rows that have a value):

```tsx
{(() => {
  const a = selectedApplication
  const rows: Array<[string, string | null | undefined]> = [
    ['Availability', typeof a?.availability === 'string' ? a.availability : a?.availability ? JSON.stringify(a.availability) : null],
    ['Experience', a?.relevant_experience_answer],
    ['Travel', a?.travel_answer],
    ['Can start', a?.start_availability],
    ['Cover note', a?.cover_note],
  ].filter(([, v]) => Boolean(v))
  if (rows.length === 0) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-text-muted">Their answers</p>
      <dl className="mt-1 space-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label}><span className="text-text-muted">{label}:</span> {value}</div>
        ))}
      </dl>
    </div>
  )
})()}
```

- [ ] **Step 2:** Move the AI score/rationale/strengths/concerns/CV-profile JSX
(currently ~1530–1577) into the Overview panel, grouped under one "AI assessment" heading.

- [ ] **Step 3:** Add a prominent Right-to-work card and a Consent card in Overview reading
from `selectedApplication.candidate` (`right_to_work_status`, `right_to_work_document_type`,
`right_to_work_checked_at`, `sms_consent`, `sms_consent_at`, `future_recruitment_consent`,
`future_recruitment_consent_at`). Read-only display here; editing stays in Profile.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npm run lint`. Expected: clean.

### Task 1.5: Comms / Activity / Profile tabs — re-parent existing JSX

**Files:** Modify `RecruitmentDashboardClient.tsx`.

- [ ] **Step 1:** Move the email composer + send form (~1653–1690) and the
`selectedApplicationCommunications` list (currently in the audit block ~1702–1735) into the
Comms panel.
- [ ] **Step 2:** Move the Timeline (`selectedApplicationEvents`, ~1692–1701) and the AI runs
(`selectedApplicationAiRuns`) into the Activity panel.
- [ ] **Step 3:** Move the candidate edit form (~1578–1652) and the admin actions
(re-score, create employee invite, archive/restore, erase) into the Profile panel.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` + `npm run lint` + `npm run build`.
Expected: all clean.

### Task 1.6: Manual verification + commit

- [ ] **Step 1:** Start the dev server (preview), open a candidate with an upcoming
interview, confirm: header shows status/AI/RTW/consent pills + next-step CTA; Schedule tab
shows the date/time (London) and calendar status; all 5 tabs switch; staff-role hiding of
gated controls is unchanged.
- [ ] **Step 2: Commit:**

```bash
git add src/app/\(authenticated\)/recruitment/_components/RecruitmentDashboardClient.tsx
git commit -m "feat(recruitment): tabbed candidate drawer — surface schedule, answers, RTW, consents"
```

---

## Phase 2 — Cross-tab data needing small queries

### Task 2.1: Appointments query — interviewer name + raise cap (TDD)

**Files:** Modify `src/services/recruitment.ts` (~529–536). Test:
`src/services/__tests__/recruitment-drawer.test.ts`.

- [ ] **Step 1: Write failing test** — a Vitest test that mocks the Supabase builder and
asserts `getRecruitmentDashboard` requests the supervisor embed and a limit > 10. Mock
`createAdminClient` to capture the `.select(...)` string and `.limit(n)` for the
appointments query, returning `{ data: [], error: null }` for all eight queries.

```ts
import { describe, it, expect, vi } from 'vitest'

it('embeds supervisor and raises appointment cap', async () => {
  const calls: { select: string[]; limit: number[] } = { select: [], limit: [] }
  const makeBuilder = () => {
    const b: any = {}
    for (const m of ['select','is','eq','gte','lt','in','not','order']) b[m] = vi.fn(() => b)
    b.select = vi.fn((s: string) => { calls.select.push(s); return b })
    b.limit = vi.fn((n: number) => { calls.limit.push(n); return Promise.resolve({ data: [], error: null, count: 0 }) })
    b.order = vi.fn(() => b)
    return b
  }
  const supabase: any = { from: vi.fn(() => makeBuilder()) }
  const { getRecruitmentDashboard } = await import('../recruitment')
  await getRecruitmentDashboard(supabase)
  const apptSelect = calls.select.find(s => s.includes('recruitment_candidate_appointments') || s.includes('scheduled')) ?? calls.select.join(' ')
  expect(calls.select.some(s => s.includes('supervisor'))).toBe(true)
  expect(Math.max(...calls.limit)).toBeGreaterThan(10)
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/services/__tests__/recruitment-drawer.test.ts`.

- [ ] **Step 3: Implement** — change the appointments select to add the supervisor embed and
raise the limit:

```ts
.select('*, candidate:recruitment_candidates(first_name,last_name,email), application:recruitment_applications(id, status, job_posting:recruitment_job_postings(title)), supervisor:employees!supervisor_staff_id(first_name,last_name)')
...
.limit(200),
```

(If the embed alias `employees!supervisor_staff_id` errors against the live relationship,
fall back to `supervisor:employees(first_name,last_name)`; verify against the live schema
with the Supabase MCP before finalising.)

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5:** In `RecruitmentDashboardClient.tsx` Schedule tab, render the interviewer:
`{apt.supervisor && <span> · Interviewer: {apt.supervisor.first_name} {apt.supervisor.last_name}</span>}`.

- [ ] **Step 6: Commit:**

```bash
git add src/services/recruitment.ts src/services/__tests__/recruitment-drawer.test.ts src/app/\(authenticated\)/recruitment/_components/RecruitmentDashboardClient.tsx
git commit -m "feat(recruitment): show interviewer name + cover all upcoming appointments"
```

### Task 2.2: Candidate extras — scorecards + other applications (TDD)

**Files:** Add `getRecruitmentCandidateExtras` to `src/services/recruitment.ts`; wire into
`getRecruitmentPageData` (`src/app/actions/recruitment.ts`) so the drawer receives
`scorecardsByAppointment` and `otherApplications` for the selected candidate. Test in the
same Vitest file.

- [ ] **Step 1: Write failing test** asserting the function queries
`recruitment_interview_scorecards` by `candidate_id` and `recruitment_applications` by
`candidate_id` excluding the current `application_id`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the function (two `Promise.all` queries; map scorecards by
`appointment_id`). Return `{ scorecards, otherApplications }`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5:** Render scorecard summary in the Schedule tab (overall rating +
recommendation + comments per appointment) and "Other applications by this candidate" +
talent-pool/conversion status in the Profile tab (derive from
`candidate.converted_employee_id` and `application.status === 'talent_pool'`).
- [ ] **Step 6: Verify** `npm run lint` + `npx tsc --noEmit` + `npm test` + `npm run build`. Commit.

---

## Phase 3 — Inline actions + at-a-glance surfacing

### Task 3.1: Inline reschedule / cancel / record-outcome in Schedule tab

**Files:** Modify `RecruitmentDashboardClient.tsx`. Reuse existing actions already imported:
`rescheduleRecruitmentAppointmentAction`, `cancelRecruitmentAppointmentAction`,
`recordRecruitmentAppointmentOutcomeAction`, `recordRecruitmentScorecardAction`.

- [ ] **Step 1:** Read the existing Schedule-tab appointment drawer (~2203–2270) to reuse
its exact outcome/scorecard form markup and action wiring.
- [ ] **Step 2:** Add, per appointment card: a Reschedule control (slot select +
`rescheduleRecruitmentAppointmentAction`), a Cancel control (ConfirmDialog +
`cancelRecruitmentAppointmentAction`), and a Record-outcome form (status, rating, meal,
notes via `recordRecruitmentAppointmentOutcomeAction`; scorecard via
`recordRecruitmentScorecardAction`) — gated on `permissions.canEdit`/`canManage`.
- [ ] **Step 3: Verify** lint/types/build. Commit.

### Task 3.2: Kanban "interview booked" badge

**Files:** Modify `RecruitmentDashboardClient.tsx` pipeline cards (~1123–1157).

- [ ] **Step 1:** Inside the card map, compute the next appointment for that application:

```tsx
const nextAppt = appointments.find((ap: any) => ap.application_id === application.id)
```

- [ ] **Step 2:** Render a small badge after the score badge when `nextAppt` exists:

```tsx
{nextAppt && (
  <span className="truncate text-xs text-text-muted">
    <ClockIcon className="inline h-3 w-3" /> {nextAppt.type === 'trial_shift' ? 'Trial' : 'Interview'} {formatSlotDateTime(nextAppt.scheduled_start)}
  </span>
)}
```

- [ ] **Step 3: Verify** lint/types/build. Commit.

### Task 3.3: Clickable dashboard stat cards

**Files:** Modify `RecruitmentDashboardClient.tsx` stat cards (~1045–1064).

- [ ] **Step 1:** Make each stat card with an `item.href` clickable. For the `appointments`
item, call `setActiveTab('schedule')`; for others, map their `href` query intent to the
existing in-app filters (or `router.push(item.href)` using the already-imported
`useRouter`). Wrap the `Card` in a `button`/`onClick`; add `aria-label`.
- [ ] **Step 2: Verify** lint/types/build. Commit.

---

## Self-review notes

- Spec coverage: every spec item maps to a task — interview date/time (1.3), candidate
  answers (1.4), grouped AI (1.4), RTW/consents (1.4), comms/activity/profile re-parent
  (1.5), interviewer name + cap (2.1), scorecards/other-apps/talent (2.2), inline actions
  (3.1), kanban badge (3.2), clickable stat (3.3), London tz (1.3 helper), calendar status
  (1.3). Calendar sync intentionally unchanged (non-goal).
- Placeholder scan: query embed alias for the supervisor join is the one runtime unknown —
  Task 2.1 Step 3 names the exact fallback and says to verify against live schema before
  finalising.
- Type consistency: `drawerTab` union, `calendarSyncLabel`, `formatSlotDateTime` reused
  consistently across tasks.
