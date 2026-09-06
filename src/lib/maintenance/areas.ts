// Area name rules, kept pure so they can be tested without a database.
//
// The database is the enforcer: maintenance_areas_name_normalised_key is a unique
// index on lower(regexp_replace(btrim(name), '\s+', ' ', 'g')). These helpers
// mirror that expression exactly so the app can say "there is already an area
// called that" in plain English instead of leaking a constraint name, and so the
// stored name is the tidy form rather than whatever was pasted in.

/** Longest name the maintenance_areas_name_length_check constraint accepts. */
export const MAINTENANCE_AREA_NAME_MAX_LENGTH = 100

// Messages live here rather than beside the actions because a 'use server' file
// may only export async functions, and the page and the tests both need them.

export const AREA_DUPLICATE_NAME_MESSAGE =
  'There is already an area with that name. Names ignore capitals and extra spaces.'
export const AREA_NOT_FOUND_MESSAGE =
  'That area no longer exists. Reload the page and try again.'
export const AREA_ORDER_STALE_MESSAGE =
  'The areas changed while you were reordering them. Reload the page and try again.'

/**
 * The form a name is stored in: trimmed, with runs of whitespace collapsed to a
 * single space. Case is preserved, because "Toilets (Gents)" should read that way.
 */
export function normaliseAreaName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * The comparison key the unique index uses. Two names sharing a key cannot both
 * exist, however differently they were typed.
 */
export function areaNameKey(name: string): string {
  return normaliseAreaName(name).toLowerCase()
}

/**
 * The area, if any, that already holds this name. `exceptId` skips the area being
 * renamed, so saving a name unchanged is not reported as a clash.
 *
 * Inactive areas are included on purpose: the unique index does not care about
 * `active`, so reusing a deactivated area's name would fail at the database.
 */
export function findAreaWithSameName<T extends { id: string; name: string }>(
  areas: readonly T[],
  name: string,
  exceptId?: string
): T | undefined {
  const key = areaNameKey(name)
  return areas.find((area) => area.id !== exceptId && areaNameKey(area.name) === key)
}

/** Gaps of ten, so a later manual insert has somewhere to go. */
export const MAINTENANCE_AREA_SORT_STEP = 10

/**
 * Sort orders for a chosen sequence. Returned as a map so a caller can write only
 * the rows that actually moved rather than touching every area on every reorder.
 */
export function sortOrdersForSequence(orderedIds: readonly string[]): Map<string, number> {
  return new Map(
    orderedIds.map((id, index) => [id, (index + 1) * MAINTENANCE_AREA_SORT_STEP])
  )
}
