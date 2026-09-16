#!/usr/bin/env tsx
/**
 * Sets up mileage drivers and their cars from a JSON file kept OUTSIDE the repository.
 *
 * Dry run (default):
 *   npx tsx scripts/mileage/setup-drivers-and-vehicles.ts --input ~/Desktop/mileage-drivers.json
 *
 * Apply, only after the owner approves the dry run:
 *   RUN_MILEAGE_DRIVER_SETUP_MUTATION=true \
 *     npx tsx scripts/mileage/setup-drivers-and-vehicles.ts --input ~/Desktop/mileage-drivers.json --confirm
 *
 * Input: { "drivers": [ { "displayName": "...", "drivesOjProjects": true,
 *   "vehicles": [ { "validFrom": "2023-06-01", "fuelType": "petrol", "engineCc": 1598 } ] } ] }
 * Fuel types: petrol, diesel, lpg, electric_home, electric_public. Record hybrids as petrol or diesel.
 * Exactly one driver drives OJ Projects trips. Re-running with the same file changes nothing.
 */

import * as dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '../../src/lib/script-mutation-safety'
import {
  DRIVER_SETUP_SCRIPT_NAME,
  assertDriverSetupMutationAllowed,
  driverSetupInputSchema,
  planDriverSetup,
  readDriverSetupArgs,
  type ExistingDriver,
  type ExistingVehicle,
  type FuelType,
} from '../../src/lib/mileage/driver-setup'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function main(): Promise<void> {
  const args = readDriverSetupArgs(process.argv.slice(2))
  const parsed = driverSetupInputSchema.safeParse(JSON.parse(readFileSync(resolve(args.input), 'utf8')))
  if (!parsed.success) {
    throw new Error(`Invalid input: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const db = createClient(url, key, { auth: { persistSession: false } })

  const driversResult = await db.from('mileage_drivers').select('id, display_name, is_active, drives_oj_projects')
  const drivers =
    assertScriptQuerySucceeded({ operation: 'Load drivers', error: driversResult.error, data: driversResult.data, allowMissing: true }) ?? []
  const vehiclesResult = await db.from('mileage_vehicles').select('driver_id, valid_from, fuel_type, engine_cc')
  const vehicles =
    assertScriptQuerySucceeded({ operation: 'Load cars', error: vehiclesResult.error, data: vehiclesResult.data, allowMissing: true }) ?? []

  const plan = planDriverSetup(
    parsed.data,
    drivers.map(
      (row): ExistingDriver => ({
        id: row.id as string,
        displayName: row.display_name as string,
        isActive: row.is_active as boolean,
        drivesOjProjects: row.drives_oj_projects as boolean,
      })
    ),
    vehicles.map(
      (row): ExistingVehicle => ({
        driverId: row.driver_id as string,
        validFrom: row.valid_from as string,
        fuelType: row.fuel_type as FuelType,
        engineCc: (row.engine_cc as number | null) ?? null,
      })
    )
  )

  console.log(`${DRIVER_SETUP_SCRIPT_NAME}: ${plan.actions.length} change(s) planned`)
  for (const action of plan.actions) console.log(`  ${JSON.stringify(action)}`)
  for (const warning of plan.warnings) console.warn(`  warning: ${warning}`)

  if (plan.actions.length === 0) {
    console.log('Nothing to change.')
    return
  }
  if (!args.confirm) {
    console.log('Dry run only. Nothing was written.')
    return
  }
  assertDriverSetupMutationAllowed()

  const idsByName = new Map(drivers.map((row) => [String(row.display_name).trim().toLowerCase(), String(row.id)]))

  for (const action of plan.actions) {
    if (action.kind === 'create_driver') {
      const result = await db
        .from('mileage_drivers')
        .insert({ display_name: action.displayName, drives_oj_projects: action.drivesOjProjects })
        .select('id')
      assertScriptMutationSucceeded({ operation: `Create driver ${action.displayName}`, error: result.error, updatedRows: result.data })
      idsByName.set(action.displayName.toLowerCase(), String(result.data![0].id))
    } else if (action.kind === 'update_driver') {
      const result = await db
        .from('mileage_drivers')
        .update({ display_name: action.displayName, drives_oj_projects: action.drivesOjProjects, is_active: true })
        .eq('id', action.driverId)
        .select('id')
      assertScriptMutationSucceeded({ operation: `Update driver ${action.displayName}`, error: result.error, updatedRows: result.data })
    } else {
      const driverId = idsByName.get(action.displayName.toLowerCase())
      if (!driverId) throw new Error(`No driver id for ${action.displayName}`)
      const result = await db
        .from('mileage_vehicles')
        .insert({
          driver_id: driverId,
          valid_from: action.validFrom,
          fuel_type: action.fuelType,
          engine_cc: action.engineCc,
          description: action.description,
        })
        .select('id')
      assertScriptMutationSucceeded({ operation: `Add car for ${action.displayName}`, error: result.error, updatedRows: result.data })
    }
  }

  // Records what kind of change ran, never names or car details.
  const audit = await db.from('audit_logs').insert({
    operation_type: 'update',
    resource_type: 'mileage_driver_setup',
    operation_status: 'success',
    additional_info: { change: 'mileage_driver_setup', actions: plan.actions.map((action) => action.kind) },
  })
  if (audit.error) {
    console.error('Audit row failed', {
      code: audit.error.code,
      message: audit.error.message,
      details: audit.error.details,
      hint: audit.error.hint,
    })
  }

  console.log(`${DRIVER_SETUP_SCRIPT_NAME}: applied ${plan.actions.length} change(s)`)
}

main().catch((error) => {
  console.error(`${DRIVER_SETUP_SCRIPT_NAME} failed:`, error instanceof Error ? error.message : error)
  process.exit(1)
})
