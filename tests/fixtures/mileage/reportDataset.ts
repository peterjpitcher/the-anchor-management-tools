/**
 * Synthetic Q2 2026 report dataset (spec 6.1 JSON shape). Expected figures used across the
 * Release 4 tests:
 * - totals: 3 trips, 570 tenths (57.0 mi), 3,101p (GBP 31.01)
 * - Driver A: 2 trips, 434 tenths, 2,353p; Driver B: 1 trip, 136 tenths, 748p
 * - bands: 2025/26 at 45p 34 tenths 153p; 2026/27 at 55p 536 tenths 2,948p
 * - months: 2026-04 2 trips 170 tenths 901p; 2026-05 1 trip 400 tenths 2,200p
 * - VAT: Driver A petrol 1598cc at 14p: 48p + 560p = 608p fuel, 101p VAT;
 *        Driver B diesel 1995cc at 13p: 177p fuel, 29p VAT; total 785p fuel, 130p VAT
 */

export const DRIVER_A_ID = '00000000-0000-4000-8000-0000000000a1'
export const DRIVER_B_ID = '00000000-0000-4000-8000-0000000000b1'
const HOME_ID = '00000000-0000-4000-8000-000000000001'
const SHOP_ID = '00000000-0000-4000-8000-000000000002'
const WHOLESALER_ID = '00000000-0000-4000-8000-000000000003'

type Place = [id: string, name: string, postcode: string | null, isHomeBase: boolean]

function leg(order: number, from: Place, to: Place, milesTenths: number) {
  return {
    leg_order: order,
    from_id: from[0], from_name: from[1], from_postcode: from[2], from_is_home_base: from[3],
    to_id: to[0], to_name: to[1], to_postcode: to[2], to_is_home_base: to[3],
    miles_tenths: milesTenths,
  }
}

const HOME: Place = [HOME_ID, 'The Anchor', 'TW19 6AQ', true]
const SHOP: Place = [SHOP_ID, 'Shop One', 'TW15 1AA', false]
const WHOLESALER: Place = [WHOLESALER_ID, 'Wholesaler', null, false]

export function buildDatasetJson(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: '2026-10-02T13:05:00.123456+00:00',
    from: '2026-04-01',
    to: '2026-06-30',
    trips: [
      {
        id: '00000000-0000-4000-8000-000000000101', trip_date: '2026-04-04', created_at: '2026-04-04T10:00:00+00:00',
        description: 'Shop One', total_miles_tenths: 34, standard_miles_tenths: 34, reduced_miles_tenths: 0, amount_pence: 153,
        source: 'manual', driver_id: DRIVER_A_ID, driver_name: 'Driver A', driver_basis: 'owner_statement',
        oj_project_name: null, oj_client_name: null,
        legs: [leg(1, HOME, SHOP, 17), leg(2, SHOP, HOME, 17)],
      },
      {
        id: '00000000-0000-4000-8000-000000000102', trip_date: '2026-04-06', created_at: '2026-04-06T09:00:00+00:00',
        description: 'Collect wholesale order', total_miles_tenths: 136, standard_miles_tenths: 136, reduced_miles_tenths: 0, amount_pence: 748,
        source: 'manual', driver_id: DRIVER_B_ID, driver_name: 'Driver B', driver_basis: 'entered',
        oj_project_name: null, oj_client_name: null,
        legs: [leg(1, HOME, WHOLESALER, 68), leg(2, WHOLESALER, HOME, 68)],
      },
      {
        id: '00000000-0000-4000-8000-000000000103', trip_date: '2026-05-01', created_at: '2026-05-01T08:00:00+00:00',
        description: 'Workshop', total_miles_tenths: 400, standard_miles_tenths: 400, reduced_miles_tenths: 0, amount_pence: 2200,
        source: 'oj_projects', driver_id: DRIVER_A_ID, driver_name: 'Driver A', driver_basis: 'oj_projects',
        oj_project_name: 'Vision workshop', oj_client_name: 'Client Ltd',
        legs: [],
      },
    ],
    tax_year_positions: [
      { driver_id: DRIVER_A_ID, tax_year_start: '2025-04-06', cutoff_date: '2026-04-05', miles_tenths_to_cutoff: 1034 },
      { driver_id: DRIVER_A_ID, tax_year_start: '2026-04-06', cutoff_date: '2026-06-30', miles_tenths_to_cutoff: 400 },
      { driver_id: DRIVER_B_ID, tax_year_start: '2025-04-06', cutoff_date: '2026-04-05', miles_tenths_to_cutoff: 0 },
      { driver_id: DRIVER_B_ID, tax_year_start: '2026-04-06', cutoff_date: '2026-06-30', miles_tenths_to_cutoff: 136 },
    ],
    drivers: [
      { id: DRIVER_A_ID, display_name: 'Driver A' },
      { id: DRIVER_B_ID, display_name: 'Driver B' },
    ],
    vehicles: [
      { driver_id: DRIVER_A_ID, valid_from: '2023-01-01', fuel_type: 'petrol', engine_cc: 1598 },
      { driver_id: DRIVER_B_ID, valid_from: '2023-01-01', fuel_type: 'diesel', engine_cc: 1995 },
    ],
    ...overrides,
  }
}
