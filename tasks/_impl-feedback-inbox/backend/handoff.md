# Backend handoff — Feedback triage inbox (PR2)

## Files created / edited

1. **CREATED** `supabase/migrations/20260703090000_feedback_rbac_permissions.sql`
   - RBAC seed migration for module `feedback`, actions `view` + `manage`, granted to `super_admin` and `manager`.
   - Copied the `DO $$ ... $$` idempotent NOT EXISTS pattern from `20260302000001_short_links_rbac_permissions.sql` exactly.
   - **NOT applied.** Orchestrator applies to prod (via Supabase MCP `apply_migration` per project convention — prod uses apply-time timestamps, repo filename ≠ prod version).

2. **EDITED** `src/types/rbac.ts`
   - Added `| 'feedback'` to the `ModuleName` union (placed after `'short_links'`, before `'menu_management'`). One line, nothing else.

3. **EDITED** `src/ds/shell/SidebarNav.tsx`
   - Added ONE NavItem to the first `NAV_GROUPS` group (alongside Dashboard/Events/Customers/Messages):
     `{ id: 'feedback', label: 'Feedback', icon: 'message', href: '/feedback-inbox', permission: { module: 'feedback', action: 'view' } }`
   - href is `/feedback-inbox` (NOT `/feedback`, which is the public funnel). icon `message` reused (exists in DS).

4. **CREATED** `src/app/actions/feedback.ts` — `'use server'`.

## Migration filename + timestamp chosen
`20260703090000_feedback_rbac_permissions.sql` (after 20260702120000, as required).

## Action contract (exported — UI agent depends on this)

```ts
export type ReviewFeedbackStatus = 'new' | 'in_progress' | 'resolved' | 'dismissed'

export interface ReviewFeedbackItem {
  id: string
  rating: number
  comments: string | null
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  contactConsent: boolean
  status: ReviewFeedbackStatus
  staffNotes: string | null
  createdAt: string
  handledAt: string | null
}

export async function getReviewFeedbackList():
  Promise<{ success: true; data: ReviewFeedbackItem[] } | { error: string }>

export async function updateReviewFeedbackStatus(input: {
  id: string
  status: ReviewFeedbackStatus
  staffNotes?: string
}): Promise<{ success: true } | { error: string }>
```

- `getReviewFeedbackList`: checks `feedback/view`; queries `review_feedback` via `createAdminClient()`, selects the 11 needed columns, `order created_at desc`, `limit 200`; manually maps snake_case → camelCase; try/catch → `{ error }`.
- `updateReviewFeedbackStatus`: auth via `createClient().auth.getUser()` (no user → `{ error: 'Unauthorized' }`) AND `feedback/manage` (else permission error); zod-validates id (uuid) + status (enum of 4); updates `status`, `handled_by = user.id`, `handled_at = now()`, and `staff_notes` ONLY when `staffNotes` provided; `logAuditEvent({ operation_type:'update', resource_type:'review_feedback', resource_id, operation_status:'success', user_id, ... })`; `revalidatePath('/feedback-inbox')`.

## Notes for the UI agent
- The list page/route must live at **`/feedback-inbox`** to match the nav href and revalidatePath. `/feedback` is the public funnel — do not collide with it.
- Import both actions + `ReviewFeedbackItem`/`ReviewFeedbackStatus` from `@/app/actions/feedback`.
- The page still needs its own server-side `checkUserPermission('feedback','view')` gate (actions already re-check, but the route should gate too, per project RBAC convention). The nav item is gated by `feedback/view`.
- `updateReviewFeedbackStatus` returns `{ success: true }` (no data). Re-fetch the list or rely on `revalidatePath` after a mutation.

## Assumptions
- Used `createAdminClient()` (service-role, bypasses RLS) for both read and write, consistent with the project's audit/service pattern where authorization is enforced by the explicit `checkUserPermission` calls rather than RLS. The `review_feedback` table already exists in prod (per task context) — no table migration written.
- Reused the existing DS icon `message` for the nav item (per task instruction; no new icon added).
- `staffNotes` semantics: passing `undefined` (or omitting) leaves `staff_notes` untouched; passing an empty string `''` will overwrite it to empty. This matches the "only if provided" instruction.

## Verification done
- `npx tsc --noEmit` — no errors in any of my owned files (filtered; UI agent's files may not exist yet).
- `npx eslint` on all 3 source files with `--max-warnings=0` — exit 0, clean.
- Migration not applied (per ownership rule).
