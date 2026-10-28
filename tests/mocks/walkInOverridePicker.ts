/**
 * The two database calls the FOH walk-in and super-admin override make since BK-145: the visit
 * length (table_booking_turn_minutes) and the booking function's own table picker
 * (find_table_allocation_candidates). Returns null for any other function, so a test's own rpc
 * mock carries on as before.
 */
export const WALK_IN_TURN = { duration_minutes: 120, turnaround_minutes: 15 }

export type PickerTable = { id: string; name: string; capacity: number }

export function walkInOverridePickerRpc(
  fn: string,
  tables: PickerTable[] = [{ id: 'table-1', name: 'A', capacity: 4 }]
): { data: unknown; error: null } | null {
  if (fn === 'table_booking_turn_minutes') {
    return { data: [WALK_IN_TURN], error: null }
  }
  if (fn === 'find_table_allocation_candidates') {
    return {
      data: tables.map((table, index) => ({
        rank: index + 1,
        table_ids: [table.id],
        table_names: [table.name],
        total_capacity: table.capacity,
        table_count: 1,
        worst_priority: 1,
        reason_code: null,
      })),
      error: null,
    }
  }
  return null
}
