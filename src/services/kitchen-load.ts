import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Food the kitchen cooks for private hires and events (owner decision D29, review BK-072,
 * 24 October 2026). Each counts against the online food bookings for the arrival window around its
 * food time, one cover per guest who eats unless staff set otherwise.
 *
 * The rule lives in the database (kitchen_food_loads, which the booking functions sum through
 * kitchen_food_load_covers), so the screens read the same list rather than working it out again.
 */

// `any` because the admin client and the test fakes share no exported type (as readiness.ts).
type DbClient = ReturnType<typeof createAdminClient> | any

export interface KitchenLoad {
  sourceKind: 'private_booking' | 'event'
  sourceId: string
  date: string
  /** "19:00" on the London clock. */
  foodTime: string
  covers: number
}

/** The kitchen loads on these dates. Throws when they cannot be read. */
export async function loadKitchenLoads(from: string, to: string, db: DbClient = createAdminClient()): Promise<KitchenLoad[]> {
  const { data, error } = await db.rpc('kitchen_food_loads', { p_from: from, p_to: to })
  if (error) throw new Error(`Could not read the kitchen covers for hires and events: ${error.message}`)
  return ((data ?? []) as Array<{ source_kind: string; source_id: string; food_date: string; food_time: string; covers: number }>)
    .map((row) => ({
      sourceKind: row.source_kind === 'event' ? 'event' : 'private_booking',
      sourceId: row.source_id,
      date: row.food_date,
      foodTime: String(row.food_time ?? '').slice(0, 5),
      covers: Number(row.covers) || 0,
    }))
}

/** The load one hire or event puts on the kitchen, or null when it puts none. Throws on a failed read. */
export async function loadKitchenLoadFor(
  sourceKind: KitchenLoad['sourceKind'],
  sourceId: string,
  date: string | null | undefined,
  db: DbClient = createAdminClient(),
): Promise<KitchenLoad | null> {
  if (!date) return null
  const loads = await loadKitchenLoads(date, date, db)
  return loads.find((load) => load.sourceKind === sourceKind && load.sourceId === sourceId) ?? null
}

const MAX_KITCHEN_COVERS = 1000

/**
 * Staff's kitchen settings from a form: a number of covers (blank for the automatic count) and a
 * food time (blank for the start). Returns the values to store, or a plain error.
 */
export function parseKitchenSettings(input: { covers?: string | null; foodTime?: string | null }):
  | { ok: true; covers: number | null; foodTime: string | null }
  | { ok: false; error: string } {
  const coversText = (input.covers ?? '').trim()
  let covers: number | null = null
  if (coversText !== '') {
    if (!/^\d+$/.test(coversText)) return { ok: false, error: 'Enter the kitchen covers as a whole number, or leave it blank.' }
    covers = Number(coversText)
    if (covers > MAX_KITCHEN_COVERS) return { ok: false, error: `Kitchen covers cannot be more than ${MAX_KITCHEN_COVERS}.` }
  }
  const timeText = (input.foodTime ?? '').trim()
  let foodTime: string | null = null
  if (timeText !== '') {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(timeText)
    if (!match) return { ok: false, error: 'Enter the food time as hours and minutes, for example 19:30.' }
    foodTime = `${match[1]}:${match[2]}`
  }
  return { ok: true, covers, foodTime }
}
