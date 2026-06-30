# Recruitment notes, audit trail & decision flow — design

Date: 2026-06-30
Branch: (new) `feat/recruitment-notes-trail-decision-flow`
Complexity: 5 (XL, cross-cutting) — decomposed into 4 independently-shippable phases.

## Problem

Two user-reported gaps, plus a systemic root cause found in a lifecycle audit:

1. **No timestamped notes.** The only way to record anything about a candidate is the
   single overwritable `recruitment_candidates.notes` field — not dated, not attributed,
   not in any audit trail. The user wants to jot internal notes during conversations and
   record *why* a candidate was rejected.
2. **No full audit trail per candidate.** Activity is scattered (status events and AI runs
   in one tab, comms elsewhere); field-level edits live in `audit_logs` but aren't surfaced.
3. **Silent decisions (root cause).** Every status transition is a silent flip — the
   transition RPC updates `status` and logs a status event, but **no transition sends a
   candidate email or captures a reason**. All recruitment emails are manual (composer) or
   cron (reminders). So rejecting a candidate sent no email; the same is true for offer,
   decline-duplicate, and (recruitment-branded) hire. Reasons aren't captured for
   withdrawn / on_hold / single rejects. Appointment no-show / staff-cancel silently moves
   the application to `on_hold` with no candidate notice and no manager alert. Retention
   (GDPR) clock isn't started on rejection.

## Goals

- Timestamped, attributed, append-only internal notes per candidate.
- One unified, chronological audit trail per candidate in the drawer's Activity tab.
- A single reusable **decision flow** so every candidate-facing decision proposes an email
  (approve → send via Microsoft Graph) and captures an internal reason — closing the whole
  class of "silent decision" gaps, not just rejection.

## Decisions (from brainstorming)

- Audit trail depth: **activity feed + field-level system changes** (from `audit_logs`).
- Note visibility: **all recruitment staff** (internal; never shown to candidate).
- Notes: **append-only / immutable** (no edit or delete path).
- Decision scope: **all candidate-facing decisions + appointment notices** (reject, offer,
  decline-duplicate, withdraw, hold; manager alert + optional candidate notice on
  no-show/staff-cancel; recruitment email on hire; start retention clock on rejection).

## Non-goals

- No change to the AI scoring, the booking-token self-scheduling, the reminder cron, or the
  email transport (stays on the configured provider — currently Microsoft Graph).
- The existing single `recruitment_candidates.notes` field stays (it feeds AI scoring
  context) — relabelled in the UI to "Notes for AI context" to avoid confusion with the log.
- No new RBAC roles; reuse `recruitment:view/edit/manage` permissions.

---

## A. Notes log

### Schema — new table `recruitment_candidate_notes` (append-only)
```sql
CREATE TABLE public.recruitment_candidate_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.recruitment_applications(id) ON DELETE SET NULL,
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'note',           -- 'note' | 'rejection' | 'withdrawn' | 'on_hold' | 'decline_duplicate' | 'offer' | 'hired'
  created_by uuid REFERENCES auth.users(id),
  created_by_email text,                        -- denormalised author label (avoids fragile auth.users join)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recruitment_candidate_notes_candidate
  ON public.recruitment_candidate_notes (candidate_id, created_at DESC);
ALTER TABLE public.recruitment_candidate_notes ENABLE ROW LEVEL SECURITY;
```
RLS mirrors the existing recruitment pattern (`public.user_has_permission(auth.uid(),'recruitment',...)`):
- SELECT → `view`; INSERT → `edit`; `service_role` FOR ALL.
- **No UPDATE/DELETE policy** → append-only at the DB layer. There is also no update/delete
  server action, so no code path can mutate a note.

`kind` lets a decision write a typed note (e.g. a rejection reason) that the trail can badge.

### Service + action
- `src/services/recruitment.ts`: `addRecruitmentCandidateNote({ candidateId, applicationId, content, kind, userId, userEmail })`.
- `src/app/actions/recruitment.ts`: `addRecruitmentCandidateNoteAction(formData)` — gate
  `recruitment:edit`; insert via service-role client; `auditRecruitmentMutation({operation:'create_note', resource:'recruitment_candidate_note', resourceId:<noteId>})`; `revalidatePath`.

---

## B. Unified audit trail (Activity tab)

A per-candidate server action assembles the parts that can't be pre-loaded globally:

- `getRecruitmentCandidateTrailAction(candidateId)` — gate `recruitment:view`. Returns
  `{ notes, systemChanges }`:
  - `notes`: all `recruitment_candidate_notes` for the candidate (desc).
  - `systemChanges`: rows from `audit_logs` for this candidate. It first loads the
    candidate's application ids, appointment ids and scorecard ids, then queries
    `audit_logs` with an `.or()` over `(resource_type, resource_id)` pairs
    (`recruitment_candidate`=candidateId; `recruitment_application` in applicationIds;
    `recruitment_appointment` in appointmentIds; `recruitment_interview_scorecard` in
    scorecardIds), `order created_at desc limit 100`. Each row is formatted to a short
    human string from `operation_type` + `resource_type` + the changed keys of
    `new_values` (e.g. "Updated candidate · phone, right_to_work_status").

The client fetches this on drawer open (when `selectedCandidateId` changes) and after any
note/decision, with a loading state.

The **Activity tab** renders one time-sorted feed of typed events merged from:
- notes (kind-badged) — from the trail action,
- status changes — `selectedApplicationEvents` (already loaded),
- emails/SMS — `selectedApplicationCommunications` (already loaded),
- appointments — `selectedApplicationAppointments`: emit "scheduled" (at `created_at`),
  and "outcome: <status>" (at `outcome_recorded_at`) when present,
- AI runs — `selectedApplicationAiRuns` (already loaded),
- system changes — from the trail action.

