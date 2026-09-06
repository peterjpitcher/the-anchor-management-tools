'use server'

// Area administration for the maintenance tracker.
//
// Areas are created, renamed, reordered and deactivated here. There is
// deliberately no delete: the migration gives maintenance_areas no DELETE policy
// and maintenance_items.area_id is ON DELETE RESTRICT, so an area that has ever
// been used cannot be removed without taking its items' history with it.
// Deactivating is the whole of "getting rid of" an area.
//
// Access is super-admin only, and the gate is the one the rest of the tracker
// uses: currentUserCanUseMaintenance() in src/app/actions/maintenance.ts, which
// resolves to public.is_super_admin(auth.uid()). It is reused rather than
// re-implemented so the app and the RLS policies cannot drift apart.
// checkUserPermission is not usable here: user_has_permission returns true for a
// super-admin on any module name, so it can only ever express a floor.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import {
  currentUserCanUseMaintenance,
  getMaintenanceAreas,
  type MaintenanceActionResult,
} from '@/app/actions/maintenance'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import {
  AREA_DUPLICATE_NAME_MESSAGE,
  AREA_NOT_FOUND_MESSAGE,
  AREA_ORDER_STALE_MESSAGE,
  MAINTENANCE_AREA_NAME_MAX_LENGTH,
  findAreaWithSameName,
  normaliseAreaName,
  sortOrdersForSequence,
} from '@/lib/maintenance/areas'
import { mapMaintenanceArea, type MaintenanceArea, type MaintenanceAreaRow } from '@/types/maintenance'
import type { MaintenanceDbClient } from '@/services/maintenance'

const FORBIDDEN = 'Insufficient permissions'
const UNAUTHORIZED = 'Unauthorized'

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

interface AreaAdmin {
  userId: string
  userEmail: string | null
}

/**
 * Throws unless the caller is a signed-in super-admin, and hands back who they
 * are for the audit log. The role check is delegated to the tracker's own gate;
 * the session read here only supplies the actor.
 */
async function requireAreaAdmin(): Promise<AreaAdmin> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error(UNAUTHORIZED)
  if (!(await currentUserCanUseMaintenance())) throw new Error(FORBIDDEN)

  return { userId: user.id, userEmail: user.email ?? null }
}

async function areaDb(): Promise<MaintenanceDbClient> {
  // The cookie-bound client on purpose, so RLS applies in depth. The generated
  // database types do not carry the maintenance tables yet, which is why the
  // client is widened here exactly as src/services/maintenance.ts widens it.
  return (await createClient()) as unknown as MaintenanceDbClient
}

// ---------------------------------------------------------------------------
// Failure mapping
// ---------------------------------------------------------------------------

function isDuplicateNameError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: string; message?: string }
  if (candidate.code === '23505') return true
  return Boolean(candidate.message?.includes('maintenance_areas_name_normalised_key'))
}

function toFailure<T>(error: unknown, fallback: string): MaintenanceActionResult<T> {
  if (error instanceof Error && (error.message === UNAUTHORIZED || error.message === FORBIDDEN)) {
    return { success: false, error: error.message, code: 'forbidden' }
  }

  if (isDuplicateNameError(error)) {
    return { success: false, error: AREA_DUPLICATE_NAME_MESSAGE }
  }

  logger.error('[MaintenanceAreas] Unexpected failure', {
    error: error instanceof Error ? error : new Error(String(error)),
  })
  return { success: false, error: fallback }
}

function revalidateAreas(): void {
  revalidatePath('/settings/maintenance')
  // The list page's area filter and both item forms read this set.
  revalidatePath('/maintenance')
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid('That is not a valid area')

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Give the area a name')
  .max(MAINTENANCE_AREA_NAME_MAX_LENGTH, `Keep the name to ${MAINTENANCE_AREA_NAME_MAX_LENGTH} characters`)

const createSchema = z.object({ name: nameSchema })
const renameSchema = z.object({ id: uuidSchema, name: nameSchema })
const setActiveSchema = z.object({ id: uuidSchema, active: z.boolean() })
const reorderSchema = z.object({ orderedIds: z.array(uuidSchema).min(1, 'Nothing to reorder') })

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the details and try again.'
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every area, active and inactive, for the settings screen. Inactive areas must
 * stay visible here: they still label existing items and can be brought back.
 */
export async function listMaintenanceAreasForAdmin(): Promise<
  MaintenanceActionResult<MaintenanceArea[]>
> {
  // getMaintenanceAreas already gates on super-admin and already reads inactive
  // areas when asked, so there is nothing to add here.
  return getMaintenanceAreas(true)
}

/** All areas as domain objects, for the write paths that need the current set. */
async function loadAreas(db: MaintenanceDbClient): Promise<MaintenanceArea[]> {
  const { data, error } = await db
    .from('maintenance_areas')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error
  return ((data ?? []) as MaintenanceAreaRow[]).map(mapMaintenanceArea)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createMaintenanceArea(input: {
  name: string
}): Promise<MaintenanceActionResult<MaintenanceArea>> {
  try {
    const actor = await requireAreaAdmin()

    const parsed = createSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const name = normaliseAreaName(parsed.data.name)
    const db = await areaDb()
    const existing = await loadAreas(db)

    // Checked here for a readable message; the unique index is still the
    // enforcer, and a race that beats this check is caught by isDuplicateNameError.
    if (findAreaWithSameName(existing, name)) {
      return { success: false, error: AREA_DUPLICATE_NAME_MESSAGE }
    }

    const highest = existing.reduce((max, area) => Math.max(max, area.sortOrder), 0)

    const { data, error } = await db
      .from('maintenance_areas')
      .insert({ name, sort_order: highest + 10 })
      .select('*')
      .single()

    if (error) throw error

    const area = mapMaintenanceArea(data as MaintenanceAreaRow)

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.userEmail ?? undefined,
      operation_type: 'create',
      resource_type: 'maintenance_area',
      resource_id: area.id,
      operation_status: 'success',
      new_values: { name: area.name, sort_order: area.sortOrder },
    })

    revalidateAreas()
    return { success: true, data: area }
  } catch (error) {
    return toFailure(error, 'Could not add that area.')
  }
}

