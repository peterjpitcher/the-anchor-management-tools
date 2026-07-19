'use server'

// Phase 3 (oversight) setup actions for the checklists feature.
// CRUD over checklists and task templates, plus the kill-switch flags and a manual
// "regenerate today" trigger. Everything is gated on `checklists:manage`.
// checklist_* tables are deny-all under RLS, so every read/write uses the admin client
// (spec sections 3, 5.8, 9.4, 12). See tasks/checklists-discovery/spec.md v4.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getChecklistSettings } from '@/lib/checklists/settings'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { jobQueue } from '@/lib/unified-job-queue'
import type { Anchor, Freq, ScheduleKind } from '@/lib/checklists/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminTemplate {
  id: string
  checklistId: string
  title: string
  instruction: string | null
  department: string | null
  scheduleKind: ScheduleKind
  freq: Freq | null
  freqInterval: number
  anchor: Anchor
  anchorDate: string | null
  byWeekday: number[] | null
  atTimes: string[] | null
  everyHours: number | null
  firstOffsetMinutes: number | null
  notBefore: string | null
  leadMinutes: number
  graceMinutes: number | null
  intervalDays: number | null
  toleranceDays: number | null
  firstDueOn: string | null
  seasonStart: string | null
  seasonEnd: string | null
  requiresValue: boolean
  valueUnit: string | null
  valueMin: number | null
  valueMax: number | null
  isSpotCheckable: boolean
  isActive: boolean
  version: number
  sortOrder: number
}

export interface AdminChecklist {
  id: string
  name: string
  description: string | null
  department: string
  sortOrder: number
  isActive: boolean
  templates: AdminTemplate[]
}

export interface ChecklistFlags {
  moduleEnabled: boolean
  generationEnabled: boolean
  promptsEnabled: boolean
  emailsEnabled: boolean
}

// ---------------------------------------------------------------------------
// Permission helper
// ---------------------------------------------------------------------------

async function requireManage(): Promise<
  { userId: string; userEmail: string } | { error: string }
> {
  const canManage = await checkUserPermission('checklists', 'manage')
  if (!canManage) return { error: 'Insufficient permissions' }
  const { user_id, user_email } = await getCurrentUser()
  if (!user_id) return { error: 'Unauthorized' }
  return { userId: user_id, userEmail: user_email ?? '' }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SEASON = /^[0-1][0-9]-[0-3][0-9]$/

const checklistCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name is too long'),
  description: z.string().max(2000).optional().or(z.literal('')),
  department: z.string().min(1, 'Department is required'),
  sortOrder: z.number().int().optional(),
})

const checklistUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name is too long').optional(),
  description: z.string().max(2000).nullable().optional(),
  department: z.string().min(1, 'Department is required').optional(),
  sortOrder: z.number().int().optional(),
})

// Lenient: all fields optional; unknown keys (id, checklistId, version) are stripped.
const templateInputSchema = z.object({
  title: z.string().min(1, 'Title is required').optional(),
  instruction: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  scheduleKind: z.enum(['calendar', 'floating']).optional(),
  freq: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'annual']).nullable().optional(),
  freqInterval: z.number().int().min(1, 'Frequency interval must be at least 1').optional(),
  anchor: z.enum(['open', 'close', 'every', 'at_times', 'anytime']).optional(),
  anchorDate: z.string().regex(ISO_DATE, 'Invalid anchor date').nullable().optional(),
  byWeekday: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  atTimes: z.array(z.string()).nullable().optional(),
  everyHours: z.number().positive('Every hours must be greater than 0').nullable().optional(),
  firstOffsetMinutes: z.number().int().nullable().optional(),
  notBefore: z.string().nullable().optional(),
  leadMinutes: z.number().int().min(0, 'Lead minutes cannot be negative').optional(),
  graceMinutes: z.number().int().min(0, 'Grace minutes cannot be negative').nullable().optional(),
  intervalDays: z.number().int().min(1, 'Interval days must be at least 1').nullable().optional(),
  toleranceDays: z.number().int().min(0, 'Tolerance days cannot be negative').nullable().optional(),
  firstDueOn: z.string().regex(ISO_DATE, 'Invalid first-due date').nullable().optional(),
  seasonStart: z.string().regex(SEASON, 'Season start must be MM-DD').nullable().optional(),
  seasonEnd: z.string().regex(SEASON, 'Season end must be MM-DD').nullable().optional(),
  requiresValue: z.boolean().optional(),
  valueUnit: z.string().nullable().optional(),
  valueMin: z.number().nullable().optional(),
  valueMax: z.number().nullable().optional(),
  isSpotCheckable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

