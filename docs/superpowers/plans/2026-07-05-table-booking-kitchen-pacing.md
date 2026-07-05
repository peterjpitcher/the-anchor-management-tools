# Table-booking kitchen pacing — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap how many food covers can *arrive* in any rolling 30-minute window so table bookings spread across the service instead of stacking on the opening slot, while reserving headroom for walk-ins — enforced authoritatively inside the one booking RPC, configurable by managers, and exposed so the website can grey out full slots.

**Architecture:** Split along the test harness boundary. The covers-in-window arithmetic and config resolution live in a new pure TypeScript module (`src/lib/table-bookings/kitchen-pacing.ts`) that is unit-tested with Vitest (TDD). The authoritative enforcement is a mirrored SQL block added inside `create_table_booking_v05` (the single choke point every booking passes through), verified by a Supabase MCP smoke test after apply because this repo has **no** SQL test harness. Config is stored in the existing `system_settings` key/value table plus nullable per-date override columns on `special_hours`. The feature ships behind `kitchen_pacing_enabled` defaulting to `false`, so applying the migrations changes nothing until a manager switches it on.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase Postgres (PL/pgSQL RPC), Vitest, Tailwind v4. Prod migrations applied via Supabase MCP `apply_migration` (project_id `tfcasgxopxegwrabvwat`), never `db push`.

---

## Ground rules (read before starting)

- **Isolation:** the user is editing the working tree in a parallel session. Do all work on a dedicated branch/worktree. Stage only files you created/edited; never `git add -A`; inspect the staged diff before every commit.
- **No SQL unit tests exist** (no pgTAP, no local DB). Do not fake the RPC in Vitest and call it tested. TS mirror = TDD in Vitest; SQL gate = MCP smoke test post-apply.
- **Prod apply + push to `main` are outward, hard-to-reverse actions.** Build and test everything locally first. **Pause and get explicit user confirmation before** (a) applying any migration to prod via MCP, and (b) pushing to `main`. `anchor-management-tools` auto-deploys `main`.
- **`system_settings.value` is jsonb with mixed shapes.** Pacing keys are wrapped `{"value": N}`. Read via `(value->>'value')` in SQL and the existing `coerceInteger` unwrap (`source.value ?? source.minutes`) in TS. Store new keys wrapped as `{"value": N}`.
- **`committed_party_size` is `integer NOT NULL`** (no default) — but mirror `buildBookingLoad` and use `COALESCE(committed_party_size, party_size)` everywhere for parity.
- **Two distinct fields:** `booking_type` ∈ {`regular`,`sunday_lunch`} (enum); `booking_purpose` ∈ {`food`,`drinks`} (text CHECK, default `food`). Kitchen covers = `booking_purpose = 'food'`. Sunday tighter cap keys off `EXTRACT(DOW FROM booking_date) = 0`, NOT booking_type (sunday_lunch is retired; roasts arrive as regular+food).
- **Migrations must be idempotent** (`ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP FUNCTION IF EXISTS` before `CREATE`). Filenames `YYYYMMDDHHMMSS_snake.sql`.

---

## File structure

**Create:**
- `src/lib/table-bookings/kitchen-pacing.ts` — pure config types/keys/defaults, `system_settings` read/write, per-date override resolution, and the pure covers-in-window / ceiling / availability-slot helpers. One responsibility: kitchen pacing maths + config. No JSX, no route logic.
- `src/lib/table-bookings/kitchen-pacing.test.ts` — Vitest unit tests for every pure helper.
- `src/app/api/settings/table-bookings/kitchen-pacing/route.ts` — GET/PATCH for the cap config (mirrors the existing pacing route).
- `supabase/migrations/<ts>_kitchen_pacing_settings.sql` — additive settings rows + `special_hours` override columns.
- `supabase/migrations/<ts>_kitchen_pacing_gate_v06.sql` — redefine `create_table_booking_v05` (DROP+CREATE, +`p_bypass_pacing`, +advisory lock, +pacing gate).

**Modify:**
- `src/lib/table-bookings/load.ts` — export `shouldCountBooking` (currently module-private) so the new module reuses the exact exclusion rules.
- `src/app/api/foh/bookings/route.ts` — add `bypass_pacing` to the schema, gate it (manager/super_admin), audit it, pass `p_bypass_pacing`; walk-ins auto-bypass.
- `src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts` + `.../components/FohCreateBookingModal.tsx` — add the override toggle to `CreateForm` and the POST body (Phase 2).
- `src/app/api/table-bookings/load/route.ts` — add a `capacity` object + `slots` to the response (Phase 2).
- `src/app/(authenticated)/settings/table-bookings/TableSetupManager.tsx` — add a "Kitchen pacing (cap)" settings card (Phase 1 config UI).

---

# Phase 1 — Core gate (AMS + prod DB). Independently deployable; ships disabled.

## Task 1: Export `shouldCountBooking` from load.ts for reuse

**Files:**
- Modify: `src/lib/table-bookings/load.ts` (the `function shouldCountBooking(...)` declaration)

- [ ] **Step 1: Make it exported.** Change the declaration from `function shouldCountBooking(` to `export function shouldCountBooking(`. Do not change its body — it already encodes the exclusion rules (cancelled/no_show dropped; `left_at` set dropped; expired unpaid `pending_payment`/`pending_card_capture` holds dropped via strict `hold_expires_at < now`).

- [ ] **Step 2: Verify nothing else breaks.**

Run: `npx tsc --noEmit`
Expected: clean (an added `export` never breaks callers).

- [ ] **Step 3: Commit**

```bash
git add src/lib/table-bookings/load.ts
git commit -m "refactor(table-bookings): export shouldCountBooking for reuse"
```

## Task 2: Pure kitchen-pacing module (TDD)

**Files:**
- Create: `src/lib/table-bookings/kitchen-pacing.ts`
- Test: `src/lib/table-bookings/kitchen-pacing.test.ts`

