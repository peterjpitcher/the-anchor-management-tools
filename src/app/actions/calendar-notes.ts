'use server'

import { z } from 'zod'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { getOpenAIConfig } from '@/lib/openai/config'
import { logAuditEvent } from './audit'

const DEFAULT_NOTE_COLOR = '#0EA5E9'
const MAX_AI_GENERATION_RANGE_DAYS = 730

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format')
const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a 6-digit hex value')

const CalendarNoteCreateSchema = z.object({
  note_date: IsoDateSchema,
  end_date: IsoDateSchema.optional(),
  title: z.string().trim().min(1, 'Title is required').max(160, 'Title is too long'),
  notes: z.string().max(4000, 'Notes are too long').nullable().optional(),
  start_time: TimeSchema.nullable().optional(),
  end_time: TimeSchema.nullable().optional(),
  color: HexColorSchema.nullable().optional(),
}).refine(
  (value) => !value.end_time || Boolean(value.start_time),
  {
    message: 'End time requires a start time',
    path: ['end_time'],
  }
).refine(
  (value) => !value.end_date || value.end_date >= value.note_date,
  {
    message: 'End date must be the same or after start date',
    path: ['end_date'],
  }
)

const CalendarNoteUpdateSchema = z.object({
  note_date: IsoDateSchema.optional(),
  end_date: IsoDateSchema.optional(),
  title: z.string().trim().min(1, 'Title is required').max(160, 'Title is too long').optional(),
  notes: z.string().max(4000, 'Notes are too long').nullable().optional(),
  start_time: TimeSchema.nullable().optional(),
  end_time: TimeSchema.nullable().optional(),
  color: HexColorSchema.nullable().optional(),
})

const CalendarNoteGenerateSchema = z.object({
  start_date: IsoDateSchema,
  end_date: IsoDateSchema,
  guidance: z.string().max(2000, 'Guidance is too long').nullable().optional(),
})

const AiGeneratedNoteSchema = z.object({
  note_date: IsoDateSchema,
  end_date: IsoDateSchema.optional(),
  title: z.string().trim().min(1).max(160),
  notes: z.string().max(4000).nullable().optional(),
  start_time: TimeSchema.nullable().optional(),
  end_time: TimeSchema.nullable().optional(),
  color: z.string().nullable().optional(),
})

const AiGeneratedPayloadSchema = z.object({
  notes: z.array(AiGeneratedNoteSchema).max(250),
})

type CalendarNoteRow = {
  id: string
  note_date: string
  end_date: string
  title: string
  notes: string | null
  source: string
  start_time: string | null
  end_time: string | null
  color: string
  created_at: string
  updated_at: string
}

export type CalendarNote = CalendarNoteRow

type CalendarNoteCreateInput = z.infer<typeof CalendarNoteCreateSchema>
type CalendarNoteUpdateInput = z.infer<typeof CalendarNoteUpdateSchema>
type CalendarNoteGenerateInput = z.infer<typeof CalendarNoteGenerateSchema>

type PermissionContext =
  | {
      user: {
        id: string
        email?: string | null
      }
    }
  | { error: string }

function calendarNotesTable(client: unknown) {
  return (client as { from: (table: string) => any }).from('calendar_notes')
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalTime(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null
}

function normalizeHexColor(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  return DEFAULT_NOTE_COLOR
}

function mapCalendarNoteRow(row: Record<string, unknown>): CalendarNote {
  const noteDate = String(row.note_date)
  const endDateRaw = typeof row.end_date === 'string' ? row.end_date : noteDate

  return {
    id: String(row.id),
    note_date: noteDate,
    end_date: endDateRaw,
    title: String(row.title),
    notes: typeof row.notes === 'string' ? row.notes : null,
    source: typeof row.source === 'string' ? row.source : 'manual',
    start_time: typeof row.start_time === 'string' ? row.start_time : null,
    end_time: typeof row.end_time === 'string' ? row.end_time : null,
    color: normalizeHexColor(typeof row.color === 'string' ? row.color : DEFAULT_NOTE_COLOR),
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  }
}

function parseIsoDateToUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/**
 * Compute Easter Sunday for a given year using the Anonymous Gregorian algorithm.
 * Returns the date as a YYYY-MM-DD string.
 */
function computeEasterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Add days to a YYYY-MM-DD string, returning a new YYYY-MM-DD string. */
function addDaysToIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(y, (m as number) - 1, (d as number) + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Return the Nth weekday (0=Sun…6=Sat) on or after the given YYYY-MM-DD. */
function nextWeekday(dateIso: string, weekday: number): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(y, (m as number) - 1, d as number)
  const diff = (weekday - date.getDay() + 7) % 7
  return addDaysToIso(dateIso, diff)
}

/** Return the last occurrence of a weekday in a given month/year. */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): string {
  // Start from the last day of the month and work back
  const lastDay = new Date(year, month, 0) // month is 1-based here; new Date(y, m, 0) = last day of month m-1
  const lastDayStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
  const [y, mo, d] = lastDayStr.split('-').map(Number)
  const date = new Date(y, (mo as number) - 1, d as number)
  const diff = (date.getDay() - weekday + 7) % 7
  return addDaysToIso(lastDayStr, -diff)
}

