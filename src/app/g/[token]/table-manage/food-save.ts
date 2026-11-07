/**
 * Saving one guest's line on the Christmas food page, for the organiser's page and the guest's own
 * link alike. The routes prove who is saving and which seat they may touch; this turns the line the
 * browser sent into one `savePreorderCover` call and says what happened in words the person can act
 * on.
 *
 * The browser sends the WHOLE line every time: name, allergies, tier and every course. Anything the
 * tier does not have is sent as cleared, so a guest moving from 3 courses to 2 keeps the one of the
 * starter and dessert they picked and loses the other, and a kids main never survives a move off
 * 1 course.
 */

import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import {
  getCoverAddons,
  PreorderCourseLimitError,
  PreorderSaveScopeError,
  savePreorderCover,
  type PreorderSaveActor,
  type PreorderSelectionInput,
  type SavePreorderCoverInput,
} from '@/lib/table-bookings/preorder'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import {
  PREORDER_ALLERGY_DETAIL_MAX_LENGTH,
  PREORDER_COURSES,
  PREORDER_DIETARY_NOTE_MAX_LENGTH,
  PREORDER_GUEST_NAME_MAX_LENGTH,
  type PreorderCourse,
  type PreorderCover,
  type PreorderOrder,
  type PreorderSeatCourseCount,
} from '@/types/preorders'

type Db = Parameters<typeof savePreorderCover>[0]

const MenuItemId = z.string().uuid().nullable()

/** One line, as the line component posts it. Text is trimmed and length-checked here. */
export const FoodSeatPayloadSchema = z.object({
  ordinal: z.number().int().min(1).max(60),
  /** The seat the page showed, so a save from a page left open after the numbers changed is refused. */
  coverId: z.string().uuid().nullable().optional(),
  guestName: z.string().max(PREORDER_GUEST_NAME_MAX_LENGTH * 2).nullable(),
  hasAllergies: z.boolean().nullable(),
  allergyDetail: z.string().max(PREORDER_ALLERGY_DETAIL_MAX_LENGTH * 2).nullable(),
  dietaryNote: z.string().max(PREORDER_DIETARY_NOTE_MAX_LENGTH * 2).nullable(),
  courseCount: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  starterId: MenuItemId,
  mainId: MenuItemId,
  dessertId: MenuItemId,
  /** Omitted when the menu has no extras; otherwise the whole set the line wants. */
  addonIds: z.array(z.string().uuid()).max(20).optional(),
})

export type FoodSeatPayload = z.infer<typeof FoodSeatPayloadSchema>

function cleanText(value: string | null, max: number): string | null {
  const trimmed = (value ?? '').trim().slice(0, max)
  return trimmed === '' ? null : trimmed
}

/** What each course should hold after this save, given the tier. */
function wantedCourses(payload: FoodSeatPayload): Record<PreorderCourse, string | null> {
  const tier = payload.courseCount
  if (tier === 0) return { starter: null, main: null, dessert: null }
  if (tier === 1) return { starter: null, main: payload.mainId, dessert: null }
  if (tier === 2) {
    // One of the two, never both. The line only ever sends one; a hand-made request sending both
    // keeps the starter.
    return payload.starterId
      ? { starter: payload.starterId, main: payload.mainId, dessert: null }
      : { starter: null, main: payload.mainId, dessert: payload.dessertId }
  }
  return { starter: payload.starterId, main: payload.mainId, dessert: payload.dessertId }
}

/**
 * The `savePreorderCover` input for this line, or null when nothing changed. A tier change sends
 * every course, because the database clears dishes the new tier does not have before the courses
 * are written; without that, a kept starter would vanish with the change.
 */
export function buildFoodSeatSaveInput(
  cover: PreorderCover,
  currentCourseCount: PreorderSeatCourseCount | null,
  payload: FoodSeatPayload,
  actor: PreorderSaveActor,
  tableBookingId: string,
): SavePreorderCoverInput | null {
  const input: SavePreorderCoverInput = { coverId: cover.id, actor, tableBookingId }
  let changed = false

  const guestName = cleanText(payload.guestName, PREORDER_GUEST_NAME_MAX_LENGTH)
  if (guestName !== (cover.guestName ?? null)) {
    input.guestName = guestName
    changed = true
  }
  const dietaryNote = cleanText(payload.dietaryNote, PREORDER_DIETARY_NOTE_MAX_LENGTH)
  if (dietaryNote !== (cover.dietaryNote ?? null)) {
    input.dietaryNote = dietaryNote
    changed = true
  }
  const allergyDetail = payload.hasAllergies ? cleanText(payload.allergyDetail, PREORDER_ALLERGY_DETAIL_MAX_LENGTH) : null
  if (payload.hasAllergies !== (cover.hasAllergies ?? null) || allergyDetail !== (cover.allergyDetail ?? null)) {
    input.hasAllergies = payload.hasAllergies
    if (payload.hasAllergies) input.allergyDetail = allergyDetail
    changed = true
  }

  const tierChanged = payload.courseCount !== currentCourseCount
  if (tierChanged) {
    input.courseCount = payload.courseCount
    changed = true
  }

  const wanted = wantedCourses(payload)
  const selections: PreorderSelectionInput[] = []
  for (const course of PREORDER_COURSES) {
    const current = cover.selections.find((selection) => selection.course === course) ?? null
    const currentId = current && !current.itemWithdrawn ? current.menuItemId : null
    // A withdrawn dish counts as "not chosen", so leaving the box empty clears it from the record.
    if (tierChanged || wanted[course] !== currentId || (current?.itemWithdrawn && wanted[course] === null)) {
      selections.push({ course, menuItemId: wanted[course] })
    }
  }
  if (selections.length > 0) {
    input.selections = selections
    changed = true
  }

  if (payload.addonIds) {
    const wantedAddons = Array.from(new Set(payload.addonIds)).sort()
    const currentAddons = getCoverAddons(cover)
      .filter((addon) => !addon.itemWithdrawn)
      .map((addon) => addon.menuItemId)
      .sort()
    if (wantedAddons.length !== currentAddons.length || wantedAddons.some((id, index) => id !== currentAddons[index])) {
      input.addonMenuItemIds = wantedAddons
      changed = true
    }
  }

  return changed ? input : null
}