- [ ] **Step 1: Write the failing tests** (copy the fixture-driven, injectable-client style of `move-table.test.ts`).

```typescript
// src/lib/table-bookings/kitchen-pacing.test.ts
import { describe, expect, it } from 'vitest'
import {
  sumKitchenCoversInWindow,
  resolveKitchenCeiling,
  isSundayDate,
  buildKitchenAvailabilitySlots,
  type KitchenBookingRow,
  type KitchenPacingSettings,
} from './kitchen-pacing'

const NOW = new Date('2026-07-05T10:00:00.000Z')

function row(partial: Partial<KitchenBookingRow>): KitchenBookingRow {
  return {
    booking_time: '19:00',
    booking_purpose: 'food',
    party_size: 4,
    committed_party_size: null,
    status: 'confirmed',
    left_at: null,
    hold_expires_at: null,
    payment_status: null,
    ...partial,
  }
}

const SETTINGS: KitchenPacingSettings = {
  enabled: true,
  windowMinutes: 30,
  paceCoversRegular: 25,
  paceCoversSunday: 20,
  walkInReserveRegular: 6,
  walkInReserveSunday: 6,
}

describe('sumKitchenCoversInWindow', () => {
  it('sums food covers inside the centered window and ignores those outside it', () => {
    const rows = [
      row({ booking_time: '19:00', party_size: 4 }), // center
      row({ booking_time: '19:10', party_size: 2 }), // +10 -> inside [18:45,19:15)
      row({ booking_time: '19:20', party_size: 5 }), // +20 -> outside
      row({ booking_time: '18:40', party_size: 3 }), // -20 -> outside
    ]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(6)
  })

  it('excludes drinks-only covers', () => {
    const rows = [row({ booking_purpose: 'drinks', party_size: 8 })]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(0)
  })

  it('prefers committed_party_size over party_size', () => {
    const rows = [row({ committed_party_size: 6, party_size: 2 })]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(6)
  })

  it('excludes cancelled, no_show, left, and expired unpaid holds', () => {
    const rows = [
      row({ status: 'cancelled', party_size: 4 }),
      row({ status: 'no_show', party_size: 4 }),
      row({ left_at: '2026-07-05T19:30:00Z', party_size: 4 }),
      row({ status: 'pending_payment', hold_expires_at: '2026-07-05T09:00:00Z', payment_status: 'pending', party_size: 4 }),
    ]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(0)
  })

  it('includes a live (unexpired) hold', () => {
    const rows = [row({ status: 'pending_payment', hold_expires_at: '2026-07-05T23:00:00Z', payment_status: 'pending', party_size: 4 })]
    expect(sumKitchenCoversInWindow(rows, 19 * 60, 30, NOW)).toBe(4)
  })
})

describe('resolveKitchenCeiling', () => {
  it('uses regular pace minus reserve on a weekday', () => {
    expect(resolveKitchenCeiling(SETTINGS, '2026-07-06', null)).toBe(25 - 6) // Monday
  })
  it('uses sunday pace minus reserve on a Sunday', () => {
    expect(resolveKitchenCeiling(SETTINGS, '2026-07-05', null)).toBe(20 - 6) // Sunday
  })
  it('applies a per-date override when present', () => {
    expect(resolveKitchenCeiling(SETTINGS, '2026-07-06', { paceCovers: 40, walkInReserve: 10 })).toBe(30)
  })
  it('never returns below zero', () => {
    expect(resolveKitchenCeiling({ ...SETTINGS, paceCoversRegular: 3, walkInReserveRegular: 10 }, '2026-07-06', null)).toBe(0)
  })
})

describe('isSundayDate', () => {
  it('detects Sunday from a YYYY-MM-DD string', () => {
    expect(isSundayDate('2026-07-05')).toBe(true)
    expect(isSundayDate('2026-07-06')).toBe(false)
  })
})

describe('buildKitchenAvailabilitySlots', () => {
  it('returns covers and remaining per grid slot', () => {
    const rows = [row({ booking_time: '19:00', party_size: 10 })]
    const slots = buildKitchenAvailabilitySlots(rows, SETTINGS, '2026-07-06', 18 * 60, 19 * 60, 30, null, NOW)
    // grid: 18:00, 18:30, 19:00 ; ceiling weekday = 19
    const at1900 = slots.find((s) => s.time === '19:00')!
    expect(at1900.covers).toBe(10)
    expect(at1900.remaining).toBe(9)
    const at1800 = slots.find((s) => s.time === '18:00')!
    expect(at1800.covers).toBe(0)
    expect(at1800.remaining).toBe(19)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/table-bookings/kitchen-pacing.test.ts`
Expected: FAIL — module `./kitchen-pacing` not found.

- [ ] **Step 3: Write the module**