/** Return the Nth weekday (1-indexed) of a given month/year. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  // Find the first occurrence, then add (n-1) weeks
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const firstOccurrence = nextWeekday(firstDay, weekday)
  return addDaysToIso(firstOccurrence, (n - 1) * 7)
}

/**
 * Build a list of confirmed UK hospitality-relevant dates for all years covered
 * by the requested range. These must be injected into the AI prompt verbatim
 * so the AI never recalculates moveable feasts incorrectly.
 */
function buildConfirmedUKDates(startDateIso: string, endDateIso: string): string {
  const startYear = Number(startDateIso.slice(0, 4))
  const endYear = Number(endDateIso.slice(0, 4))
  const lines: string[] = []

  for (let year = startYear; year <= endYear; year++) {
    const easter = computeEasterSunday(year)
    const goodFriday = addDaysToIso(easter, -2)
    const easterSaturday = addDaysToIso(easter, -1)
    const easterMonday = addDaysToIso(easter, 1)
    const motheringSunday = addDaysToIso(easter, -21)
    // Early May Bank Holiday: first Monday of May
    const earlyMayBH = nthWeekdayOfMonth(year, 5, 1, 1)
    // Spring Bank Holiday: last Monday of May
    const springBH = lastWeekdayOfMonth(year, 5, 1)
    // Father's Day: third Sunday of June
    const fathersDay = nthWeekdayOfMonth(year, 6, 0, 3)
    // World Gin Day: second Saturday of June
    const worldGinDay = nthWeekdayOfMonth(year, 6, 6, 2)
    // Late Summer Bank Holiday: last Monday of August
    const lateSummerBH = lastWeekdayOfMonth(year, 8, 1)
    // Oktoberfest: Saturday nearest to 17 September
    const sep17 = nextWeekday(`${year}-09-17`, 6)
    // (nextWeekday gives the Saturday on or after Sep 17; if Sep 17 IS Saturday that day is returned)
    const oktoberfestStart = sep17

    lines.push(
      `${year}:`,
      `  New Year's Day: ${year}-01-01`,
      `  Dry January Ends: ${year}-01-31`,
      `  Valentine's Day: ${year}-02-14`,
      `  St. Patrick's Day: ${year}-03-17`,
      `  Mothering Sunday: ${motheringSunday}`,
      `  Good Friday: ${goodFriday}`,
      `  Easter Saturday: ${easterSaturday}`,
      `  Easter Sunday: ${easter}`,
      `  Easter Monday: ${easterMonday}`,
      `  Early May Bank Holiday: ${earlyMayBH}`,
      `  Spring Bank Holiday: ${springBH}`,
      `  Father's Day: ${fathersDay}`,
      `  World Gin Day: ${worldGinDay}`,
      `  Late Summer Bank Holiday: ${lateSummerBH}`,
      `  Oktoberfest Start: ${oktoberfestStart}`,
      `  Halloween: ${year}-10-31`,
      `  Bonfire Night: ${year}-11-05`,
      `  Christmas Day: ${year}-12-25`,
      `  Boxing Day: ${year}-12-26`,
      `  New Year's Eve: ${year}-12-31`,
    )
  }

  return lines.join('\n')
}

function revalidateCalendarSurfaces() {
  revalidatePath('/settings')
  revalidatePath('/settings/calendar-notes')
  revalidatePath('/events')
  revalidateTag('dashboard')
  revalidatePath('/dashboard')
}

