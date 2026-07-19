'use server'

import { revalidatePath } from 'next/cache'
import { formatInTimeZone } from 'date-fns-tz'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { getOpenSessions } from './timeclock'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'
import { getPublishedShiftsForDate } from '@/lib/checklists/rota'
import { jobQueue } from '@/lib/unified-job-queue'

const TZ = 'Europe/London'

function todayBusinessDate(): string {
  return formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
}

export interface ChecklistTaskView {
  id: string
  title: string
  instruction: string | null
  slot: string
  department: string
  requiresValue: boolean
  valueUnit: string | null
  valueMin: number | null
  valueMax: number | null
  dueAt: string
  graceUntil: string
  state: 'pending' | 'done' | 'missed' | 'skipped' | 'not_applicable'
  locked: boolean
  completedByEmployeeId: string | null
  completedByName: string | null
  completedAt: string | null
  wasLate: boolean
  valueRecorded: number | null
  valueBreach: boolean
  notes: string | null
}

export interface ChecklistGroupView {
  checklistId: string
  checklistName: string
  department: string
  sortOrder: number
  tasks: ChecklistTaskView[]
}

export interface TodayChecklistResult {
  businessDate: string
  moduleEnabled: boolean
  generationStatus: 'complete' | 'running' | 'failed' | 'skipped_closed' | 'none'
  groups: ChecklistGroupView[]
}

export async function getTodayChecklist(
  date?: string,
): Promise<{ data?: TodayChecklistResult; error?: string }> {
  const canView = await checkUserPermission('checklists', 'view')
  if (!canView) return { error: 'Insufficient permissions' }

  const businessDate = date ?? todayBusinessDate()
  const settings = await getChecklistSettings()
  if (!settings.moduleEnabled) {
    return { data: { businessDate, moduleEnabled: false, generationStatus: 'none', groups: [] } }
  }

  const db = createAdminClient()

  const { data: runs } = await db
    .from('checklist_generation_runs')
    .select('status, attempt')
    .eq('business_date', businessDate)
    .order('attempt', { ascending: false })
    .limit(1)
  const generationStatus = (runs?.[0]?.status as TodayChecklistResult['generationStatus']) ?? 'none'

  const { data: rows, error } = await db
    .from('checklist_task_instances')
    .select(
      `id, checklist_id, title_snapshot, instruction_snapshot, slot, department,
       requires_value, value_unit, value_min, value_max, due_at, grace_until, state,
       locked_at, completed_by_employee_id, completed_at, was_late, value_recorded,
       value_breach, notes,
       checklists!inner(name, sort_order),
       employees:completed_by_employee_id(first_name, last_name)`,
    )
    .eq('business_date', businessDate)
    .order('due_at', { ascending: true })
  if (error) return { error: error.message }

  const groupMap = new Map<string, ChecklistGroupView>()
  for (const row of (rows ?? []) as Record<string, unknown>[]) {
    const checklist = row.checklists as { name: string; sort_order: number } | null
    const emp = row.employees as { first_name: string | null; last_name: string | null } | null
    const checklistId = row.checklist_id as string
    if (!groupMap.has(checklistId)) {
      groupMap.set(checklistId, {
        checklistId,
        checklistName: checklist?.name ?? 'Checklist',
        department: row.department as string,
        sortOrder: checklist?.sort_order ?? 0,
        tasks: [],
      })
    }
    groupMap.get(checklistId)!.tasks.push({
      id: row.id as string,
      title: row.title_snapshot as string,
      instruction: (row.instruction_snapshot as string | null) ?? null,
      slot: row.slot as string,
      department: row.department as string,
      requiresValue: row.requires_value as boolean,
      valueUnit: (row.value_unit as string | null) ?? null,
      valueMin: (row.value_min as number | null) ?? null,
      valueMax: (row.value_max as number | null) ?? null,
      dueAt: row.due_at as string,
      graceUntil: row.grace_until as string,
      state: row.state as ChecklistTaskView['state'],
      locked: row.locked_at != null,
      completedByEmployeeId: (row.completed_by_employee_id as string | null) ?? null,
      completedByName: emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ') || null : null,
      completedAt: (row.completed_at as string | null) ?? null,
      wasLate: row.was_late as boolean,
      valueRecorded: (row.value_recorded as number | null) ?? null,
      valueBreach: row.value_breach as boolean,
      notes: (row.notes as string | null) ?? null,
    })
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => a.sortOrder - b.sortOrder)
  return { data: { businessDate, moduleEnabled: true, generationStatus, groups } }
}

