/**
 * Every permission an API key can hold. This is the one list.
 *
 * Two things read it:
 *
 * 1. `withApiAuth` types its required permissions as `ApiKeyScope`, so a route
 *    that asks for a scope missing from here does not compile.
 * 2. The API keys screen builds its tick boxes from `API_KEY_SCOPE_OPTIONS`, so
 *    every scope a route can ask for can be granted from the screen.
 *
 * The screen used to keep its own hand-typed list. It fell behind the routes by
 * six scopes the public website's key depends on (the three parking ones,
 * `write:recruitment`, `write:marketing_conversions` and `write:ops_alerts`), so
 * a replacement website key issued from the screen would have broken parking,
 * dropped job applications and silenced payment failure alerts with no error
 * anywhere. `tests/api/apiKeyScopes.test.ts` fails if a route names a scope this
 * list lacks, or if `usedByRoutes` stops matching what the routes ask for.
 *
 * This file is imported by a client component. Keep it free of server imports.
 */

interface ApiKeyScopeDefinition {
  value: string
  label: string
  /** False when no route asks for the scope today. Kept so existing keys that hold it still show it. */
  usedByRoutes: boolean
}

const SCOPE_DEFINITIONS = [
  { value: 'read:events', label: 'Read Events', usedByRoutes: true },
  // Gates GET /api/events/{id}/artwork, the only route that emits the story and
  // print-poster URLs. A replacement key created without it leaves artwork
  // import reporting "unavailable" while every other check stays green.
  { value: 'read:events:artwork', label: 'Read Event Artwork', usedByRoutes: true },
  { value: 'read:menu', label: 'Read Menu', usedByRoutes: true },
  { value: 'read:table_bookings', label: 'Read Table Bookings', usedByRoutes: true },
  { value: 'read:customers', label: 'Read Customers', usedByRoutes: true },
  // Table, event and private hire bookings and enquiries made from the website.
  { value: 'create:bookings', label: 'Create Bookings', usedByRoutes: true },
  { value: 'payments:capture', label: 'Capture Payments', usedByRoutes: true },
  { value: 'parking:view', label: 'Parking: View Rates and Bookings', usedByRoutes: true },
  { value: 'parking:availability', label: 'Parking: Check Availability', usedByRoutes: true },
  { value: 'parking:create', label: 'Parking: Create Bookings and Take Payment', usedByRoutes: true },
  { value: 'write:recruitment', label: 'Write Job Applications', usedByRoutes: true },
  { value: 'write:marketing_conversions', label: 'Write Marketing Conversions', usedByRoutes: true },
  // POST /api/website/payment-failure-alert, which texts the pub's alert number.
  { value: 'write:ops_alerts', label: 'Send Operations Alerts', usedByRoutes: true },
  { value: 'write:events', label: 'Write Events', usedByRoutes: false },
  { value: 'write:performers', label: 'Write Performers', usedByRoutes: false },
  { value: 'write:menu', label: 'Write Menu', usedByRoutes: false },
  { value: 'read:business', label: 'Read Business Info', usedByRoutes: false },
  { value: 'write:table_bookings', label: 'Write Table Bookings', usedByRoutes: false },
  { value: 'write:customers', label: 'Write Customers', usedByRoutes: false },
  { value: 'write:bookings', label: 'Write Bookings', usedByRoutes: false },
] as const satisfies readonly ApiKeyScopeDefinition[]

/** Holds every scope at once. Granted from the screen, never asked for by a route. */
export const API_KEY_WILDCARD_SCOPE = '*'

export type ApiKeyScope = (typeof SCOPE_DEFINITIONS)[number]['value']

export const API_KEY_SCOPES: readonly ApiKeyScopeDefinition[] = SCOPE_DEFINITIONS

export interface ApiKeyScopeOption {
  value: string
  label: string
}

const UNUSED_SUFFIX = ' (no route uses this)'

/** The tick boxes on the API keys screen, in the order they are shown. */
export const API_KEY_SCOPE_OPTIONS: readonly ApiKeyScopeOption[] = [
  ...SCOPE_DEFINITIONS.map((scope) => ({
    value: scope.value,
    label: scope.usedByRoutes ? scope.label : `${scope.label}${UNUSED_SUFFIX}`,
  })),
  { value: API_KEY_WILDCARD_SCOPE, label: 'All Permissions' },
]

export function isKnownApiKeyScope(value: string): value is ApiKeyScope {
  return SCOPE_DEFINITIONS.some((scope) => scope.value === value)
}
