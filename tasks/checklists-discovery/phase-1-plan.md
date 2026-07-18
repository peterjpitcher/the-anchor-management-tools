# Checklists Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use subagent-driven-development or
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> The full contract is [spec.md](spec.md) v4; this plan sequences Phase 1 of §14 into
> TDD-sized tasks. Where a step says "per spec §X", the spec section is the authority for
> the algorithm; this plan fixes the file paths, signatures, and test contracts so the
> pieces fit together.

**Goal:** Build the checklists data model and the entire scheduling/accountability/scoring
engine as tested pure functions, plus the RBAC module. Ships completely dark: no UI, no
cron, no jobs, nothing user-visible. Every switch in `checklist_settings` defaults false.

**Architecture:** One migration creates 10 tables (RLS deny-all, service-role only) and
seeds the `checklists` RBAC module for super_admin/manager/staff (NOT foh_staff, which is
Phase 2). The engine lives in `src/lib/checklists/` as pure functions that take their data
as arguments, so every rule is unit-tested with no database. Database-reading wrappers,
jobs, and screens are Phase 2 onward.

**Tech Stack:** Next.js 15, TypeScript strict, Supabase (Postgres), Vitest. Migrations in
`supabase/migrations/`, `npx supabase db push`. Tests co-located, run with
`npx vitest run <path>`.

**Verified ground truth (do not re-derive):**
- Migration naming: 14-digit `YYYYMMDDHHMMSS_desc.sql`, sorts lexically. Latest existing is
  `20260730000002_...`; new files MUST beat it, so use the `20260731...` prefix.
- Roles are live-only knowledge: prod has `super_admin`, `manager`, `staff`, `foh_staff`
  (the 1-user FOH iPad, table_bookings-only), `Deputy`, `portal_shift_manager`. Phase 1
  grants to the first three; foh_staff is Phase 2.
- RLS deny-all pattern: `ENABLE ROW LEVEL SECURITY` plus a single
  `FOR ALL TO service_role USING (true) WITH CHECK (true)` policy = authenticated/anon get
  nothing. Model: `supabase/migrations/20260418120200_pb_send_idempotency.sql`.
- RBAC seed pattern: `INSERT INTO permissions ... ON CONFLICT (module_name, action) DO
  UPDATE SET description = EXCLUDED.description`, then per-role `INSERT INTO role_permissions
  SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = '...' AND ...
  ON CONFLICT DO NOTHING`. Model: `supabase/migrations/20260708000012_customer_consent_audit.sql:316-369`.
- `departments` PK is `name TEXT` (rows: bar, kitchen, runner, host, cleaning).
- `employees` PK is `employee_id UUID`. `rota_published_shifts` columns: id, week_id,
  employee_id, shift_date, start_time, end_time, department, status, is_open_shift,
  is_overnight, name, published_at (plus more).
- Test model: `src/app/(authenticated)/rota/payroll/payrollCycleStats.test.ts` (pure,
  `makeRow` factory, explicit `today` string, no `new Date()`). vitest `globals:true` but
  import `{ describe, it, expect }` explicitly. `@` maps to `src/`.
- TZ is not set in the toolchain; timezone tests assert on `.toISOString()` or pass
  explicit dates. Engine functions take dates/times as arguments and construct London
  instants via `date-fns-tz` (already a dependency), never `new Date(str)`.

**Commit discipline:** one commit per task, conventional messages, end each with
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Branch: `feat/checklists`
(already created).

**Verification gate before the phase is done:** `npm run lint` (0 warnings),
`npx tsc --noEmit`, `npm test`, `npm run build`, `npx supabase db push --dry-run` all clean.

---

## Task 1: Characterization test for `isFohOnlyUser` (before it is ever touched)

Phase 2 widens this predicate. Pin its current behaviour first so the Phase 2 change is
provably safe.

**Files:**
- Test: `src/lib/foh/__tests__/user-mode.test.ts` (create)
- Read only: `src/lib/foh/user-mode.ts`

- [ ] **Step 1: Read the current implementation** so the test matches exactly.

Run: `sed -n '1,40p' src/lib/foh/user-mode.ts`

- [ ] **Step 2: Write the characterization test.**

```ts
// src/lib/foh/__tests__/user-mode.test.ts
import { describe, it, expect } from 'vitest'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import type { UserPermission } from '@/types/rbac'

const perm = (module_name: string, action = 'view'): UserPermission =>
  ({ module_name, action } as UserPermission)

describe('isFohOnlyUser (current behaviour, pre-checklists)', () => {
  it('returns false for an empty permission list', () => {
    expect(isFohOnlyUser([])).toBe(false)
  })
  it('returns false when table_bookings:view is absent', () => {
    expect(isFohOnlyUser([perm('events'), perm('customers')])).toBe(false)
  })
  it('returns true when every permission is on table_bookings and view is present', () => {
    expect(isFohOnlyUser([perm('table_bookings', 'view'), perm('table_bookings', 'edit')])).toBe(true)
  })
  it('returns false when any permission is outside table_bookings', () => {
    expect(isFohOnlyUser([perm('table_bookings', 'view'), perm('checklists', 'view')])).toBe(false)
  })
})
```

