// Maintenance and improvements tracker, data layer.
//
// Pinned to supabase/migrations/20260906080646_maintenance_tracker.sql. Rules the
// database owns and this module must never duplicate:
//
//   - History is written by a trigger, one row per changed field, in the same
//     transaction. Never write maintenance_item_history from here.
//   - updated_at, reference, id, created_at and created_by are maintained or
//     frozen by triggers.
//   - Blank strings normalise to NULL on write.
//   - Moving an item onto an inactive area is rejected by the database with a
//     ready-made sentence, which is surfaced verbatim rather than replaced.
//
// Access is super-admin only. That is enforced by RLS on every table and again by
// requireMaintenanceSuperAdmin() in src/app/actions/maintenance.ts. This module
// deliberately defaults to the cookie-bound client so RLS applies in depth.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getTodayIsoDate } from '@/lib/dateUtils'
import {
  MAINTENANCE_OPEN_STATUSES,
  isMaintenanceItemOverdue,
  isOpenMaintenanceStatus,
  mapMaintenanceArea,
  mapMaintenanceItem,
  mapMaintenanceItemHistoryEntry,
  mapMaintenanceNote,
  mapMaintenancePhoto,
  type MaintenanceArea,
  type MaintenanceAreaRow,
  type MaintenanceItem,
  type MaintenanceItemHistoryEntry,
  type MaintenanceItemHistoryRow,
  type MaintenanceItemRow,
  type MaintenanceKind,
  type MaintenanceNote,
  type MaintenanceNoteRow,
  type MaintenancePhoto,
  type MaintenancePhotoRow,
  type MaintenancePriority,
  type MaintenanceResponsibility,
  type MaintenanceStatus,
  type MaintenanceCostSummary,
} from '@/types/maintenance'

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

// The generated database types do not yet carry the maintenance tables, so the
// client is deliberately loose here. Justifying the `any`: every row is narrowed
// through the *Row interfaces in @/types/maintenance before it leaves this module,
// so nothing untyped escapes.
export type MaintenanceDbClient = SupabaseClient<any, 'public', any>

export interface MaintenanceServiceOptions {
  /** Injected for tests and for callers that already hold a client. */
  client?: MaintenanceDbClient
}