async function requireSettingsManagePermission(): Promise<PermissionContext> {
  const hasPermission = await checkUserPermission('settings', 'manage')
  if (!hasPermission) {
    return { error: 'You do not have permission to manage calendar notes.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  return {
    user: {
      id: user.id,
      email: user.email,
    },
  }
}

export async function listCalendarNotes(): Promise<{ data?: CalendarNote[]; error?: string }> {
  const permission = await requireSettingsManagePermission()
  if ('error' in permission) {
    return { error: permission.error }
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await calendarNotesTable(admin)
      .select('id, note_date, end_date, title, notes, source, start_time, end_time, color, created_at, updated_at')
      .order('note_date', { ascending: true })
      .order('end_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })
      .order('title', { ascending: true })

    if (error) {
      console.error('Failed to load calendar notes:', error)
      return { error: 'Failed to load calendar notes.' }
    }

    return {
      data: (data ?? []).map((row: Record<string, unknown>) => mapCalendarNoteRow(row)),
    }
  } catch (error) {
    console.error('Unexpected error loading calendar notes:', error)
    return { error: 'Failed to load calendar notes.' }
  }
}

export async function createCalendarNote(input: CalendarNoteCreateInput): Promise<{ data?: CalendarNote; error?: string }> {
  const permission = await requireSettingsManagePermission()
  if ('error' in permission) {
    return { error: permission.error }
  }

  const parsed = CalendarNoteCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid calendar note.' }
  }

  const payload = {
    note_date: parsed.data.note_date,
    end_date: parsed.data.end_date ?? parsed.data.note_date,
    title: parsed.data.title.trim(),
    notes: normalizeOptionalText(parsed.data.notes),
    source: 'manual',
    start_time: normalizeOptionalTime(parsed.data.start_time),
    end_time: normalizeOptionalTime(parsed.data.end_time),
    color: normalizeHexColor(parsed.data.color),
    created_by: permission.user.id,
    updated_by: permission.user.id,
    generated_context: {} as Record<string, never>,
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await calendarNotesTable(admin)
      .insert(payload)
      .select('id, note_date, end_date, title, notes, source, start_time, end_time, color, created_at, updated_at')
      .maybeSingle()

    if (error) {
      console.error('Failed to create calendar note:', error)
      return { error: 'Failed to create calendar note.' }
    }

    if (!data) {
      return { error: 'Calendar note was not created.' }
    }

    const note = mapCalendarNoteRow(data as Record<string, unknown>)

    try {
      await logAuditEvent({
        user_id: permission.user.id,
        ...(permission.user.email && { user_email: permission.user.email }),
        operation_type: 'create',
        resource_type: 'calendar_note',
        resource_id: note.id,
        operation_status: 'success',
        new_values: {
          note_date: note.note_date,
          end_date: note.end_date,
          title: note.title,
          source: note.source,
        },
      })
    } catch (auditError) {
      console.error('Failed to write calendar note create audit log:', auditError)
    }

    revalidateCalendarSurfaces()
    return { data: note }
  } catch (error) {
    console.error('Unexpected error creating calendar note:', error)
    return { error: 'Failed to create calendar note.' }
  }
}

export async function updateCalendarNote(noteId: string, input: CalendarNoteUpdateInput): Promise<{ data?: CalendarNote; error?: string }> {
  const permission = await requireSettingsManagePermission()
  if ('error' in permission) {
    return { error: permission.error }
  }

  const idParse = z.string().uuid().safeParse(noteId)
  if (!idParse.success) {
    return { error: 'Invalid calendar note id.' }
  }

  const parsedPatch = CalendarNoteUpdateSchema.safeParse(input)
  if (!parsedPatch.success) {
    return { error: parsedPatch.error.issues[0]?.message ?? 'Invalid calendar note update.' }
  }

  try {
    const admin = createAdminClient()

    const { data: existing, error: existingError } = await calendarNotesTable(admin)
      .select('id, note_date, end_date, title, notes, source, start_time, end_time, color, created_at, updated_at')
      .eq('id', idParse.data)
      .maybeSingle()

    if (existingError) {
      console.error('Failed to load calendar note for update:', existingError)
      return { error: 'Failed to update calendar note.' }
    }

    if (!existing) {
      return { error: 'Calendar note not found.' }
    }

    const existingNote = mapCalendarNoteRow(existing as Record<string, unknown>)
    const mergedForValidation = {
      note_date: parsedPatch.data.note_date ?? existingNote.note_date,
      end_date: parsedPatch.data.end_date ?? existingNote.end_date,
      title: parsedPatch.data.title ?? existingNote.title,
      notes: parsedPatch.data.notes !== undefined ? parsedPatch.data.notes : existingNote.notes,
      start_time: parsedPatch.data.start_time !== undefined ? parsedPatch.data.start_time : existingNote.start_time,
      end_time: parsedPatch.data.end_time !== undefined ? parsedPatch.data.end_time : existingNote.end_time,
      color: parsedPatch.data.color !== undefined ? parsedPatch.data.color : existingNote.color,
    }

    const validated = CalendarNoteCreateSchema.safeParse(mergedForValidation)
    if (!validated.success) {
      return { error: validated.error.issues[0]?.message ?? 'Invalid calendar note update.' }
    }

    const updatePayload = {
      note_date: validated.data.note_date,
      end_date: validated.data.end_date ?? validated.data.note_date,
      title: validated.data.title.trim(),
      notes: normalizeOptionalText(validated.data.notes),
      start_time: normalizeOptionalTime(validated.data.start_time),
      end_time: normalizeOptionalTime(validated.data.end_time),
      color: normalizeHexColor(validated.data.color),
      updated_by: permission.user.id,
    }

    const { data: updated, error: updateError } = await calendarNotesTable(admin)
      .update(updatePayload)
      .eq('id', idParse.data)
      .select('id, note_date, end_date, title, notes, source, start_time, end_time, color, created_at, updated_at')
      .maybeSingle()

    if (updateError) {
      console.error('Failed to update calendar note:', updateError)
      return { error: 'Failed to update calendar note.' }
    }

    if (!updated) {
      return { error: 'Calendar note not found.' }
    }

    const note = mapCalendarNoteRow(updated as Record<string, unknown>)

    try {
      await logAuditEvent({
        user_id: permission.user.id,
        ...(permission.user.email && { user_email: permission.user.email }),
        operation_type: 'update',
        resource_type: 'calendar_note',
        resource_id: note.id,
        operation_status: 'success',
        old_values: existingNote,
        new_values: note,
      })
    } catch (auditError) {
      console.error('Failed to write calendar note update audit log:', auditError)
    }

    revalidateCalendarSurfaces()
    return { data: note }
  } catch (error) {
    console.error('Unexpected error updating calendar note:', error)
    return { error: 'Failed to update calendar note.' }
  }
}

export async function deleteCalendarNote(noteId: string): Promise<{ success?: boolean; error?: string }> {
  const permission = await requireSettingsManagePermission()
  if ('error' in permission) {
    return { error: permission.error }
  }

  const idParse = z.string().uuid().safeParse(noteId)
  if (!idParse.success) {
    return { error: 'Invalid calendar note id.' }
  }

  try {
    const admin = createAdminClient()

    const { data: existing, error: existingError } = await calendarNotesTable(admin)
      .select('id, note_date, end_date, title, notes, source, start_time, end_time, color, created_at, updated_at')
      .eq('id', idParse.data)
      .maybeSingle()

    if (existingError) {
      console.error('Failed to load calendar note for delete:', existingError)
      return { error: 'Failed to delete calendar note.' }
    }

    if (!existing) {
      return { error: 'Calendar note not found.' }
    }

    const { data: deleted, error: deleteError } = await calendarNotesTable(admin)
      .delete()
      .eq('id', idParse.data)
      .select('id')
      .maybeSingle()

    if (deleteError) {
      console.error('Failed to delete calendar note:', deleteError)
      return { error: 'Failed to delete calendar note.' }
    }

    if (!deleted) {
      return { error: 'Calendar note not found.' }
    }

    try {
      const existingNote = mapCalendarNoteRow(existing as Record<string, unknown>)
      await logAuditEvent({
        user_id: permission.user.id,
        ...(permission.user.email && { user_email: permission.user.email }),
        operation_type: 'delete',
        resource_type: 'calendar_note',
        resource_id: noteId,
        operation_status: 'success',
        old_values: existingNote,
      })
    } catch (auditError) {
      console.error('Failed to write calendar note delete audit log:', auditError)
    }

    revalidateCalendarSurfaces()
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting calendar note:', error)
    return { error: 'Failed to delete calendar note.' }
  }
}

export async function generateCalendarNotesWithAI(
  input: CalendarNoteGenerateInput
): Promise<{ data?: CalendarNote[]; insertedCount?: number; skippedCount?: number; error?: string }> {
  const permission = await requireSettingsManagePermission()
  if ('error' in permission) {
    return { error: permission.error }
  }

  const parsedInput = CalendarNoteGenerateSchema.safeParse(input)
  if (!parsedInput.success) {
    return { error: parsedInput.error.issues[0]?.message ?? 'Invalid generation settings.' }
  }

  const startDate = parseIsoDateToUtc(parsedInput.data.start_date)
  const endDate = parseIsoDateToUtc(parsedInput.data.end_date)

  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return { error: 'Invalid date range.' }
  }

  if (endDate < startDate) {
    return { error: 'End date must be the same or after the start date.' }
  }

  const rangeDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
  if (rangeDays > MAX_AI_GENERATION_RANGE_DAYS) {
    return { error: `Date range is too large. Maximum range is ${MAX_AI_GENERATION_RANGE_DAYS} days.` }
  }

  const guidance = normalizeOptionalText(parsedInput.data.guidance)

  const admin = createAdminClient()
  const { data: existingRows, error: existingError } = await calendarNotesTable(admin)
    .select('note_date, end_date, title')
    .gte('note_date', parsedInput.data.start_date)
    .lte('note_date', parsedInput.data.end_date)

  if (existingError) {
    console.error('Failed to load existing calendar notes for AI generation:', existingError)
    return { error: 'Failed to generate notes.' }
  }

  const existingKeySet = new Set<string>(
    (existingRows ?? []).map((row: { note_date?: string; end_date?: string; title?: string }) => {
      const date = String(row.note_date ?? '')
      const endDate = String(row.end_date ?? row.note_date ?? '')
      const title = String(row.title ?? '').trim().toLowerCase()
      return `${date}|${endDate}|${title}`
    })
  )

  const existingLines = (existingRows ?? [])
    .slice(0, 200)
    .map((row: { note_date?: string; end_date?: string; title?: string }) => {
      const startDate = String(row.note_date ?? '')
      const endDate = String(row.end_date ?? row.note_date ?? '')
      const rangeLabel = startDate === endDate ? startDate : `${startDate} to ${endDate}`
      return `${rangeLabel}: ${String(row.title ?? '').trim()}`
    })
    .join('\n')

  const { apiKey, baseUrl, eventsModel } = await getOpenAIConfig()
  if (!apiKey) {
    return { error: 'OpenAI is not configured. Add an API key in Settings first.' }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: eventsModel,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You generate UK calendar notes for hospitality planning. Return concise factual entries and never include dates outside the requested range.',
        },
        {
          role: 'user',
          content: [
            'Generate important calendar notes for a UK pub between the start and end dates (inclusive).',
            '',
            `Start date: ${parsedInput.data.start_date}`,
            `End date: ${parsedInput.data.end_date}`,
            '',
            'CRITICAL: The following dates have been pre-calculated for you and are correct. You MUST use these exact dates — do not recalculate or alter them:',
            '',
            buildConfirmedUKDates(parsedInput.data.start_date, parsedInput.data.end_date),
            '',
            'Include key moments from the confirmed dates above when they fall in the requested range, plus any additional hospitality-relevant seasonal reminders.',
            'Add useful seasonal reminders where appropriate.',
            'Keep titles short and operational notes concise.',
            'Use end_date for multi-day notes; for single-day notes set end_date equal to note_date.',
            'Use null for start_time/end_time unless there is a clear reason to set one.',
            '',
            guidance ? `Extra user guidance: ${guidance}` : 'Extra user guidance: none.',
            '',
            'Avoid duplicates of these existing notes in the same period:',
            existingLines.length > 0 ? existingLines : '(none)',
            '',
            'Return a JSON object with key "notes", where "notes" is an array of objects with keys:',
            '- note_date (YYYY-MM-DD)',
            '- end_date (YYYY-MM-DD)',
            '- title (string)',
            '- notes (string or null)',
            '- start_time (HH:MM or null)',
            '- end_time (HH:MM or null)',
            '- color (#RRGGBB or null)',
            '',
            'Sort output by date ascending and return at most 120 entries.',
          ].join('\n'),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'calendar_note_generation',
          schema: {
            type: 'object',
            properties: {
              notes: {
                type: 'array',
                maxItems: 250,
                items: {
                  type: 'object',
                  properties: {
                    note_date: { type: 'string' },
                    end_date: { type: 'string' },
                    title: { type: 'string' },
                    notes: { type: ['string', 'null'] },
                    start_time: { type: ['string', 'null'] },
                    end_time: { type: ['string', 'null'] },
                    color: { type: ['string', 'null'] },
                  },
                  required: ['note_date', 'end_date', 'title', 'notes', 'start_time', 'end_time', 'color'],
                  additionalProperties: false,
                },
              },
            },
            required: ['notes'],
            additionalProperties: false,
          },
        },
      },
      max_tokens: 3200,
    }),
  })

  if (!response.ok) {
    console.error('OpenAI calendar note generation failed:', await response.text())
    return { error: 'OpenAI request failed while generating notes.' }
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (!content) {
    return { error: 'OpenAI returned no content.' }
  }

  let parsedContent: unknown
  try {
    parsedContent = JSON.parse(typeof content === 'string' ? content : JSON.stringify(content))
  } catch (parseError) {
    console.error('Failed to parse OpenAI calendar notes JSON:', parseError)
    return { error: 'Failed to parse AI response.' }
  }

  const validatedPayload = AiGeneratedPayloadSchema.safeParse(parsedContent)
  if (!validatedPayload.success) {
    console.error('OpenAI calendar notes payload failed validation:', validatedPayload.error)
    return { error: 'AI response format was invalid.' }
  }

  const insertRows: Array<Record<string, unknown>> = []
  const batchKeySet = new Set<string>()
  let skippedCount = 0

  for (const candidate of validatedPayload.data.notes) {
    const validatedCandidate = CalendarNoteCreateSchema.safeParse({
      note_date: candidate.note_date,
      end_date: candidate.end_date ?? candidate.note_date,
      title: candidate.title,
      notes: candidate.notes ?? null,
      start_time: candidate.start_time ?? null,
      end_time: candidate.end_time ?? null,
      color: candidate.color && /^#[0-9A-Fa-f]{6}$/.test(candidate.color) ? candidate.color : DEFAULT_NOTE_COLOR,
    })

    if (!validatedCandidate.success) {
      skippedCount += 1
      continue
    }

    const noteDate = validatedCandidate.data.note_date
    const endDate = validatedCandidate.data.end_date ?? noteDate
    if (
      noteDate < parsedInput.data.start_date ||
      endDate > parsedInput.data.end_date ||
      endDate < noteDate
    ) {
      skippedCount += 1
      continue
    }

    const title = validatedCandidate.data.title.trim()
    const dedupeKey = `${noteDate}|${endDate}|${title.toLowerCase()}`
    if (existingKeySet.has(dedupeKey) || batchKeySet.has(dedupeKey)) {
      skippedCount += 1
      continue
    }

    batchKeySet.add(dedupeKey)
    insertRows.push({
      note_date: noteDate,
      end_date: endDate,
      title,
      notes: normalizeOptionalText(validatedCandidate.data.notes),
      source: 'ai',
      start_time: normalizeOptionalTime(validatedCandidate.data.start_time),
      end_time: normalizeOptionalTime(validatedCandidate.data.end_time),
      color: normalizeHexColor(validatedCandidate.data.color),
      created_by: permission.user.id,
      updated_by: permission.user.id,
      generated_context: {
        start_date: parsedInput.data.start_date,
        end_date: parsedInput.data.end_date,
        guidance,
      },
    })
  }

  if (insertRows.length === 0) {
    return { data: [], insertedCount: 0, skippedCount }
  }

  const { data: insertedRows, error: insertError } = await calendarNotesTable(admin)
    .insert(insertRows)
    .select('id, note_date, end_date, title, notes, source, start_time, end_time, color, created_at, updated_at')

  if (insertError) {
    console.error('Failed to save AI-generated calendar notes:', insertError)
    return { error: 'Failed to save generated notes.' }
  }

  const insertedNotes = (insertedRows ?? []).map((row: Record<string, unknown>) => mapCalendarNoteRow(row))

  try {
    await logAuditEvent({
      user_id: permission.user.id,
      ...(permission.user.email && { user_email: permission.user.email }),
      operation_type: 'create',
      resource_type: 'calendar_note',
      operation_status: 'success',
      new_values: {
        source: 'ai',
        start_date: parsedInput.data.start_date,
        end_date: parsedInput.data.end_date,
        inserted_count: insertedNotes.length,
        skipped_count: skippedCount,
      },
    })
  } catch (auditError) {
    console.error('Failed to write AI calendar note generation audit log:', auditError)
  }

  revalidateCalendarSurfaces()

  return {
    data: insertedNotes,
    insertedCount: insertedNotes.length,
    skippedCount,
  }
}