```typescript
// src/lib/table-bookings/kitchen-pacing.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin' // mirror the import used at the top of load.ts if the path differs
import { shouldCountBooking } from './load'

export type KitchenBookingRow = {
  booking_time: string | null
  booking_purpose?: string | null
  party_size: number | null
  committed_party_size: number | null
  status: string | null
  left_at: string | null
  hold_expires_at: string | null
  payment_status: string | null
}

export type KitchenPacingSettings = {
  enabled: boolean
  windowMinutes: number
  paceCoversRegular: number
  paceCoversSunday: number
  walkInReserveRegular: number
  walkInReserveSunday: number
}

export type PublicKitchenPacingSettings = {
  enabled: boolean
  window_minutes: number
  pace_covers_regular: number
  pace_covers_sunday: number
  walk_in_reserve_regular: number
  walk_in_reserve_sunday: number
}

export type KitchenPacingOverride = { paceCovers: number | null; walkInReserve: number | null } | null

export type KitchenAvailabilitySlot = { time: string; covers: number; remaining: number }

const DEFAULTS: KitchenPacingSettings = {
  enabled: false,
  windowMinutes: 30,
  paceCoversRegular: 25,
  paceCoversSunday: 20,
  walkInReserveRegular: 6,
  walkInReserveSunday: 6,
}

const KEYS = {
  enabled: 'kitchen_pacing_enabled',
  windowMinutes: 'kitchen_pacing_window_minutes',
  paceCoversRegular: 'kitchen_pace_covers_regular',
  paceCoversSunday: 'kitchen_pace_covers_sunday',
  walkInReserveRegular: 'kitchen_walk_in_reserve_regular',
  walkInReserveSunday: 'kitchen_walk_in_reserve_sunday',
} as const

const DESCRIPTIONS: Record<keyof typeof KEYS, string> = {
  enabled: 'Kitchen pacing: master on/off for the covers-per-window cap.',
  windowMinutes: 'Kitchen pacing: rolling window length in minutes.',
  paceCoversRegular: 'Kitchen pacing: max food covers per window on a normal service.',
  paceCoversSunday: 'Kitchen pacing: max food covers per window on a Sunday.',
  walkInReserveRegular: 'Kitchen pacing: covers per window reserved for walk-ins (normal).',
  walkInReserveSunday: 'Kitchen pacing: covers per window reserved for walk-ins (Sunday).',
}

function coerceInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const n = Number.parseInt(value.trim(), 10)
    return Number.isFinite(n) ? n : null
  }
  if (value && typeof value === 'object') {
    const s = value as Record<string, unknown>
    return coerceInt(s.value ?? s.minutes)
  }
  return null
}

function coerceBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (value && typeof value === 'object') return coerceBool((value as Record<string, unknown>).value)
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}

function timeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function coversOf(row: KitchenBookingRow): number {
  const committed = coerceInt(row.committed_party_size)
  const party = coerceInt(row.party_size)
  return committed ?? party ?? 0
}

function isKitchenRow(row: KitchenBookingRow, now: Date): boolean {
  if ((row.booking_purpose ?? 'food') !== 'food') return false
  // shouldCountBooking takes the load.ts BookingLoadRow shape; our fields are a superset.
  return shouldCountBooking(row as never, now)
}

export function isSundayDate(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 0
}

export function sumKitchenCoversInWindow(
  rows: KitchenBookingRow[],
  centerMinutes: number,
  windowMinutes: number,
  now: Date = new Date()
): number {
  const half = windowMinutes / 2
  let sum = 0
  for (const row of rows) {
    if (!isKitchenRow(row, now)) continue
    const t = timeToMinutes(row.booking_time)
    if (t === null) continue
    if (t >= centerMinutes - half && t < centerMinutes + half) sum += coversOf(row)
  }
  return sum
}

export function resolveKitchenCeiling(
  settings: KitchenPacingSettings,
  dateStr: string,
  override: KitchenPacingOverride
): number {
  const sunday = isSundayDate(dateStr)
  const pace = override?.paceCovers ?? (sunday ? settings.paceCoversSunday : settings.paceCoversRegular)
  const reserve = override?.walkInReserve ?? (sunday ? settings.walkInReserveSunday : settings.walkInReserveRegular)
  return Math.max(0, pace - reserve)
}

export function buildKitchenAvailabilitySlots(
  rows: KitchenBookingRow[],
  settings: KitchenPacingSettings,
  dateStr: string,
  gridStartMinutes: number,
  gridEndMinutes: number,
  stepMinutes: number,
  override: KitchenPacingOverride,
  now: Date = new Date()
): KitchenAvailabilitySlot[] {
  const ceiling = resolveKitchenCeiling(settings, dateStr, override)
  const out: KitchenAvailabilitySlot[] = []
  for (let m = gridStartMinutes; m <= gridEndMinutes; m += stepMinutes) {
    const covers = sumKitchenCoversInWindow(rows, m, settings.windowMinutes, now)
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    out.push({ time: `${hh}:${mm}`, covers, remaining: Math.max(0, ceiling - covers) })
  }
  return out
}

export function toPublicKitchenPacingSettings(s: KitchenPacingSettings): PublicKitchenPacingSettings {
  return {
    enabled: s.enabled,
    window_minutes: s.windowMinutes,
    pace_covers_regular: s.paceCoversRegular,
    pace_covers_sunday: s.paceCoversSunday,
    walk_in_reserve_regular: s.walkInReserveRegular,
    walk_in_reserve_sunday: s.walkInReserveSunday,
  }
}

export function validateKitchenPacingSettings(
  input: Partial<Record<keyof KitchenPacingSettings, unknown>>
): { ok: true; settings: KitchenPacingSettings } | { ok: false; error: string } {
  const windowMinutes = coerceInt(input.windowMinutes)
  const paceCoversRegular = coerceInt(input.paceCoversRegular)
  const paceCoversSunday = coerceInt(input.paceCoversSunday)
  const walkInReserveRegular = coerceInt(input.walkInReserveRegular)
  const walkInReserveSunday = coerceInt(input.walkInReserveSunday)

  if (!windowMinutes || windowMinutes < 10 || windowMinutes > 180 || windowMinutes % 5 !== 0) {
    return { ok: false, error: 'Window must be a multiple of 5 between 10 and 180 minutes' }
  }
  for (const [label, v] of [
    ['Regular pace', paceCoversRegular],
    ['Sunday pace', paceCoversSunday],
  ] as const) {
    if (!v || v < 1 || v > 500) return { ok: false, error: `${label} must be between 1 and 500 covers` }
  }
  for (const [label, v] of [
    ['Regular walk-in reserve', walkInReserveRegular],
    ['Sunday walk-in reserve', walkInReserveSunday],
  ] as const) {
    if (v === null || v < 0 || v > 500) return { ok: false, error: `${label} must be between 0 and 500 covers` }
  }
  return {
    ok: true,
    settings: {
      enabled: coerceBool(input.enabled),
      windowMinutes,
      paceCoversRegular: paceCoversRegular!,
      paceCoversSunday: paceCoversSunday!,
      walkInReserveRegular: walkInReserveRegular!,
      walkInReserveSunday: walkInReserveSunday!,
    },
  }
}

export async function getKitchenPacingSettings(
  supabase: SupabaseClient = createAdminClient()
): Promise<KitchenPacingSettings> {
  const { data, error } = await supabase.from('system_settings').select('key, value').in('key', Object.values(KEYS))
  if (error) {
    console.warn('[kitchen-pacing] Failed to load settings; using defaults')
    return DEFAULTS
  }
  const byKey = new Map((data || []).map((r) => [r.key, r.value]))
  return {
    enabled: coerceBool(byKey.get(KEYS.enabled)),
    windowMinutes: coerceInt(byKey.get(KEYS.windowMinutes)) ?? DEFAULTS.windowMinutes,
    paceCoversRegular: coerceInt(byKey.get(KEYS.paceCoversRegular)) ?? DEFAULTS.paceCoversRegular,
    paceCoversSunday: coerceInt(byKey.get(KEYS.paceCoversSunday)) ?? DEFAULTS.paceCoversSunday,
    walkInReserveRegular: coerceInt(byKey.get(KEYS.walkInReserveRegular)) ?? DEFAULTS.walkInReserveRegular,
    walkInReserveSunday: coerceInt(byKey.get(KEYS.walkInReserveSunday)) ?? DEFAULTS.walkInReserveSunday,
  }
}

export async function saveKitchenPacingSettings(
  supabase: SupabaseClient,
  settings: KitchenPacingSettings
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString()
  const rows = [
    { key: KEYS.enabled, value: { value: settings.enabled }, description: DESCRIPTIONS.enabled, updated_at: now },
    { key: KEYS.windowMinutes, value: { value: settings.windowMinutes }, description: DESCRIPTIONS.windowMinutes, updated_at: now },
    { key: KEYS.paceCoversRegular, value: { value: settings.paceCoversRegular }, description: DESCRIPTIONS.paceCoversRegular, updated_at: now },
    { key: KEYS.paceCoversSunday, value: { value: settings.paceCoversSunday }, description: DESCRIPTIONS.paceCoversSunday, updated_at: now },
    { key: KEYS.walkInReserveRegular, value: { value: settings.walkInReserveRegular }, description: DESCRIPTIONS.walkInReserveRegular, updated_at: now },
    { key: KEYS.walkInReserveSunday, value: { value: settings.walkInReserveSunday }, description: DESCRIPTIONS.walkInReserveSunday, updated_at: now },
  ]
  const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' })
  return error ? { ok: false, error: 'Failed to save kitchen pacing settings' } : { ok: true }
}

export async function getKitchenPacingOverrideForDate(
  dateStr: string,
  supabase: SupabaseClient = createAdminClient()
): Promise<KitchenPacingOverride> {
  const { data, error } = await supabase
    .from('special_hours')
    .select('kitchen_pace_covers, kitchen_walk_in_reserve')
    .eq('date', dateStr)
    .maybeSingle()
  if (error || !data) return null
  const pace = coerceInt(data.kitchen_pace_covers)
  const reserve = coerceInt(data.kitchen_walk_in_reserve)
  if (pace === null && reserve === null) return null
  return { paceCovers: pace, walkInReserve: reserve }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/table-bookings/kitchen-pacing.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: zero warnings, clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/table-bookings/kitchen-pacing.ts src/lib/table-bookings/kitchen-pacing.test.ts
git commit -m "feat(table-bookings): pure kitchen-pacing config + covers-in-window helpers"
```