The last case asserts the CURRENT behaviour: today, adding `checklists` breaks FOH-only
mode. Phase 2 will flip that expectation to `true` in the same change that widens
`FOH_MODULES`. That is the whole point of pinning it now.

- [ ] **Step 3: Run and verify it passes against current code.**

Run: `npx vitest run "src/lib/foh/__tests__/user-mode.test.ts"`
Expected: PASS (4 tests). If the `UserPermission` shape differs, adjust `perm()` to match
`src/types/rbac.ts`; do not change the assertions.

- [ ] **Step 4: Commit.**

```bash
git add "src/lib/foh/__tests__/user-mode.test.ts"
git commit -m "test(checklists): pin isFohOnlyUser behaviour before Phase 2 widens it"
```

---

## Task 4: Shared engine types

One types module so every later task agrees on shapes. No logic, no test (types only). Built
early (before the migration's siblings) because every other task imports from it.

**Files:**
- Create: `src/lib/checklists/types.ts`

- [ ] **Step 1: Write the types.** These are the contracts every engine function uses.

```ts
// src/lib/checklists/types.ts

export type ScheduleKind = 'calendar' | 'floating'
export type Anchor = 'open' | 'close' | 'every' | 'at_times' | 'anytime'
export type Freq = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'
export type InstanceState = 'pending' | 'done' | 'missed' | 'skipped' | 'not_applicable'
export type Band = 'green' | 'amber' | 'red'

/** A row from business_hours or special_hours, only the fields the resolver reads. */
export interface HoursRow {
  opens: string | null
  closes: string | null
  is_closed: boolean | null
}

/** Discriminated result of resolving a day's trading window (spec 5.1). */
export type TradingWindow =
  | { isClosed: true; source: 'special_hours' | 'business_hours' }
  | { isClosed: false; opens: string; closes: string; source: 'special_hours' | 'business_hours' }
  | { resolved: false; reason: 'query_error' | 'no_hours' | 'invalid_hours' }

/** Zoned instants for a day, London-resolved (spec 5.3). */
export interface WindowInstants {
  opensAt: Date
  closesAt: Date
}

/** The cadence-relevant subset of a template (spec 3.2). */
export interface CadenceTemplate {
  scheduleKind: ScheduleKind
  freq: Freq | null
  freqInterval: number
  anchorDate: string | null // 'YYYY-MM-DD'
  byWeekday: number[] | null // 0 = Sunday
  seasonStart: string | null // 'MM-DD'
  seasonEnd: string | null
  intervalDays: number | null
  toleranceDays: number | null
  firstDueOn: string | null // 'YYYY-MM-DD'
}

/** A published rota shift, only the fields accountability needs (spec 6). */
export interface ShiftRow {
  employeeId: string | null
  shiftDate: string // 'YYYY-MM-DD'
  startTime: string // 'HH:MM' or 'HH:MM:SS'
  endTime: string
  department: string
  status: string
  isOpenShift: boolean
}

/** A completed instance for scoring (spec 7). */
export interface ScoredInstance {
  completedAt: Date
  graceUntil: Date
}

/** Result of scoring one person's completed instances. */
export interface TimelinessResult {
  score: number | null // null when suppressed (< 30)
  count: number
  band: Band | null
}
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/checklists/types.ts
git commit -m "feat(checklists): shared engine types"
```

> **Execution order note:** tasks are numbered by spec area, not strict sequence. Run them
> in this order: 1 (pin the FOH test), 4 (types, everything imports it), 2 (migration), 3
> (rbac name), then 5 to 11 (engine, any order), then 12 (gate).

---

## Task 2: The foundation migration (10 tables, constraints, RLS, RBAC)

The single load-bearing artifact. Build it whole, then dry-run it.

**Files:**
- Create: `supabase/migrations/20260731000000_checklists_foundation.sql`

- [ ] **Step 1: Write the migration.** Transcribe spec 3 exactly. The full SQL:

```sql
-- Checklists foundation: 10 tables, constraints, RLS (deny-all service-role only), RBAC.
-- Ships dark. See tasks/checklists-discovery/spec.md v4 sections 3 and 12.

-- 1. checklists
CREATE TABLE public.checklists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  department  text NOT NULL REFERENCES public.departments(name),
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. checklist_task_templates
CREATE TABLE public.checklist_task_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id         uuid NOT NULL REFERENCES public.checklists(id) ON DELETE RESTRICT,
  title                text NOT NULL,
  instruction          text,
  sort_order           int NOT NULL DEFAULT 0,
  department           text REFERENCES public.departments(name),
  schedule_kind        text NOT NULL CHECK (schedule_kind IN ('calendar','floating')),
  freq                 text CHECK (freq IN ('daily','weekly','monthly','quarterly','annual')),
  freq_interval        int NOT NULL DEFAULT 1 CHECK (freq_interval >= 1),
  anchor_date          date,
  by_weekday           int[],
  anchor               text NOT NULL DEFAULT 'open'
                         CHECK (anchor IN ('open','close','every','at_times','anytime')),
  at_times             time[],
  every_hours          numeric,
  first_offset_minutes int,
  not_before           time,
  lead_minutes         int NOT NULL DEFAULT 0 CHECK (lead_minutes >= 0),
  grace_minutes        int CHECK (grace_minutes IS NULL OR grace_minutes >= 0),
  interval_days        int,
  tolerance_days       int,
  first_due_on         date,
  season_start         text CHECK (season_start IS NULL OR season_start ~ '^[0-1][0-9]-[0-3][0-9]$'),
  season_end           text CHECK (season_end IS NULL OR season_end ~ '^[0-1][0-9]-[0-3][0-9]$'),
  requires_value       boolean NOT NULL DEFAULT false,
  value_unit           text,
  value_min            numeric(5,1),
  value_max            numeric(5,1),
  is_spot_checkable    boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  version              int NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cl_tpl_calendar_shape CHECK (
    schedule_kind <> 'calendar' OR (
      freq IS NOT NULL AND interval_days IS NULL AND tolerance_days IS NULL AND first_due_on IS NULL
    )
  ),
  CONSTRAINT cl_tpl_floating_shape CHECK (
    schedule_kind <> 'floating' OR (
      interval_days >= 1 AND tolerance_days >= 0 AND first_due_on IS NOT NULL
      AND anchor = 'anytime' AND at_times IS NULL AND every_hours IS NULL
    )
  ),
  CONSTRAINT cl_tpl_every_shape CHECK (anchor <> 'every' OR every_hours > 0),
  CONSTRAINT cl_tpl_at_times_shape CHECK (anchor <> 'at_times' OR array_length(at_times, 1) >= 1),
  CONSTRAINT cl_tpl_every_only CHECK (
    anchor = 'every' OR (every_hours IS NULL AND first_offset_minutes IS NULL AND not_before IS NULL)
  ),
  CONSTRAINT cl_tpl_anchor_date CHECK (
    NOT (freq_interval > 1 OR freq IN ('weekly','monthly','quarterly','annual')) OR anchor_date IS NOT NULL
  ),
  CONSTRAINT cl_tpl_value_bounds CHECK (value_min IS NULL OR value_max IS NULL OR value_min <= value_max),
  CONSTRAINT cl_tpl_value_required CHECK (
    NOT requires_value OR ((value_min IS NOT NULL OR value_max IS NOT NULL) AND value_unit IS NOT NULL)
  ),
  CONSTRAINT cl_tpl_season_pair CHECK ((season_start IS NULL) = (season_end IS NULL))
);
CREATE INDEX idx_cl_tpl_checklist ON public.checklist_task_templates(checklist_id);
CREATE INDEX idx_cl_tpl_active ON public.checklist_task_templates(is_active) WHERE is_active;

-- 3. checklist_generation_runs (declared before instances for the FK)
CREATE TABLE public.checklist_generation_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date       date NOT NULL,
  attempt             int NOT NULL DEFAULT 1,
  status              text NOT NULL CHECK (status IN ('running','complete','failed','skipped_closed')),
  window              jsonb,
  instances_created   int,
  instances_updated   int,
  instances_retracted int,
  error_message       text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  UNIQUE (business_date, attempt)
);

-- 4. checklist_task_instances
CREATE TABLE public.checklist_task_instances (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id              uuid NOT NULL REFERENCES public.checklist_task_templates(id) ON DELETE RESTRICT,
  template_version         int NOT NULL,
  checklist_id             uuid NOT NULL REFERENCES public.checklists(id) ON DELETE RESTRICT,
  generation_run_id        uuid REFERENCES public.checklist_generation_runs(id),
  business_date            date NOT NULL,
  slot                     text NOT NULL,
  department               text NOT NULL,
  title_snapshot           text NOT NULL,
  instruction_snapshot     text,
  requires_value           boolean NOT NULL,
  value_unit               text,
  value_min                numeric(5,1),
  value_max                numeric(5,1),
  is_spot_checkable        boolean NOT NULL,
  window_start             timestamptz NOT NULL,
  due_at                   timestamptz NOT NULL,
  grace_until              timestamptz NOT NULL,
  state                    text NOT NULL DEFAULT 'pending'
                             CHECK (state IN ('pending','done','missed','skipped','not_applicable')),
  locked_at                timestamptz,
  accountable_employee_id  uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  completed_by_employee_id uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  completed_at             timestamptz,
  was_late                 boolean NOT NULL DEFAULT false,
  value_recorded           numeric(5,1),
  value_breach             boolean NOT NULL DEFAULT false,
  notes                    text,
  skip_reason              text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (template_id, business_date, slot),
  CONSTRAINT cl_inst_time_order CHECK (window_start <= due_at AND due_at <= grace_until),
  CONSTRAINT cl_inst_done_fields CHECK (
    state <> 'done' OR (completed_by_employee_id IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT cl_inst_open_fields CHECK (
    state NOT IN ('missed','pending')
    OR (completed_by_employee_id IS NULL AND completed_at IS NULL AND value_recorded IS NULL)
  ),
  CONSTRAINT cl_inst_skip_reason CHECK (state <> 'skipped' OR skip_reason IS NOT NULL),
  CONSTRAINT cl_inst_value_present CHECK (
    NOT (requires_value AND state = 'done') OR value_recorded IS NOT NULL
  ),
  CONSTRAINT cl_inst_value_absent CHECK (requires_value OR value_recorded IS NULL)
);
CREATE INDEX idx_cl_inst_date_checklist ON public.checklist_task_instances(business_date, checklist_id);
CREATE INDEX idx_cl_inst_completer ON public.checklist_task_instances(completed_by_employee_id, business_date);
CREATE INDEX idx_cl_inst_pending ON public.checklist_task_instances(grace_until) WHERE state = 'pending';
CREATE INDEX idx_cl_inst_run ON public.checklist_task_instances(generation_run_id);

-- 5. checklist_spot_checks
CREATE TABLE public.checklist_spot_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id         uuid NOT NULL REFERENCES public.checklist_task_instances(id),
  business_date       date NOT NULL,
  draw_number         int NOT NULL,
  checked_employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  drawn_at            timestamptz NOT NULL DEFAULT now(),
  state               text NOT NULL DEFAULT 'drawn' CHECK (state IN ('drawn','recorded')),
  checked_by_user_id  uuid,
  result              text CHECK (result IN ('pass','fail')),
  note                text,
  recorded_at         timestamptz,
  UNIQUE (instance_id),
  UNIQUE (business_date, draw_number),
  CONSTRAINT cl_spot_recorded CHECK (
    state <> 'recorded'
    OR (result IS NOT NULL AND recorded_at IS NOT NULL AND checked_by_user_id IS NOT NULL)
  )
);
CREATE INDEX idx_cl_spot_date ON public.checklist_spot_checks(business_date);

-- 6. checklist_todos
CREATE TABLE public.checklist_todos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    text NOT NULL,
  description              text,
  department               text REFERENCES public.departments(name),
  assigned_employee_id     uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  due_date                 date,
  state                    text NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','cancelled')),
  completed_by_employee_id uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  completed_at             timestamptz,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cl_todos_state_due ON public.checklist_todos(state, due_date);

-- 7. checklist_email_outbox
CREATE TABLE public.checklist_email_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_type      text NOT NULL CHECK (email_type IN ('weekly_summary','value_breach','system_alert')),
  source_type     text NOT NULL,
  source_id       text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  to_addresses    text[] NOT NULL,
  subject         text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','held','sent','failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  error_message   text,
  message_id      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX idx_cl_outbox_status ON public.checklist_email_outbox(status, next_attempt_at);

-- 8. checklist_settings (singleton)
CREATE TABLE public.checklist_settings (
  id                             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  autumn_winter_start            text NOT NULL DEFAULT '10-01',
  autumn_winter_end              text NOT NULL DEFAULT '03-31',
  spot_checks_per_day            int NOT NULL DEFAULT 2,
  default_grace_minutes          int NOT NULL DEFAULT 30,
  business_day_start_hour        int NOT NULL DEFAULT 6,
  open_lead_minutes              int NOT NULL DEFAULT 0,
  close_lead_minutes             int NOT NULL DEFAULT 60,
  mismatch_threshold_minutes     int NOT NULL DEFAULT 30,
  mismatch_early_threshold_minutes int NOT NULL DEFAULT 90,
  module_enabled                 boolean NOT NULL DEFAULT false,
  generation_enabled             boolean NOT NULL DEFAULT false,
  prompts_enabled                boolean NOT NULL DEFAULT false,
  emails_enabled                 boolean NOT NULL DEFAULT false,
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  updated_by                     uuid
);
INSERT INTO public.checklist_settings (id) VALUES (1);

-- 9. checklist_hours_mismatches
CREATE TABLE public.checklist_hours_mismatches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date          date NOT NULL,
  kind                   text NOT NULL CHECK (kind IN ('no_cover_at_open','no_cover_at_close','rota_before_open')),
  expected_opens_at      timestamptz,
  expected_closes_at     timestamptz,
  rota_earliest_start_at timestamptz,
  rota_latest_end_at     timestamptz,
  mismatch_minutes       int NOT NULL,
  notified_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_date, kind)
);

-- 10. checklist_spot_check_expectations
CREATE TABLE public.checklist_spot_check_expectations (
  business_date date PRIMARY KEY,
  expected      int NOT NULL
);

-- RLS: all tables deny-all, service-role only
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'checklists','checklist_task_templates','checklist_generation_runs',
    'checklist_task_instances','checklist_spot_checks','checklist_todos',
    'checklist_email_outbox','checklist_settings','checklist_hours_mismatches',
    'checklist_spot_check_expectations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      t || '_service_role', t
    );
  END LOOP;
END $$;

-- RBAC: the checklists module
INSERT INTO public.permissions (module_name, action, description) VALUES
  ('checklists', 'view',   'View and complete checklist tasks'),
  ('checklists', 'manage', 'Set up checklists, view insights, run spot checks')
ON CONFLICT (module_name, action) DO UPDATE SET description = EXCLUDED.description;

-- super_admin + manager: view + manage
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.name IN ('super_admin','manager') AND p.module_name = 'checklists'
ON CONFLICT DO NOTHING;

-- staff: view only
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.name = 'staff' AND p.module_name = 'checklists' AND p.action = 'view'
ON CONFLICT DO NOTHING;
-- NOTE: foh_staff is deliberately NOT granted here. Its grant ships in Phase 2 in the
-- same deploy as the FOH_MODULES widening (spec sections 12 and 14).
```

- [ ] **Step 2: Dry-run the migration.**

Run: `npx supabase db push --dry-run`
Expected: the new migration is listed as pending with no SQL errors. If it reports a
conflicting timestamp, rename to the next free `20260731...` prefix. Do NOT push to prod in
this task.

- [ ] **Step 3: Sanity-check the SQL parses** by counting the table statements.

Run: `grep -c "CREATE TABLE public.checklist" supabase/migrations/20260731000000_checklists_foundation.sql`
Expected: `10` (nine `checklist_*` plus `checklists`). Confirm the RLS `DO $$` array lists
all ten tables.

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/20260731000000_checklists_foundation.sql
git commit -m "feat(checklists): foundation migration (10 tables, RLS, RBAC), ships dark"
```

---

## Task 3: Add `checklists` to the RBAC ModuleName union

**Files:**
- Modify: `src/types/rbac.ts` (the `ModuleName` union, ends `| 'mgd'`)

- [ ] **Step 1: Add the member.** Append `| 'checklists'` to the `ModuleName` union after
      `| 'mgd'`.

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit`. Expected: clean. The union is
      additive. If `tsc` flags a non-exhaustive switch in a file outside checklists, that is
      pre-existing; leave it alone.

- [ ] **Step 3: Commit.**

```bash
git add src/types/rbac.ts
git commit -m "feat(checklists): register the checklists RBAC module name"
```

---

## Task 5: Trading-window resolver (pure core)

The section 5.1 truth table as a pure function. The async DB wrapper is Phase 2.

**Files:**
- Create: `src/lib/checklists/trading-window.ts`
- Test: `src/lib/checklists/__tests__/trading-window.test.ts`

- [ ] **Step 1: Write the failing test** covering every row of the truth table.

```ts
// src/lib/checklists/__tests__/trading-window.test.ts
import { describe, it, expect } from 'vitest'
import { coalesceTradingWindow } from '../trading-window'
import type { HoursRow } from '../types'

const h = (o: string | null, c: string | null, closed: boolean | null): HoursRow =>
  ({ opens: o, closes: c, is_closed: closed })

describe('coalesceTradingWindow (spec 5.1 truth table)', () => {
  it('no special row: uses business throughout', () => {
    expect(coalesceTradingWindow(null, h('16:00', '22:00', false)))
      .toEqual({ isClosed: false, opens: '16:00', closes: '22:00', source: 'business_hours' })
  })
  it('special is_closed=true: closed regardless of times', () => {
    expect(coalesceTradingWindow(h('12:00', '22:00', true), h('16:00', '22:00', false)))
      .toEqual({ isClosed: true, source: 'special_hours' })
  })
  it('special is_closed=false: open, times coalesce special over business', () => {
    expect(coalesceTradingWindow(h('12:00', null, false), h('16:00', '22:00', false)))
      .toEqual({ isClosed: false, opens: '12:00', closes: '22:00', source: 'special_hours' })
  })
  it('special is_closed=NULL, business closed: inherits closed', () => {
    expect(coalesceTradingWindow(h('12:00', null, null), h('16:00', '22:00', true)))
      .toEqual({ isClosed: true, source: 'business_hours' })
  })
  it('special is_closed=NULL, business open: open with special times', () => {
    expect(coalesceTradingWindow(h('12:00', null, null), h('16:00', '22:00', false)))
      .toEqual({ isClosed: false, opens: '12:00', closes: '22:00', source: 'special_hours' })
  })
  it('resolved open but a time is missing: no_hours', () => {
    expect(coalesceTradingWindow(null, h('16:00', null, false)))
      .toEqual({ resolved: false, reason: 'no_hours' })
  })
  it('opens equals closes: invalid_hours', () => {
    expect(coalesceTradingWindow(null, h('22:00', '22:00', false)))
      .toEqual({ resolved: false, reason: 'invalid_hours' })
  })
  it('both rows null: no_hours', () => {
    expect(coalesceTradingWindow(null, null)).toEqual({ resolved: false, reason: 'no_hours' })
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npx vitest run src/lib/checklists/__tests__/trading-window.test.ts` gives FAIL (function undefined).

- [ ] **Step 3: Implement `coalesceTradingWindow`** per spec 5.1. Signature and doc:

```ts
// src/lib/checklists/trading-window.ts
import type { HoursRow, TradingWindow } from './types'

/**
 * Pure core of the trading-window resolver (spec 5.1). Field-by-field COALESCE of a
 * special_hours row over a business_hours row, INCLUDING is_closed. Never fabricates a
 * window: missing hours give { resolved:false }. The async DB wrapper resolveTradingWindow()
 * (Phase 2) reads the two rows and calls this.
 *
 * source is 'special_hours' when the special row governed the outcome (its is_closed, or it
 * supplied opens), else 'business_hours'.
 */
export function coalesceTradingWindow(
  special: HoursRow | null,
  business: HoursRow | null,
): TradingWindow {
  // Implement the 5.1 truth table exactly. opens/closes coalesce special ?? business.
  // is_closed coalesces special.is_closed ?? business.is_closed ?? false.
  // opens === closes gives invalid_hours. Follow the test's `source` values precisely.
}
```

- [ ] **Step 4: Run to verify it passes.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/checklists/trading-window.ts src/lib/checklists/__tests__/trading-window.test.ts
git commit -m "feat(checklists): trading-window coalesce core per spec 5.1"
```

---

## Task 6: Window instants (cross-midnight, business day)

**Files:**
- Create: `src/lib/checklists/window.ts`
- Test: `src/lib/checklists/__tests__/window.test.ts`

Uses `date-fns-tz` (`fromZonedTime`) for London instants. Tests assert on `.toISOString()`
so they are TZ-independent (do not construct expected dates with `new Date(localString)`).

- [ ] **Step 1: Write the failing test.** Key cases per spec 5.3:

```ts
// src/lib/checklists/__tests__/window.test.ts
import { describe, it, expect } from 'vitest'
import { expandInstants, businessDayBounds } from '../window'

describe('expandInstants (spec 5.3)', () => {
  it('same-day window 16:00 to 22:00 in summer (BST, UTC+1)', () => {
    const r = expandInstants('2026-07-17', '16:00', '22:00')
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.opensAt.toISOString()).toBe('2026-07-17T15:00:00.000Z')
    expect(r.closesAt.toISOString()).toBe('2026-07-17T21:00:00.000Z')
  })
  it('cross-midnight: closes <= opens means next calendar day', () => {
    const r = expandInstants('2026-07-17', '16:00', '00:00')
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.closesAt.toISOString()).toBe('2026-07-17T23:00:00.000Z')
  })
  it('winter window uses GMT (UTC+0)', () => {
    const r = expandInstants('2026-01-15', '16:00', '22:00')
    if (!('opensAt' in r)) throw new Error('expected a window')
    expect(r.opensAt.toISOString()).toBe('2026-01-15T16:00:00.000Z')
  })
  it('close past the 06:00 business-day end is invalid', () => {
    expect(expandInstants('2026-07-17', '16:00', '07:00')).toEqual({ error: 'invalid_hours' })
  })
})

