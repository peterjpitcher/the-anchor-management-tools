import { createAdminClient } from '@/lib/supabase/admin'
import { checkCapacity } from './conflicts'

/**
 * Is a private hire ready to be confirmed? (Owner decisions D24 and D25, review items BK-005,
 * BK-006 and BK-007, 24 October 2026.)
 *
 * A hire only takes the rest of the pub off sale through the room ("space") booked on it, so a
 * confirmed hire with no room, with no guest count, or with more guests than its rooms hold left
 * tables on sale on nights the pub was full. And a hire was confirmed without its contract ever
 * reaching the customer. One set of rules decides all of it, used by every way a booking becomes
 * confirmed (staff changing the status, a deposit being paid, a deposit being waived), by the
 * booking page and list, and by the daily check that emails the manager.
 *
 * - A hire needs at least one room and a guest count.
 * - The guests must fit the rooms for the layout (checkCapacity). A manager can allow more guests
 *   than the rooms hold; that is recorded, with the reason, as a `capacity_override` row on the
 *   booking's audit trail, and covers exactly those rooms and that layout up to the number allowed.
 *   Changing either ends it.
 * - The contract must have been sent, or recorded as accepted another way.
 *
 * The pure functions here never read the database; the loader does, and throws when it cannot,
 * so each caller decides whether a check that could not run blocks or not.
 */

// `any` because the session client, the admin client and the test fakes share no exported type
// (the same alias as payments.ts).
type DbClient = ReturnType<typeof createAdminClient> | any

export type HireLayout = 'seated' | 'standing' | 'mixed' | null

export interface HireRoom {
  id: string
  name: string
  capacity_seated: number | null
  capacity_standing: number | null
  blocks_all_spaces?: boolean | null
  active?: boolean | null
  display_order?: number | null
}

/** A manager's permission for more guests than the rooms hold. */
export interface CapacityOverride {
  maxGuests: number
  layout: HireLayout
  /** The rooms it was given for, sorted. */
  spaceIds: string[]
  reason: string
  grantedAt: string
  grantedBy: string | null
}

export type HireProblemCode = 'no_room' | 'no_guest_count' | 'over_capacity' | 'contract_not_sent'

export interface HireProblem {
  code: HireProblemCode
  /** A plain sentence for staff. */
  message: string
}

/** The audit action that records a manager's capacity override. */
export const CAPACITY_OVERRIDE_ACTION = 'capacity_override'
/** The audit action finalizeDepositPayment writes when a paid deposit could not confirm the booking. */
export const CONFIRMATION_BLOCKED_ACTION = 'confirmation_blocked'

const NO_ROOM_MESSAGE =
  'No room is booked for this hire. Add the room the party will use as a Space item, so the rest of the pub is not sold over it.'
const NO_GUEST_COUNT_MESSAGE =
  'The guest count is not set, so nobody can check that the room is big enough. Add the number of guests.'
export const CONTRACT_NOT_SENT_MESSAGE =
  'The contract has not been sent. Send it from the Signatures panel, or record that the customer accepted it another way.'

function normaliseLayout(layout: unknown): HireLayout {
  return layout === 'seated' || layout === 'standing' || layout === 'mixed' ? layout : null
}

function positiveGuests(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const guests = Number(value)
  return Number.isFinite(guests) && guests > 0 ? guests : null
}

function sortedUnique(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort()
}

/** "A", "A or B", "A, B or C". */
function joinWithOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/** One room's capacity for the layout, by the same rule as checkCapacity, or null when unknown. */
export function roomCapacity(room: HireRoom, layout: HireLayout): number | null {
  return checkCapacity({ spaces: [room], guestCount: null, layout }).capacity ?? null
}

/** Does this override cover these rooms, this layout and this many guests? */
export function capacityOverrideCovers(
  override: CapacityOverride | null | undefined,
  state: { spaceIds: string[]; layout: HireLayout; guestCount: number | null },
): boolean {
  if (!override || state.guestCount === null) return false
  if ((override.layout ?? null) !== (state.layout ?? null)) return false
  const now = sortedUnique(state.spaceIds)
  const granted = sortedUnique(override.spaceIds)
  if (now.length !== granted.length || now.some((id, index) => id !== granted[index])) return false
  return state.guestCount <= override.maxGuests
}

/**
 * The rooms that, added to the ones booked, would fit the guests: in the order the venue lists
 * them. A whole-venue space (blocks_all_spaces) replaces the others rather than adding to them, so
 * it counts only when it holds everyone by itself.
 */