## Task 3: Settings migration (additive; idempotent)

**Files:**
- Create: `supabase/migrations/<ts>_kitchen_pacing_settings.sql` (use a real 14-digit timestamp, later than the latest existing filename — check `ls supabase/migrations | tail`).

- [ ] **Step 1: Write the migration**

```sql
-- Kitchen pacing: config settings (ship disabled) + per-date override columns.
-- Additive + idempotent; changes nothing until kitchen_pacing_enabled is true.

INSERT INTO public.system_settings (key, value, description)
VALUES
  ('kitchen_pacing_enabled',          '{"value": false}', 'Kitchen pacing: master on/off for the covers-per-window cap.'),
  ('kitchen_pacing_window_minutes',   '{"value": 30}',    'Kitchen pacing: rolling window length in minutes.'),
  ('kitchen_pace_covers_regular',     '{"value": 25}',    'Kitchen pacing: max food covers per window on a normal service.'),
  ('kitchen_pace_covers_sunday',      '{"value": 20}',    'Kitchen pacing: max food covers per window on a Sunday.'),
  ('kitchen_walk_in_reserve_regular', '{"value": 6}',     'Kitchen pacing: covers per window reserved for walk-ins (normal).'),
  ('kitchen_walk_in_reserve_sunday',  '{"value": 6}',     'Kitchen pacing: covers per window reserved for walk-ins (Sunday).')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.special_hours
  ADD COLUMN IF NOT EXISTS kitchen_pace_covers integer,
  ADD COLUMN IF NOT EXISTS kitchen_walk_in_reserve integer;
```

- [ ] **Step 2: PAUSE — get user confirmation to apply to prod.** Show the SQL. Only on approval:

Apply via Supabase MCP: `apply_migration(project_id='tfcasgxopxegwrabvwat', name='kitchen_pacing_settings', query=<the SQL above>)`.

- [ ] **Step 3: Verify apply.**

Run via MCP `execute_sql`:
```sql
SELECT key, value FROM public.system_settings WHERE key LIKE 'kitchen_%' ORDER BY key;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='special_hours' AND column_name IN ('kitchen_pace_covers','kitchen_walk_in_reserve');
```
Expected: 6 settings rows present; 2 nullable integer columns present.

- [ ] **Step 4: Commit** (the repo file, regardless of prod-apply timing)