describe('businessDayBounds', () => {
  it('06:00 London to 06:00 next day (BST)', () => {
    const { start, end } = businessDayBounds('2026-07-17', 6)
    expect(start.toISOString()).toBe('2026-07-17T05:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-18T05:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** per spec 5.3:

```ts
// src/lib/checklists/window.ts
import { fromZonedTime } from 'date-fns-tz'
import type { WindowInstants } from './types'

const TZ = 'Europe/London'

/** Build the day's open/close instants. closes <= opens gives a next-calendar-day close.
 *  A close at or past the next business-day start (default 06:00) is invalid. */
export function expandInstants(
  businessDate: string, opens: string, closes: string, businessDayStartHour = 6,
): WindowInstants | { error: 'invalid_hours' } {
  // Normalise HH:MM:SS to HH:MM. opensAt = fromZonedTime(`${businessDate}T${opens}`, TZ).
  // If closes <= opens (HH:MM string compare) closesAt is on the next calendar day.
  // invalid if closesAt >= businessDayBounds(businessDate, businessDayStartHour).end.
}

export function businessDayBounds(businessDate: string, startHour = 6): { start: Date; end: Date } {
  // start = fromZonedTime(`${businessDate}T${pad(startHour)}:00`, TZ); end = start of next day at startHour.
}
```

- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** with `feat(checklists): London window instants with cross-midnight handling`.

---

## Task 7: Cadence engine

**Files:**
- Create: `src/lib/checklists/cadence.ts`
- Test: `src/lib/checklists/__tests__/cadence.test.ts`

Functions (all pure, per spec 4):

```ts
export function inSeason(date: string, start: string | null, end: string | null): boolean
export function isCalendarDueOn(t: CadenceTemplate, date: string): boolean
export function everySlots(opensAt: Date, closesAt: Date, everyHours: number,
                           opts?: { firstOffsetMinutes?: number | null; notBefore?: Date | null }): Date[]
export function nextFloatingDue(
  prior: { dueDate: string; state: InstanceState; completedDate: string | null; graceDate: string } | null,
  interval: number, firstDueOn: string,
): string
```

- [ ] **Step 1: Write the failing test.** Write each of these as its own `it`, with concrete
      assertions:

```
inSeason('2026-01-15','10-01','03-31') === true   // wraps year end
inSeason('2026-07-15','10-01','03-31') === false
inSeason('2026-07-15', null, null) === true       // no season = always
weekly with freqInterval 2 and an anchorDate: due on the anchor week and 2 weeks later, not the week between
monthly anchored on the 31st: due 30 Apr and 28 Feb (clamp to last day of shorter months)
annual anchored 29 Feb: falls on 28 Feb in a non-leap year
everySlots(noon open, 22:00 close, 2h) has length 4 (14,16,18,20) with correct instants
everySlots(16:00 open, 22:00 close, 2h) has length 2 (18,20); a slot exactly at close is dropped
everySlots with notBefore 18:00 drops the 14:00 and 16:00 slots
nextFloatingDue(null, 4, '2026-07-06') === '2026-07-06'
nextFloatingDue(done on 07-07, due 07-06, 4, ...) === '2026-07-11'   // max(due,completed)+interval
nextFloatingDue(missed with graceDate 07-09, 4, ...) === '2026-07-13'
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** per spec 4 (anchors, season wrap, every-N clamped to the window,
      floating `max(due, completed) + interval` clamp). Use `date-fns` for date arithmetic;
      compare instants for `everySlots`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** with `feat(checklists): cadence engine (anchors, seasons, every-N, floating)`.

---

## Task 8: Accountability

**Files:**
- Create: `src/lib/checklists/accountability.ts`
- Test: `src/lib/checklists/__tests__/accountability.test.ts`

```ts
export function resolveCloser(shifts: ShiftRow[]): string | null
export function resolveCoverage(shifts: ShiftRow[], dueAt: Date, businessDate: string,
                                department: string): string | null
```

`resolveCloser` implements the spec 6 ordering over shifts already filtered to
`status='scheduled'`, `isOpenShift=false`, non-null `employeeId`: next-day finish
(`endTime <= startTime`) first, then latest `endTime`, then `department='bar'`, then earliest
`startTime`, then a stable tiebreak; returns the top `employeeId`. The function itself should
apply the filter defensively too.

- [ ] **Step 1: Write the failing test** with the prod-trap fixtures, each its own `it`:

```
Monday single all-day bar shift 16:00-22:00 -> that employeeId is the closer
two bar shifts both ending 22:00 -> deterministic winner (stable tiebreak, not input order): assert same result when the input array is reversed
latest finish is a kitchen shift, no bar at the max end -> the kitchen employeeId is the closer
a sick row (status 'sick') is excluded -> ignored even if it has the latest end
end_time '00:00:00' (Fri close) sorts as latest via endTime <= startTime
empty shift list -> null
an is_open_shift=true row with null employeeId -> excluded
```

- [ ] **Steps 2-4:** run (fail), implement per spec 6, run (pass).
- [ ] **Step 5: Commit** with `feat(checklists): accountability closer and coverage resolution`.

---

## Task 9: Scoring

**Files:**
- Create: `src/lib/checklists/scoring.ts`
- Test: `src/lib/checklists/__tests__/scoring.test.ts`

```ts
export function scoreTimeliness(instances: ScoredInstance[]): TimelinessResult
```

Per spec 7: 10 points if `completedAt <= graceUntil` else 5, averaged; `band` green >= 9.6 /
amber 7.6 to 9.5 / red <= 7.5; `score = null` when `count < 30` (suppressed), but `count` is
always returned.

- [ ] **Step 1: Write the failing test:**

```
30 on-time instances -> score 10, band 'green', count 30
29 on-time instances -> score null (suppressed), count 29
enough instances averaging 7.5 -> band 'red'
empty -> { score: null, count: 0, band: null }
```

- [ ] **Steps 2-4:** fail, implement, pass.
- [ ] **Step 5: Commit** with `feat(checklists): timeliness scoring per spec 7`.

---

## Task 10: Mismatch detection

**Files:**
- Create: `src/lib/checklists/mismatch.ts`
- Test: `src/lib/checklists/__tests__/mismatch.test.ts`

```ts
export interface MismatchInput {
  opensAt: Date; closesAt: Date
  earliestStartAt: Date | null; latestEndAt: Date | null
  earlyThresholdMinutes: number; thresholdMinutes: number
}
export function detectMismatches(input: MismatchInput):
  Array<{ kind: 'no_cover_at_open' | 'no_cover_at_close' | 'rota_before_open'; minutes: number }>
```

Per spec 8: `no_cover_at_open` when earliest start > opens + 30m; `no_cover_at_close` when
latest end < closes - 30m; `rota_before_open` when earliest start < opens - 90m. Multiple
kinds may return together.

- [ ] **Step 1: Write the failing test** including the critical guard:

```
2026-05-25 shape (opens 12:00, earliest start 16:00) -> includes no_cover_at_open
Sunday Cleaning shift starting exactly 90 min before open (10:30 vs 12:00) -> NO rota_before_open (threshold is strict): assert the array has no rota_before_open kind
latest end 21:00 vs 22:00 close -> includes no_cover_at_close
a normal day (start = open, end = close) -> empty array
```

- [ ] **Steps 2-4:** fail, implement, pass.
- [ ] **Step 5: Commit** with `feat(checklists): hours-mismatch detection`.

---

## Task 11: Spot-check draw (weighted, seeded RNG)

**Files:**
- Create: `src/lib/checklists/spot-draw.ts`
- Test: `src/lib/checklists/__tests__/spot-draw.test.ts`

```ts
export interface DrawCandidate { instanceId: string; templateId: string }
export function drawSpotChecks(
  candidates: DrawCandidate[],
  recentChecksByTemplate: Record<string, number>, // checks per template in the last 14 days
  count: number,
  rng: () => number, // injected; deterministic in tests
): string[] // chosen instanceIds, up to `count`, no repeats
```

Per spec 11: weight `1 / (1 + recentChecks[templateId] ?? 0)`, weighted random without
replacement.

- [ ] **Step 1: Write the failing test:**

```
rng returning 0 always picks the highest-weight (least-recently-checked) candidate first
fewer candidates than count -> returns all of them
no repeated instanceId in the returned set
deterministic output for a fixed rng sequence (assert exact ids)
```

- [ ] **Steps 2-4:** fail, implement, pass.
- [ ] **Step 5: Commit** with `feat(checklists): weighted spot-check draw with injectable RNG`.

---

## Task 12: Phase-1 verification gate

- [ ] **Step 1: Lint.** `npm run lint` gives 0 warnings. Fix any in checklists files.
- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` clean.
- [ ] **Step 3: Tests.** `npm test` all pass (existing suite plus the new checklists tests).
- [ ] **Step 4: Build.** `npm run build` succeeds.
- [ ] **Step 5: Migration dry-run.** `npx supabase db push --dry-run` lists the checklists
      migration as pending, no errors.
- [ ] **Step 6: Update the review section** in
      [implementation-plan.md](implementation-plan.md) with what shipped and any deviations.
- [ ] **Step 7: Final commit** if anything changed in the gate.

---

## Self-review

- **Spec coverage:** section 3 goes to Task 2; section 3.12 constraints go to Task 2 CHECKs;
  5.1 to Task 5; 5.3 to Task 6; 4 to Task 7; 6 to Task 8; 7 to Task 9; 8 to Task 10; 11 draw
  to Task 11; 12 RLS plus RBAC to Task 2; the `isFohOnlyUser` pin to Task 1. Deferred to
  Phase 2 (correctly, not gaps): the async DB wrappers, jobs, cron, screens, the
  `FOH_MODULES` change, and the foh_staff grant.
- **Type consistency:** every function signature draws its argument/return types from Task
  4's `types.ts`. `ScoredInstance`, `CadenceTemplate`, `ShiftRow`, `TradingWindow`,
  `HoursRow`, `WindowInstants`, `TimelinessResult` are defined once and reused.
- **No live risk:** nothing here runs. No cron entry, no job type registered, no UI import,
  every settings flag false. The migration is additive; RLS denies everyone but the service
  role.