export function suggestRoomsToAdd(input: {
  rooms: HireRoom[]
  guestCount: number
  layout: HireLayout
  candidates: HireRoom[]
}): string[] {
  const booked = new Set(input.rooms.map((room) => room.id))
  const current = checkCapacity({ spaces: input.rooms, guestCount: null, layout: input.layout }).capacity ?? 0
  return [...input.candidates]
    .filter((room) => room.active !== false && !booked.has(room.id))
    .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999) || a.name.localeCompare(b.name))
    .filter((room) => {
      const capacity = roomCapacity(room, input.layout)
      if (!capacity) return false
      return room.blocks_all_spaces ? capacity >= input.guestCount : current + capacity >= input.guestCount
    })
    .map((room) => room.name)
}

function overCapacityMessage(reason: string, suggestions: string[]): string {
  const advice = suggestions.length > 0
    ? `Add ${joinWithOr(suggestions)} so the guests fit, or ask a manager to allow it.`
    : 'No other room would fit them, so reduce the guest count or ask a manager to allow it.'
  return `${reason}. ${advice}`
}

/**
 * What is wrong with a hire's rooms: no room, no guest count, or more guests than the rooms hold
 * (unless a manager's override covers it). Empty when the rooms are fine.
 */
export function assessHireRooms(input: {
  rooms: HireRoom[]
  guestCount: unknown
  layout: unknown
  override?: CapacityOverride | null
  /** Every venue space, for the "add the next room" advice. */
  candidates?: HireRoom[]
}): HireProblem[] {
  const problems: HireProblem[] = []
  const layout = normaliseLayout(input.layout)
  const guests = positiveGuests(input.guestCount)

  if (input.rooms.length === 0) problems.push({ code: 'no_room', message: NO_ROOM_MESSAGE })
  if (guests === null) problems.push({ code: 'no_guest_count', message: NO_GUEST_COUNT_MESSAGE })

  if (input.rooms.length > 0 && guests !== null) {
    const result = checkCapacity({ spaces: input.rooms, guestCount: guests, layout })
    const covered = capacityOverrideCovers(input.override, {
      spaceIds: input.rooms.map((room) => room.id),
      layout,
      guestCount: guests,
    })
    if (!result.ok && !covered) {
      problems.push({
        code: 'over_capacity',
        message: overCapacityMessage(
          result.reason || 'The guest count is more than the rooms hold',
          suggestRoomsToAdd({ rooms: input.rooms, guestCount: guests, layout, candidates: input.candidates ?? [] }),
        ),
      })
    }
  }

  return problems
}

/** Has the contract reached the customer: sent, or accepted (online, on paper or in writing)? */
export function contractSentOrAccepted(booking: {
  contract_sent_at?: string | null
  contract_accepted_at?: string | null
}): boolean {
  return Boolean(booking.contract_sent_at) || Boolean(booking.contract_accepted_at)
}

/** Everything the rules read about one booking. */
export interface HireReadinessFacts {
  bookingId: string
  status: string | null
  guestCount: number | null
  layout: HireLayout
  rooms: HireRoom[]
  override: CapacityOverride | null
  contractSentAt: string | null
  contractAcceptedAt: string | null
  depositPaidDate: string | null
  depositConfirmedAt: string | null
  depositWaived: boolean
  /** The reasons recorded when a paid deposit could not confirm the booking, latest first. */
  lastConfirmationBlock: { reasons: string[]; at: string | null } | null
}

/** The rooms problems for the facts as loaded, or with a guest count or layout about to be saved. */
export function hireRoomProblems(
  facts: HireReadinessFacts,
  candidates: HireRoom[],
  pending?: { guestCount?: unknown; layout?: unknown },
): HireProblem[] {
  return assessHireRooms({
    rooms: facts.rooms,
    guestCount: pending?.guestCount !== undefined ? pending.guestCount : facts.guestCount,
    layout: pending?.layout !== undefined ? pending.layout : facts.layout,
    override: facts.override,
    candidates,
  })
}

/**
 * Owner decision D25 (review BK-006): a hire is not confirmed until its contract has been sent, or
 * recorded as accepted another way. Every deposit request told the guest that paying accepts the
 * terms "set out in your contract", and most hires were confirmed with none ever sent.
 */
export function contractProblem(facts: Pick<HireReadinessFacts, 'contractSentAt' | 'contractAcceptedAt'>): HireProblem | null {
  return contractSentOrAccepted({ contract_sent_at: facts.contractSentAt, contract_accepted_at: facts.contractAcceptedAt })
    ? null
    : { code: 'contract_not_sent', message: CONTRACT_NOT_SENT_MESSAGE }
}

/** Everything that stops a hire being confirmed: its rooms (D24) and its contract (D25). */
export function hireConfirmationProblems(
  facts: HireReadinessFacts,
  candidates: HireRoom[],
  pending?: { guestCount?: unknown; layout?: unknown },
): HireProblem[] {
  const contract = contractProblem(facts)
  return [...hireRoomProblems(facts, candidates, pending), ...(contract ? [contract] : [])]
}

