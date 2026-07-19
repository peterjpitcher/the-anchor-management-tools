// src/lib/checklists/jobs/generate.ts
// The checklist_generate_day job (spec 5.4). Resolves the day's trading window, expands the
// active templates into their desired instances, and reconciles them against the database:
// insert new, update pending timestamps that changed (a late special_hours edit), retract
// pending rows no longer desired, never touch a row that has left pending. It records a run
// row, upserts the spot-check expectation, and flags any hours mismatch (spec 8) with a
// system_alert outbox row.
//
// v1 reconciliation is intentionally NON-transactional (the admin client exposes no
// transaction API). Every write is idempotent through database constraints instead: the
// instance unique key (template_id, business_date, slot), the run unique (business_date,
// attempt), and the outbox idempotency_key. The run row records progress, so a failed run is
// safe to retry (step 4 reconciles, it does not append).
// All reads/writes use the service-role admin client (checklist_* is deny-all under RLS).

import { addDays, format, parseISO } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings, type ChecklistSettings } from '@/lib/checklists/settings'
import { resolveTradingWindow } from '@/lib/checklists/trading-window'
import { expandInstants } from '@/lib/checklists/window'
import { getPublishedShiftsForDate } from '@/lib/checklists/rota'
import { resolveCoverage } from '@/lib/checklists/accountability'
import { detectMismatches } from '@/lib/checklists/mismatch'
import {
  computeDesiredInstances,
  type GenTemplate,
  type FloatingPrior,
} from '@/lib/checklists/generation'
import type { InstanceState, ShiftRow } from '@/lib/checklists/types'

const TZ = 'Europe/London'

type AdminDb = ReturnType<typeof createAdminClient>