export async function renameMaintenanceArea(input: {
  id: string
  name: string
}): Promise<MaintenanceActionResult<MaintenanceArea>> {
  try {
    const actor = await requireAreaAdmin()

    const parsed = renameSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const name = normaliseAreaName(parsed.data.name)
    const db = await areaDb()
    const existing = await loadAreas(db)

    const current = existing.find((area) => area.id === parsed.data.id)
    if (!current) return { success: false, error: AREA_NOT_FOUND_MESSAGE, code: 'not_found' }

    if (findAreaWithSameName(existing, name, parsed.data.id)) {
      return { success: false, error: AREA_DUPLICATE_NAME_MESSAGE }
    }

    const { data, error } = await db
      .from('maintenance_areas')
      .update({ name })
      .eq('id', parsed.data.id)
      .select('*')
      .single()

    if (error) throw error

    const area = mapMaintenanceArea(data as MaintenanceAreaRow)

    // Items are not snapshotted against an area name, so every existing item now
    // shows the new one. The rename is recorded here so that is traceable.
    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.userEmail ?? undefined,
      operation_type: 'update',
      resource_type: 'maintenance_area',
      resource_id: area.id,
      operation_status: 'success',
      old_values: { name: current.name },
      new_values: { name: area.name },
    })

    revalidateAreas()
    return { success: true, data: area }
  } catch (error) {
    return toFailure(error, 'Could not rename that area.')
  }
}

/**
 * Turns an area on or off. Never a delete: existing items keep their area and
 * stay filterable by it, and the database refuses to put a new item on an
 * inactive area with the sentence the forms surface verbatim.
 */
export async function setMaintenanceAreaActive(input: {
  id: string
  active: boolean
}): Promise<MaintenanceActionResult<MaintenanceArea>> {
  try {
    const actor = await requireAreaAdmin()

    const parsed = setActiveSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const db = await areaDb()

    const { data, error } = await db
      .from('maintenance_areas')
      .update({ active: parsed.data.active })
      .eq('id', parsed.data.id)
      .select('*')
      .single()

    if (error) throw error
    if (!data) return { success: false, error: AREA_NOT_FOUND_MESSAGE, code: 'not_found' }

    const area = mapMaintenanceArea(data as MaintenanceAreaRow)

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.userEmail ?? undefined,
      operation_type: 'update',
      resource_type: 'maintenance_area',
      resource_id: area.id,
      operation_status: 'success',
      old_values: { active: !parsed.data.active },
      new_values: { active: parsed.data.active },
    })

    revalidateAreas()
    return { success: true, data: area }
  } catch (error) {
    return toFailure(error, 'Could not change that area.')
  }
}

/**
 * Rewrites the running order. The caller sends the full sequence, which is
 * checked against the areas that actually exist, so a stale page cannot drop an
 * area or invent one. Only the rows whose position really moved are written.
 */
export async function reorderMaintenanceAreas(input: {
  orderedIds: string[]
}): Promise<MaintenanceActionResult<MaintenanceArea[]>> {
  try {
    const actor = await requireAreaAdmin()

    const parsed = reorderSchema.safeParse(input)
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) }

    const db = await areaDb()
    const existing = await loadAreas(db)

    const requested = new Set(parsed.data.orderedIds)
    const known = new Set(existing.map((area) => area.id))
    const isPermutation =
      requested.size === parsed.data.orderedIds.length &&
      requested.size === known.size &&
      parsed.data.orderedIds.every((id) => known.has(id))

    if (!isPermutation) return { success: false, error: AREA_ORDER_STALE_MESSAGE }

    const wanted = sortOrdersForSequence(parsed.data.orderedIds)
    const moved = existing.filter((area) => wanted.get(area.id) !== area.sortOrder)

    for (const area of moved) {
      const { error } = await db
        .from('maintenance_areas')
        .update({ sort_order: wanted.get(area.id) })
        .eq('id', area.id)

      if (error) throw error
    }

    if (moved.length > 0) {
      await logAuditEvent({
        user_id: actor.userId,
        user_email: actor.userEmail ?? undefined,
        operation_type: 'update',
        resource_type: 'maintenance_area',
        operation_status: 'success',
        additional_info: { reordered: moved.map((area) => area.id) },
      })
    }

    revalidateAreas()
    return { success: true, data: await loadAreas(db) }
  } catch (error) {
    return toFailure(error, 'Could not reorder the areas.')
  }
}