/**
 * Has the booking reached the deposit stage: deposit confirmed, paid or waived, or the booking
 * confirmed? From then on a missing contract is shown on the booking and in the list (BK-006).
 */
export function depositStageReached(
  facts: Pick<HireReadinessFacts, 'status' | 'depositConfirmedAt' | 'depositPaidDate' | 'depositWaived'>,
): boolean {
  return Boolean(facts.depositConfirmedAt) || Boolean(facts.depositPaidDate) || facts.depositWaived || facts.status === 'confirmed'
}

/** Is this booking a draft with its deposit paid: money in, booking not confirmed? */
export function isPaidButNotConfirmed(facts: Pick<HireReadinessFacts, 'status' | 'depositPaidDate'>): boolean {
  return facts.status === 'draft' && Boolean(facts.depositPaidDate)
}

/** The text a staff error leads with when a booking cannot be confirmed yet. */
export function describeConfirmationBlockers(problems: HireProblem[]): string {
  return `This booking cannot be confirmed yet. ${problems.map((problem) => problem.message).join(' ')}`
}

/** What the booking page shows about a hire's readiness. Plain data, so it can go to the client. */
export interface HireReadinessView {
  /** True for a draft or confirmed booking; the rest are over or not going ahead. */
  live: boolean
  status: string | null
  roomProblems: HireProblem[]
  /** Set when the deposit is paid and the booking is still a draft. */
  paidNotConfirmed: { reasons: string[]; recordedAt: string | null } | null
  roomNames: string[]
  /** What the booked rooms hold for the layout, or null when no room or no capacity is known. */
  roomCapacity: number | null
  /** A manager's override that still applies to the rooms and layout booked now. */
  capacityOverride: { maxGuests: number; reason: string; grantedAt: string } | null
  /** The deposit stage is reached and the contract has not been sent or accepted (D25). */
  contractNotSent: boolean
}

export function buildHireReadinessView(facts: HireReadinessFacts, candidates: HireRoom[]): HireReadinessView {
  const live = facts.status === 'draft' || facts.status === 'confirmed'
  const total = facts.rooms.reduce((sum, room) => sum + (roomCapacity(room, facts.layout) ?? 0), 0)
  const overrideApplies =
    facts.override !== null &&
    capacityOverrideCovers(facts.override, {
      spaceIds: facts.rooms.map((room) => room.id),
      layout: facts.layout,
      // Any count up to the one allowed: the override still stands for these rooms and layout.
      guestCount: Math.min(facts.guestCount ?? 1, facts.override.maxGuests),
    })
  return {
    live,
    status: facts.status,
    roomProblems: live ? hireRoomProblems(facts, candidates) : [],
    paidNotConfirmed: live && isPaidButNotConfirmed(facts)
      ? { reasons: facts.lastConfirmationBlock?.reasons ?? [], recordedAt: facts.lastConfirmationBlock?.at ?? null }
      : null,
    roomNames: facts.rooms.map((room) => room.name),
    roomCapacity: total > 0 ? total : null,
    capacityOverride: overrideApplies && facts.override
      ? { maxGuests: facts.override.maxGuests, reason: facts.override.reason, grantedAt: facts.override.grantedAt }
      : null,
    contractNotSent: live && depositStageReached(facts) && contractProblem(facts) !== null,
  }
}

function readOverride(row:{ metadata?: unknown; performed_at?: string | null; performed_by?: string | null }): CapacityOverride | null {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>
  const maxGuests = positiveGuests(metadata.max_guests)
  const spaceIds = Array.isArray(metadata.space_ids)
    ? metadata.space_ids.filter((id): id is string => typeof id === 'string')
    : []
  if (maxGuests === null || spaceIds.length === 0) return null
  return {
    maxGuests,
    layout: normaliseLayout(metadata.layout),
    spaceIds: sortedUnique(spaceIds),
    reason: typeof metadata.reason === 'string' ? metadata.reason : '',
    grantedAt: row.performed_at ?? '',
    grantedBy: row.performed_by ?? null,
  }
}

function readBlock(row: { metadata?: unknown; performed_at?: string | null }): { reasons: string[]; at: string | null } {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>
  const reasons = Array.isArray(metadata.reasons)
    ? metadata.reasons.filter((reason): reason is string => typeof reason === 'string' && reason.trim() !== '')
    : []
  return { reasons, at: row.performed_at ?? null }
}

/** Every venue space, for room names, capacities and the "add the next room" advice. */
export async function loadVenueRooms(db: DbClient = createAdminClient()): Promise<HireRoom[]> {
  const { data, error } = await db
    .from('venue_spaces')
    .select('id, name, capacity_seated, capacity_standing, blocks_all_spaces, active, display_order')
  if (error) throw new Error(`Could not read the venue's rooms: ${error.message}`)
  return (data ?? []) as HireRoom[]
}