Shape: `type TrailEvent = { at: string; kind: 'note'|'status'|'comms'|'appointment'|'ai'|'system'; icon; title; detail?; actor? }`.
Sorted `at` desc. An **Add note** composer (textarea + "Add note", gated `recruitment:edit`)
sits at the top of the tab.

---

## C. Decision flow (reusable)

### Server action
`decideRecruitmentApplicationAction(formData)` in `src/app/actions/recruitment.ts`:
- inputs: `application_id`, `decision` ∈ {reject, offer, decline_duplicate, withdraw, hold},
  `reason` (text, optional), `send_email` (bool), `email_subject`, `email_body`.
- permission: reject/withdraw/hold → `recruitment:edit`; offer/decline_duplicate → `recruitment:manage`.
- decision → target status map: reject→`rejected`, offer→`offered`,
  decline_duplicate→`declined_duplicate`, withdraw→`withdrawn`, hold→`on_hold`.
- Orchestration (best-effort on the email, atomic on the data):
  1. Transition status via the existing transition path (records a status event + audit).
  2. If a reason was given: write it as an internal note (with `kind` = the decision, e.g.
     `rejection`/`withdrawn`/`on_hold`/`decline_duplicate`/`offer`) **and** set
     `recruitment_applications.rejection_reason` for the reject case (re-use the column;
     other decisions store the reason only as a note since they have no column).
  3. For terminal negatives (reject, withdraw, decline_duplicate): set
     `retention_until = today + retentionMonths()` if not already set (starts the GDPR clock).
  4. If `send_email`: send the matching template email
     (reject→`rejection`, offer→`offer`, decline_duplicate→`already_considered`) with the
     edited subject/body via the existing send path (`sendRecruitmentDecisionEmailAction`'s
     underlying sender → Microsoft Graph). Withdraw/hold default to no candidate email.
  5. `auditRecruitmentMutation` for the whole decision.
- Returns `{ success }` or `{ error }`; non-blocking email failure is surfaced
  (re-using the existing "clearer email-failure message" pattern from recent work).

### Email preview
`previewRecruitmentDecisionEmailAction(applicationId, type)` — renders the matching template
with merge fields (re-using the existing template-merge used by the send path) and returns
`{ subject, body }` *without sending*, so the dialog can show a proposal. An optional
"Improve with AI" button calls the existing `draftRecruitmentEmailAction`.

### UI — decision dialog
A modal opened from the dedicated decision buttons (Reject, plus Offer / Decline-duplicate /
Withdraw / Hold surfaced in the drawer). Contents: an internal **reason** textarea; for the
email-bearing decisions, a **proposed email** (subject + body, pre-filled via the preview
action, editable) with "Improve with AI" and a "Send email" toggle (auto-off and disabled
when the candidate has no email on file); a confirm button ("Reject and email", etc.). The
**manual status dropdown stays** as a silent power-user override.

---

## D. Appointment notices + hire email (closing the remaining gaps)

- **No-show / staff-cancel** (`recordRecruitmentAppointmentOutcomeAction` no_show path and the
  staff cancel path): after the existing transition to `on_hold`, always send a
  `manager_alert` (`sendRecruitmentManagerAlert`), and offer an **optional candidate notice**
  (a short templated email; reuse the decision-dialog email proposal pattern, off by default).
- **Hire** (`inviteRecruitmentCandidateAsEmployeeAction` / `completeRecruitmentHireHandoff`):
  in addition to the existing employee-invite email, send a recruitment-branded confirmation
  to the candidate (reuse the `offer` template or a short message) and a `manager_alert`.

---

## Phasing (each independently deployable)

- **Phase 1 — Notes + trail (A + B).** Migration for `recruitment_candidate_notes`;
  add-note service/action; `getRecruitmentCandidateTrailAction`; Activity tab → add-note
  composer + unified merged trail incl. system changes. Delivers the core ask (timestamped,
  attributed notes + full trail).
- **Phase 2 — Reject decision dialog (C, reject path).** `decideRecruitmentApplicationAction`
  (reject) + `previewRecruitmentDecisionEmailAction` + dialog wired to the Reject button +
  rejection_reason + reason note + retention clock + Graph send. Closes the reported bug.
- **Phase 3 — Extend decisions (C).** offer / decline_duplicate / withdraw / hold through the
  same action + dialog.
- **Phase 4 — Appointment notices + hire email (D).** no-show/cancel manager alert + optional
  candidate notice; recruitment confirmation + manager alert on hire.

## Migrations to production

Only Phase 1 needs a migration (the notes table — additive, non-destructive). I'll add the
repo migration file (`supabase/migrations/<timestamp>_recruitment_candidate_notes.sql`) and
apply it to production via the Supabase MCP `apply_migration` (this project applies prod
migrations that way, not `db push`), **after explicit confirmation**. No destructive DDL.

## Testing

- Vitest (mock Supabase): `addRecruitmentCandidateNote` inserts with the right shape;
  `getRecruitmentCandidateTrailAction` builds the audit_logs `.or()` filter from the
  candidate's related ids; `decideRecruitmentApplicationAction` maps each decision to the
  right status + template and starts the retention clock on negatives. Happy path + one
  error/empty case each, per `.claude/rules/testing.md`.
- Per phase: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all green.
- Manual: reject a test candidate → dialog proposes the rejection email, approve → it sends
  and the reason note + status + retention appear in the Activity trail.

## Risks / rollback

- The decision action orchestrates several writes + an email. Data writes are sequenced and
  audited; the email is best-effort and its failure is surfaced, not swallowed (matches the
  recent recruitment email-failure work). Each phase is a separate commit/PR; revert the
  commit to roll back. The only schema change is an additive table (Phase 1) — drop the table
  to fully reverse if ever needed.