```bash
git add supabase/migrations/*_kitchen_pacing_settings.sql
git commit -m "feat(db): kitchen pacing settings + special_hours override columns"
```

## Task 4: Add the pacing gate inside create_table_booking_v05

> Track B — **not** unit-testable here. The SQL below mirrors the TS helpers from Task 2. Verify by MCP smoke test (Step 4).

**Files:**
- Create: `supabase/migrations/<ts>_kitchen_pacing_gate_v06.sql`

- [ ] **Step 1: Fetch the LIVE function definition first.** Prod may diverge from the repo. Via MCP `execute_sql`:
```sql
SELECT pg_get_functiondef('public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean)'::regprocedure);
```
Base the new migration on THIS body (not the repo file). If it differs materially from `20260719000000_...sql`, reconcile before proceeding.

- [ ] **Step 2: Write the migration.** Structure: DROP the old 10-arg signature, CREATE the 11-arg version = the live body with (a) the new `p_bypass_pacing boolean DEFAULT false` param appended, (b) the new DECLARE variables, (c) the pacing block spliced at the seam (after the `no_table` guard, before the deposit/status block), then re-REVOKE/GRANT.

```sql
-- Redefine create_table_booking_v05: add kitchen pacing gate + advisory lock.
-- Signature changes (adds p_bypass_pacing) => DROP old signature first to avoid
-- an overload (the project already hit overload ambiguity in 20260509000007).

DROP FUNCTION IF EXISTS public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean
);

CREATE OR REPLACE FUNCTION public.create_table_booking_v05(
  p_customer_id uuid,
  p_booking_date date,
  p_booking_time time without time zone,
  p_party_size integer,
  p_booking_purpose text DEFAULT 'food'::text,
  p_notes text DEFAULT NULL::text,
  p_sunday_lunch boolean DEFAULT false,
  p_source text DEFAULT 'brand_site'::text,
  p_bypass_cutoff boolean DEFAULT false,
  p_deposit_waived boolean DEFAULT false,
  p_bypass_pacing boolean DEFAULT false        -- NEW
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- ... KEEP ALL existing DECLARE lines from the live body ...
  -- NEW pacing variables:
  v_pacing_enabled boolean;
  v_pacing_window integer;
  v_pace_base integer;
  v_reserve_base integer;
  v_ovr_pace integer;
  v_ovr_reserve integer;
  v_pace integer;
  v_reserve integer;
  v_ceiling integer;
  v_center_minutes integer;
  v_half numeric;
  v_existing_covers integer;
  v_is_sunday boolean;
BEGIN
  -- ... KEEP the entire existing body verbatim up to and including the no_table guard:
  --   IF v_selected_table_ids IS NULL OR cardinality(v_selected_table_ids) = 0 THEN
  --     RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  --   END IF;

  -- ===== KITCHEN PACING GATE (new) =====
  IF NOT COALESCE(p_bypass_pacing, false) THEN
    SELECT COALESCE((value ->> 'value')::boolean, false)
      INTO v_pacing_enabled
      FROM public.system_settings WHERE key = 'kitchen_pacing_enabled';

    IF COALESCE(v_pacing_enabled, false) THEN
      v_is_sunday := EXTRACT(DOW FROM p_booking_date) = 0;

      SELECT COALESCE((value ->> 'value')::int, 30) INTO v_pacing_window
        FROM public.system_settings WHERE key = 'kitchen_pacing_window_minutes';
      v_pacing_window := COALESCE(v_pacing_window, 30);

      SELECT COALESCE((value ->> 'value')::int, CASE WHEN v_is_sunday THEN 20 ELSE 25 END)
        INTO v_pace_base
        FROM public.system_settings
        WHERE key = CASE WHEN v_is_sunday THEN 'kitchen_pace_covers_sunday' ELSE 'kitchen_pace_covers_regular' END;
      v_pace_base := COALESCE(v_pace_base, CASE WHEN v_is_sunday THEN 20 ELSE 25 END);

      SELECT COALESCE((value ->> 'value')::int, 6)
        INTO v_reserve_base
        FROM public.system_settings
        WHERE key = CASE WHEN v_is_sunday THEN 'kitchen_walk_in_reserve_sunday' ELSE 'kitchen_walk_in_reserve_regular' END;
      v_reserve_base := COALESCE(v_reserve_base, 6);

      SELECT sh.kitchen_pace_covers, sh.kitchen_walk_in_reserve
        INTO v_ovr_pace, v_ovr_reserve
        FROM public.special_hours sh WHERE sh.date = p_booking_date;

      v_pace := COALESCE(v_ovr_pace, v_pace_base);
      v_reserve := COALESCE(v_ovr_reserve, v_reserve_base);
      v_ceiling := GREATEST(0, v_pace - v_reserve);

      v_center_minutes := EXTRACT(HOUR FROM p_booking_time)::int * 60 + EXTRACT(MINUTE FROM p_booking_time)::int;
      v_half := v_pacing_window / 2.0;

      -- Serialize count+insert for this date so concurrent bookings can't both slip under the cap.
      PERFORM pg_advisory_xact_lock(('x' || substr(md5('kitchen_pacing:' || p_booking_date::text), 1, 16))::bit(64)::bigint);

      SELECT COALESCE(SUM(COALESCE(tb.committed_party_size, tb.party_size)), 0)
        INTO v_existing_covers
        FROM public.table_bookings tb
        WHERE tb.booking_date = p_booking_date
          AND COALESCE(tb.booking_purpose, 'food') = 'food'
          AND tb.status NOT IN ('cancelled', 'no_show')
          AND tb.left_at IS NULL
          AND NOT (
            tb.status IN ('pending_payment', 'pending_card_capture')
            AND tb.hold_expires_at IS NOT NULL
            AND tb.payment_status IS DISTINCT FROM 'completed'
            AND tb.hold_expires_at < v_now
          )
          AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) >= v_center_minutes - v_half
          AND (EXTRACT(HOUR FROM tb.booking_time)::int * 60 + EXTRACT(MINUTE FROM tb.booking_time)::int) <  v_center_minutes + v_half;

      IF v_existing_covers + p_party_size > v_ceiling THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'slot_full');
      END IF;
    END IF;
  END IF;
  -- ===== END KITCHEN PACING GATE =====

  -- ... KEEP the rest of the existing body verbatim: deposit/status decision,
  --     reference + deposit amount, INSERT INTO table_bookings, booking_table_assignments,
  --     booking_holds / payments, and the final success RETURN jsonb_build_object(...) ...
END;
$function$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean
) TO service_role;
```