/**
 * Loads the facts for these bookings. Throws if any read fails: a hire must never be confirmed,
 * or shown as fine, on a read that did not happen.
 */
export async function loadHireReadinessFacts(
  bookingIds: string[],
  options: { db?: DbClient; rooms?: HireRoom[] } = {},
): Promise<{ facts: Map<string, HireReadinessFacts>; rooms: HireRoom[] }> {
  const db = options.db ?? createAdminClient()
  const ids = Array.from(new Set(bookingIds.filter(Boolean)))
  const facts = new Map<string, HireReadinessFacts>()
  const venueRooms = options.rooms ?? (await loadVenueRooms(db))
  if (ids.length === 0) return { facts, rooms: venueRooms }

  const { data: bookings, error: bookingsError } = await db
    .from('private_bookings')
    .select('id, status, guest_count, layout, contract_sent_at, contract_accepted_at, deposit_paid_date, deposit_confirmed_at, deposit_waived')
    .in('id', ids)
  if (bookingsError) throw new Error(`Could not read the bookings: ${bookingsError.message}`)

  const { data: items, error: itemsError } = await db
    .from('private_booking_items')
    .select('booking_id, space_id')
    .in('booking_id', ids)
    .eq('item_type', 'space')
  if (itemsError) throw new Error(`Could not read the booked rooms: ${itemsError.message}`)

  const { data: auditRows, error: auditError } = await db
    .from('private_booking_audit')
    .select('booking_id, action, metadata, performed_by, performed_at')
    .in('booking_id', ids)
    .in('action', [CAPACITY_OVERRIDE_ACTION, CONFIRMATION_BLOCKED_ACTION])
    .order('performed_at', { ascending: false })
  if (auditError) throw new Error(`Could not read the booking history: ${auditError.message}`)

  const roomById = new Map(venueRooms.map((room) => [room.id, room]))
  const roomsByBooking = new Map<string, HireRoom[]>()
  for (const item of (items ?? []) as Array<{ booking_id: string; space_id: string | null }>) {
    if (!item.space_id) continue
    const room = roomById.get(item.space_id)
    if (!room) continue
    const list = roomsByBooking.get(item.booking_id) ?? []
    if (!list.some((existing) => existing.id === room.id)) list.push(room)
    roomsByBooking.set(item.booking_id, list)
  }

  // Newest first, so the first of each kind per booking is the one that counts.
  const overrideByBooking = new Map<string, CapacityOverride | null>()
  const blockByBooking = new Map<string, { reasons: string[]; at: string | null }>()
  const rows = [...((auditRows ?? []) as Array<{ booking_id: string; action: string; metadata?: unknown; performed_by?: string | null; performed_at?: string | null }>)]
    .sort((a, b) => String(b.performed_at ?? '').localeCompare(String(a.performed_at ?? '')))
  for (const row of rows) {
    if (row.action === CAPACITY_OVERRIDE_ACTION && !overrideByBooking.has(row.booking_id)) {
      overrideByBooking.set(row.booking_id, readOverride(row))
    } else if (row.action === CONFIRMATION_BLOCKED_ACTION && !blockByBooking.has(row.booking_id)) {
      blockByBooking.set(row.booking_id, readBlock(row))
    }
  }

  for (const booking of (bookings ?? []) as Array<Record<string, unknown>>) {
    const id = String(booking.id)
    facts.set(id, {
      bookingId: id,
      status: (booking.status as string | null) ?? null,
      guestCount: positiveGuests(booking.guest_count),
      layout: normaliseLayout(booking.layout),
      rooms: roomsByBooking.get(id) ?? [],
      override: overrideByBooking.get(id) ?? null,
      contractSentAt: (booking.contract_sent_at as string | null) ?? null,
      contractAcceptedAt: (booking.contract_accepted_at as string | null) ?? null,
      depositPaidDate: (booking.deposit_paid_date as string | null) ?? null,
      depositConfirmedAt: (booking.deposit_confirmed_at as string | null) ?? null,
      depositWaived: booking.deposit_waived === true,
      lastConfirmationBlock: blockByBooking.get(id) ?? null,
    })
  }

  return { facts, rooms: venueRooms }
}

/** One booking's facts and the venue's rooms. Throws when the booking cannot be read. */
export async function loadOneHireReadiness(
  bookingId: string,
  db?: DbClient,
): Promise<{ facts: HireReadinessFacts; rooms: HireRoom[] }> {
  const { facts, rooms } = await loadHireReadinessFacts([bookingId], { db })
  const one = facts.get(bookingId)
  if (!one) throw new Error('Booking not found')
  return { facts: one, rooms }
}
