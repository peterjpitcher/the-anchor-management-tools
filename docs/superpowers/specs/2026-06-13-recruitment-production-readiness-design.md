# Recruitment — Production-Readiness Gap Spec

- **Date:** 2026-06-13
- **Author:** Peter Pitcher (with Claude)
- **Status:** Reviewed and updated against current code
- **Section:** `/recruitment` (internal ATS dashboard)
- **Predecessor specs:** [`2026-06-07-recruitment-section-design.md`](2026-06-07-recruitment-section-design.md), [`2026-06-07-recruitment-ats-implementation.md`](2026-06-07-recruitment-ats-implementation.md)

---

## 1. Purpose

The recruitment ATS shipped on 2026-06-07 against a comprehensive design. This spec is a **gap analysis of the live implementation** against that design plus normal production-readiness standards. It inventories everything missing, mis-built, or unfinished, prioritised into independently-deployable phases.

It is a **prioritised gap inventory**, not a per-feature deep design. Each phase becomes its own implementation plan (via writing-plans) when scheduled.

### Gap classes

Every gap is tagged with how it arose:

- **[Divergence]** — the build diverged from the agreed 2026-06-07 design. Highest concern: these are regressions from a signed-off contract.
- **[Unfinished]** — designed but not built (or only the data layer was built).
- **[New]** — net-new production-readiness scope, not in the original v1 design.
- **[Cleanup]** — dormant schema/data to use or retire.

---

## 2. Current state (verified)

A single route `/recruitment` with 5 tabs — **Applications, Postings, Schedule, Talent pool, Comms** — over 9 tables:

`recruitment_job_postings`, `recruitment_candidates`, `recruitment_applications`, `recruitment_application_status_events`, `recruitment_ai_runs`, `recruitment_appointment_slots`, `recruitment_candidate_appointments`, `recruitment_email_templates`, `recruitment_communications`.

**What works well today** (do not re-spec):

- Create/edit job postings; duplicate posting; public postings API with application closing-date filtering; public application API rejects closed/expired postings.
- Manual + public (website) application intake with idempotency, rate limiting, CAPTCHA, dedup (email/phone/CV hash).
- AI CV extraction, scoring, recommendation, re-score, email drafting; full `recruitment_ai_runs` audit trail.
- Candidate self-service booking via token (preview slots, claim, **reschedule, cancel**) with Graph calendar sync + `.ics` fallback.
- Application status transitions written transactionally with an append-only `recruitment_application_status_events` trail.
- Talent-pool matching, candidate erasure (GDPR anonymise), hire→employee handoff.
- Email (templated) + SMS sends, manager alerts, idempotent receipt emails.
- **Four background crons wired in `vercel.json`:** `recruitment-reminders`, `recruitment-calendar-retry`, `recruitment-ai-sweep`, `recruitment-retention`.

**Key reference files:**

- UI: `src/app/(authenticated)/recruitment/page.tsx`, `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx`
- Actions: `src/app/actions/recruitment.ts`
- Services/logic: `src/services/recruitment.ts`, `src/lib/recruitment/{ai,communications,calendar,files}.ts`
- Types: `src/types/recruitment.ts`, `src/types/database.recruitment.ts`
- Public API: `src/app/api/recruitment/{applications,postings}/route.ts`, `src/app/api/recruitment/booking/[token]/{route,reschedule,cancel}.ts`
- Crons: `src/app/api/cron/recruitment-*/route.ts`
- Schema: `supabase/migrations/20260707000000_recruitment_foundation.sql` and later `*recruitment*` migrations

---

## 3. Scope & non-goals

**In scope:** the internal `/recruitment` dashboard, its server actions, services, and data model. The public intake form and candidate booking pages are touched only where they block internal work (e.g. staff reschedule reuses booking logic).