- [ ] **Step 3: PAUSE — get user confirmation to apply to prod** (this redefines the live booking function). Show the full SQL. Emphasise: additive, gated on `kitchen_pacing_enabled=false`, so behaviour is identical to today until switched on. Only on approval, apply via MCP `apply_migration(project_id='tfcasgxopxegwrabvwat', name='kitchen_pacing_gate_v06', query=<sql>)`.

- [ ] **Step 4: Smoke-test the live function via MCP `execute_sql`** (no Vitest possible). Run each and assert:
  1. Confirm the 11-arg signature exists and old 10-arg is gone:
     ```sql
     SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='create_table_booking_v05';
     ```
     Expected: exactly one row, ending in `, p_bypass_pacing boolean`.
  2. Disabled (default): a normal booking still succeeds exactly as before (state `confirmed`/`pending_payment`). (kitchen_pacing_enabled is false.)
  3. Temporarily enable with a tiny ceiling on a scratch future date, seed food bookings to the ceiling, then call the RPC for one more cover in-window → expect `{"state":"blocked","reason":"slot_full"}`; a booking just outside the window or `p_bypass_pacing=>true` → succeeds. Then reset `kitchen_pacing_enabled` to false and delete the scratch bookings.
     (Do this against a scratch date far in the future to avoid touching real bookings; clean up after.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_kitchen_pacing_gate_v06.sql
git commit -m "feat(db): enforce kitchen pacing cap in create_table_booking_v05"
```

## Task 5: Kitchen-pacing settings API route

**Files:**
- Create: `src/app/api/settings/table-bookings/kitchen-pacing/route.ts` (mirror `src/app/api/settings/table-bookings/pacing/route.ts`)
- Test: `src/app/api/settings/table-bookings/kitchen-pacing/route.test.ts`

- [ ] **Step 1: Write the failing test** (copy the auth-mock + createSupabaseMock pattern from `src/app/api/foh/bookings/[id]/time/route.test.ts`; assert PATCH validation rejects a bad payload and accepts a good one). Keep it focused: one 400 (invalid) case and one 200 (valid) case, mocking `requireSettingsManagePermission` and the supabase upsert.

- [ ] **Step 2: Run to verify it fails.** `npx vitest run src/app/api/settings/table-bookings/kitchen-pacing/route.test.ts` → FAIL (route missing).

- [ ] **Step 3: Implement the route** (mirror the existing pacing route exactly, swapping in the kitchen-pacing helpers):

```typescript
// src/app/api/settings/table-bookings/kitchen-pacing/route.ts
import { NextResponse } from 'next/server'
import { requireSettingsManagePermission } from '@/lib/settings/require-permission' // use the SAME import the pacing route uses
import { AuditService } from '@/services/audit' // match the pacing route's audit import
import {
  getKitchenPacingSettings,
  saveKitchenPacingSettings,
  toPublicKitchenPacingSettings,
  validateKitchenPacingSettings,
} from '@/lib/table-bookings/kitchen-pacing'

export async function GET() {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response
  try {
    const settings = await getKitchenPacingSettings(auth.supabase)
    return NextResponse.json({ success: true, data: toPublicKitchenPacingSettings(settings) })
  } catch {
    return NextResponse.json({ error: 'Failed to load kitchen pacing settings' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const auth = await requireSettingsManagePermission()
  if (!auth.ok) return auth.response
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const validated = validateKitchenPacingSettings({
    enabled: body.enabled,
    windowMinutes: body.window_minutes,
    paceCoversRegular: body.pace_covers_regular,
    paceCoversSunday: body.pace_covers_sunday,
    walkInReserveRegular: body.walk_in_reserve_regular,
    walkInReserveSunday: body.walk_in_reserve_sunday,
  })
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  const previous = await getKitchenPacingSettings(auth.supabase)
  const saved = await saveKitchenPacingSettings(auth.supabase, validated.settings)
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 })

  await AuditService.logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'kitchen_pacing_settings',
    operation_status: 'success',
    old_values: toPublicKitchenPacingSettings(previous),
    new_values: toPublicKitchenPacingSettings(validated.settings),
  })
  return NextResponse.json({ success: true, data: toPublicKitchenPacingSettings(validated.settings) })
}
```
> Before writing, open `src/app/api/settings/table-bookings/pacing/route.ts` and copy its EXACT import paths for `requireSettingsManagePermission` and the audit logger, and its exact auth-object shape (`auth.ok`/`auth.response`/`auth.supabase`/`auth.userId`). Match them.

- [ ] **Step 4: Run tests to pass.** `npx vitest run src/app/api/settings/table-bookings/kitchen-pacing/route.test.ts` → PASS.

- [ ] **Step 5: Lint + typecheck.** `npm run lint && npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/settings/table-bookings/kitchen-pacing/
git commit -m "feat(settings): kitchen pacing config API (GET/PATCH)"
```

## Task 6: Manager settings UI — "Kitchen pacing (cap)" card

**Files:**
- Modify: `src/app/(authenticated)/settings/table-bookings/TableSetupManager.tsx`

- [ ] **Step 1: Add state + loader + saver** mirroring the existing `pacingDraft` block (init ~123-127, `loadPacingSettings` ~190-208, client `savePacingSettings` ~525-581). Add a `kitchenPacingDraft` state with string fields `{ enabled: boolean; window_minutes: '30'; pace_covers_regular: '25'; pace_covers_sunday: '20'; walk_in_reserve_regular: '6'; walk_in_reserve_sunday: '6' }`, `loadingKitchenPacing`/`savingKitchenPacing` flags, a `loadKitchenPacing()` calling `GET /api/settings/table-bookings/kitchen-pacing`, and a `saveKitchenPacing()` that client-validates (same bounds as `validateKitchenPacingSettings`) then `PATCH`es. Call `loadKitchenPacing()` in the same effect that calls `loadPacingSettings()`.

- [ ] **Step 2: Add the card JSX** immediately after the existing "Booking pacing" card (~line 674). One toggle (`enabled`) + five number inputs (window minutes, regular pace, Sunday pace, regular reserve, Sunday reserve) + a Save button, using the same `@/ds` primitives and layout classes the existing card uses (copy its markup and swap fields/handlers). Add helper text: "When on, online bookings that would push food covers over the cap in a 30-minute window are declined and asked to pick another time. Staff can override. Walk-ins bypass but use the reserve." Show the computed online ceiling per service (`pace − reserve`) as read-only text.

- [ ] **Step 3: Verify in the preview** (settings → table bookings). Use the preview tools: load the page, confirm the card renders, toggle + save, confirm a success toast and that `GET` returns the saved values. Confirm keyboard focus + labels (a11y).

- [ ] **Step 4: Lint + typecheck.** `npm run lint && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authenticated)/settings/table-bookings/TableSetupManager.tsx"
git commit -m "feat(settings): kitchen pacing cap configuration card"
```

## Task 7: FOH override — subject-to-pacing with manager override; walk-ins bypass

**Files:**
- Modify: `src/app/api/foh/bookings/route.ts`

- [ ] **Step 1: Add `bypass_pacing` to the request schema.** Find `CreateFohTableBookingSchema` (the zod schema the route parses) and add `bypass_pacing: z.boolean().optional()`.

- [ ] **Step 2: Resolve the flag + gate it.** Just below the existing `treatAsWaived` block (the `p_deposit_waived` computation), add:
```typescript
// Walk-ins are at-arrival and always bypass pacing; advance FOH bookings are
// subject to pacing unless a manager/super_admin explicitly overrides.
let bypassPacing = payload.walk_in === true
if (payload.bypass_pacing === true && payload.walk_in !== true) {
  const { data: roleRows } = await auth.supabase.from('user_roles').select('roles(name)').eq('user_id', auth.userId)
  const isManagerOrAbove =
    (roleRows as unknown as Array<{ roles: { name: string } | null }> | null)?.some(
      (r) => r.roles?.name === 'manager' || r.roles?.name === 'super_admin'
    ) ?? false
  if (!isManagerOrAbove) {
    return NextResponse.json({ error: 'Insufficient permissions to override kitchen pacing' }, { status: 403 })
  }
  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'create',
    resource_type: 'table_booking_pacing_override',
    operation_status: 'success',
    additional_info: { bypass_pacing: true, date: payload.date, time: payload.time, party_size: payload.party_size },
  })
  bypassPacing = true
}
```

- [ ] **Step 3: Pass it to the RPC.** In the `auth.supabase.rpc('create_table_booking_v05', { ... })` call (~line 1027) add the final arg: `p_bypass_pacing: bypassPacing`.

- [ ] **Step 4: Confirm the override paths still skip pacing.** `createManualWalkInBookingOverride` (management override + walk-in hours-bypass fallback) does raw inserts and never calls the RPC, so it already skips pacing — no change needed. Add a one-line code comment there noting this so a future maintainer doesn't add a duplicate check.

- [ ] **Step 5: Test the route mapping** (Vitest, mock `.rpc`): assert a walk-in POST calls the RPC with `p_bypass_pacing: true`; a normal FOH POST without override calls with `p_bypass_pacing: false`; a `bypass_pacing:true` POST from a non-manager returns 403. Copy the createSupabaseMock/auth-mock pattern from `foh/bookings/[id]/time/route.test.ts`.

- [ ] **Step 6: Lint + typecheck + full suite.**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: zero warnings, clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/foh/bookings/route.ts src/app/api/foh/bookings/route.test.ts
git commit -m "feat(foh): manager override for kitchen pacing; walk-ins bypass"
```