function systemEmail(): string {
  return process.env.CHECKLIST_SYSTEM_EMAIL || 'peter@orangejelly.co.uk'
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Trim an 'HH:MM' or 'HH:MM:SS' string to 'HH:MM'. */
function normTime(value: string): string {
  return value.slice(0, 5)
}

/** Minutes since midnight for a normalised 'HH:MM'. */
function toMinutes(hhmm: string): number {
  const [h, m] = normTime(hhmm).split(':')
  return Number(h) * 60 + Number(m)
}

/** Add one calendar day to a 'YYYY-MM-DD' string. */
function addOneDay(iso: string): string {
  return format(addDays(parseISO(iso), 1), 'yyyy-MM-dd')
}

/**
 * The business date an instant belongs to: the London calendar date of the instant shifted
 * back by the business-day start hour (a completion at 02:00 belongs to the prior business
 * day). Matches the spec 4 worked example (grace 06:00 Thu 9th gives miss date the 9th).
 */
function businessDateOfInstant(instant: Date, startHour: number): string {
  const shifted = new Date(instant.getTime() - startHour * 60 * 60 * 1000)
  return formatInTimeZone(shifted, TZ, 'yyyy-MM-dd')
}

/** Record the run as failed and alert Peter (spec 5.4 step 2, spec 10). */
async function failRun(
  db: AdminDb,
  runId: string,
  businessDate: string,
  attempt: number,
  settings: ChecklistSettings,
  reason: string,
): Promise<void> {
  await db
    .from('checklist_generation_runs')
    .update({ status: 'failed', error_message: reason, finished_at: nowIso() })
    .eq('id', runId)

  await db.from('checklist_email_outbox').upsert(
    {
      email_type: 'system_alert',
      source_type: 'generation_run',
      source_id: runId,
      idempotency_key: `checklist_gen_fail:${businessDate}:${attempt}`,
      to_addresses: [systemEmail()],
      subject: `Checklist generation failed for ${businessDate}: ${reason}`,
      status: settings.emailsEnabled ? 'pending' : 'held',
      next_attempt_at: nowIso(),
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true },
  )
}

/** Map an active-template row (joined to its checklist) to the compute shape. */
function toGenTemplate(row: Record<string, unknown>): GenTemplate {
  const rawChecklist = row.checklists
  const checklist = (Array.isArray(rawChecklist) ? rawChecklist[0] : rawChecklist) as
    | { department?: string | null }
    | null
    | undefined

  const num = (v: unknown): number | null => (v == null ? null : Number(v))

  return {
    id: row.id as string,
    checklistId: row.checklist_id as string,
    version: row.version as number,
    // Templates inherit the parent checklist's department when their own is null (spec 3.2).
    department: (row.department as string | null) ?? (checklist?.department as string),
    title: row.title as string,
    instruction: (row.instruction as string | null) ?? null,
    scheduleKind: row.schedule_kind as GenTemplate['scheduleKind'],
    anchor: row.anchor as GenTemplate['anchor'],
    freq: (row.freq as GenTemplate['freq']) ?? null,
    freqInterval: row.freq_interval as number,
    anchorDate: (row.anchor_date as string | null) ?? null,
    byWeekday: (row.by_weekday as number[] | null) ?? null,
    seasonStart: (row.season_start as string | null) ?? null,
    seasonEnd: (row.season_end as string | null) ?? null,
    atTimes: (row.at_times as string[] | null) ?? null,
    everyHours: num(row.every_hours),
    firstOffsetMinutes: (row.first_offset_minutes as number | null) ?? null,
    notBefore: (row.not_before as string | null) ?? null,
    leadMinutes: row.lead_minutes as number,
    graceMinutes: (row.grace_minutes as number | null) ?? null,
    intervalDays: (row.interval_days as number | null) ?? null,
    toleranceDays: (row.tolerance_days as number | null) ?? null,
    firstDueOn: (row.first_due_on as string | null) ?? null,
    requiresValue: row.requires_value as boolean,
    valueUnit: (row.value_unit as string | null) ?? null,
    valueMin: num(row.value_min),
    valueMax: num(row.value_max),
    isSpotCheckable: row.is_spot_checkable as boolean,
  }
}

const TEMPLATE_COLUMNS =
  'id, checklist_id, title, instruction, department, schedule_kind, freq, freq_interval, anchor_date, by_weekday, anchor, at_times, every_hours, first_offset_minutes, not_before, lead_minutes, grace_minutes, interval_days, tolerance_days, first_due_on, season_start, season_end, requires_value, value_unit, value_min, value_max, is_spot_checkable, version, checklists!inner(id, is_active, department)'

/**
 * Run generation for a single business date. Domain outcomes (unresolvable hours, closed day)
 * are recorded and returned without throwing; only unexpected infrastructure errors throw so
 * the job queue records the failure.
 */
export async function runGenerateDay(
  payload: { businessDate: string },
): Promise<Record<string, unknown>> {
  const { businessDate } = payload
  const db = createAdminClient()

  const settings = await getChecklistSettings()
  if (!settings.generationEnabled) {
    return { skipped: 'generation_disabled' }
  }

  // --- Run row: attempt = (max attempt for the date) + 1 ---
  const { data: priorRuns, error: priorErr } = await db
    .from('checklist_generation_runs')
    .select('attempt')
    .eq('business_date', businessDate)
    .order('attempt', { ascending: false })
    .limit(1)
  if (priorErr) throw priorErr
  const attempt = ((priorRuns?.[0]?.attempt as number | undefined) ?? 0) + 1

  const { data: runRow, error: runErr } = await db
    .from('checklist_generation_runs')
    .insert({ business_date: businessDate, attempt, status: 'running' })
    .select('id')
    .single()
  if (runErr) throw runErr
  const runId = runRow.id as string

  // --- Resolve the trading window (spec 5.1) ---
  const tw = await resolveTradingWindow(businessDate)
  if ('reason' in tw) {
    await failRun(db, runId, businessDate, attempt, settings, tw.reason)
    return { status: 'failed', reason: tw.reason, runId }
  }
  if (tw.isClosed) {
    await db
      .from('checklist_generation_runs')
      .update({ status: 'skipped_closed', finished_at: nowIso() })
      .eq('id', runId)
    return { status: 'skipped_closed', runId }
  }

  // --- Expand into zoned instants (spec 5.3) ---
  const instants = expandInstants(businessDate, tw.opens, tw.closes, settings.businessDayStartHour)
  if ('error' in instants) {
    await failRun(db, runId, businessDate, attempt, settings, instants.error)
    return { status: 'failed', reason: instants.error, runId }
  }
  const windowInstants = { opensAt: instants.opensAt, closesAt: instants.closesAt }

  // --- Active templates joined to active checklists ---
  const { data: tplRows, error: tplErr } = await db
    .from('checklist_task_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('is_active', true)
    .eq('checklists.is_active', true)
  if (tplErr) throw tplErr
  const templates = (tplRows ?? []).map((r) => toGenTemplate(r as Record<string, unknown>))

  // --- Floating priors + pending-exclusion (spec 4) ---
  const floatingPriors: Record<string, FloatingPrior | null> = {}
  const excludedFloatingIds = new Set<string>()
  for (const t of templates) {
    if (t.scheduleKind !== 'floating') continue

    const { data: pending, error: pendErr } = await db
      .from('checklist_task_instances')
      .select('id')
      .eq('template_id', t.id)
      .eq('state', 'pending')
      .limit(1)
    if (pendErr) throw pendErr
    if (pending && pending.length > 0) {
      excludedFloatingIds.add(t.id) // an open instance exists; generation skips this template
      continue
    }

    const { data: last, error: lastErr } = await db
      .from('checklist_task_instances')
      .select('business_date, state, completed_at, grace_until')
      .eq('template_id', t.id)
      .order('business_date', { ascending: false })
      .limit(1)
    if (lastErr) throw lastErr
    const lr = last?.[0]
    floatingPriors[t.id] = lr
      ? {
          dueDate: lr.business_date as string,
          state: lr.state as InstanceState,
          completedDate: lr.completed_at
            ? businessDateOfInstant(new Date(lr.completed_at as string), settings.businessDayStartHour)
            : null,
          graceDate: businessDateOfInstant(
            new Date(lr.grace_until as string),
            settings.businessDayStartHour,
          ),
        }
      : null
  }

  const templatesForCompute = templates.filter(
    (t) => !(t.scheduleKind === 'floating' && excludedFloatingIds.has(t.id)),
  )

  // --- Desired instance set ---
  const desired = computeDesiredInstances(
    templatesForCompute,
    businessDate,
    windowInstants,
    {
      defaultGraceMinutes: settings.defaultGraceMinutes,
      openLeadMinutes: settings.openLeadMinutes,
      closeLeadMinutes: settings.closeLeadMinutes,
      businessDayStartHour: settings.businessDayStartHour,
    },
    floatingPriors,
  )

  // --- Reconcile against existing rows for the date ---
  const { data: existing, error: exErr } = await db
    .from('checklist_task_instances')
    .select('id, template_id, slot, state, window_start, due_at, grace_until')
    .eq('business_date', businessDate)
  if (exErr) throw exErr

  const shifts = await getPublishedShiftsForDate(businessDate)

  const keyOf = (templateId: string, slot: string) => `${templateId}::${slot}`
  const desiredByKey = new Map(desired.map((d) => [keyOf(d.templateId, d.slot), d]))
  const existingByKey = new Map(
    (existing ?? []).map((e) => [keyOf(e.template_id as string, e.slot as string), e]),
  )

  let created = 0
  let updated = 0
  let retracted = 0

  for (const d of desired) {
    const ex = existingByKey.get(keyOf(d.templateId, d.slot))

    if (!ex) {
      const accountable = resolveCoverage(shifts, d.dueAt, businessDate, d.department)
      const { error } = await db.from('checklist_task_instances').insert({
        template_id: d.templateId,
        template_version: d.templateVersion,
        checklist_id: d.checklistId,
        generation_run_id: runId,
        business_date: businessDate,
        slot: d.slot,
        department: d.department,
        title_snapshot: d.titleSnapshot,
        instruction_snapshot: d.instructionSnapshot,
        requires_value: d.requiresValue,
        value_unit: d.valueUnit,
        value_min: d.valueMin,
        value_max: d.valueMax,
        is_spot_checkable: d.isSpotCheckable,
        window_start: d.windowStart.toISOString(),
        due_at: d.dueAt.toISOString(),
        grace_until: d.graceUntil.toISOString(),
        state: 'pending',
        accountable_employee_id: accountable,
      })
      if (error) {
        // Unique (template_id, business_date, slot): a concurrent run already inserted it.
        if ((error as { code?: string }).code === '23505') continue
        throw error
      }
      created += 1
      continue
    }

    // Only pending rows can be reconciled; never touch a row that has left pending.
    if (ex.state !== 'pending') continue

    const changed =
      new Date(ex.window_start as string).getTime() !== d.windowStart.getTime() ||
      new Date(ex.due_at as string).getTime() !== d.dueAt.getTime() ||
      new Date(ex.grace_until as string).getTime() !== d.graceUntil.getTime()
    if (!changed) continue

    const accountable = resolveCoverage(shifts, d.dueAt, businessDate, d.department)
    const { error } = await db
      .from('checklist_task_instances')
      .update({
        window_start: d.windowStart.toISOString(),
        due_at: d.dueAt.toISOString(),
        grace_until: d.graceUntil.toISOString(),
        accountable_employee_id: accountable,
        updated_at: nowIso(),
      })
      .eq('id', ex.id as string)
      .eq('state', 'pending')
    if (error) throw error
    updated += 1
  }

  // Retract pending rows whose slot is no longer desired.
  for (const e of existing ?? []) {
    if (e.state !== 'pending') continue
    // A floating template with an open pending instance is deliberately excluded from the
    // desired set (it must not be regenerated), so it is legitimately absent from
    // desiredByKey. Preserve it, otherwise a same-day re-run (manual "Regenerate today" or
    // a queue retry) would delete the live floating task and corrupt its recurrence.
    if (excludedFloatingIds.has(e.template_id as string)) continue
    if (desiredByKey.has(keyOf(e.template_id as string, e.slot as string))) continue
    const { error } = await db
      .from('checklist_task_instances')
      .delete()
      .eq('id', e.id as string)
      .eq('state', 'pending')
    if (error) throw error
    retracted += 1
  }

  // --- Spot-check expectation (spec 3.10) ---
  const { error: sceErr } = await db
    .from('checklist_spot_check_expectations')
    .upsert({ business_date: businessDate, expected: settings.spotChecksPerDay }, {
      onConflict: 'business_date',
    })
  if (sceErr) throw sceErr

  // --- Hours mismatch (spec 8): earliest start / latest end across countable shifts ---
  let earliestStartAt: Date | null = null
  let latestEndAt: Date | null = null
  for (const s of shifts as ShiftRow[]) {
    const startAt = fromZonedTime(`${businessDate}T${normTime(s.startTime)}:00`, TZ)
    const endDate = toMinutes(s.endTime) <= toMinutes(s.startTime) ? addOneDay(businessDate) : businessDate
    const endAt = fromZonedTime(`${endDate}T${normTime(s.endTime)}:00`, TZ)
    if (!earliestStartAt || startAt < earliestStartAt) earliestStartAt = startAt
    if (!latestEndAt || endAt > latestEndAt) latestEndAt = endAt
  }

  const mismatches = detectMismatches({
    opensAt: windowInstants.opensAt,
    closesAt: windowInstants.closesAt,
    earliestStartAt,
    latestEndAt,
    earlyThresholdMinutes: settings.mismatchEarlyThresholdMinutes,
    thresholdMinutes: settings.mismatchThresholdMinutes,
  })

  if (mismatches.length > 0) {
    for (const m of mismatches) {
      const { error } = await db.from('checklist_hours_mismatches').upsert(
        {
          business_date: businessDate,
          kind: m.kind,
          expected_opens_at: windowInstants.opensAt.toISOString(),
          expected_closes_at: windowInstants.closesAt.toISOString(),
          rota_earliest_start_at: earliestStartAt ? earliestStartAt.toISOString() : null,
          rota_latest_end_at: latestEndAt ? latestEndAt.toISOString() : null,
          mismatch_minutes: Math.round(m.minutes),
        },
        { onConflict: 'business_date,kind' },
      )
      if (error) throw error
    }

    // One system_alert per date; the shared idempotency key means multiple kinds share an email.
    const kinds = mismatches.map((m) => m.kind).join(', ')
    const { error: outboxErr } = await db.from('checklist_email_outbox').upsert(
      {
        email_type: 'system_alert',
        source_type: 'mismatch',
        source_id: businessDate,
        idempotency_key: `checklist_mismatch:${businessDate}`,
        to_addresses: [systemEmail()],
        subject: `Checklist hours mismatch for ${businessDate}: ${kinds}`,
        status: settings.emailsEnabled ? 'pending' : 'held',
        next_attempt_at: nowIso(),
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
    if (outboxErr) throw outboxErr
  }

  // --- Complete the run ---
  await db
    .from('checklist_generation_runs')
    .update({
      status: 'complete',
      instances_created: created,
      instances_updated: updated,
      instances_retracted: retracted,
      finished_at: nowIso(),
    })
    .eq('id', runId)

  return {
    status: 'complete',
    runId,
    businessDate,
    created,
    updated,
    retracted,
    mismatches: mismatches.length,
  }
}