**Out of scope** (carried over from the v1 design's non-goals, unchanged): inbound mailbox ingestion / two-way recruitment inbox, OCR for scanned CVs, rota integration for trial shifts, multi-venue/multi-brand recruitment, fully automated reject/advance/hire decisions, multi-capacity slots, AV scanning.

---

## 4. Design principles

1. **Delete = archive + restore.** No hard deletes by default. The section is audit- and GDPR-sensitive (status events are an immutable trail; candidates are *erased*, not deleted). True hard delete stays super-admin-only behind a confirmation dialog, per workspace ethics rules.
2. **Every mutation is permission-checked and audited.** Granular `checkUserPermission('recruitment', …)` server-side + `logAuditEvent()` on success/failure. This cannot rely on RLS alone because most recruitment services use the service-role admin client.
3. **No new AI model/prompt work.** Only surface outputs that already exist.
4. **Each phase is independently deployable** with no broken intermediate state, per the project's incremental-PR rules.
5. **Follow existing patterns** — server actions returning `{ success?, error? }`, `fromDb`-style mapping, design-system components from `@/ds`.

### Critical implementation risks

- **Service-role bypass:** `createAdminClient()` bypasses RLS, so all staff-facing server actions must check permissions before calling service functions. Treat RLS as defence-in-depth, not the primary guard.
- **RPC actor context:** current recruitment RPCs are called through the service-role client, so `auth.uid()` may be null inside the database function. Any RPC that needs to know the staff user must receive `p_actor_user_id` from a permission-checked server action.
- **Side effects must be idempotent:** email, SMS, calendar sync, booking links, and duplicate applications already use idempotency patterns. Preserve those keys when adding retry/resend/bulk actions.
- **Public API and dashboard must stay aligned:** posting status, `is_public`, and `application_closing_date` affect both the internal UI and the public website API. Any future posting change must update both.
- **Do not mutate audit trails:** `recruitment_communications`, `recruitment_application_status_events`, and `recruitment_ai_runs` should be append-only/redacted, not archived or edited.

---

## 5. Phase 1 — Platform foundations (P1, prerequisites)

These are mostly **[Divergence]** gaps — the platform behaves differently from the agreed design — and they are prerequisites for safely adding more mutations.

### 1.1 Real RBAC — replace super-admin-only gate and fake UI permissions  `[Divergence]`

- **Current:** `requireRecruitmentUser()` (`src/app/actions/recruitment.ts:52`) throws unless the user has `super_admin`, and is used in ~25 actions. `page.tsx:20` hardcodes `permissions={{ canCreate, canEdit, canManage, canSend, canDelete: true }}`. The `recruitment` permission actions (view/create/edit/delete/manage) exist in RLS and in the design's role seeding, but the app layer ignores them.
- **Why it matters:** Managers and staff cannot use recruitment at all — every action throws for non-super-admins. This contradicts the 2026-06-07 design (manager = view/create/edit/manage/send; delete = super-admin). It is the single biggest blocker to the section being usable.
- **Proposed fix:**
  - Replace `requireRecruitmentUser()` with a `requireRecruitmentPermission(action)` helper that resolves the authenticated user once, calls `checkUserPermission('recruitment', action, user.id)`, and throws a typed error on failure. Map each action to the correct scope (e.g. status transition → `edit`; erase/archive → `delete`; re-score/retention/match → `manage`; email/SMS send → `send`).
  - Load real permissions in `page.tsx` via the project permission helper and pass them down; gate every UI control on the real flag.
  - Keep page-level access separate from mutation permissions: `view` controls access to `/recruitment`; create/edit/manage/send/delete control the individual controls.
  - Keep `delete`/erase/hard-delete restricted to super-admin where the design requires.
- **Acceptance criteria:**
  - A user with `recruitment.view` only sees a read-only dashboard (no create/edit/delete/send controls) and every mutating action rejects server-side.
  - A user with `recruitment.edit` can change status and edit records but cannot archive/erase/hard-delete.
  - A super-admin retains full access.
  - No `permissions={{…true}}` literal remains in `page.tsx`.
  - Unit tests cover a view-only user and a user with `edit` but not `send/delete`.

### 1.2 Central audit logging on every mutation  `[Divergence / standard]`

- **Current:** Posting creation and posting duplication call `logAuditEvent()`. Status transitions, appointment outcomes, slot creation, candidate update/erase, comms sends, hire handoff, posting update, CV retry, and retention runs do not consistently write to the central `audit_logs`. (Domain trails `recruitment_application_status_events` and `recruitment_ai_runs` exist and work, but are recruitment-local.)
- **Why it matters:** Workspace standard (`.claude/rules/supabase.md`) requires `logAuditEvent()` on all create/update/delete in server actions. Without it, recruitment mutations are invisible to cross-module security/audit review, and erase/anonymise (a GDPR action) has no central record.
- **Proposed fix:** Add a small wrapper/helper for recruitment server actions so `logAuditEvent({ resource_type: 'recruitment_*', operation_type, operation_status })` is written on success and failure. Keep the domain trails as-is.
- **Acceptance criteria:** Every recruitment mutation produces exactly one `audit_logs` row; erase and hard-delete are always logged; a failed mutation logs `operation_status: 'failure'`; tests assert representative success/failure logging for create, update, send, erase, and retention.

### 1.3 Application status state-machine enforcement  `[Divergence]`

- **Current:** `recruitment_transition_application_status()` writes the transition + event transactionally but performs **no validation** — any status → any status is allowed (verified: no transition guard in any `*recruitment*` migration). The design specified an explicit path.
- **Why it matters:** Illegal transitions (e.g. `hired → new`, `rejected → offered`) corrupt the pipeline, skew reporting, and can re-trigger comms. Data integrity gap.
- **Proposed fix:** Define the allowed-transition map in TypeScript and enforce it in the `recruitment_transition_application_status()` RPC or a new guarded RPC. The DB guard is important because several service paths call the RPC directly. If the RPC needs actor details, pass `p_actor_user_id`; do not rely on `auth.uid()` when the server action uses `createAdminClient()`. Reject illegal transitions with a clear error before the write. Allow terminal/override transitions (withdrawn, on_hold, talent_pool, declined_duplicate) from the appropriate states. Provide a super-admin "force status" override that is explicitly logged.
- **Acceptance criteria:** Attempting an illegal transition returns a descriptive error and writes nothing; every legal transition still succeeds; the allowed map is unit-tested (happy path + at least one illegal jump).

### 1.4 Archive / soft-delete + restore infrastructure  `[New]`

- **Current:** Nothing can be hidden from default staff lists except candidate erase (anonymise), duplicate application suppression, posting `archived` status, and candidate-initiated appointment cancel. There is still no consistent archive/restore model for stray applications, mistaken slots, appointments, or old postings.
- **Why it matters:** Staff accumulate test/duplicate/mistaken records with no way to clear them; the only "fix" today is direct DB access.
- **Proposed fix:**
  - Add `archived_at timestamptz` + `archived_by uuid` to `recruitment_applications`, `recruitment_appointment_slots`, and `recruitment_candidate_appointments`. For job postings, either use the existing `status = archived` as the archive mechanism or add the same columns; do not keep two competing archive states.
  - **Not archivable by design:** email templates retire via `is_active` (see 2.1); `recruitment_communications`, `recruitment_application_status_events`, and `recruitment_ai_runs` are immutable send/audit trails and must stay intact for compliance.
  - Add `archive` + `restore` server actions per archivable entity (permission: `delete`), and filter archived records from default lists with a "Show archived" toggle. Keep `declined_duplicate` and `duplicate_of_application_id` excluded from normal application views unless the toggle explicitly includes them.
  - Hard delete: super-admin-only, confirmation dialog, cascade-aware, always audited. Candidate removal continues to use erase/anonymise, not hard delete.
- **Acceptance criteria:** Each archivable entity can be archived and restored from the UI by a `delete`-permission user; archived records are hidden by default and shown via toggle; immutable trails cannot be archived; hard delete is reachable only by super-admin behind a confirm dialog and is audited; all dashboard counts ignore archived records by default.

---

## 6. Phase 2 — Feature completeness (P2)

### 2.1 Email-template management UI  `[Unfinished]`

- **Current:** `recruitment_email_templates` (9 types: `interview_invite`, `rejection`, `already_considered`, `trial_invite`, `offer`, `interview_confirmation`, `trial_confirmation`, `reminder`, `manager_alert`) exists and is seeded by migration. There is **no in-app way** to view, edit, activate/deactivate, or preview templates.
- **Why it matters:** Changing any wording requires a migration + deploy. Managers can't tune tone or fix a typo. The design assumed editable templates.
- **Proposed fix:** A "Templates" surface (new tab or settings sub-page): list by type, edit subject/body, toggle `is_active` (respecting the unique-active-per-type index), live preview with sample merge data, and deterministic merge-field validation. The current placeholder validation is private to `src/lib/recruitment/communications.ts`; extract/share it rather than duplicating regex logic. All edits permission-gated (`manage`) and audited.
- **Acceptance criteria:** A manager edits the `rejection` subject/body, saves, and the next rejection email uses the new copy; activating a template deactivates the previously active one of that type; invalid merge fields are rejected before save.

### 2.2 Appointment slot management — edit / cancel / archive  `[New / partial]`

- **Current:** Slots can be created and claimed; status can become `cancelled`, but there is no UI to edit a slot's time/location/interviewer, and no staff control to cancel a slot (especially a booked one) with candidate notification.
- **Why it matters:** A mistyped slot time or a double-booked interviewer can only be fixed in the DB today.
- **Proposed fix:** Edit action for open slots (time/location/interviewer/timezone); cancel action that, for a booked slot, notifies the affected candidate and releases/cancels their appointment; archive for old slots. Calendar re-syncs on change. Prevent editing/cancelling past slots except archive.
- **Acceptance criteria:** Editing an open slot updates the schedule; cancelling a booked slot cancels the candidate's appointment, notifies them, and removes the calendar event; all actions are permission-gated and audited.

### 2.3 Staff-side appointment reschedule / cancel  `[Divergence]`

- **Current:** Reschedule/cancel exist **only** as public token API routes (`booking/[token]/reschedule`, `…/cancel`). There is no server action and no dashboard control for staff (verified). Staff can only record an outcome. The design (§9.5) stated managers can reschedule/cancel.
- **Why it matters:** If a candidate phones to rearrange, staff cannot action it from the dashboard.
- **Proposed fix:** Add `rescheduleRecruitmentAppointmentAction` / `cancelRecruitmentAppointmentAction` that reuse the existing booking reschedule/cancel service logic, with staff-initiated notification to the candidate and calendar re-sync. Do not require staff to know or expose the candidate's booking token. Surface as controls in an appointment drawer rather than more inline table actions.
- **Acceptance criteria:** Staff can reschedule an appointment to another open slot and cancel one from the dashboard; the candidate is notified; the calendar event and `reschedule_count` update; both actions audited; token-only public routes still work unchanged.

### 2.4 Interview scorecards / structured notes  `[New]`

- **Current:** Only a single `outcome` text + `outcome_rating` (1–5) on `recruitment_candidate_appointments`. No structured, attributable, multi-criteria feedback.
- **Why it matters:** Hiring decisions rely on free text and one number; no per-interviewer record, no consistent criteria, weak audit for fair-hiring.
- **Proposed fix:** A scorecard entity (e.g. `recruitment_interview_scorecards`) linked to an appointment: per-criterion ratings + comments, overall recommendation, attributed to the interviewer (`created_by`), multiple allowed per appointment. Surface scorecards in the application timeline. (Criteria set can start fixed; configurable criteria is a later enhancement.)
- **Acceptance criteria:** An interviewer records a scorecard against an appointment; it appears in the candidate's timeline attributed to them; multiple interviewers can each add one; permission-gated and audited.

### 2.5 Communication resend / retry  `[New / partial]`

- **Current:** The Comms tab is a read-only audit. Failed/bounced email/SMS cannot be retried or resent; full message bodies aren't viewable. (A `recruitment-calendar-retry` cron exists, but that's calendar sync, not message resend.)
- **Why it matters:** A bounced rejection or interview invite silently fails with no recovery path.
- **Proposed fix:** On each communication: view full content, and a resend/retry action for `failed`/`bounced`. Do not overwrite the old communication row; create a new row linked back with metadata such as `retry_of_communication_id`, preserving the original audit trail. Optionally a small "failed comms" filter for triage.
- **Acceptance criteria:** A failed communication can be retried; the original row remains unchanged apart from optional metadata, the new attempt has its own `delivery_status`, resends are idempotent and audited, and the full body is viewable.