async function resolveClient(options?: MaintenanceServiceOptions): Promise<MaintenanceDbClient> {
  if (options?.client) return options.client
  return (await createClient()) as unknown as MaintenanceDbClient
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type MaintenanceErrorCode =
  | 'not_found'
  | 'stale_write'
  | 'area_inactive'
  | 'invalid_cursor'
  | 'db_error'

/**
 * A failure the caller can act on. `message` is safe to show a user; raw database
 * text is never passed through except for the one sentence the database writes
 * for an inactive area, which is already written for a human.
 */
export class MaintenanceServiceError extends Error {
  readonly code: MaintenanceErrorCode

  constructor(code: MaintenanceErrorCode, message: string) {
    super(message)
    this.name = 'MaintenanceServiceError'
    this.code = code
  }
}

/** Exactly the sentence raised by maintenance_items_normalise(). */
const AREA_INACTIVE_MESSAGE = 'That area is no longer available. Pick another one.'

export const MAINTENANCE_STALE_WRITE_MESSAGE =
  'This item was changed by someone else while you were editing. Reload the page and reapply your changes.'

function isPostgrestErrorLike(error: unknown): error is { message?: string; code?: string } {
  return typeof error === 'object' && error !== null
}

/**
 * Constraints worth translating. Anything not listed falls back to the caller's
 * generic sentence, so a schema detail can never reach the browser by accident.
 */
const CONSTRAINT_MESSAGES: ReadonlyArray<[string, string]> = [
  [
    'maintenance_items_target_date_check',
    'The target date cannot be before the date this was reported.',
  ],
  [
    'maintenance_items_completed_on_check',
    'A completion date belongs only on an item marked done.',
  ],
  ['maintenance_items_title_check', 'Give this a title of up to 200 characters.'],
  ['maintenance_items_description_check', 'Keep the description to 5000 characters.'],
  ['maintenance_notes_content_check', 'A note must be between 1 and 5000 characters.'],
  ['reported_on cannot be in the future', 'The reported date cannot be in the future.'],
  ['completed_on cannot be in the future', 'The completion date cannot be in the future.'],
  ['is immutable', 'That detail cannot be changed once an item has been created.'],
]

/**
 * Turn a database error into something a person can read. The inactive-area
 * message is passed through because the database wrote it for a human; everything
 * else is replaced so no schema detail leaks to the browser.
 */
function toServiceError(error: unknown, fallback: string): MaintenanceServiceError {
  if (isPostgrestErrorLike(error) && typeof error.message === 'string') {
    const message = error.message

    if (message.includes(AREA_INACTIVE_MESSAGE)) {
      return new MaintenanceServiceError('area_inactive', AREA_INACTIVE_MESSAGE)
    }

    for (const [needle, plainEnglish] of CONSTRAINT_MESSAGES) {
      if (message.includes(needle)) {
        return new MaintenanceServiceError('db_error', plainEnglish)
      }
    }
  }
  return new MaintenanceServiceError('db_error', fallback)
}

// ---------------------------------------------------------------------------
// Filters, cursors and paging
// ---------------------------------------------------------------------------

export interface MaintenanceListFilters {
  kind?: MaintenanceKind
  statuses?: MaintenanceStatus[]
  areaId?: string
  responsibility?: MaintenanceResponsibility
  priority?: MaintenancePriority
  /** Open items whose target date has already passed. Due today is not overdue. */
  overdueOnly?: boolean
  /** Free text over title and reference. */
  search?: string
}

/** Keyset cursor over the list order, which is (created_at DESC, id DESC). */
export interface MaintenanceListCursor {
  createdAt: string
  id: string
}

export interface MaintenanceListPage {
  items: MaintenanceItem[]
  nextCursor: MaintenanceListCursor | null
  hasMore: boolean
}

export const MAINTENANCE_LIST_PAGE_SIZE = 25
export const MAINTENANCE_LIST_MAX_PAGE_SIZE = 100

/**
 * The cost summary reads every row matching the filters, not just the current
 * page. This cap stops a pathological filter loading the whole table; the tracker
 * is a few hundred rows, so it is a safety net rather than a limit in practice.
 */
const MAINTENANCE_SUMMARY_ROW_CAP = 5000

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
// Timestamps as PostgREST returns them. Restricted on purpose: the value is
// interpolated into a PostgREST filter string, so nothing that could end a filter
// clause (a comma, a bracket, a quote) may appear.
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+([+-][0-9:]+|Z)?$/

function assertCursor(cursor: { createdAt?: string; id?: string }, label: string): void {
  if (!cursor.id || !UUID_PATTERN.test(cursor.id)) {
    throw new MaintenanceServiceError('invalid_cursor', `That ${label} position is not valid.`)
  }
  if (!cursor.createdAt || !TIMESTAMP_PATTERN.test(cursor.createdAt)) {
    throw new MaintenanceServiceError('invalid_cursor', `That ${label} position is not valid.`)
  }
}

/**
 * Escape a free-text term for a PostgREST filter value. The value is wrapped in
 * double quotes so commas and brackets in the search term cannot end the clause.
 * LIKE wildcards are left alone: they can only widen a search, never narrow it.
 */
function quoteForPostgrestFilter(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

const ITEM_SELECT = '*, maintenance_areas(name)'

interface MaintenanceItemJoinRow extends MaintenanceItemRow {
  maintenance_areas?: { name: string | null } | null
}

function mapJoinedItem(row: MaintenanceItemJoinRow): MaintenanceItem {
  return mapMaintenanceItem(row, row.maintenance_areas?.name ?? null)
}

type QueryBuilder = any // PostgREST builder; the client is untyped, see MaintenanceDbClient.

function applyFilters(query: QueryBuilder, filters: MaintenanceListFilters, todayIsoDate: string): QueryBuilder {
  let next = query

  if (filters.kind) next = next.eq('kind', filters.kind)
  if (filters.areaId) next = next.eq('area_id', filters.areaId)
  if (filters.responsibility) next = next.eq('responsibility', filters.responsibility)
  if (filters.priority) next = next.eq('priority', filters.priority)

  if (filters.statuses && filters.statuses.length > 0) {
    next = next.in('status', filters.statuses)
  }

  if (filters.overdueOnly) {
    // Overdue is an open item whose target date is strictly before today in
    // London. Due today is not overdue, which is why this is lt and not lte.
    next = next.in('status', [...MAINTENANCE_OPEN_STATUSES])
    next = next.not('target_date', 'is', null)
    next = next.lt('target_date', todayIsoDate)
  }

  const search = filters.search?.trim()
  if (search) {
    const term = quoteForPostgrestFilter(search)
    next = next.or(`title.ilike."%${term}%",reference.ilike."%${term}%"`)
  }

  return next
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/**
 * Areas for the filter bar and the create and edit forms. Inactive areas stay
 * visible on existing items but must never be offered for a new one, so the
 * default excludes them.
 */
export async function listMaintenanceAreas(
  options?: MaintenanceServiceOptions & { includeInactive?: boolean }
): Promise<MaintenanceArea[]> {
  const supabase = await resolveClient(options)

  let query = supabase
    .from('maintenance_areas')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (!options?.includeInactive) {
    query = query.eq('active', true)
  }

  const { data, error } = await query
  if (error) throw toServiceError(error, 'Could not load the areas.')

  return ((data ?? []) as MaintenanceAreaRow[]).map(mapMaintenanceArea)
}

// ---------------------------------------------------------------------------
// Items, reads
// ---------------------------------------------------------------------------

export async function listMaintenanceItems(
  filters: MaintenanceListFilters = {},
  options?: MaintenanceServiceOptions & {
    limit?: number
    cursor?: MaintenanceListCursor | null
    todayIsoDate?: string
  }
): Promise<MaintenanceListPage> {
  const supabase = await resolveClient(options)
  const today = options?.todayIsoDate ?? getTodayIsoDate()

  const requested = options?.limit ?? MAINTENANCE_LIST_PAGE_SIZE
  const limit = Math.max(1, Math.min(requested, MAINTENANCE_LIST_MAX_PAGE_SIZE))

  let query = supabase.from('maintenance_items').select(ITEM_SELECT)
  query = applyFilters(query, filters, today)

  if (options?.cursor) {
    assertCursor(options.cursor, 'list')
    const { createdAt, id } = options.cursor
    // Keyset over (created_at DESC, id DESC). Repeated or= clauses are ANDed by
    // PostgREST, so this composes with the free-text clause above.
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`)
  }

  // One extra row tells us whether another page exists without a count query.
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (error) throw toServiceError(error, 'Could not load the maintenance list.')

  const rows = (data ?? []) as MaintenanceItemJoinRow[]
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map(mapJoinedItem),
    hasMore,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}

export async function getMaintenanceItem(
  id: string,
  options?: MaintenanceServiceOptions
): Promise<MaintenanceItem | null> {
  const supabase = await resolveClient(options)

  const { data, error } = await supabase
    .from('maintenance_items')
    .select(ITEM_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) throw toServiceError(error, 'Could not load that item.')
  if (!data) return null

  return mapJoinedItem(data as MaintenanceItemJoinRow)
}

// ---------------------------------------------------------------------------
// Cost summary
// ---------------------------------------------------------------------------

export type MaintenanceCostSummaryInput = Pick<
  MaintenanceItem,
  'status' | 'responsibility' | 'estimatedCost' | 'targetDate'
>

function roundPounds(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Totals for a list, following whatever filters produced the rows.
 *
 * Closed items are excluded entirely. on_hold is open, so it counts. A null
 * estimate is never summed as zero: it is counted separately, because "we do not
 * know yet" and "it is free" are different answers. Greene King and to-confirm
 * are reported apart from our own total and never added into it.
 */
export function summariseMaintenanceCosts(
  items: ReadonlyArray<MaintenanceCostSummaryInput>,
  todayIsoDate: string
): MaintenanceCostSummary {
  let ourOpenEstimate = 0
  let ourUncostedCount = 0
  let greeneKingOpenEstimate = 0
  let greeneKingUncostedCount = 0
  let toConfirmOpenEstimate = 0
  let toConfirmUncostedCount = 0
  let openCount = 0
  let overdueCount = 0

  for (const item of items) {
    if (!isOpenMaintenanceStatus(item.status)) continue

    openCount += 1
    if (isMaintenanceItemOverdue(item, todayIsoDate)) overdueCount += 1

    const estimate = item.estimatedCost
    const costed = estimate !== null && estimate !== undefined && Number.isFinite(estimate)

    switch (item.responsibility) {
      case 'us':
        if (costed) ourOpenEstimate += estimate as number
        else ourUncostedCount += 1
        break
      case 'greene_king':
        if (costed) greeneKingOpenEstimate += estimate as number
        else greeneKingUncostedCount += 1
        break
      case 'to_confirm':
        if (costed) toConfirmOpenEstimate += estimate as number
        else toConfirmUncostedCount += 1
        break
    }
  }

  return {
    ourOpenEstimate: roundPounds(ourOpenEstimate),
    ourUncostedCount,
    greeneKingOpenEstimate: roundPounds(greeneKingOpenEstimate),
    greeneKingUncostedCount,
    toConfirmOpenEstimate: roundPounds(toConfirmOpenEstimate),
    toConfirmUncostedCount,
    openCount,
    overdueCount,
  }
}

/** The same totals, read across every row matching the filters rather than one page. */
export async function getMaintenanceCostSummary(
  filters: MaintenanceListFilters = {},
  options?: MaintenanceServiceOptions & { todayIsoDate?: string }
): Promise<MaintenanceCostSummary> {
  const supabase = await resolveClient(options)
  const today = options?.todayIsoDate ?? getTodayIsoDate()

  let query = supabase
    .from('maintenance_items')
    .select('status, responsibility, estimated_cost, target_date')
  query = applyFilters(query, filters, today)

  const { data, error } = await query.limit(MAINTENANCE_SUMMARY_ROW_CAP)
  if (error) throw toServiceError(error, 'Could not work out the totals.')

  const rows = (data ?? []) as Array<
    Pick<MaintenanceItemRow, 'status' | 'responsibility' | 'estimated_cost' | 'target_date'>
  >

  return summariseMaintenanceCosts(
    rows.map(row => ({
      status: row.status,
      responsibility: row.responsibility,
      // numeric(10,2) arrives as a string over PostgREST on some paths.
      estimatedCost: row.estimated_cost === null ? null : Number(row.estimated_cost),
      targetDate: row.target_date,
    })),
    today
  )
}

// ---------------------------------------------------------------------------
// Items, writes
// ---------------------------------------------------------------------------

export interface MaintenanceActor {
  userId: string
  userEmail: string | null
}

export interface CreateMaintenanceItemInput {
  kind: MaintenanceKind
  title: string
  description?: string | null
  areaId: string
  status?: MaintenanceStatus
  priority?: MaintenancePriority
  responsibility?: MaintenanceResponsibility
  reportedOn?: string
  targetDate?: string | null
  completedOn?: string | null
  estimatedCost?: number | null
  actualCost?: number | null
  contractorName?: string | null
  contractorContact?: string | null
}

export interface UpdateMaintenanceItemInput {
  kind?: MaintenanceKind
  title?: string
  description?: string | null
  areaId?: string
  status?: MaintenanceStatus
  priority?: MaintenancePriority
  responsibility?: MaintenanceResponsibility
  reportedOn?: string
  targetDate?: string | null
  completedOn?: string | null
  estimatedCost?: number | null
  actualCost?: number | null
  contractorName?: string | null
  contractorContact?: string | null
}

/**
 * Work out completed_on for a status change.
 *
 * Moving to done stamps today in London unless the user gave a date, which they
 * can do when a job is recorded late. Reopening from done clears it, because the
 * database refuses a completion date on any status other than done; the
 * completion event survives in the history trigger's rows either way.
 */
export function resolveCompletedOn(params: {
  previousStatus: MaintenanceStatus | null
  nextStatus: MaintenanceStatus
  previousCompletedOn: string | null
  /** Present only when the user explicitly supplied a value. */
  suppliedCompletedOn?: string | null
  todayIsoDate: string
}): string | null {
  const { previousStatus, nextStatus, previousCompletedOn, suppliedCompletedOn, todayIsoDate } = params

  if (nextStatus !== 'done') return null

  if (suppliedCompletedOn !== undefined && suppliedCompletedOn !== null) {
    return suppliedCompletedOn
  }

  if (previousStatus === 'done' && previousCompletedOn) return previousCompletedOn

  return todayIsoDate
}

function nullIfBlank(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export async function createMaintenanceItem(
  input: CreateMaintenanceItemInput,
  actor: MaintenanceActor,
  options?: MaintenanceServiceOptions & { todayIsoDate?: string }
): Promise<MaintenanceItem> {
  const supabase = await resolveClient(options)
  const today = options?.todayIsoDate ?? getTodayIsoDate()
  const status: MaintenanceStatus = input.status ?? 'reported'

  const payload = {
    kind: input.kind,
    title: input.title.trim(),
    description: nullIfBlank(input.description) ?? null,
    area_id: input.areaId,
    status,
    priority: input.priority ?? 'medium',
    responsibility: input.responsibility ?? 'to_confirm',
    reported_on: input.reportedOn ?? today,
    target_date: input.targetDate ?? null,
    completed_on: resolveCompletedOn({
      previousStatus: null,
      nextStatus: status,
      previousCompletedOn: null,
      suppliedCompletedOn: input.completedOn,
      todayIsoDate: today,
    }),
    estimated_cost: input.estimatedCost ?? null,
    actual_cost: input.actualCost ?? null,
    contractor_name: nullIfBlank(input.contractorName) ?? null,
    contractor_contact: nullIfBlank(input.contractorContact) ?? null,
    created_by: actor.userId,
    created_by_email: actor.userEmail,
  }

  const { data, error } = await supabase
    .from('maintenance_items')
    .insert(payload)
    .select(ITEM_SELECT)
    .single()

  if (error || !data) throw toServiceError(error, 'Could not save that item.')

  return mapJoinedItem(data as MaintenanceItemJoinRow)
}

/**
 * Update an item, refusing a stale write.
 *
 * `expectedUpdatedAt` is the updated_at the client last saw. The update is
 * conditional on it, so two people editing the same item cannot silently
 * overwrite each other: the second write is refused with a stale_write error the
 * page renders as "reload and reapply".
 */
export async function updateMaintenanceItem(
  id: string,
  input: UpdateMaintenanceItemInput,
  expectedUpdatedAt: string,
  options?: MaintenanceServiceOptions & { todayIsoDate?: string }
): Promise<MaintenanceItem> {
  const supabase = await resolveClient(options)
  const today = options?.todayIsoDate ?? getTodayIsoDate()

  const current = await getMaintenanceItem(id, { client: supabase })
  if (!current) {
    throw new MaintenanceServiceError('not_found', 'That item no longer exists.')
  }

  const nextStatus = input.status ?? current.status

  // A partial update: only the columns the caller actually supplied are written,
  // so an untouched field is never overwritten. Justifying the `any`: the values
  // are strings, numbers, nulls and dates across unrelated columns, and each has
  // already been narrowed by UpdateMaintenanceItemInput on the way in.
  const payload: Record<string, any> = {}

  if (input.kind !== undefined) payload.kind = input.kind
  if (input.title !== undefined) payload.title = input.title.trim()
  if (input.description !== undefined) payload.description = nullIfBlank(input.description)
  if (input.areaId !== undefined) payload.area_id = input.areaId
  if (input.priority !== undefined) payload.priority = input.priority
  if (input.responsibility !== undefined) payload.responsibility = input.responsibility
  if (input.reportedOn !== undefined) payload.reported_on = input.reportedOn
  if (input.targetDate !== undefined) payload.target_date = input.targetDate
  if (input.estimatedCost !== undefined) payload.estimated_cost = input.estimatedCost
  if (input.actualCost !== undefined) payload.actual_cost = input.actualCost
  if (input.contractorName !== undefined) payload.contractor_name = nullIfBlank(input.contractorName)
  if (input.contractorContact !== undefined) {
    payload.contractor_contact = nullIfBlank(input.contractorContact)
  }

  const statusChanged = input.status !== undefined && input.status !== current.status
  if (input.status !== undefined) payload.status = input.status

  // completed_on is derived, never taken straight from the form, because the
  // database constrains it against status and will reject a mismatched pair.
  if (statusChanged || input.completedOn !== undefined) {
    payload.completed_on = resolveCompletedOn({
      previousStatus: current.status,
      nextStatus,
      previousCompletedOn: current.completedOn,
      suppliedCompletedOn: input.completedOn,
      todayIsoDate: today,
    })
  }

  if (Object.keys(payload).length === 0) {
    return current
  }

  const { data, error } = await supabase
    .from('maintenance_items')
    .update(payload)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(ITEM_SELECT)
    .maybeSingle()

  if (error) throw toServiceError(error, 'Could not save your changes.')

  if (!data) {
    // No row came back. Either someone else has written since the client loaded
    // the item, or it has gone. Re-read to say which, rather than guessing.
    const latest = await getMaintenanceItem(id, { client: supabase })
    if (!latest) {
      throw new MaintenanceServiceError('not_found', 'That item no longer exists.')
    }
    throw new MaintenanceServiceError('stale_write', MAINTENANCE_STALE_WRITE_MESSAGE)
  }

  return mapJoinedItem(data as MaintenanceItemJoinRow)
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * Add a note. Closed items still accept notes, deliberately: evidence and
 * invoices often arrive after a job is marked done.
 */
export async function addMaintenanceNote(
  itemId: string,
  content: string,
  actor: MaintenanceActor,
  options?: MaintenanceServiceOptions
): Promise<MaintenanceNote> {
  const supabase = await resolveClient(options)

  const { data, error } = await supabase
    .from('maintenance_notes')
    .insert({
      item_id: itemId,
      content: content.trim(),
      created_by: actor.userId,
      created_by_email: actor.userEmail,
    })
    .select('*')
    .single()

  if (error || !data) throw toServiceError(error, 'Could not save that note.')

  return mapMaintenanceNote(data as MaintenanceNoteRow)
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type MaintenanceTimelineEntry =
  | { kind: 'note'; id: string; occurredAt: string; actorEmail: string | null; note: MaintenanceNote }
  | {
      kind: 'history'
      id: string
      occurredAt: string
      actorEmail: string | null
      history: MaintenanceItemHistoryEntry
    }
  | {
      kind: 'photo'
      id: string
      occurredAt: string
      actorEmail: string | null
      photo: MaintenancePhoto
    }

/** Keyset cursor over the merged order, which is (occurredAt DESC, id DESC). */
export interface MaintenanceTimelineCursor {
  occurredAt: string
  id: string
}

export interface MaintenanceTimelinePage {
  entries: MaintenanceTimelineEntry[]
  nextCursor: MaintenanceTimelineCursor | null
  hasMore: boolean
}

export const MAINTENANCE_TIMELINE_PAGE_SIZE = 30
const MAINTENANCE_TIMELINE_MAX_PAGE_SIZE = 100

function applyTimelineCursor(
  query: QueryBuilder,
  column: string,
  cursor: MaintenanceTimelineCursor | null | undefined
): QueryBuilder {
  if (!cursor) return query
  return query.or(
    `${column}.lt.${cursor.occurredAt},and(${column}.eq.${cursor.occurredAt},id.lt.${cursor.id})`
  )
}

/**
 * The item's trail, newest first: notes, field changes from the history trigger,
 * and photo events, merged into one list.
 *
 * A single update writes several history rows sharing one changed_at, so the
 * order is keyed on (timestamp, id) rather than the timestamp alone; ordering on
 * time alone would drop rows at a page boundary.
 *
 * A read failure on any of the three sources throws. An item's trail is either
 * complete or explicitly broken; it is never quietly shown short.
 */
export async function getMaintenanceTimeline(
  itemId: string,
  options?: MaintenanceServiceOptions & {
    limit?: number
    cursor?: MaintenanceTimelineCursor | null
  }
): Promise<MaintenanceTimelinePage> {
  const supabase = await resolveClient(options)

  const requested = options?.limit ?? MAINTENANCE_TIMELINE_PAGE_SIZE
  const limit = Math.max(1, Math.min(requested, MAINTENANCE_TIMELINE_MAX_PAGE_SIZE))
  const cursor = options?.cursor ?? null
  if (cursor) assertCursor({ createdAt: cursor.occurredAt, id: cursor.id }, 'timeline')

  // Each source is asked for one more row than the page needs, so the merge can
  // tell whether older entries remain without a second round of queries.
  const fetchSize = limit + 1

  let notesQuery = supabase.from('maintenance_notes').select('*').eq('item_id', itemId)
  notesQuery = applyTimelineCursor(notesQuery, 'created_at', cursor)

  let historyQuery = supabase.from('maintenance_item_history').select('*').eq('item_id', itemId)
  historyQuery = applyTimelineCursor(historyQuery, 'changed_at', cursor)

  // Only ready photos are ever read or displayed. A redacted photo keeps its
  // place in the trail; the redaction fields on the row say what happened to it.
  let photosQuery = supabase
    .from('maintenance_photos')
    .select('*')
    .eq('item_id', itemId)
    .eq('state', 'ready')
  photosQuery = applyTimelineCursor(photosQuery, 'uploaded_at', cursor)

  const [notes, history, photos] = await Promise.all([
    notesQuery
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchSize),
    historyQuery
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchSize),
    photosQuery
      .order('uploaded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(fetchSize),
  ])

  if (notes.error) throw toServiceError(notes.error, 'Could not load the notes for this item.')
  if (history.error) throw toServiceError(history.error, 'Could not load the change history for this item.')
  if (photos.error) throw toServiceError(photos.error, 'Could not load the photos for this item.')

  const merged: MaintenanceTimelineEntry[] = [
    ...((notes.data ?? []) as MaintenanceNoteRow[]).map<MaintenanceTimelineEntry>(row => ({
      kind: 'note',
      id: row.id,
      occurredAt: row.created_at,
      actorEmail: row.created_by_email,
      note: mapMaintenanceNote(row),
    })),
    ...((history.data ?? []) as MaintenanceItemHistoryRow[]).map<MaintenanceTimelineEntry>(row => ({
      kind: 'history',
      id: row.id,
      occurredAt: row.changed_at,
      actorEmail: row.changed_by_email,
      history: mapMaintenanceItemHistoryEntry(row),
    })),
    ...((photos.data ?? []) as MaintenancePhotoRow[]).map<MaintenanceTimelineEntry>(row => ({
      kind: 'photo',
      id: row.id,
      occurredAt: row.uploaded_at,
      actorEmail: row.uploaded_by_email,
      photo: mapMaintenancePhoto(row),
    })),
  ]

  merged.sort((a, b) => {
    if (a.occurredAt === b.occurredAt) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    return a.occurredAt < b.occurredAt ? 1 : -1
  })

  const hasMore = merged.length > limit
  const entries = hasMore ? merged.slice(0, limit) : merged
  const last = entries[entries.length - 1]

  return {
    entries,
    hasMore,
    nextCursor: hasMore && last ? { occurredAt: last.occurredAt, id: last.id } : null,
  }
}