const flagsSchema = z.object({
  moduleEnabled: z.boolean().optional(),
  generationEnabled: z.boolean().optional(),
  promptsEnabled: z.boolean().optional(),
  emailsEnabled: z.boolean().optional(),
  spotChecksPerDay: z.number().int().min(0).max(20).optional(),
})

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function mapTemplateRow(row: Record<string, unknown>): AdminTemplate {
  return {
    id: row.id as string,
    checklistId: row.checklist_id as string,
    title: row.title as string,
    instruction: (row.instruction as string | null) ?? null,
    department: (row.department as string | null) ?? null,
    scheduleKind: row.schedule_kind as ScheduleKind,
    freq: (row.freq as Freq | null) ?? null,
    freqInterval: (row.freq_interval as number) ?? 1,
    anchor: row.anchor as Anchor,
    anchorDate: (row.anchor_date as string | null) ?? null,
    byWeekday: (row.by_weekday as number[] | null) ?? null,
    atTimes: (row.at_times as string[] | null) ?? null,
    everyHours: num(row.every_hours),
    firstOffsetMinutes: (row.first_offset_minutes as number | null) ?? null,
    notBefore: (row.not_before as string | null) ?? null,
    leadMinutes: (row.lead_minutes as number) ?? 0,
    graceMinutes: (row.grace_minutes as number | null) ?? null,
    intervalDays: (row.interval_days as number | null) ?? null,
    toleranceDays: (row.tolerance_days as number | null) ?? null,
    firstDueOn: (row.first_due_on as string | null) ?? null,
    seasonStart: (row.season_start as string | null) ?? null,
    seasonEnd: (row.season_end as string | null) ?? null,
    requiresValue: Boolean(row.requires_value),
    valueUnit: (row.value_unit as string | null) ?? null,
    valueMin: num(row.value_min),
    valueMax: num(row.value_max),
    isSpotCheckable: Boolean(row.is_spot_checkable),
    isActive: Boolean(row.is_active),
    version: (row.version as number) ?? 1,
    sortOrder: (row.sort_order as number) ?? 0,
  }
}

/** Writable defaults for a brand-new template (before applying user input). */
function templateDefaults(): Omit<AdminTemplate, 'id' | 'checklistId'> {
  return {
    title: '',
    instruction: null,
    department: null,
    scheduleKind: 'calendar',
    freq: null,
    freqInterval: 1,
    anchor: 'open',
    anchorDate: null,
    byWeekday: null,
    atTimes: null,
    everyHours: null,
    firstOffsetMinutes: null,
    notBefore: null,
    leadMinutes: 0,
    graceMinutes: null,
    intervalDays: null,
    toleranceDays: null,
    firstDueOn: null,
    seasonStart: null,
    seasonEnd: null,
    requiresValue: false,
    valueUnit: null,
    valueMin: null,
    valueMax: null,
    isSpotCheckable: false,
    isActive: true,
    version: 1,
    sortOrder: 0,
  }
}

type ResolvedTemplate = Omit<AdminTemplate, 'id' | 'checklistId'>

/**
 * Merge user input over a base (defaults for create, the existing row for update), then
 * normalise fields so the write can never violate the DB CHECK constraints (spec 3.12):
 * floating forces anchor='anytime' and nulls calendar/every fields; non-'every' anchors
 * null the every-slot fields; non-'at_times' anchors null at_times.
 */
