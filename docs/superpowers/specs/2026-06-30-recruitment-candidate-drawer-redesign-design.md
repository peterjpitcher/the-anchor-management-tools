# Recruitment candidate drawer redesign — design

Date: 2026-06-30
Branch: `feat/recruitment-candidate-drawer-redesign`
Complexity: 4 (L) — phased into 3 independently-shippable PRs

## Problem

The recruitment candidate detail drawer (`RecruitmentDashboardClient.tsx`, ~lines 1282–1735)
surfaces only ~60% of what we hold about a candidate, and what it does show is
scattered across a 3-column scroll. Concretely:

- **The interview/trial date and time is not shown in the drawer at all.** The data
  (`recruitment_candidate_appointments.scheduled_start/end`) is even computed in the
  component (`selectedApplicationAppointments`, line 827) but never rendered. It only
  appears in the separate Schedule tab. This was the original user complaint.
- **The candidate's own answers** (`availability`, `cover_note`,
  `relevant_experience_answer`, `travel_answer`, `start_availability`) are captured on
  the application and never displayed anywhere.
- **Appointment outcomes and interview scorecards** are recorded but never surfaced on
  the candidate.
- **Full comms history, talent-pool / converted-employee status, and the candidate's
  other applications** live in other tabs or nowhere.
- **Right to work** (legally important) is buried as a field inside the edit form;
  **consents** are easy-to-miss checkboxes at the bottom of that form.
- Status management is fragmented (quick buttons + a manual dropdown); "send booking
  link" vs "schedule directly" read as two confusingly similar paths.

The user's requirement: *"make sure everything we have within the candidate profiles is
surfaced to the drawer UI so I'm not struggling to figure out how to find something."*

## Goals

- One drawer is the complete, findable home for a candidate. Nothing requires hopping to
  another tab to manage a candidate.
- Fix the original complaint: interview/trial date & time visible in the drawer.
- Surface data we already hold but never render.
- Group related things so each has exactly one obvious place.

## Non-goals (explicit decisions made during brainstorming)

- **Calendar sync stays as-is.** Interviews keep syncing to Microsoft Graph (Outlook)
  with the ICS email fallback. We are **not** moving recruitment onto Google Calendar in
  this work (private bookings use Google; recruitment uses Graph). The drawer will show
  the existing `calendar_sync_status` so staff know whether the invite went out. A future
  follow-up could add Google sync via the already-present `createInterviewEvent()`.
- No changes to auth/RBAC, the scheduling engine, or the email/ICS sending pipeline.
- No redesign of the other dashboard tabs (Pipeline, Applications, Postings, Schedule,
  Talent, Templates, Comms) beyond the small additions in Phase 3.

## Design — information architecture

A tabbed drawer with a persistent summary header. Reference mockup approved by the user.

### Persistent header (visible on every tab)
- Avatar/initials, candidate name, current status badge, AI score chip.
- Pills: right-to-work status, SMS consent, future-recruitment consent.
- Primary CTA = the current "next step" (the existing `nextActionHint`), so the next
  action is never hidden behind a tab.
- Document buttons: Open CV, Interview kit, Trial brief.

### Tab: Overview
- Contact (email, phone, location), source + applied date.
- **Their answers** (NEW): availability, relevant experience, travel, start availability,
  cover note.
- **AI assessment** grouped into one card: score, recommendation, rationale, strengths,
  concerns, CV profile (skills / recommended roles / role fit).
- **Right to work** promoted to its own prominent card.
- **Consent** card (SMS + future recruitment, with dates).

### Tab: Schedule
- Each appointment as a card: type, date/time (Europe/London), location, interviewer
  name, status, calendar-sync status, reminders sent, outcome.
- Inline quick-actions: Reschedule, Cancel, Record outcome + scorecard (user chose inline
  actions over jump-to-Schedule-tab).
- Booking-link status (sent / expiry), and schedule-from-open-slot forms.

### Tab: Comms
- Full per-candidate email + SMS history with delivery status and timestamps.
- AI draft buttons + the compose/send form.
- Reminders sent.

### Tab: Activity
- Status timeline (`recruitment_application_status_events`).
- AI runs audit (`recruitment_ai_runs`).

### Tab: Profile
- The candidate edit form (name, contact, location, right-to-work verify, consents, notes).
- Admin actions: re-score AI, create employee invite, archive/restore, erase (GDPR).
- **Other applications by this candidate** (NEW).
- **Talent-pool membership / converted-employee** status (NEW).

## Data plumbing — facts and required changes