export async function completeChecklistInstance(input: {
  instanceId: string
  employeeId: string
  value?: number | null
  notes?: string | null
}): Promise<{ success?: boolean; error?: string; breach?: boolean; alreadyDone?: boolean }> {
  const canView = await checkUserPermission('checklists', 'view')
  if (!canView) return { error: 'Insufficient permissions' }

  const db = createAdminClient()
  const { data: inst, error: fetchErr } = await db
    .from('checklist_task_instances')
    .select('id, state, locked_at, grace_until, requires_value, value_min, value_max')
    .eq('id', input.instanceId)
    .maybeSingle()
  if (fetchErr) return { error: fetchErr.message }
  if (!inst) return { error: 'Task not found' }
  if (inst.locked_at) return { error: 'This checklist is locked and can no longer be changed' }
  if (inst.state !== 'pending') return { alreadyDone: true, error: 'Already completed by someone else' }

  if (inst.requires_value && (input.value === undefined || input.value === null)) {
    return { error: 'A reading is required for this task' }
  }

  const now = new Date()
  const wasLate = now.getTime() > new Date(inst.grace_until as string).getTime()
  let breach = false
  if (inst.requires_value && input.value != null) {
    const min = inst.value_min as number | null
    const max = inst.value_max as number | null
    breach = (min != null && input.value < min) || (max != null && input.value > max)
  }

  const { data: updated, error: updErr } = await db
    .from('checklist_task_instances')
    .update({
      state: 'done',
      completed_by_employee_id: input.employeeId,
      completed_at: now.toISOString(),
      was_late: wasLate,
      value_recorded: inst.requires_value ? input.value ?? null : null,
      value_breach: breach,
      notes: input.notes ?? null,
      updated_at: now.toISOString(),
    })
    .eq('id', input.instanceId)
    .eq('state', 'pending')
    .is('locked_at', null)
    .select('id')
    .maybeSingle()
  if (updErr) return { error: updErr.message }
  if (!updated) return { alreadyDone: true, error: 'Already completed by someone else' }

  const { user_id, user_email } = await getCurrentUser()
  await logAuditEvent({
    user_id: user_id ?? undefined,
    user_email: user_email ?? undefined,
    operation_type: 'update',
    resource_type: 'checklist_instance',
    resource_id: input.instanceId,
    operation_status: 'success',
    additional_info: { completed_by_employee_id: input.employeeId, breach },
  })

  if (breach) {
    const settings = await getChecklistSettings()
    const to = process.env.CHECKLIST_MANAGER_EMAIL || 'manager@the-anchor.pub'
    await db
      .from('checklist_email_outbox')
      .insert({
        email_type: 'value_breach',
        source_type: 'instance',
        source_id: input.instanceId,
        idempotency_key: `value_breach:${input.instanceId}`,
        to_addresses: [to],
        subject: 'The Anchor: a checklist reading is out of range',
        status: settings.emailsEnabled ? 'pending' : 'held',
        next_attempt_at: now.toISOString(),
      })
      .then(() => undefined, () => undefined) // idempotency_key unique: ignore duplicate
    if (settings.emailsEnabled) {
      await jobQueue.enqueue('checklist_email_outbox_process', {}, { unique: `checklist_outbox:breach:${input.instanceId}` })
    }
  }

  revalidatePath('/checklists')
  return { success: true, breach }
}

