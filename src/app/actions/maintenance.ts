'use server'

// Maintenance and improvements tracker, server actions.
//
// Access is super-admin only at every entry point. checkUserPermission is
// deliberately not used and no RBAC module exists for maintenance:
// user_has_permission returns true for a super-admin on any module name,
// including one that was never created, so it can only express a floor and never
// a restriction. The gate here is public.is_super_admin(auth.uid()), the same
// predicate the RLS policies use, so the two can never drift apart.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { formBooleanSchema } from '@/lib/forms/formBoolean'
import {
  isMaintenanceKind,
  isMaintenancePriority,
  isMaintenanceResponsibility,
  isMaintenanceStatus,
  type MaintenanceArea,
  type MaintenanceCostSummary,
  type MaintenanceItem,
  type MaintenanceKind,
  type MaintenanceNote,
  type MaintenancePriority,
  type MaintenanceResponsibility,
  type MaintenanceStatus,
} from '@/types/maintenance'
import {
  MaintenanceServiceError,
  addMaintenanceNote as addMaintenanceNoteRecord,
  createMaintenanceItem as createMaintenanceItemRecord,
  getMaintenanceCostSummary as readMaintenanceCostSummary,
  getMaintenanceItem as readMaintenanceItem,
  getMaintenanceTimeline as readMaintenanceTimeline,
  listMaintenanceAreas as readMaintenanceAreas,
  listMaintenanceItems as readMaintenanceItems,
  updateMaintenanceItem as updateMaintenanceItemRecord,
  type MaintenanceActor,
  type MaintenanceErrorCode,
  type MaintenanceListCursor,
  type MaintenanceListPage,
  type MaintenanceTimelineCursor,
  type MaintenanceTimelinePage,
} from '@/services/maintenance'

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface MaintenanceActionResult<T> {
  success?: boolean
  error?: string
  /**
   * Present on failure so a page can react to the kind of failure rather than
   * matching on the message. 'stale_write' is the one to render as "reload and
   * reapply"; 'forbidden' means the caller is not a super-admin.
   */
  code?: MaintenanceErrorCode | 'forbidden'
  data?: T
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * Throws unless the caller is a signed-in super-admin.
 *
 * 'Unauthorized' means no session, 'Insufficient permissions' means a session
 * without the role, matching the wording every other action in this app uses.
 */
async function requireMaintenanceSuperAdmin(): Promise<MaintenanceActor> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: unknown }>)('is_super_admin', {
    check_user_id: user.id,
  })

  if (error) {
    logger.error('[Maintenance] Could not verify the caller role', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { userId: user.id },
    })
    // Fail closed: an unverifiable role is not a permitted one.
    throw new Error('Insufficient permissions')
  }

  if (data !== true) {
    throw new Error('Insufficient permissions')
  }

  return { userId: user.id, userEmail: user.email ?? null }
}

/**
 * Whether the current caller may use the tracker at all. Hiding a nav item is a
 * courtesy and never the boundary: every action re-checks the role server-side.
 */
export async function currentUserCanUseMaintenance(): Promise<boolean> {
  try {
    await requireMaintenanceSuperAdmin()
    return true
  } catch {
    return false
  }
}

function toFailure<T>(error: unknown, fallback: string): MaintenanceActionResult<T> {
  if (error instanceof MaintenanceServiceError) {
    return { success: false, error: error.message, code: error.code }
  }

  if (error instanceof Error) {
    if (error.message === 'Unauthorized' || error.message === 'Insufficient permissions') {
      return { success: false, error: error.message, code: 'forbidden' }
    }
  }

  logger.error('[Maintenance] Unexpected failure', {
    error: error instanceof Error ? error : new Error(String(error)),
  })
  return { success: false, error: fallback }
}