function buildResolvedTemplate(
  base: ResolvedTemplate,
  input: z.infer<typeof templateInputSchema>,
): ResolvedTemplate {
  const t: ResolvedTemplate = { ...base }

  const apply = <K extends keyof ResolvedTemplate>(key: K, value: ResolvedTemplate[K] | undefined) => {
    if (value !== undefined) t[key] = value
  }

  apply('title', input.title)
  apply('instruction', input.instruction ?? undefined)
  apply('department', input.department ?? undefined)
  apply('scheduleKind', input.scheduleKind)
  apply('freq', input.freq ?? undefined)
  apply('freqInterval', input.freqInterval)
  apply('anchor', input.anchor)
  apply('anchorDate', input.anchorDate ?? undefined)
  apply('byWeekday', input.byWeekday ?? undefined)
  apply('atTimes', input.atTimes ?? undefined)
  apply('everyHours', input.everyHours ?? undefined)
  apply('firstOffsetMinutes', input.firstOffsetMinutes ?? undefined)
  apply('notBefore', input.notBefore ?? undefined)
  apply('leadMinutes', input.leadMinutes)
  apply('graceMinutes', input.graceMinutes ?? undefined)
  apply('intervalDays', input.intervalDays ?? undefined)
  apply('toleranceDays', input.toleranceDays ?? undefined)
  apply('firstDueOn', input.firstDueOn ?? undefined)
  apply('seasonStart', input.seasonStart ?? undefined)
  apply('seasonEnd', input.seasonEnd ?? undefined)
  apply('requiresValue', input.requiresValue)
  apply('valueUnit', input.valueUnit ?? undefined)
  apply('valueMin', input.valueMin ?? undefined)
  apply('valueMax', input.valueMax ?? undefined)
  apply('isSpotCheckable', input.isSpotCheckable)
  apply('isActive', input.isActive)
  apply('sortOrder', input.sortOrder)

  // Normalise so the row satisfies the DB CHECK constraints.
  if (t.scheduleKind === 'floating') {
    t.anchor = 'anytime'
    t.freq = null
    t.freqInterval = 1 // floating has no freq, so a stray interval > 1 must not trip the anchor_date CHECK
    t.anchorDate = null // meaningless for floating; keep it null so the anchor_date CHECK is never engaged
    t.atTimes = null
    t.everyHours = null
    t.firstOffsetMinutes = null
    t.notBefore = null
  } else {
    // calendar: never carry floating-only fields
    t.intervalDays = null
    t.toleranceDays = null
    t.firstDueOn = null
    if (t.anchor !== 'every') {
      t.everyHours = null
      t.firstOffsetMinutes = null
      t.notBefore = null
    }
    if (t.anchor !== 'at_times') {
      t.atTimes = null
    }
  }

  return t
}

/**
 * Validate a fully-resolved template against the DB CHECK constraints and template-validity
 * rules (spec 3.12). Returns an error message, or null when the template is valid. Run on
 * create, update and activation so an invalid template is never written or activated.
 */
function validateResolvedTemplate(t: ResolvedTemplate): string | null {
  if (!t.title || !t.title.trim()) return 'Title is required'

  if (t.freqInterval < 1) return 'Frequency interval must be at least 1'
  if (t.leadMinutes < 0) return 'Lead minutes cannot be negative'
  if (t.graceMinutes != null && t.graceMinutes < 0) return 'Grace minutes cannot be negative'

  if (t.scheduleKind === 'calendar') {
    if (!t.freq) return 'A calendar task needs a frequency'
    const needsAnchor =
      t.freqInterval > 1 || ['weekly', 'monthly', 'quarterly', 'annual'].includes(t.freq)
    if (needsAnchor && !t.anchorDate) {
      return 'This cadence needs an anchor date (its first occurrence)'
    }
  } else {
    // floating
    if (t.intervalDays == null || t.intervalDays < 1) {
      return 'A floating task needs an interval of at least 1 day'
    }
    if (t.toleranceDays == null || t.toleranceDays < 0) {
      return 'A floating task needs a tolerance of 0 days or more'
    }
    if (!t.firstDueOn) return 'A floating task needs a first-due date'
  }

  if (t.anchor === 'every' && !(t.everyHours != null && t.everyHours > 0)) {
    return 'An "every N hours" task needs a positive interval'
  }
  if (t.anchor === 'at_times' && !(t.atTimes && t.atTimes.length > 0)) {
    return 'An "at times" task needs at least one time'
  }

  if (t.requiresValue) {
    if (t.valueMin == null && t.valueMax == null) {
      return 'A value task needs at least one bound (min or max)'
    }
    if (!t.valueUnit) return 'A value task needs a unit'
  }
  if (t.valueMin != null && t.valueMax != null && t.valueMin > t.valueMax) {
    return 'Minimum value cannot be greater than maximum value'
  }

  const hasStart = t.seasonStart != null
  const hasEnd = t.seasonEnd != null
  if (hasStart !== hasEnd) return 'A season needs both a start and an end (or neither)'

  return null
}