export async function undoChecklistInstance(input: {
  instanceId: string
  employeeId: string
}): Promise<{ success?: boolean; error?: string }> {
  const canView = await checkUserPermission('checklists', 'view')
  if (!canView) return { error: 'Insufficient permissions' }

  const db = createAdminClient()
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: updated, error } = await db
    .from('checklist_task_instances')
    .update({
      state: 'pending',
      completed_by_employee_id: null,
      completed_at: null,
      was_late: false,
      value_recorded: null,
      value_breach: false,
      notes: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.instanceId)
    .eq('state', 'done')
    .eq('completed_by_employee_id', input.employeeId)
    .is('locked_at', null)
    .gte('completed_at', cutoff)
    .select('id')
    .maybeSingle()
  if (error) return { error: error.message }
  if (!updated) return { error: 'Too late to undo, or this was not your tick' }
  revalidatePath('/checklists')
  return { success: true }
}

export interface DuePrompt {
  id: string
  title: string
  slot: string
  dueAt: string
}

// Mid-shift prompts (spec 9.2): pending tasks whose window has opened, for today, but only
// when prompts_enabled. Returns [] when the flag is off so the FOH prompt component stays
// silent. Excludes open/close/anytime slots (those live on the dedicated screen); only the
// during-service every-N and at_times slots prompt.
export async function getDueChecklistPrompts(): Promise<{ data?: DuePrompt[]; error?: string }> {
  const canView = await checkUserPermission('checklists', 'view')
  if (!canView) return { error: 'Insufficient permissions' }

  const settings = await getChecklistSettings()
  if (!settings.moduleEnabled || !settings.promptsEnabled) return { data: [] }

  const db = createAdminClient()
  const nowIso = new Date().toISOString()
  const businessDate = todayBusinessDate()
  const { data, error } = await db
    .from('checklist_task_instances')
    .select('id, title_snapshot, slot, due_at')
    .eq('business_date', businessDate)
    .eq('state', 'pending')
    .is('locked_at', null)
    .not('slot', 'in', '(open,close,anytime)')
    .lte('window_start', nowIso)
    .order('due_at', { ascending: true })
  if (error) return { error: error.message }

  return {
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      title: r.title_snapshot as string,
      slot: r.slot as string,
      dueAt: r.due_at as string,
    })),
  }
}

export interface AttributionCandidate {
  employeeId: string
  name: string
  clockedIn: boolean
  rostered: boolean
}

export async function getAttributionCandidates(input: {
  date: string
  department: string
}): Promise<{ data?: AttributionCandidate[]; error?: string }> {
  const canView = await checkUserPermission('checklists', 'view')
  if (!canView) return { error: 'Insufficient permissions' }

  const db = createAdminClient()
  const { data: employees, error } = await db
    .from('employees')
    .select('employee_id, first_name, last_name, status')
    .in('status', ['Active', 'Started Separation'])
  if (error) return { error: error.message }

  const open = await getOpenSessions()
  const clockedInIds = new Set(open.success ? open.data.map((s) => s.employee_id as string) : [])

  const shifts = await getPublishedShiftsForDate(input.date)
  const rosteredIds = new Set(
    shifts.filter((s) => s.department === input.department && s.employeeId).map((s) => s.employeeId as string),
  )

  const candidates: AttributionCandidate[] = (employees ?? []).map((e) => ({
    employeeId: e.employee_id as string,
    name: [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Unknown',
    clockedIn: clockedInIds.has(e.employee_id as string),
    rostered: rosteredIds.has(e.employee_id as string),
  }))

  // Clocked-in first, then rostered, then the rest, each alphabetical.
  candidates.sort((a, b) => {
    const rank = (c: AttributionCandidate) => (c.clockedIn ? 0 : c.rostered ? 1 : 2)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
  return { data: candidates }
}