Authoritative file/line references from discovery:

- Main component: `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx`
  - Drawer: ~1282–1735; pipeline kanban cards: ~1123–1157; stat cards: ~1045–1064.
  - `selectedApplicationAppointments` computed (never rendered): line 827.
  - `formatSlotDateTime` (Europe/London) exists at ~137–149; `formatDateTime`
    (browser timezone — to be replaced for appointment displays) at ~127–135.
  - `activeTab` is local `useState` (line 641); not URL-driven — stat-card click should
    call `setActiveTab('schedule')`.
- Dashboard data loader: `getRecruitmentPageData()` (`src/app/actions/recruitment.ts`)
  → `getRecruitmentDashboard()` (`src/services/recruitment.ts`, ~483–589).
  - Appointments query (~529–536): `status='scheduled'`, `gte scheduled_start now`,
    `.limit(10)`, joins candidate + application(job_posting) but **not** the supervisor.
- Types: `src/types/recruitment.ts` (`RecruitmentCandidateAppointment` ~248–278).
- `supervisor_staff_id` → `public.employees(employee_id)`; employee names are
  `first_name` / `last_name`.

Required backend/query changes:

1. **Interviewer name** — add an `employees(first_name, last_name)` embed on
   `supervisor_staff_id` to the appointments query so the drawer can show the interviewer.
2. **Raise the upcoming-appointments cap** from 10 to a safe ceiling (e.g. 200) so every
   candidate with an upcoming appointment is covered for the kanban badge and panel card.
3. **London timezone** — appointment date/time displays use the London formatter
   (`formatSlotDateTime` or `@/lib/dateUtils`), per project date rules. Also switch the
   existing Schedule-tab display (line ~2115) for consistency.
4. **Candidate answers** — verify the applications select includes `availability`,
   `cover_note`, `relevant_experience_answer`, `travel_answer`, `start_availability`;
   extend the select if missing.
5. **Scorecards** — load `recruitment_interview_scorecards` per appointment for the
   Schedule tab (new query; per-appointment).
6. **Other applications** — load this candidate's other applications by `candidate_id`
   for the Profile tab (new query).
7. **Talent-pool / conversion** — derive from `application.status === 'talent_pool'` and
   `candidate.converted_employee_id` (already on the candidate record).

Per-candidate data already loaded and rendered today (reuse as-is): `selectedApplicationEvents`,
`selectedApplicationAiRuns`, `selectedApplicationCommunications`. Verify the comms list is
complete (not truncated) when moved into the Comms tab.

## Phasing (each independently deployable)

**Phase 1 — Tabbed shell + surface already-loaded data (no/low backend change).**
Introduce the header + 5-tab structure inside the existing `Drawer`. Move current content
into the right tabs. Render the already-computed `selectedApplicationAppointments`
(date/time, type, status, calendar-sync) in the Schedule tab — fixes the original
complaint. Surface the candidate's answers, grouped AI assessment, the RTW header pill +
Overview card, and the consent card. Use the London formatter for dates.

**Phase 2 — Cross-tab data needing small queries.**
Interviewer-name join + raised cap; scorecards per appointment; other applications;
talent-pool / conversion status; ensure full comms history in the Comms tab. Verify the
applications select includes the candidate-answer fields.

**Phase 3 — Inline actions + at-a-glance surfacing.**
Inline Reschedule / Cancel / Record-outcome+scorecard in the Schedule tab (reusing the
existing server actions). Kanban "interview booked for X" badge on pipeline cards.
Make the "Upcoming interviews/trials" dashboard stat (and other href-bearing stat cards)
clickable via `setActiveTab`.

## Testing

- Vitest unit coverage for any new/extended service queries (mock Supabase), per
  `.claude/rules/testing.md`: happy path + at least one empty/error case for each new
  query (interviewer join, scorecards, other applications).
- Manual verification per phase via the preview workflow: open a candidate with an
  upcoming interview and confirm the date/time, interviewer, and sync status render; click
  through all five tabs; confirm permission-gated controls still hide for staff role.
- Keep `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` green at each phase.

## Risks / rollback

- The component is large (~2813 lines). Risk: regressions from re-parenting JSX into tabs.
  Mitigation: phase the work; keep server actions and existing forms untouched, only move
  their JSX; verify after each phase.
- Raising the appointments cap increases the payload slightly — bounded (upcoming only).
- Rollback: each phase is a separate commit/PR; revert the commit. No schema migrations are
  required (all changes are query selects + UI); nothing destructive.
