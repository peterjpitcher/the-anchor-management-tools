# Maintenance tracker, implementation plan

Spec: `tasks/maintenance-tracker/spec-v2-2026-09-05.md`
Date: 2026-09-05

## Ground rules for every work stream

- Build in the isolated worktree created by W0.1. **Never** work in the primary tree: it has 51 modified files of unrelated private-bookings work and two unapplied migrations.
- **No production writes.** No `supabase db push`, no migration applied to production, no email sent, no deploy. The plan stops at a verified local build and awaits the owner's explicit approval.
- Super-admin only, enforced with `public.is_super_admin(auth.uid())`. Do not add a `maintenance` ModuleName or a `report` ActionType.
- No em dashes anywhere, including code comments and commit messages.
- British English in all user-facing copy.
- Dates via `src/lib/dateUtils.ts`. Never raw `new Date()` or `.toISOString()` for a user-facing date.
- Server actions return `Promise<{ success?: boolean; error?: string; data?: T }>`.
- Design system components from `@/ds` only. No hardcoded hex.
- Every `FormData` boolean uses `src/lib/forms/formBoolean.ts`.

---

## Phase 0, foundation (sequential, blocks everything)

### W0.1 Isolated worktree
- [ ] `git fetch origin`, create branch `feat/maintenance-tracker` from `origin/main` in a new worktree at `/Users/peterpitcher/Cursor/.worktrees/maintenance-tracker`.
- [ ] Copy `.env.local` from the primary tree (only the primary tree has it).
- [ ] `nvm use`, `npm ci`, confirm a clean `npm run lint` and `npx tsc --noEmit` baseline before writing anything.
- [ ] Confirm `src/lib/manager-report/` exists in this worktree. If it does not, the branch is wrong.

**Acceptance**: clean baseline build on a branch containing commit `8554972c`.

### W0.2 Fix the timezone test gate
The repo has no `test:utc`, and `vitest.config.ts` hardcodes `env: { TZ: 'Europe/London' }`, which beats a command-line `TZ`. Today `TZ=UTC npm test` silently tests London twice.

- [ ] Make the zone read from an env var with `Europe/London` as the default.
- [ ] Add a `test:utc` script that genuinely runs the suite in UTC.
- [ ] Add a test asserting `Intl.DateTimeFormat().resolvedOptions().timeZone` matches the expected zone, so the gate cannot regress silently.
- [ ] Prove it: both `npm test` and `npm run test:utc` pass, and the assertion test fails if the zone is wrong.

**Acceptance**: two runs, two different proven zones. This is a prerequisite for every later date test.

### W0.3 Migration
One migration file, timestamp newer than `20260905180100`.

- [ ] `maintenance_areas` + the fifteen approved seeds.
- [ ] `maintenance_item_ref_seq` + `GRANT USAGE ON SEQUENCE ... TO authenticated`.
- [ ] `maintenance_items` with every CHECK in spec 3.2, `reported_on` defaulting to `(timezone('Europe/London', now()))::date`.
- [ ] `updated_at` trigger.
- [ ] `maintenance_notes` (FK RESTRICT, SELECT + INSERT policies only, no UPDATE or DELETE policy).
- [ ] `maintenance_photos` with the `state` column.
- [ ] `maintenance_item_history` + the `AFTER INSERT OR UPDATE` trigger writing one row per changed field in the same transaction.
- [ ] Storage bucket `maintenance-photos`, private, 10MB, jpeg/png/webp only, with `storage.objects` policies gated on `is_super_admin`.
- [ ] All RLS gated on `public.is_super_admin(auth.uid())`.
- [ ] Verify by executing the whole file inside a rolled-back transaction against a non-production database. A dry-run listing is not proof that SQL executes.
- [ ] Run `npx tsx scripts/security/assert-anon-surface.ts` and confirm no new anon exposure.

**Acceptance**: migration executes cleanly in a throwaway database; anon surface unchanged; constraint violations demonstrated for each CHECK.

---

## Phase 1, parallel work streams (all depend on Phase 0)

### Stream A, types, service and actions
Files: `src/types/maintenance.ts`, `src/services/maintenance.ts`, `src/app/actions/maintenance.ts`

- [ ] Types mirroring the schema, snake_case rows mapped to camelCase by hand.
- [ ] `requireMaintenanceSuperAdmin()` helper throwing `Insufficient permissions`.
- [ ] Service: list with filters and keyset pagination `(created_at DESC, id DESC)`; get one; create; update with optimistic concurrency on `updated_at`; add note; timeline read merging notes, history and photo events with a "load older" cursor.
- [ ] Predicates defined once and exported: `isOpen`, `isOverdue` (target_date < today London), cost totals per spec 6.
- [ ] Actions wrapping each, with Zod validation, `logAuditEvent`, `revalidatePath`.
- [ ] Status transition rules: `done` sets `completed_on` default today London; reopening clears it; `cancelled` reversible.

