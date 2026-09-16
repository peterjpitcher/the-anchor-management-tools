#!/usr/bin/env tsx
/**
 * Backfills who drove each historic mileage trip, by the owner's rule of 15 September 2026
 * (spec 5.3): OJ Projects trips and roadshows to the OJ Projects driver, everything else to the
 * other driver. Only trips with no driver created before --created-before are touched.
 *
 * Dry run (default). Driver names, roadshow destinations and the go-live time are supplied in chat
 * by the owner at run time; do not commit them. --created-before is the Release 3 production
 * deployment's ready time in UTC, with its zone:
 *   npx tsx scripts/mileage/backfill-trip-drivers.ts \
 *     --oj-driver "NAME" --other-driver "NAME" \
 *     --roadshow-destination "Leeds Royal Armouries" --roadshow-destination "SEC Glasgow" \
 *     --created-before "2026-10-01T09:00:00Z"
 *
 * Apply, only after the owner approves the dry run output:
 *   RUN_MILEAGE_DRIVER_BACKFILL_MUTATION=true npx tsx scripts/mileage/backfill-trip-drivers.ts ... --confirm
 *
 * Re-running is safe: trips that already have a driver are left alone.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  DRIVER_BACKFILL_SCRIPT_NAME,
  readDriverBackfillArgs,
  runDriverBackfill,
} from '../../src/lib/mileage/driver-backfill'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function main(): Promise<void> {
  // Arguments are checked before any connection, so a bad command never reaches the database.
  const args = readDriverBackfillArgs(process.argv.slice(2))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const db = createClient(url, key, { auth: { persistSession: false } })

  await runDriverBackfill(db, args, (line) => console.log(line))
}

main().catch((error) => {
  console.error(`${DRIVER_BACKFILL_SCRIPT_NAME} failed:`, error instanceof Error ? error.message : error)
  process.exit(1)
})