/** Build the snake_case DB payload for a resolved template. */
function toTemplateWrite(t: ResolvedTemplate): Record<string, unknown> {
  return {
    title: t.title.trim(),
    instruction: t.instruction,
    sort_order: t.sortOrder,
    department: t.department,
    schedule_kind: t.scheduleKind,
    freq: t.freq,
    freq_interval: t.freqInterval,
    anchor_date: t.anchorDate,
    by_weekday: t.byWeekday,
    anchor: t.anchor,
    at_times: t.atTimes,
    every_hours: t.everyHours,
    first_offset_minutes: t.firstOffsetMinutes,
    not_before: t.notBefore,
    lead_minutes: t.leadMinutes,
    grace_minutes: t.graceMinutes,
    interval_days: t.intervalDays,
    tolerance_days: t.toleranceDays,
    first_due_on: t.firstDueOn,
    season_start: t.seasonStart,
    season_end: t.seasonEnd,
    requires_value: t.requiresValue,
    value_unit: t.valueUnit,
    value_min: t.valueMin,
    value_max: t.valueMax,
    is_spot_checkable: t.isSpotCheckable,
    is_active: t.isActive,
    version: t.version,
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listChecklistsWithTemplates(): Promise<{
  data?: AdminChecklist[]
  error?: string
}> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }
    const db = createAdminClient()

    // Small tables (a handful of checklists, ~40 templates): a single ordered read each.
    const { data: checklists, error: clError } = await db
      .from('checklists')
      .select('id, name, description, department, sort_order, is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (clError) throw clError

    const { data: templates, error: tplError } = await db
      .from('checklist_task_templates')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })
    if (tplError) throw tplError

    const templatesByChecklist = new Map<string, AdminTemplate[]>()
    for (const row of templates ?? []) {
      const mapped = mapTemplateRow(row as Record<string, unknown>)
      const list = templatesByChecklist.get(mapped.checklistId) ?? []
      list.push(mapped)
      templatesByChecklist.set(mapped.checklistId, list)
    }

    const data: AdminChecklist[] = (checklists ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      description: (c.description as string | null) ?? null,
      department: c.department as string,
      sortOrder: (c.sort_order as number) ?? 0,
      isActive: Boolean(c.is_active),
      templates: templatesByChecklist.get(c.id as string) ?? [],
    }))

    return { data }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load checklists' }
  }
}

// ---------------------------------------------------------------------------
// Checklist CRUD
// ---------------------------------------------------------------------------

export async function createChecklist(input: {
  name: string
  description?: string
  department: string
  sortOrder?: number
}): Promise<{ success?: boolean; error?: string; id?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const parsed = checklistCreateSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

    const db = createAdminClient()
    const { data: created, error } = await db
      .from('checklists')
      .insert({
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        department: parsed.data.department,
        sort_order: parsed.data.sortOrder ?? 0,
        created_by: gate.userId,
      })
      .select('id')
      .single()
    if (error) throw error

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'create',
      resource_type: 'checklist',
      resource_id: created.id,
      operation_status: 'success',
      new_values: { name: parsed.data.name, department: parsed.data.department },
    })

    revalidatePath('/checklists/manage')
    return { success: true, id: created.id }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create checklist' }
  }
}