### 2.6 Direct candidate management from talent pool  `[New]`

- **Current:** Candidate details/consent/right-to-work can only be edited from inside an application drawer. The talent-pool row offers match / erase / retry-CV only. `right_to_work_checked_by` is set by the candidate update service when a verified check is saved, but pooled candidates have no direct path to that form.
- **Why it matters:** Editing a pooled candidate, fixing contact details, or recording a right-to-work check shouldn't require an active application.
- **Proposed fix:** A candidate detail/edit surface reachable from the talent pool: edit name/email/phone/location/notes, consent flags, and a proper right-to-work check capture (status, document type, checked-at, **checked-by**). Permission-gated and audited.
- **Acceptance criteria:** A pooled candidate's details and RTW check can be edited/recorded without an application; `right_to_work_checked_by` is populated; changes audited.

---

## 7. Phase 3 — Polish & scale (P3)

### 3.1 Bulk actions  `[New]`

- **Current:** All operations are single-row.
- **Proposed fix:** Multi-select on the applications list with bulk status transition, bulk reject-with-template-email, bulk archive, and bulk export (CSV). Bulk operations respect the state machine, permissions, and audit each affected row.
- **Acceptance criteria:** Selecting multiple applications and choosing "reject with email" transitions each (where legal), sends the templated email, and writes one audit row per application.

