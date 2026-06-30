# Recruitment notes, audit trail & decision flow — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append-only candidate notes, a unified per-candidate audit trail in the drawer, and a reusable decision flow so every candidate-facing decision (reject/offer/decline-duplicate/withdraw/hold) proposes an email for approval + captures a reason — fixing the systemic "silent transition" gap.

**Architecture:** A new `recruitment_candidate_notes` table (append-only, RLS mirroring the recruitment pattern); a per-candidate trail server action that merges notes + `audit_logs` field changes; the drawer Activity tab renders one sorted feed; a `decideRecruitmentApplicationAction` that transitions + writes a reason note + (optionally) sends the matching template email via Microsoft Graph, fronted by a decision dialog with an email preview.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (PostgreSQL + RLS), Vitest, Microsoft Graph (email), `@/ds`.

**Spec:** `docs/superpowers/specs/2026-06-30-recruitment-notes-trail-decision-flow-design.md`

---

## File structure

- Create: `supabase/migrations/20260717000000_recruitment_candidate_notes.sql` — table + RLS.
- Modify: `src/services/recruitment.ts` — `addRecruitmentCandidateNote`, `listRecruitmentCandidateNotes`, `getRecruitmentCandidateTrail`, `decideRecruitmentApplication`, `previewRecruitmentDecisionEmail`.
- Modify: `src/app/actions/recruitment.ts` — `addRecruitmentCandidateNoteAction`, `getRecruitmentCandidateTrailAction`, `decideRecruitmentApplicationAction`, `previewRecruitmentDecisionEmailAction`.
- Modify: `src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx` — Activity tab (add-note composer + merged trail), decision dialog, relabel "Notes for AI context".
- Create: `src/services/__tests__/recruitment-decisions.test.ts` — Vitest.
- Modify: `src/types/recruitment.ts` — `RecruitmentCandidateNote` type.

---

## Phase 1 — Notes + unified trail

### Task 1.1: Migration — `recruitment_candidate_notes`

**Files:** Create `supabase/migrations/20260717000000_recruitment_candidate_notes.sql`.

- [ ] **Step 1: Write the migration**

```sql
-- Append-only internal notes per recruitment candidate.
CREATE TABLE IF NOT EXISTS public.recruitment_candidate_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.recruitment_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.recruitment_applications(id) ON DELETE SET NULL,
  content text NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  created_by uuid REFERENCES auth.users(id),
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_candidate_notes_candidate
  ON public.recruitment_candidate_notes (candidate_id, created_at DESC);

ALTER TABLE public.recruitment_candidate_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruitment read access" ON public.recruitment_candidate_notes
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'recruitment', 'view'));

CREATE POLICY "Recruitment create access" ON public.recruitment_candidate_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'recruitment', 'edit'));

CREATE POLICY "Service role manages recruitment notes" ON public.recruitment_candidate_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- No UPDATE/DELETE policy: append-only.
```