## Phase 1 gate

- [ ] `npm run lint` (0 warnings) · `npx tsc --noEmit` (clean) · `npm test` (all pass) · `npm run build` (exit 0).
- [ ] MCP smoke test (Task 4 Step 4) green; `kitchen_pacing_enabled` left `false` in prod.
- [ ] **PAUSE — confirm with user before pushing `main`** (auto-deploys). After deploy, verify per `deploy-verify` (Ready + prod alias moved).

At this point the kitchen is protected at submit the moment a manager flips the toggle. Phases 2–3 add the pre-submit UX.

---

# Phase 2 — Visibility & customer availability (AMS). Independently deployable.

## Task 8: Extend GET /api/table-bookings/load with capacity + per-slot remaining

**Files:**
- Modify: `src/app/api/table-bookings/load/route.ts`
- Modify (if needed): a small kitchen-window helper — reuse whatever `create_table_booking_v05` / the business-hours service uses to resolve kitchen open/close for a date. If none is easily importable, add `getKitchenWindowForDate(date, supabase)` to `src/services/business-hours.ts` returning `{ openMinutes, closeMinutes } | null` from `business_hours`/`special_hours` (`kitchen_opens`/`kitchen_closes`).
- Test: extend/add the load route test.

- [ ] **Step 1: Write the failing test** — assert the response now includes `capacity: { enabled, window_minutes, ceiling_covers, walk_in_reserve }` and a `slots` array of `{ time, covers, remaining }`, and that existing fields (`date`, `bookings`, thresholds) are unchanged. Mock the loaders.