### 3.2 Empty / loading / error states  `[New]`

- **Current:** Only the Talent pool tab has empty + loading states. Applications, Postings, Schedule, and Comms can render blank.
- **Proposed fix:** Add empty-state components, loading skeletons, and per-action error surfacing to every tab, per `ui-patterns.md`.
- **Acceptance criteria:** Every tab shows a meaningful empty state when there's no data and surfaces action errors inline; no blank screens.

### 3.3 Wire up or retire dormant data  `[Cleanup]`

- **Current:** Several columns are populated-but-unused or not consistently surfaced: `recruitment_applications.rejection_reason` (unused — rejection reason lives in the status-event note), `recruitment_applications.ai_flags` (stored but not shown to managers), and AI rationale/strengths/concerns are visible in the drawer but not included in the printable interview kit. `booking_token_used_at` and `calendar_last_error` are already used/surfaced and should stay out of this cleanup.
- **Proposed fix:** Per field, decide **use or retire**: either populate `rejection_reason` on reject or drop it in favour of the status-event note; surface AI flags where useful or drop them; add rationale/strengths/concerns to the printable kit if managers use it. Any column drop follows the workspace function-audit + approval rule.
- **Acceptance criteria:** Each listed field is either actively used and surfaced, or removed via an approved migration; none remain in the populated-but-ignored state.