- [ ] **Step 2: Apply locally / verify SQL** — `npx supabase db push --dry-run` (review only; do NOT apply to prod yet — that's a confirmed manual step via Supabase MCP).
- [ ] **Step 3: Commit** `git add supabase/migrations/20260717000000_recruitment_candidate_notes.sql && git commit -m "feat(recruitment): add append-only candidate notes table"`

### Task 1.2: Type + note service functions

**Files:** Modify `src/types/recruitment.ts`, `src/services/recruitment.ts`. Test: `src/services/__tests__/recruitment-decisions.test.ts`.

- [ ] **Step 1: Add the type** to `src/types/recruitment.ts`:

```ts
export type RecruitmentCandidateNote = {
  id: string
  candidate_id: string
  application_id: string | null
  content: string
  kind: string
  created_by: string | null
  created_by_email: string | null
  created_at: string
}
```

- [ ] **Step 2: Write failing test** (`recruitment-decisions.test.ts`) for `addRecruitmentCandidateNote`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { addRecruitmentCandidateNote } from '../recruitment'

function makeClient(captured: any[]) {
  const qb: any = {}
  for (const m of ['insert','select','eq','order','limit','single']) qb[m] = vi.fn((arg?: unknown) => { if (m === 'insert') captured.push(arg); return qb })
  qb.select = vi.fn(() => qb); qb.single = vi.fn(() => Promise.resolve({ data: { id: 'n1' }, error: null }))
  qb.then = (r: any) => r({ data: [], error: null })
  return { from: vi.fn(() => qb) }
}

it('inserts a note with candidate, content, author', async () => {
  const captured: any[] = []
  const client: any = makeClient(captured)
  await addRecruitmentCandidateNote({ candidateId: 'c1', applicationId: 'a1', content: 'Spoke to them', kind: 'note', userId: 'u1', userEmail: 'pete@x' }, client)
  expect(captured[0]).toMatchObject({ candidate_id: 'c1', content: 'Spoke to them', created_by: 'u1', created_by_email: 'pete@x' })
})
```

- [ ] **Step 3: Run, expect FAIL** — `npx vitest run src/services/__tests__/recruitment-decisions.test.ts`
- [ ] **Step 4: Implement** in `src/services/recruitment.ts`:

```ts
export async function addRecruitmentCandidateNote(
  input: { candidateId: string; applicationId?: string | null; content: string; kind?: string; userId?: string | null; userEmail?: string | null },
  supabase: GenericClient = createAdminClient()
) {
  const { data, error } = await supabase
    .from('recruitment_candidate_notes')
    .insert({
      candidate_id: input.candidateId,
      application_id: input.applicationId ?? null,
      content: input.content,
      kind: input.kind ?? 'note',
      created_by: input.userId ?? null,
      created_by_email: input.userEmail ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function listRecruitmentCandidateNotes(
  candidateId: string,
  supabase: GenericClient = createAdminClient()
) {
  const { data, error } = await supabase
    .from('recruitment_candidate_notes')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 5: Run, expect PASS.** Commit.

### Task 1.3: `getRecruitmentCandidateTrail` (notes + audit_logs system changes)

**Files:** Modify `src/services/recruitment.ts`. Test: same file.

- [ ] **Step 1: Write failing test** asserting it queries `audit_logs` and returns `{ notes, systemChanges }`:

```ts
it('builds a trail of notes plus audit_logs changes for the candidate', async () => {
  const tables: string[] = []
  const qb: any = {}
  for (const m of ['select','eq','in','or','order','limit']) qb[m] = vi.fn(() => qb)
  qb.then = (r: any) => r({ data: [], error: null })
  const client: any = { from: vi.fn((t: string) => { tables.push(t); return qb }) }
  const { getRecruitmentCandidateTrail } = await import('../recruitment')
  const out = await getRecruitmentCandidateTrail('c1', client)
  expect(tables).toContain('recruitment_candidate_notes')
  expect(tables).toContain('audit_logs')
  expect(out).toHaveProperty('notes')
  expect(out).toHaveProperty('systemChanges')
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — load the candidate's application ids, appointment ids, scorecard ids, then query `audit_logs` with an `.or()` over `(resource_type,resource_id)` pairs, plus the notes. Return `{ notes, systemChanges }`. (Format each audit row to `{ at: created_at, operation_type, resource_type, changedKeys: Object.keys(new_values ?? {}) }`.)
- [ ] **Step 4: Run, expect PASS.** Commit.

### Task 1.4: Server actions for notes + trail

**Files:** Modify `src/app/actions/recruitment.ts`.

- [ ] **Step 1:** Add `addRecruitmentCandidateNoteAction(_prev, formData)` — `currentUser()`, gate `recruitment:edit` (existing `requireRecruitmentPermission`/`checkUserPermission` pattern), call `addRecruitmentCandidateNote({...})`, `auditRecruitmentMutation({operation:'create_note', resource:'recruitment_candidate_note', resourceId: note.id, user})`, `revalidatePath('/recruitment')`, return `{ success: true }`.
- [ ] **Step 2:** Add `getRecruitmentCandidateTrailAction(candidateId)` — gate `recruitment:view`, return `await getRecruitmentCandidateTrail(candidateId)` as `{ success, data }`.
- [ ] **Step 3: Verify** `npx tsc --noEmit` + `npm run lint`. Commit.

### Task 1.5: Activity tab — composer + merged trail

**Files:** Modify `RecruitmentDashboardClient.tsx` (Activity tab, currently shows Timeline + AI runs).

- [ ] **Step 1:** Add client state: `const [trail, setTrail] = useState<{notes:any[]; systemChanges:any[]}>({notes:[],systemChanges:[]})` + a `useEffect` keyed on `selectedCandidateId` that calls `getRecruitmentCandidateTrailAction(selectedCandidateId)` and sets it. Add `addNoteAction` via `useActionState(addRecruitmentCandidateNoteAction, null)`; on success, re-fetch the trail.
- [ ] **Step 2:** Build a `buildCandidateTrail()` memo that merges into `TrailEvent[]` (note/status/comms/appointment/ai/system) sorted by time desc, from `trail.notes`, `selectedApplicationEvents`, `selectedApplicationCommunications`, `selectedApplicationAppointments` (scheduled + outcome), `selectedApplicationAiRuns`, `trail.systemChanges`.
- [ ] **Step 3:** Replace the Activity tab body with: an "Add note" composer (`<form action={addNoteAction}>` hidden `candidate_id`/`application_id`, `<Textarea name="content">`, `<SubmitButton>Add note`, gated `permissions.canEdit`) above the merged feed (icons per kind, actor + London time).
- [ ] **Step 4:** Relabel the Profile tab's notes field from "Recruitment notes" to "Notes for AI context".
- [ ] **Step 5: Verify** lint + tsc + build. Commit.

### Task 1.6: Apply migration to production (CONFIRM FIRST)

- [ ] **Step 1:** Ask the user to confirm applying the additive migration to prod.
- [ ] **Step 2:** On approval, apply via Supabase MCP `apply_migration` (name `recruitment_candidate_notes`), then verify the table + policies exist with `execute_sql`.

---

## Phase 2 — Reject decision dialog

### Task 2.1: `previewRecruitmentDecisionEmail` + action

**Files:** `src/services/recruitment.ts`, `src/app/actions/recruitment.ts`. Find the existing template-merge used by `sendRecruitmentDecisionEmailAction`/`sendRecruitmentTemplateEmail` and reuse it.

- [ ] **Step 1:** Add `previewRecruitmentDecisionEmail(applicationId, type)` returning `{ subject, body }` by rendering the active template of `type` with the candidate/application merge fields — WITHOUT sending.
- [ ] **Step 2:** Add `previewRecruitmentDecisionEmailAction(applicationId, type)` (gate `recruitment:view`).
- [ ] **Step 3:** Test: rendering `rejection` returns non-empty `{subject, body}`. Verify. Commit.

### Task 2.2: `decideRecruitmentApplicationAction` (reject path, TDD)

**Files:** `src/services/recruitment.ts`, `src/app/actions/recruitment.ts`. Test: `recruitment-decisions.test.ts`.

- [ ] **Step 1: Write failing test** for `decideRecruitmentApplication` reject: asserts it transitions to `rejected`, writes a `rejection`-kind note when a reason is given, sets `rejection_reason`, and sets `retention_until`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `decideRecruitmentApplication({ applicationId, decision, reason, sendEmail, emailSubject, emailBody, user }, supabase)`: map `reject→rejected`; call `transitionRecruitmentApplicationStatus`; if `reason`, `addRecruitmentCandidateNote({kind:'rejection', content: reason, ...})` and `update recruitment_applications.rejection_reason`; set `retention_until = addMonths(now, retentionMonths())` if null; if `sendEmail`, send `rejection` template via the existing send path with the edited subject/body. Return `{ success }` / `{ error }` (surface email failure).
- [ ] **Step 4:** Add `decideRecruitmentApplicationAction(_prev, formData)` (gate `recruitment:edit` for reject) parsing `application_id, decision, reason, send_email, email_subject, email_body`; `auditRecruitmentMutation`; `revalidatePath`.
- [ ] **Step 5: Run, expect PASS.** Commit.

### Task 2.3: Decision dialog UI (reject)

**Files:** `RecruitmentDashboardClient.tsx`.

- [ ] **Step 1:** Add state `decisionDialog: { open, decision } | null`. Wire the existing "Reject" control to open it with `decision:'reject'` (keep the manual status dropdown as a silent override).
- [ ] **Step 2:** Dialog body: reason `<Textarea>`; on open, call `previewRecruitmentDecisionEmailAction(appId,'rejection')` to fill editable `subject`/`body`; "Improve with AI" button → `draftRecruitmentEmailAction`; "Send email" checkbox (default on, disabled + off when `!candidateHasEmail`); confirm submits `decideRecruitmentApplicationAction`; on success refresh + re-fetch trail.
- [ ] **Step 3: Verify** lint + tsc + build. Commit.

---

## Phase 3 — Extend decisions (offer / decline_duplicate / withdraw / hold)

### Task 3.1: Service + action coverage

- [ ] **Step 1:** Extend `decideRecruitmentApplication` decision→status map: `offer→offered`, `decline_duplicate→declined_duplicate`, `withdraw→withdrawn`, `hold→on_hold`. Template map: `offer→offer`, `decline_duplicate→already_considered`; withdraw/hold default `sendEmail=false`. Negatives (reject/withdraw/decline_duplicate) start the retention clock; offer does not.
- [ ] **Step 2:** Gate offer/decline_duplicate on `recruitment:manage` in the action.
- [ ] **Step 3:** Tests: each decision maps to the right status + template; withdraw/hold write a reason note and send no email. Verify. Commit.

### Task 3.2: Surface the decisions in the drawer

- [ ] **Step 1:** Add Offer / Decline-duplicate / Withdraw / Hold controls (header or Overview "Stage") that open the same decision dialog with the right `decision` (offer/decline_duplicate show an email proposal; withdraw/hold show reason only with send default off).
- [ ] **Step 2: Verify** lint + tsc + build. Commit.

---

## Phase 4 — Appointment notices + hire email

### Task 4.1: No-show / staff-cancel notices

**Files:** `src/app/actions/recruitment.ts` / `src/services/recruitment.ts` (the `recordRecruitmentAppointmentOutcomeAction` no_show path and the staff cancel path).

- [ ] **Step 1:** After the existing transition to `on_hold`, always send `sendRecruitmentManagerAlert(...)`. Add an optional candidate notice (a short templated email) controlled by a flag from the outcome/cancel UI (default off).
- [ ] **Step 2:** Surface a "Notify candidate" checkbox on the inline cancel / record-outcome controls.
- [ ] **Step 3: Verify.** Commit.

### Task 4.2: Hire email

**Files:** `completeRecruitmentHireHandoff` / `inviteRecruitmentCandidateAsEmployeeAction`.

- [ ] **Step 1:** After the employee invite + transition to `hired`, send a recruitment-branded confirmation to the candidate (reuse the `offer` template) and a `manager_alert`. Guard against double-send if an offer email already went out.
- [ ] **Step 2: Verify** lint + tsc + build + tests. Commit.

---

## Self-review notes

- Spec coverage: A → Tasks 1.1–1.5; B → Tasks 1.3, 1.5; C reject → Phase 2; C other decisions → Phase 3; D → Phase 4; migration-to-prod gate → Task 1.6. Append-only enforced (Task 1.1, no update/delete). Retention clock on negatives (Tasks 2.2, 3.1).
- Placeholder scan: the template-merge reuse (Task 2.1) and the audit_logs `.or()` formatting (Task 1.3) are the two "find the existing helper" points — both name the exact existing functions to reuse; resolve against the code at implementation time.
- Type consistency: `RecruitmentCandidateNote`, `decideRecruitmentApplication(input)`, `getRecruitmentCandidateTrail → {notes, systemChanges}`, note `kind` values used consistently across tasks.