**Acceptance**: unit tests for every predicate under both timezones; concurrency conflict returns a distinct error; a non-super-admin is refused.

### Stream B, photo pipeline
Files: `src/lib/maintenance/photo-upload.ts`, actions in `src/app/actions/maintenance-photos.ts`, client helper `src/app/(authenticated)/maintenance/_components/photoClient.ts`

- [ ] Client canvas normalisation: longest edge 2000px, JPEG q0.8, EXIF orientation applied by the draw, decode failure caught and surfaced as the plain-English message in spec 4.
- [ ] `requestMaintenancePhotoUpload` action: super-admin check, create `pending` row, `createSignedUploadUrl`.
- [ ] Browser `uploadToSignedUrl`.
- [ ] `confirmMaintenancePhotoUpload` action: re-check super-admin, verify magic bytes and dimensions from private storage, promote to `ready`. Idempotent on `storage_path`.
- [ ] Signed display URLs, one hour, issued only after a per-item super-admin check.
- [ ] Every row of the recovery table in spec 4 implemented and tested.
- [ ] Two controls: "Take photo" with `capture="environment"`, "Choose existing photo" without.

**Acceptance**: a real JPEG round-trips; a HEIC that the browser cannot decode produces the friendly message, not a codec error; metadata failure leaves no orphan; double confirm is a no-op.

### Stream C, pages
Files under `src/app/(authenticated)/maintenance/`

- [ ] `page.tsx` + `_components/MaintenanceListClient.tsx`: summary strip, filters, debounced search, cards on mobile, table on desktop, filters preserved on return.
- [ ] `new/page.tsx`: full page, four required fields, redirect to detail on save.
- [ ] `[id]/page.tsx` + detail client: header badges, explicit save/cancel editing, photo grid with lazy thumbnails, timeline with always-visible note box and collapsed system events.
- [ ] Every page re-checks super-admin server-side and redirects to `/unauthorized`.
- [ ] Empty, no-results, loading and error states.
- [ ] Accessibility per spec 8.

**Acceptance**: keyboard and screen-reader pass; 375px and desktop both usable; a failed save retains input.

### Stream D, settings, nav and badge
- [ ] `src/app/(authenticated)/settings/maintenance/page.tsx`: area CRUD, name normalisation for uniqueness, soft deactivate, deactivated-while-open handled.
- [ ] `NAV_GROUPS` entry in `src/ds/shell/SidebarNav.tsx` under Operations, plus the `countById` entry inside `navCount()`.
- [ ] `maintenance` added to `OutstandingCounts`, `EMPTY_COUNTS`, the cached `Promise.all` in `src/actions/get-outstanding-counts.ts`, and client fixtures.
- [ ] Strip the count for non-super-admins **outside** the shared cache.
- [ ] Read failure renders unavailable, not zero.
- [ ] Cache tag invalidated after every mutation.

**Acceptance**: a manager-role session never receives the maintenance count in the payload, proven by inspecting the response, not the rendered badge.

### Stream E, Friday email snapshot
- [ ] Add `'maintenance'` to `MANAGER_REPORT_SECTIONS` in `src/lib/manager-report/types.ts`.
- [ ] `src/app/api/cron/maintenance-weekly-snapshot/route.ts`: cron auth, gate on Friday 08:00 London, fetch **every** open item across all pages, render escaped HTML and text, queue one entry via `queueManagerReportEmail`.
- [ ] `vercel.json`: `{"path": "/api/cron/maintenance-weekly-snapshot", "schedule": "0 7,8 * * 5"}`.
- [ ] Read failure returns 500 and queues nothing, so the report marks the section unavailable.
- [ ] Per item: reference, title, area, status, priority, responsibility, target date or "not set", authenticated detail link.

**Acceptance**: fixture tests proving completeness (undated, on-hold, future-dated and every responsibility all present), no duplicates on re-run, existing report sections untouched, empty set does not suppress the email. Mocked providers only, never a real send.

---

## Phase 2, verification gate

- [ ] `npm run lint` clean at `--max-warnings=0`.
- [ ] `npx tsc --noEmit` clean (needs a large heap; a 134 exit is memory, not a type error).
- [ ] `npm test` and `npm run test:utc` both green.
- [ ] `npm run build` clean, with no dev server running.
- [ ] Full acceptance matrix from the review document section 5 walked and evidenced.
- [ ] Screenshots of list, detail and mobile capture.

## Phase 3, awaiting owner approval, do not start unsupervised

- [ ] Present the exact migration and the pending migration set for approval.
- [ ] Apply via the `prod-migrate` skill.
- [ ] Deploy, verify the commit and production alias, record the deployment id.
- [ ] Confirm the maintenance section appears in the Friday report on 11 September 2026.

---

## Out of scope, do not build

Contractor database, assignment engine, approval workflow, asset register, recurring maintenance, receipt reconciliation, calendar integration, booking availability changes, emergency alerting, offline sync, any public surface, and any change to `table_holds`.