---

## 8. Build sequence & dependencies

1. **Phase 1 first and in order:** RBAC (1.1) → audit (1.2) → state machine (1.3) → archive infra (1.4). RBAC and audit underpin everything; archive depends on RBAC's `delete` scope.
2. **Phase 2** in any order once Phase 1 lands; 2.3 (staff reschedule) and 2.2 (slot mgmt) share notification/calendar plumbing — do together.
3. **Phase 3** last; 3.1 (bulk) depends on the state machine (1.3) and archive (1.4).

Each numbered item targets a 300–500-line PR where possible; larger items (1.1, 1.4, 2.1, 2.4) may split.

---

## 9. Verification expectations

Each implementation PR should include the smallest useful mix of:

- **Action tests:** permission denied/allowed paths for every new server action.
- **Service tests:** state-machine legality, archive filtering, duplicate/idempotency behaviour, and communication retry behaviour.
- **Migration checks:** new nullable columns backfill safely; no default list changes until code can filter them.
- **Browser smoke check:** `/recruitment` tab/drawer flow for the changed surface, especially mobile-width drawer layouts.
- **Public API regression:** posting visibility and application intake still respect `status`, `is_public`, and `application_closing_date`.

Do not accept a UI-only PR for a mutation. The server action must enforce the same rule the UI implies.

---

## 10. Assumptions

- The internal dashboard is the focus; public intake/booking pages change only where they unblock staff actions (2.3 reuses booking logic).
- "Delete" requirements are satisfied by archive/restore; hard delete stays super-admin + confirm; candidate removal stays erase/anonymise.
- The `recruitment` permission actions already defined (view/create/edit/delete/manage/send) are the target RBAC model — no new permission actions are introduced.
- Retention enforcement is **already done** (cron exists) and is excluded from this spec.
- No AI prompt/model changes.

## 11. Out-of-scope deferrals confirmed from v1 design

Inbound mailbox / two-way inbox, OCR for scanned CVs, rota integration for trials, multi-venue recruitment, fully automated decisions, multi-capacity slots, AV scanning. (Unchanged — not addressed here.)

---

## 12. Summary table

| # | Gap | Class | Phase | Priority |
|---|-----|-------|-------|----------|
| 1.1 | Real RBAC (remove super-admin-only + fake UI perms) | Divergence | 1 | P1 |
| 1.2 | Central audit logging on all mutations | Divergence | 1 | P1 |
| 1.3 | Status state-machine enforcement | Divergence | 1 | P1 |
| 1.4 | Archive / soft-delete + restore | New | 1 | P1 |
| 2.1 | Email-template management UI | Unfinished | 2 | P2 |
| 2.2 | Slot management (edit/cancel/archive) | New | 2 | P2 |
| 2.3 | Staff-side appointment reschedule/cancel | Divergence | 2 | P2 |
| 2.4 | Interview scorecards / structured notes | New | 2 | P2 |
| 2.5 | Communication resend/retry | New | 2 | P2 |
| 2.6 | Direct candidate management from talent pool | New | 2 | P2 |
| 3.1 | Bulk actions | New | 3 | P3 |
| 3.2 | Empty/loading/error states | New | 3 | P3 |
| 3.3 | Wire up or retire dormant data | Cleanup | 3 | P3 |

**Headline:** the three highest-value fixes are the **divergences from the 2026-06-07 design** — RBAC (the section is unusable for non-super-admins), state-machine enforcement (data integrity), and staff reschedule/cancel (designed but never exposed) — plus the **archive/restore** capability that has no path today.