export async function updateChecklist(
  id: string,
  input: { name?: string; description?: string; department?: string; sortOrder?: number },
): Promise<{ success?: boolean; error?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const parsed = checklistUpdateSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

    const db = createAdminClient()
    const { data: existing, error: fetchError } = await db
      .from('checklists')
      .select('id, name, description, department, sort_order')
      .eq('id', id)
      .single()
    if (fetchError || !existing) return { error: 'Checklist not found' }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (parsed.data.name !== undefined) update.name = parsed.data.name.trim()
    if (parsed.data.description !== undefined) {
      update.description = parsed.data.description?.trim() || null
    }
    if (parsed.data.department !== undefined) update.department = parsed.data.department
    if (parsed.data.sortOrder !== undefined) update.sort_order = parsed.data.sortOrder

    const { error: updateError } = await db.from('checklists').update(update).eq('id', id)
    if (updateError) throw updateError

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'update',
      resource_type: 'checklist',
      resource_id: id,
      operation_status: 'success',
      old_values: {
        name: existing.name,
        department: existing.department,
        sort_order: existing.sort_order,
      },
      new_values: update,
    })

    revalidatePath('/checklists/manage')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update checklist' }
  }
}

export async function setChecklistActive(
  id: string,
  isActive: boolean,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const db = createAdminClient()
    const { data: existing, error: fetchError } = await db
      .from('checklists')
      .select('id')
      .eq('id', id)
      .single()
    if (fetchError || !existing) return { error: 'Checklist not found' }

    const { error: updateError } = await db
      .from('checklists')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) throw updateError

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'update',
      resource_type: 'checklist',
      resource_id: id,
      operation_status: 'success',
      additional_info: { action: isActive ? 'activate' : 'archive' },
    })

    revalidatePath('/checklists/manage')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to change checklist status' }
  }
}

// ---------------------------------------------------------------------------
// Template CRUD
// ---------------------------------------------------------------------------

export async function createTemplate(
  checklistId: string,
  input: Partial<AdminTemplate>,
): Promise<{ success?: boolean; error?: string; id?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const parsed = templateInputSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

    const db = createAdminClient()
    const { data: parent, error: parentError } = await db
      .from('checklists')
      .select('id')
      .eq('id', checklistId)
      .single()
    if (parentError || !parent) return { error: 'Checklist not found' }

    const resolved = buildResolvedTemplate(templateDefaults(), parsed.data)
    resolved.version = 1
    const invalid = validateResolvedTemplate(resolved)
    if (invalid) return { error: invalid }

    const { data: created, error } = await db
      .from('checklist_task_templates')
      .insert({ ...toTemplateWrite(resolved), checklist_id: checklistId, created_by: gate.userId })
      .select('id')
      .single()
    if (error) throw error

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'create',
      resource_type: 'checklist_template',
      resource_id: created.id,
      operation_status: 'success',
      new_values: { checklist_id: checklistId, title: resolved.title },
    })

    revalidatePath('/checklists/manage')
    return { success: true, id: created.id }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create task template' }
  }
}

// Fields whose change bumps the template version (spec 3.4).
const VERSION_BUMP_FIELDS: (keyof ResolvedTemplate)[] = [
  'title',
  'instruction',
  'requiresValue',
  'valueMin',
  'valueMax',
  'isSpotCheckable',
]

export async function updateTemplate(
  id: string,
  input: Partial<AdminTemplate>,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const parsed = templateInputSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

    const db = createAdminClient()
    const { data: existingRow, error: fetchError } = await db
      .from('checklist_task_templates')
      .select('*')
      .eq('id', id)
      .single()
    if (fetchError || !existingRow) return { error: 'Task template not found' }

    const existing = mapTemplateRow(existingRow as Record<string, unknown>)
    const base: ResolvedTemplate = { ...existing }
    const resolved = buildResolvedTemplate(base, parsed.data)

    const invalid = validateResolvedTemplate(resolved)
    if (invalid) return { error: invalid }

    // Bump version when any snapshotted field changes (spec 3.4).
    const bumped = VERSION_BUMP_FIELDS.some((f) => resolved[f] !== existing[f])
    resolved.version = bumped ? existing.version + 1 : existing.version

    const { error: updateError } = await db
      .from('checklist_task_templates')
      .update({ ...toTemplateWrite(resolved), updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) throw updateError

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'update',
      resource_type: 'checklist_template',
      resource_id: id,
      operation_status: 'success',
      old_values: { title: existing.title, version: existing.version },
      new_values: { title: resolved.title, version: resolved.version, versionBumped: bumped },
    })

    revalidatePath('/checklists/manage')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update task template' }
  }
}