- [ ] **Step 2: Implement.** In the handler, after the existing `Promise.all`, also fetch kitchen-pacing settings + the per-date override + the kitchen window, then build slots:
```typescript
import {
  getKitchenPacingSettings,
  getKitchenPacingOverrideForDate,
  resolveKitchenCeiling,
  buildKitchenAvailabilitySlots,
} from '@/lib/table-bookings/kitchen-pacing'
// ...
const [kSettings, kOverride, kWindow] = await Promise.all([
  getKitchenPacingSettings(supabase),
  getKitchenPacingOverrideForDate(date, supabase),
  getKitchenWindowForDate(date, supabase), // { openMinutes, closeMinutes } | null
])
// reuse the rows already loaded for buildBookingLoad — fetch the same columns
// buildKitchenAvailabilitySlots needs (booking_time, booking_purpose, party_size,
// committed_party_size, status, left_at, hold_expires_at, payment_status).
// If getBookingLoadForDate doesn't already return booking_purpose, add a parallel
// query here that selects those columns for the date.
const ceiling = resolveKitchenCeiling(kSettings, date, kOverride)
const slots = kWindow
  ? buildKitchenAvailabilitySlots(rows, kSettings, date, kWindow.openMinutes, kWindow.closeMinutes, 15, kOverride)
  : []
```
Add to the `createApiResponse` payload (keep all existing fields):
```typescript
capacity: {
  enabled: kSettings.enabled,
  window_minutes: kSettings.windowMinutes,
  ceiling_covers: ceiling,
  walk_in_reserve: isSundayDate(date) ? kSettings.walkInReserveSunday : kSettings.walkInReserveRegular,
},
slots,
```
> These fields are additive. When `enabled` is false the website should ignore them (still show all slots). Document that in the response and the website handoff.

- [ ] **Step 3: Tests pass; lint; typecheck.** Run the three; expect green.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/table-bookings/load/route.ts src/services/business-hours.ts src/app/api/table-bookings/load/route.test.ts
git commit -m "feat(table-bookings): expose kitchen-pacing capacity + per-slot remaining on load API"
```

## Task 9: FOH/BOH covers-per-window read-out + override toggle UI

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts`
- Modify: `src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx`
- Optionally: the FOH/BOH schedule view for the read-out.

- [ ] **Step 1: Add `bypass_pacing` to `CreateForm`.** In `FohCreateBookingModal.tsx` add `bypass_pacing: boolean` to the `CreateForm` type. In `useFohCreateBooking.ts` add `bypass_pacing: false` to the initial `useState`, and to `resetCreateModalState` and `openCreateModal`. Append `bypass_pacing: createForm.bypass_pacing || undefined` to the `/api/foh/bookings` POST body (~line 432).

- [ ] **Step 2: Surface the toggle** in `FohCreateBookingModal` — a checkbox "Override kitchen pacing (this window is at capacity)", visible only when `canEdit` and mode is `booking` (not walk-in/management). Use the same `@/ds` control the deposit-waiver toggle uses.

- [ ] **Step 3: Read-out (optional, low-risk).** On the FOH/BOH schedule, add a small per-window "covers arriving / cap" indicator using `GET /api/table-bookings/load` `slots`. Colour with design tokens; never colour-only (add text). This is the staff visibility from the spec §5.6.

- [ ] **Step 4: Verify in preview; lint; typecheck; test; commit** as one focused commit.

---

# Phase 3 — Website picker (the-anchor.pub, SEPARATE repo, manual deploy)

Not implemented in AMS. Handoff for the website change (spec §5.4):

- Consume `GET /api/table-bookings/load?date=…`. When `capacity.enabled` is true, for each time the picker would offer, grey out / disable any whose nearest `slots[].remaining < partySize`. When `capacity.enabled` is false, behave exactly as today.
- Keep the existing `no_table` handling and add friendly copy for a `slot_full` block reason returned by `POST /api/table-bookings` (submit-time fallback for any slot that filled between load and submit).
- Deploy is manual (the website does not auto-deploy). Coordinate with the venue.

Write this up as an issue/handoff note in the website repo; do not attempt it from AMS.

---

## Walk-in measurement (spec §5.5) — light follow-up

Add a small read-only report (or extend an existing FOH/BOH summary) showing actual walk-in food covers per service/day vs the configured reserve, so the venue tunes the reserve with evidence. Walk-ins are identifiable by `source = 'walk-in'` on `table_bookings`. Low priority; can be a separate change.

---

## Self-review checklist (run before handing off)

- Spec §3 decisions all covered: kitchen-throughput cap (Task 4 counts `booking_purpose='food'`); rolling window (Task 2 centered window + Task 4 SQL mirror); hard block online + staff override (Task 4 `slot_full` + Task 7 override; public route unchanged so it's always subject); grey-out in picker (Task 8 exposes data + Phase 3 handoff).
- Default numbers match spec (25/20/6/6/30) — Task 2 DEFAULTS + Task 3 seed rows.
- Ships disabled — `kitchen_pacing_enabled` false in Task 3; Task 4 gate no-ops when disabled.
- Walk-ins: reserve modelled (ceiling = pace − reserve); walk-ins bypass the gate (Task 7) but their covers count toward others (they're `booking_purpose='food'` rows in the window query).
- Concurrency: advisory lock re-added in Task 4 (was absent).
- Backwards-compat: new RPC param defaulted; public caller unchanged; load fields additive; enum/columns additive & idempotent.
- Type/name consistency: `kitchen_pacing_*` setting keys identical across Task 2 (`KEYS`), Task 3 (seed), Task 4 (SQL), Task 5 (route); `slot_full` reason identical in Task 4 and Phase 3 handoff; `p_bypass_pacing` identical in Task 4 signature and Task 7 call.