function revalidateMaintenance(itemId?: string): void {
  revalidatePath('/maintenance')
  if (itemId) revalidatePath(`/maintenance/${itemId}`)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid('That is not a valid reference')
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as yyyy-mm-dd')
// numeric(10,2) tops out at 99,999,999.99.
const moneySchema = z
  .number()
  .min(0, 'A cost cannot be negative')
  .max(99999999.99, 'That cost is too large')

// The type guards in @/types/maintenance are the single definition of each set,
// so they are reused here rather than restating the values as a zod enum.
const kindSchema = z.custom<MaintenanceKind>(isMaintenanceKind, {
  message: 'Choose whether this is an issue or an improvement',
})
const statusSchema = z.custom<MaintenanceStatus>(isMaintenanceStatus, {
  message: 'Choose a valid status',
})
const prioritySchema = z.custom<MaintenancePriority>(isMaintenancePriority, {
  message: 'Choose a valid priority',
})
const responsibilitySchema = z.custom<MaintenanceResponsibility>(isMaintenanceResponsibility, {
  message: 'Choose who is responsible',
})

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Give this a short title')
  .max(200, 'Keep the title to 200 characters')

const descriptionSchema = z.string().max(5000, 'Keep the description to 5000 characters')
const contractorSchema = z.string().max(200, 'Keep this to 200 characters')

const filtersSchema = z.object({
  kind: kindSchema.optional(),
  statuses: z.array(statusSchema).max(8).optional(),
  areaId: uuidSchema.optional(),
  responsibility: responsibilitySchema.optional(),
  priority: prioritySchema.optional(),
  // Never z.coerce.boolean(): Boolean('false') is true, so a FormData value of
  // 'false' would silently turn the filter on.
  overdueOnly: formBooleanSchema,
  search: z.string().max(200, 'Keep the search to 200 characters').optional(),
})

const listCursorSchema = z.object({
  createdAt: z.string().min(1),
  id: uuidSchema,
})

const timelineCursorSchema = z.object({
  occurredAt: z.string().min(1),
  id: uuidSchema,
})

const createItemSchema = z
  .object({
    kind: kindSchema,
    title: titleSchema,
    description: descriptionSchema.nullish(),
    areaId: uuidSchema,
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
    responsibility: responsibilitySchema.optional(),
    reportedOn: isoDateSchema.optional(),
    targetDate: isoDateSchema.nullish(),
    completedOn: isoDateSchema.nullish(),
    estimatedCost: moneySchema.nullish(),
    actualCost: moneySchema.nullish(),
    contractorName: contractorSchema.nullish(),
    contractorContact: contractorSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.reportedOn && value.targetDate && value.targetDate < value.reportedOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetDate'],
        message: 'The target date cannot be before the date this was reported',
      })
    }
  })

const updateItemSchema = z
  .object({
    id: uuidSchema,
    /** The updated_at the form was built from. The write is refused if it moved. */
    expectedUpdatedAt: z.string().min(1, 'Reload this item and try again'),
    kind: kindSchema.optional(),
    title: titleSchema.optional(),
    description: descriptionSchema.nullish(),
    areaId: uuidSchema.optional(),
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
    responsibility: responsibilitySchema.optional(),
    reportedOn: isoDateSchema.optional(),
    targetDate: isoDateSchema.nullish(),
    completedOn: isoDateSchema.nullish(),
    estimatedCost: moneySchema.nullish(),
    actualCost: moneySchema.nullish(),
    contractorName: contractorSchema.nullish(),
    contractorContact: contractorSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.reportedOn && value.targetDate && value.targetDate < value.reportedOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetDate'],
        message: 'The target date cannot be before the date this was reported',
      })
    }
  })

const addNoteSchema = z.object({
  itemId: uuidSchema,
  content: z
    .string()
    .trim()
    .min(1, 'Write something before saving the note')
    .max(5000, 'Keep the note to 5000 characters'),
})

function firstIssue(error: z.ZodError): string {
  return error.errors[0]?.message ?? 'Check the details and try again'
}

export type MaintenanceListFiltersInput = z.input<typeof filtersSchema>
export type MaintenanceCreateInput = z.input<typeof createItemSchema>
export type MaintenanceUpdateInput = z.input<typeof updateItemSchema>

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getMaintenanceAreas(
  includeInactive = false
): Promise<MaintenanceActionResult<MaintenanceArea[]>> {
  try {
    await requireMaintenanceSuperAdmin()
    const areas = await readMaintenanceAreas({ includeInactive })
    return { success: true, data: areas }
  } catch (error) {
    return toFailure(error, 'Could not load the areas.')
  }
}

export async function getMaintenanceItems(input?: {
  filters?: MaintenanceListFiltersInput
  cursor?: MaintenanceListCursor | null
  limit?: number
}): Promise<MaintenanceActionResult<MaintenanceListPage>> {
  try {
    await requireMaintenanceSuperAdmin()

    const parsedFilters = filtersSchema.safeParse(input?.filters ?? {})
    if (!parsedFilters.success) {
      return { success: false, error: firstIssue(parsedFilters.error) }
    }

    let cursor: MaintenanceListCursor | null = null
    if (input?.cursor) {
      const parsedCursor = listCursorSchema.safeParse(input.cursor)
      if (!parsedCursor.success) {
        return { success: false, error: 'Could not load the next page. Reload and try again.' }
      }
      cursor = parsedCursor.data
    }

    const page = await readMaintenanceItems(parsedFilters.data, {
      cursor,
      limit: input?.limit,
    })

    return { success: true, data: page }
  } catch (error) {
    return toFailure(error, 'Could not load the maintenance list.')
  }
}

export async function getMaintenanceItem(
  id: string
): Promise<MaintenanceActionResult<MaintenanceItem | null>> {
  try {
    await requireMaintenanceSuperAdmin()

    const parsed = uuidSchema.safeParse(id)
    if (!parsed.success) {
      return { success: false, error: 'That is not a valid reference' }
    }

    const item = await readMaintenanceItem(parsed.data)
    return { success: true, data: item }
  } catch (error) {
    return toFailure(error, 'Could not load that item.')
  }
}