export async function setTemplateActive(
  id: string,
  isActive: boolean,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const db = createAdminClient()
    const { data: existingRow, error: fetchError } = await db
      .from('checklist_task_templates')
      .select('*')
      .eq('id', id)
      .single()
    if (fetchError || !existingRow) return { error: 'Task template not found' }

    // Activation must not enable an invalid template (spec 3.12).
    if (isActive) {
      const resolved = mapTemplateRow(existingRow as Record<string, unknown>)
      const invalid = validateResolvedTemplate(resolved)
      if (invalid) return { error: `Cannot activate: ${invalid}` }
    }

    const { error: updateError } = await db
      .from('checklist_task_templates')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateError) throw updateError

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'update',
      resource_type: 'checklist_template',
      resource_id: id,
      operation_status: 'success',
      additional_info: { action: isActive ? 'activate' : 'deactivate' },
    })

    revalidatePath('/checklists/manage')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to change template status' }
  }
}

// ---------------------------------------------------------------------------
// Flags / settings
// ---------------------------------------------------------------------------

export async function getChecklistAdminSettings(): Promise<{
  data?: ChecklistFlags & { spotChecksPerDay: number }
  error?: string
}> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const settings = await getChecklistSettings()
    return {
      data: {
        moduleEnabled: settings.moduleEnabled,
        generationEnabled: settings.generationEnabled,
        promptsEnabled: settings.promptsEnabled,
        emailsEnabled: settings.emailsEnabled,
        spotChecksPerDay: settings.spotChecksPerDay,
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to load settings' }
  }
}

export async function updateChecklistFlags(
  input: Partial<ChecklistFlags> & { spotChecksPerDay?: number },
): Promise<{ success?: boolean; error?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const parsed = flagsSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: gate.userId,
    }
    if (parsed.data.moduleEnabled !== undefined) update.module_enabled = parsed.data.moduleEnabled
    if (parsed.data.generationEnabled !== undefined) {
      update.generation_enabled = parsed.data.generationEnabled
    }
    if (parsed.data.promptsEnabled !== undefined) update.prompts_enabled = parsed.data.promptsEnabled
    if (parsed.data.emailsEnabled !== undefined) update.emails_enabled = parsed.data.emailsEnabled
    if (parsed.data.spotChecksPerDay !== undefined) {
      update.spot_checks_per_day = parsed.data.spotChecksPerDay
    }

    const db = createAdminClient()
    const { error } = await db.from('checklist_settings').update(update).eq('id', 1)
    if (error) throw error

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'update',
      resource_type: 'checklist_settings',
      resource_id: '1',
      operation_status: 'success',
      new_values: update,
    })

    revalidatePath('/checklists/manage')
    revalidatePath('/checklists')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update settings' }
  }
}

// ---------------------------------------------------------------------------
// Manual regenerate
// ---------------------------------------------------------------------------

export async function regenerateToday(): Promise<{ success?: boolean; error?: string }> {
  try {
    const gate = await requireManage()
    if ('error' in gate) return { error: gate.error }

    const businessDate = getTodayIsoDate()
    const result = await jobQueue.enqueue(
      'checklist_generate_day',
      { businessDate },
      { unique: `checklist_generate:${businessDate}` },
    )
    if (!result.success) return { error: result.error ?? 'Failed to queue regeneration' }

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'update',
      resource_type: 'checklist',
      resource_id: businessDate,
      operation_status: 'success',
      additional_info: { action: 'regenerate_today', business_date: businessDate },
    })

    revalidatePath('/checklists/manage')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to regenerate today' }
  }
}
