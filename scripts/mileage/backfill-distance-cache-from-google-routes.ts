#!/usr/bin/env tsx

/**
 * Backfill mileage route distances from Google Maps Platform Routes API.
 *
 * Safe by default:
 *   npm run mileage:distances:routes -- --plan-only --limit 25
 *   npm run mileage:distances:routes -- --limit 25
 *
 * Mutation mode requires all three gates:
 *   RUN_MILEAGE_DISTANCE_BACKFILL_MUTATION=true \
 *   ALLOW_MILEAGE_DISTANCE_BACKFILL_MUTATION_SCRIPT=true \
 *     npm run mileage:distances:routes -- --confirm --limit 25
 *
 * Notes:
 * - Uses Google Routes API computeRouteMatrix with DRIVE + TRAFFIC_UNAWARE for
 *   stable distance output rather than time-dependent traffic routing.
 * - Computes both directions for each unordered pair by default. Because the
 *   current database stores one canonical distance per pair, materially
 *   asymmetric routes are skipped unless --accept-asymmetric is passed.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'mileage-distance-backfill'
const RUN_MUTATION_ENV = 'RUN_MILEAGE_DISTANCE_BACKFILL_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_MILEAGE_DISTANCE_BACKFILL_MUTATION_SCRIPT'
const GOOGLE_ROUTES_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'
const GOOGLE_FIELD_MASK = 'originIndex,destinationIndex,status,condition,distanceMeters,duration'
const METERS_PER_MILE = 1609.344
const DEFAULT_LIMIT = 25
const HARD_MUTATION_PAIR_CAP = 1000
const MAX_DESTINATIONS_PER_ONE_ORIGIN_REQUEST = 49

type DestinationRow = {
  id: string
  name: string
  postcode: string | null
  is_home_base: boolean
}

type ExistingDistanceRow = {
  from_destination_id: string
  to_destination_id: string
  miles: number
}

type Destination = {
  id: string
  name: string
  postcode: string | null
  isHomeBase: boolean
  address: string | null
}

type ExistingDistance = {
  miles: number
}

type MileagePair = {
  from: Destination
  to: Destination
  key: string
  existing: ExistingDistance | null
}

type Direction = 'forward' | 'reverse'

type RouteResult = {
  miles: number | null
  distanceMeters: number | null
  duration: string | null
  condition: string | null
  error: string | null
}

type PairRouteResult = {
  pair: MileagePair
  forward: RouteResult | null
  reverse: RouteResult | null
  selectedMiles: number | null
  status: 'ready' | 'skipped'
  reason: string | null
  warning: string | null
}

type Args = {
  planOnly: boolean
  confirm: boolean
  includeExisting: boolean
  anchorOnly: boolean
  singleDirection: boolean
  acceptAsymmetric: boolean
  acceptPartial: boolean
  limit: number | 'all'
  offset: number
  selection: 'max' | 'average' | 'forward'
  asymmetryMiles: number
  asymmetryPercent: number
  delayMs: number
}

function readArgValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag)
  if (index !== -1) {
    const value = argv[index + 1]
    return value && !value.startsWith('--') ? value : null
  }

  const prefixed = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (!prefixed) return null
  return prefixed.slice(flag.length + 1)
}

function parsePositiveInteger(raw: string | null, label: string, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  if (!/^[1-9]\d*$/.test(raw.trim())) {
    throw new Error(`${label} must be a positive integer`)
  }
  return Number(raw)
}

function parseNonNegativeInteger(raw: string | null, label: string, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return Number(raw)
}

function parsePositiveNumber(raw: string | null, label: string, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`)
  }
  return parsed
}

function parseArgs(argv: string[]): Args {
  if (argv.includes('--help')) {
    printUsage()
    process.exit(0)
  }

  const limitRaw = readArgValue(argv, '--limit')
  const limit =
    limitRaw === 'all'
      ? 'all'
      : parsePositiveInteger(limitRaw, '--limit', DEFAULT_LIMIT)

  const selectionRaw = readArgValue(argv, '--selection') ?? 'max'
  if (!['max', 'average', 'forward'].includes(selectionRaw)) {
    throw new Error('--selection must be one of: max, average, forward')
  }

  return {
    planOnly: argv.includes('--plan-only'),
    confirm: argv.includes('--confirm'),
    includeExisting: argv.includes('--include-existing'),
    anchorOnly: argv.includes('--anchor-only'),
    singleDirection: argv.includes('--single-direction'),
    acceptAsymmetric: argv.includes('--accept-asymmetric'),
    acceptPartial: argv.includes('--accept-partial'),
    limit,
    offset: parseNonNegativeInteger(readArgValue(argv, '--offset'), '--offset', 0),
    selection: selectionRaw as Args['selection'],
    asymmetryMiles: parsePositiveNumber(
      readArgValue(argv, '--asymmetry-miles'),
      '--asymmetry-miles',
      0.5
    ),
    asymmetryPercent: parsePositiveNumber(
      readArgValue(argv, '--asymmetry-percent'),
      '--asymmetry-percent',
      10
    ),
    delayMs: parseNonNegativeInteger(readArgValue(argv, '--delay-ms'), '--delay-ms', 150),
  }
}

function printUsage(): void {
  console.log(`Usage:
  npm run mileage:distances:routes -- [options]

Options:
  --plan-only             Load DB rows and show target pairs without calling Google.
  --limit <n|all>         Number of unordered destination pairs to process. Default: ${DEFAULT_LIMIT}.
  --offset <n>            Skip the first n target pairs. Default: 0.
  --include-existing      Include pairs that already have cached distances.
  --anchor-only           Only process pairs where one side is the home base.
  --single-direction      Only calculate from -> to; otherwise both directions are checked.
  --selection <mode>      max, average, or forward. Default: max.
  --accept-asymmetric     Write materially asymmetric bidirectional pairs using --selection.
  --accept-partial        Write if only one direction succeeds.
  --asymmetry-miles <n>   Material asymmetry absolute threshold. Default: 0.5.
  --asymmetry-percent <n> Material asymmetry percentage threshold. Default: 10.
  --delay-ms <n>          Delay between Google API calls. Default: 150.
  --confirm               Enable mutation mode; also requires ${RUN_MUTATION_ENV}=true and ${ALLOW_MUTATION_ENV}=true.
`)
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase())
}

function assertMutationAllowed(args: Args, pairCount: number): boolean {
  if (!args.confirm) return false
  if (args.planOnly) {
    throw new Error('--confirm cannot be combined with --plan-only')
  }
  if (!isTruthy(process.env[RUN_MUTATION_ENV]) || !isTruthy(process.env[ALLOW_MUTATION_ENV])) {
    throw new Error(
      `Mutation blocked. Set ${RUN_MUTATION_ENV}=true and ${ALLOW_MUTATION_ENV}=true, then pass --confirm.`
    )
  }
  if (pairCount > HARD_MUTATION_PAIR_CAP) {
    throw new Error(
      `Mutation blocked: selected ${pairCount} pairs, above hard cap ${HARD_MUTATION_PAIR_CAP}. Use --limit/--offset.`
    )
  }
  return true
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function createSupabaseClient() {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function pairKey(a: string, b: string): string {
  return canonicalPair(a, b).join(':')
}

function buildAddress(destination: DestinationRow): string | null {
  const postcode = destination.postcode?.trim()
  if (!postcode) return null
  return `${destination.name}, ${postcode}, United Kingdom`
}

function metersToRoundedMiles(meters: number): number {
  return Math.round((meters / METERS_PER_MILE) * 10) / 10
}

function roundMiles(miles: number): number {
  return Math.round(miles * 10) / 10
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function loadDestinations(): Promise<Destination[]> {
  const db = createSupabaseClient()
  const { data, error } = await db
    .from('mileage_destinations')
    .select('id, name, postcode, is_home_base')
    .order('is_home_base', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw new Error(`Failed to load mileage destinations: ${error.message}`)

  return ((data ?? []) as DestinationRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    postcode: row.postcode,
    isHomeBase: row.is_home_base,
    address: buildAddress(row),
  }))
}

async function loadExistingDistances(): Promise<Map<string, ExistingDistance>> {
  const db = createSupabaseClient()
  const { data, error } = await db
    .from('mileage_destination_distances')
    .select('from_destination_id, to_destination_id, miles')

  if (error) throw new Error(`Failed to load mileage distances: ${error.message}`)

  const existing = new Map<string, ExistingDistance>()
  for (const row of (data ?? []) as ExistingDistanceRow[]) {
    existing.set(pairKey(row.from_destination_id, row.to_destination_id), {
      miles: Number(row.miles),
    })
  }
  return existing
}

function buildPairs(
  destinations: Destination[],
  existing: Map<string, ExistingDistance>,
  args: Args
): { pairs: MileagePair[]; totalMatchingPairs: number; missingAddressPairs: MileagePair[] } {
  const allPairs: MileagePair[] = []
  const missingAddressPairs: MileagePair[] = []

  for (let i = 0; i < destinations.length; i++) {
    for (let j = i + 1; j < destinations.length; j++) {
      const from = destinations[i]
      const to = destinations[j]
      if (args.anchorOnly && !from.isHomeBase && !to.isHomeBase) continue

      const key = pairKey(from.id, to.id)
      const existingDistance = existing.get(key) ?? null
      const pair = { from, to, key, existing: existingDistance }

      if (!from.address || !to.address) {
        missingAddressPairs.push(pair)
        continue
      }
      if (!args.includeExisting && existingDistance) continue

      allPairs.push(pair)
    }
  }

  return {
    pairs: allPairs.slice(args.offset, args.limit === 'all' ? undefined : args.offset + args.limit),
    totalMatchingPairs: allPairs.length,
    missingAddressPairs,
  }
}

async function computeRoutesForOrigin(params: {
  apiKey: string
  origin: Destination
  destinations: Destination[]
}): Promise<Map<string, RouteResult>> {
  if (!params.origin.address) {
    throw new Error(`Missing address for origin ${params.origin.name}`)
  }

  const destinations = params.destinations.filter((destination) => destination.address)
  const response = await fetch(GOOGLE_ROUTES_MATRIX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': params.apiKey,
      'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
    },
    body: JSON.stringify({
      origins: [
        {
          waypoint: {
            address: params.origin.address,
          },
        },
      ],
      destinations: destinations.map((destination) => ({
        waypoint: {
          address: destination.address,
        },
      })),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      languageCode: 'en-GB',
      regionCode: 'GB',
      units: 'IMPERIAL',
    }),
  })

  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Google Routes returned non-JSON response: ${text.slice(0, 300)}`)
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload &&
      'error' in payload &&
      typeof payload.error === 'object' &&
      payload.error &&
      'message' in payload.error
        ? String(payload.error.message)
        : text
    throw new Error(`Google Routes request failed (${response.status}): ${message}`)
  }

  if (!Array.isArray(payload)) {
    throw new Error(`Google Routes returned unexpected payload: ${text.slice(0, 300)}`)
  }

  const results = new Map<string, RouteResult>()
  for (const element of payload as Array<Record<string, unknown>>) {
    const destinationIndex = Number(element.destinationIndex)
    const destination = destinations[destinationIndex]
    if (!destination) continue

    const status = element.status as { code?: number; message?: string } | undefined
    const condition = typeof element.condition === 'string' ? element.condition : null
    const distanceMeters =
      typeof element.distanceMeters === 'number' ? element.distanceMeters : null
    const error =
      status?.code && status.code !== 0
        ? status.message ?? `Google status ${status.code}`
        : condition && condition !== 'ROUTE_EXISTS'
          ? `Route condition ${condition}`
          : distanceMeters == null
            ? 'Missing distanceMeters'
            : null

    results.set(`${params.origin.id}->${destination.id}`, {
      miles: distanceMeters == null ? null : metersToRoundedMiles(distanceMeters),
      distanceMeters,
      duration: typeof element.duration === 'string' ? element.duration : null,
      condition,
      error,
    })
  }

  return results
}

async function computeRouteResults(
  pairs: MileagePair[],
  args: Args,
  apiKey: string
): Promise<Map<string, RouteResult>> {
  const originDestinationMap = new Map<string, { origin: Destination; destinations: Destination[] }>()

  function addDirection(origin: Destination, destination: Destination): void {
    const existing = originDestinationMap.get(origin.id)
    if (existing) {
      if (!existing.destinations.some((d) => d.id === destination.id)) {
        existing.destinations.push(destination)
      }
      return
    }
    originDestinationMap.set(origin.id, { origin, destinations: [destination] })
  }

  for (const pair of pairs) {
    addDirection(pair.from, pair.to)
    if (!args.singleDirection) {
      addDirection(pair.to, pair.from)
    }
  }

  const routeResults = new Map<string, RouteResult>()
  let requestCount = 0
  for (const group of originDestinationMap.values()) {
    for (let i = 0; i < group.destinations.length; i += MAX_DESTINATIONS_PER_ONE_ORIGIN_REQUEST) {
      const chunk = group.destinations.slice(i, i + MAX_DESTINATIONS_PER_ONE_ORIGIN_REQUEST)
      requestCount += 1
      console.log(
        `Google Routes request ${requestCount}: ${group.origin.name} -> ${chunk.length} destination(s)`
      )
      const chunkResults = await computeRoutesForOrigin({
        apiKey,
        origin: group.origin,
        destinations: chunk,
      })
      for (const [key, value] of chunkResults) {
        routeResults.set(key, value)
      }
      if (args.delayMs > 0) {
        await sleep(args.delayMs)
      }
    }
  }

  return routeResults
}

function isMateriallyAsymmetric(
  a: number,
  b: number,
  args: Args
): { asymmetric: boolean; message: string | null } {
  const diff = Math.abs(a - b)
  const smaller = Math.min(a, b)
  const percent = smaller === 0 ? 100 : (diff / smaller) * 100
  const asymmetric = diff > args.asymmetryMiles && percent > args.asymmetryPercent
  return {
    asymmetric,
    message: asymmetric
      ? `asymmetric by ${roundMiles(diff)} mi (${Math.round(percent)}%)`
      : null,
  }
}

function selectMiles(forwardMiles: number, reverseMiles: number | null, args: Args): number {
  if (args.selection === 'forward' || reverseMiles == null) return forwardMiles
  if (args.selection === 'average') return roundMiles((forwardMiles + reverseMiles) / 2)
  return Math.max(forwardMiles, reverseMiles)
}

function buildPairResults(
  pairs: MileagePair[],
  routeResults: Map<string, RouteResult>,
  args: Args
): PairRouteResult[] {
  return pairs.map((pair) => {
    const forward = routeResults.get(`${pair.from.id}->${pair.to.id}`) ?? null
    const reverse = args.singleDirection
      ? null
      : routeResults.get(`${pair.to.id}->${pair.from.id}`) ?? null

    if (!forward || forward.error || forward.miles == null) {
      return {
        pair,
        forward,
        reverse,
        selectedMiles: null,
        status: 'skipped',
        reason: forward?.error ?? 'Forward route missing',
        warning: null,
      }
    }

    if (!args.singleDirection && (!reverse || reverse.error || reverse.miles == null)) {
      if (!args.acceptPartial) {
        return {
          pair,
          forward,
          reverse,
          selectedMiles: null,
          status: 'skipped',
          reason: reverse?.error ?? 'Reverse route missing',
          warning: null,
        }
      }

      return {
        pair,
        forward,
        reverse,
        selectedMiles: forward.miles,
        status: 'ready',
        reason: null,
        warning: 'reverse route unavailable; using forward route',
      }
    }

    const reverseMiles = reverse?.miles ?? null
    const asymmetry =
      reverseMiles == null
        ? { asymmetric: false, message: null }
        : isMateriallyAsymmetric(forward.miles, reverseMiles, args)

    if (asymmetry.asymmetric && !args.acceptAsymmetric) {
      return {
        pair,
        forward,
        reverse,
        selectedMiles: null,
        status: 'skipped',
        reason: asymmetry.message,
        warning: null,
      }
    }

    return {
      pair,
      forward,
      reverse,
      selectedMiles: selectMiles(forward.miles, reverseMiles, args),
      status: 'ready',
      reason: null,
      warning: asymmetry.message,
    }
  })
}

async function upsertDistances(results: PairRouteResult[]): Promise<void> {
  const db = createSupabaseClient()
  const rows = results
    .filter((result) => result.status === 'ready' && result.selectedMiles != null)
    .map((result) => {
      const [fromId, toId] = canonicalPair(result.pair.from.id, result.pair.to.id)
      return {
        from_destination_id: fromId,
        to_destination_id: toId,
        miles: result.selectedMiles!,
        last_used_at: new Date().toISOString(),
      }
    })

  if (rows.length === 0) return

  const { error } = await db
    .from('mileage_destination_distances')
    .upsert(rows, { onConflict: 'from_destination_id,to_destination_id' })

  if (error) {
    throw new Error(`Failed to upsert mileage distances: ${error.message}`)
  }
}

function formatPair(result: PairRouteResult): string {
  const forward = result.forward?.miles == null ? '-' : `${result.forward.miles} mi`
  const reverse = result.reverse?.miles == null ? '-' : `${result.reverse.miles} mi`
  const selected = result.selectedMiles == null ? '-' : `${result.selectedMiles} mi`
  const existing = result.pair.existing ? `${result.pair.existing.miles} mi` : '-'
  const suffix =
    result.status === 'ready'
      ? result.warning
        ? ` WARN: ${result.warning}`
        : ''
      : ` SKIP: ${result.reason}`

  return `${result.pair.from.name} <-> ${result.pair.to.name} | existing ${existing} | fwd ${forward} | rev ${reverse} | selected ${selected}${suffix}`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const destinations = await loadDestinations()
  const existingDistances = await loadExistingDistances()
  const homeBase = destinations.find((destination) => destination.isHomeBase)

  if (!homeBase) {
    throw new Error('No home base destination found')
  }

  const { pairs, totalMatchingPairs, missingAddressPairs } = buildPairs(
    destinations,
    existingDistances,
    args
  )
  const mutationEnabled = assertMutationAllowed(args, pairs.length)

  console.log(`\n${SCRIPT_NAME} (${args.planOnly ? 'PLAN' : mutationEnabled ? 'MUTATION' : 'DRY-RUN'})`)
  console.log(`Destinations loaded: ${destinations.length}`)
  console.log(`Existing cached distances: ${existingDistances.size}`)
  console.log(`Candidate target pairs before limit/offset: ${totalMatchingPairs}`)
  console.log(`Selected target pairs: ${pairs.length}`)
  console.log(`Pairs skipped for missing postcode/address: ${missingAddressPairs.length}`)
  console.log(`Home base: ${homeBase.name} (${homeBase.postcode ?? 'no postcode'})`)
  console.log(`Current filters: ${JSON.stringify({
    limit: args.limit,
    offset: args.offset,
    includeExisting: args.includeExisting,
    anchorOnly: args.anchorOnly,
    singleDirection: args.singleDirection,
    selection: args.selection,
  })}\n`)

  if (pairs.length === 0) {
    console.log('No target pairs selected.')
    return
  }

  if (args.planOnly) {
    pairs.forEach((pair) => {
      console.log(
        `${pair.from.name} <-> ${pair.to.name} | existing ${pair.existing ? `${pair.existing.miles} mi` : '-'}`
      )
    })
    console.log('\nPlan-only mode: no Google API calls and no database writes.')
    return
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_ROUTES_API_KEY
  if (!apiKey) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY (or GOOGLE_ROUTES_API_KEY) for Google Routes API')
  }

  const routeResults = await computeRouteResults(pairs, args, apiKey)
  const pairResults = buildPairResults(pairs, routeResults, args)
  const ready = pairResults.filter((result) => result.status === 'ready')
  const skipped = pairResults.filter((result) => result.status === 'skipped')
  const warnings = pairResults.filter((result) => result.warning)

  console.log('\nRoute results:')
  pairResults.forEach((result) => console.log(formatPair(result)))

  console.log('\nSummary:')
  console.log(`Ready to upsert: ${ready.length}`)
  console.log(`Skipped: ${skipped.length}`)
  console.log(`Warnings: ${warnings.length}`)

  if (!mutationEnabled) {
    console.log('\nDry-run mode: no database writes.')
    console.log(
      `To apply ready rows, rerun with --confirm and set ${RUN_MUTATION_ENV}=true ${ALLOW_MUTATION_ENV}=true.`
    )
    return
  }

  await upsertDistances(ready)
  console.log(`\nUpdated mileage_destination_distances rows: ${ready.length}`)
}

void main().catch((error) => {
  process.exitCode = 1
  console.error(`[${SCRIPT_NAME}] failed:`, error instanceof Error ? error.message : error)
})