/** Why a line did not save, in words for the person saving it. */
export function describeFoodSaveError(error: unknown): string {
  if (error instanceof PreorderCourseLimitError) {
    return error.reason === 'child_option'
      ? 'Kids Christmas dinners are 1 course only. Choose 1 course, or pick a different main.'
      : 'That is more courses than this guest is having. On 2 courses, choose a main plus a starter or a dessert, not both.'
  }
  if (error instanceof PreorderSaveScopeError) return error.message
  const message = error instanceof Error ? error.message : ''
  if (/taken off the menu|not on the menu/i.test(message)) {
    return 'One of those dishes is no longer on the menu. Please choose again.'
  }
  return `We couldn't save this guest's choices. Please try again, or call us on ${GUEST_CONTACT.phoneDisplay}.`
}

/** True when the failure is the guest's to fix rather than a fault on our side. */
export function isExpectedFoodSaveError(error: unknown): boolean {
  if (error instanceof PreorderCourseLimitError || error instanceof PreorderSaveScopeError) return true
  const message = error instanceof Error ? error.message : ''
  return /taken off the menu|not on the menu/i.test(message)
}

export type FoodSaveOutcome =
  | { state: 'saved'; cover: PreorderCover | null }
  | { state: 'unchanged' }
  | { state: 'failed'; error: string }

/**
 * Save one line. Never throws: a fault is logged (an error, so it is seen) and returned as words
 * for the page, and the audit row names the seat and dish ids only, never a name, allergy or note.
 */
export async function saveFoodSeat(
  supabase: Db,
  input: {
    order: PreorderOrder
    cover: PreorderCover
    payload: FoodSeatPayload
    actor: PreorderSaveActor
    source: 'organiser_food_page' | 'guest_choice_link'
  },
): Promise<FoodSaveOutcome> {
  const { order, cover, payload, actor } = input
  const currentCourseCount = order.courseCounts?.[cover.ordinal - 1] ?? null
  const saveInput = buildFoodSeatSaveInput(cover, currentCourseCount, payload, actor, order.tableBookingId)
  if (!saveInput) return { state: 'unchanged' }

  try {
    const saved = await savePreorderCover(supabase, saveInput)
    await auditFoodSave(order, cover.ordinal, saveInput, input.source)
    return { state: 'saved', cover: saved }
  } catch (error) {
    const log = isExpectedFoodSaveError(error) ? logger.warn : logger.error
    log.call(logger, 'Christmas food line could not be saved', {
      ...(isExpectedFoodSaveError(error) ? {} : { error: error instanceof Error ? error : new Error(String(error)) }),
      metadata: {
        tableBookingId: order.tableBookingId,
        ordinal: cover.ordinal,
        source: input.source,
        reason: error instanceof Error ? error.message : String(error),
      },
    })
    return { state: 'failed', error: describeFoodSaveError(error) }
  }
}

async function auditFoodSave(
  order: PreorderOrder,
  ordinal: number,
  saveInput: SavePreorderCoverInput,
  source: string,
): Promise<void> {
  try {
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'table_booking_preorder',
      resource_id: order.tableBookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: order.bookingReference,
        seats_saved: [ordinal],
        dish_ids: Array.from(
          new Set([
            ...(saveInput.selections ?? []).map((entry) => entry.menuItemId).filter((id): id is string => Boolean(id)),
            ...(saveInput.addonMenuItemIds ?? []),
          ]),
        ),
        ...(saveInput.courseCount !== undefined ? { course_count: saveInput.courseCount } : {}),
        source,
      },
    })
  } catch (error) {
    logger.error('Could not audit a Christmas food line save', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: order.tableBookingId, ordinal },
    })
  }
}