export async function getMaintenanceCosts(
  filters?: MaintenanceListFiltersInput
): Promise<MaintenanceActionResult<MaintenanceCostSummary>> {
  try {
    await requireMaintenanceSuperAdmin()

    const parsed = filtersSchema.safeParse(filters ?? {})
    if (!parsed.success) {
      return { success: false, error: firstIssue(parsed.error) }
    }

    const summary = await readMaintenanceCostSummary(parsed.data)
    return { success: true, data: summary }
  } catch (error) {
    return toFailure(error, 'Could not work out the totals.')
  }
}

export async function getMaintenanceTimeline(input: {
  itemId: string
  cursor?: MaintenanceTimelineCursor | null
  limit?: number
}): Promise<MaintenanceActionResult<MaintenanceTimelinePage>> {
  try {
    await requireMaintenanceSuperAdmin()

    const parsedId = uuidSchema.safeParse(input.itemId)
    if (!parsedId.success) {
      return { success: false, error: 'That is not a valid reference' }
    }

    let cursor: MaintenanceTimelineCursor | null = null
    if (input.cursor) {
      const parsedCursor = timelineCursorSchema.safeParse(input.cursor)
      if (!parsedCursor.success) {
        return { success: false, error: 'Could not load older entries. Reload and try again.' }
      }
      cursor = parsedCursor.data
    }

    const page = await readMaintenanceTimeline(parsedId.data, { cursor, limit: input.limit })
    return { success: true, data: page }
  } catch (error) {
    return toFailure(error, 'Could not load the history for this item.')
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createMaintenanceItem(
  input: MaintenanceCreateInput
): Promise<MaintenanceActionResult<MaintenanceItem>> {
  try {
    const actor = await requireMaintenanceSuperAdmin()

    const parsed = createItemSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: firstIssue(parsed.error) }
    }

    const item = await createMaintenanceItemRecord(
      {
        ...parsed.data,
        description: parsed.data.description ?? null,
        targetDate: parsed.data.targetDate ?? null,
        completedOn: parsed.data.completedOn ?? undefined,
        estimatedCost: parsed.data.estimatedCost ?? null,
        actualCost: parsed.data.actualCost ?? null,
        contractorName: parsed.data.contractorName ?? null,
        contractorContact: parsed.data.contractorContact ?? null,
      },
      actor
    )

    // The item's own field history is written by a database trigger in the same
    // transaction. This audit event exists for consistency with the rest of the
    // app and is never the trail we rely on.
    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.userEmail ?? undefined,
      operation_type: 'create',
      resource_type: 'maintenance_item',
      resource_id: item.id,
      operation_status: 'success',
      additional_info: { reference: item.reference, kind: item.kind, status: item.status },
    })

    revalidateMaintenance(item.id)
    return { success: true, data: item }
  } catch (error) {
    return toFailure(error, 'Could not save that item.')
  }
}

export async function updateMaintenanceItem(
  input: MaintenanceUpdateInput
): Promise<MaintenanceActionResult<MaintenanceItem>> {
  try {
    const actor = await requireMaintenanceSuperAdmin()

    const parsed = updateItemSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: firstIssue(parsed.error) }
    }

    const { id, expectedUpdatedAt, ...patch } = parsed.data

    const item = await updateMaintenanceItemRecord(id, patch, expectedUpdatedAt)

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.userEmail ?? undefined,
      operation_type: 'update',
      resource_type: 'maintenance_item',
      resource_id: item.id,
      operation_status: 'success',
      additional_info: { reference: item.reference, status: item.status },
    })

    revalidateMaintenance(item.id)
    return { success: true, data: item }
  } catch (error) {
    return toFailure(error, 'Could not save your changes.')
  }
}

export async function addMaintenanceNote(input: {
  itemId: string
  content: string
}): Promise<MaintenanceActionResult<MaintenanceNote>> {
  try {
    const actor = await requireMaintenanceSuperAdmin()

    const parsed = addNoteSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: firstIssue(parsed.error) }
    }

    // Closed items still accept notes on purpose, so there is no status gate here.
    const note = await addMaintenanceNoteRecord(parsed.data.itemId, parsed.data.content, actor)

    await logAuditEvent({
      user_id: actor.userId,
      user_email: actor.userEmail ?? undefined,
      operation_type: 'create',
      resource_type: 'maintenance_note',
      resource_id: note.id,
      operation_status: 'success',
      additional_info: { itemId: note.itemId },
    })

    revalidateMaintenance(parsed.data.itemId)
    return { success: true, data: note }
  } catch (error) {
    return toFailure(error, 'Could not save that note.')
  }
}
