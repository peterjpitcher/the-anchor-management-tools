/**
 * Plans the one-off set-up of mileage drivers and their cars (spec 5.1). Pure: the script in
 * scripts/mileage/setup-drivers-and-vehicles.ts loads the current rows, calls this, prints the
 * plan and applies it only with --confirm and RUN_MILEAGE_DRIVER_SETUP_MUTATION=true. Names and
 * cars come from a JSON file kept outside the repository.
 */
import { z } from 'zod'
import { isValidIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

export const FUEL_TYPES = ['petrol', 'diesel', 'lpg', 'electric_home', 'electric_public'] as const
export type FuelType = (typeof FUEL_TYPES)[number]

export const DRIVER_SETUP_SCRIPT_NAME = 'mileage-driver-setup'
export const DRIVER_SETUP_MUTATION_ENV = 'RUN_MILEAGE_DRIVER_SETUP_MUTATION'

const isoDate = z.string().refine(isValidIsoDate, 'Use a real date as YYYY-MM-DD')

const vehicleInputSchema = z
  .object({
    validFrom: isoDate,
    fuelType: z.enum(FUEL_TYPES),
    engineCc: z.number().int().min(50).max(10000).nullable(),
    description: z.string().trim().max(100).optional(),
  })
  .refine((vehicle) => vehicle.fuelType.startsWith('electric') || vehicle.engineCc !== null, {
    message: 'Engine size is required unless the car is electric',
  })

export const driverSetupInputSchema = z
  .object({
    drivers: z
      .array(
        z
          .object({
            displayName: z.string().trim().min(1).max(100),
            drivesOjProjects: z.boolean(),
            vehicles: z.array(vehicleInputSchema).min(1, 'Each driver needs at least one car'),
          })
          .refine(
            (driver) => new Set(driver.vehicles.map((vehicle) => vehicle.validFrom)).size === driver.vehicles.length,
            { message: 'A driver cannot have two cars from the same date' }
          )
      )
      .min(1),
  })
  .refine((input) => input.drivers.filter((driver) => driver.drivesOjProjects).length === 1, {
    message: 'Exactly one driver must drive OJ Projects trips',
  })
  .refine(
    (input) => new Set(input.drivers.map((driver) => driver.displayName.toLowerCase())).size === input.drivers.length,
    { message: 'Driver names must be unique' }
  )

export type DriverSetupInput = z.infer<typeof driverSetupInputSchema>

export interface ExistingDriver {
  id: string
  displayName: string
  isActive: boolean
  drivesOjProjects: boolean
}

export interface ExistingVehicle {
  driverId: string
  validFrom: string
  fuelType: FuelType
  engineCc: number | null
}

export type DriverSetupAction =
  | { kind: 'create_driver'; displayName: string; drivesOjProjects: boolean }
  | { kind: 'update_driver'; driverId: string; displayName: string; drivesOjProjects: boolean }
  | {
      kind: 'create_vehicle'
      displayName: string
      validFrom: string
      fuelType: FuelType
      engineCc: number | null
      description: string | null
    }

export interface DriverSetupPlan {
  actions: DriverSetupAction[]
  warnings: string[]
}

export class DriverSetupConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DriverSetupConflictError'
  }
}

export function planDriverSetup(
  input: DriverSetupInput,
  existingDrivers: ExistingDriver[],
  existingVehicles: ExistingVehicle[],
  catchUpStart = '2024-01-01'
): DriverSetupPlan {
  const actions: DriverSetupAction[] = []
  const warnings: string[] = []
  const byName = new Map(existingDrivers.map((driver) => [driver.displayName.trim().toLowerCase(), driver]))
  const inputNames = new Set(input.drivers.map((driver) => driver.displayName.toLowerCase()))

  const strandedOjDriver = existingDrivers.find(
    (driver) => driver.drivesOjProjects && !inputNames.has(driver.displayName.trim().toLowerCase())
  )
  if (strandedOjDriver) {
    throw new DriverSetupConflictError(
      `${strandedOjDriver.displayName} drives OJ Projects trips but is not in the input; include them so the flag can move safely`
    )
  }

  // Drivers losing or keeping no OJ Projects flag go first, so at most one row ever holds it.
  const ordered = [...input.drivers].sort((a, b) => Number(a.drivesOjProjects) - Number(b.drivesOjProjects))

  for (const driver of ordered) {
    const existing = byName.get(driver.displayName.toLowerCase())
    if (!existing) {
      actions.push({ kind: 'create_driver', displayName: driver.displayName, drivesOjProjects: driver.drivesOjProjects })
    } else if (
      existing.drivesOjProjects !== driver.drivesOjProjects ||
      !existing.isActive ||
      existing.displayName !== driver.displayName
    ) {
      actions.push({
        kind: 'update_driver',
        driverId: existing.id,
        displayName: driver.displayName,
        drivesOjProjects: driver.drivesOjProjects,
      })
    }

    const vehicles = [...driver.vehicles].sort((a, b) => a.validFrom.localeCompare(b.validFrom))
    for (const vehicle of vehicles) {
      const recorded = existing
        ? existingVehicles.find((row) => row.driverId === existing.id && row.validFrom === vehicle.validFrom)
        : undefined
      if (recorded) {
        if (recorded.fuelType !== vehicle.fuelType || recorded.engineCc !== vehicle.engineCc) {
          throw new DriverSetupConflictError(
            `${driver.displayName} already has a different car from ${vehicle.validFrom}; correct it by hand, not with this script`
          )
        }
        continue
      }
      actions.push({
        kind: 'create_vehicle',
        displayName: driver.displayName,
        validFrom: vehicle.validFrom,
        fuelType: vehicle.fuelType,
        engineCc: vehicle.engineCc,
        description: vehicle.description ?? null,
      })
    }

    const earliest = vehicles[0].validFrom
    if (earliest > catchUpStart) {
      warnings.push(
        `${driver.displayName}: no car is recorded before ${earliest}, so VAT on trips from ${catchUpStart} to ${shiftIsoDate(earliest, -1) ?? earliest} cannot be priced`
      )
    }
  }

  return { actions, warnings }
}

/** Reads the script's arguments. A dry run unless --confirm is passed. */
export function readDriverSetupArgs(argv: string[]): { input: string; confirm: boolean } {
  const index = argv.indexOf('--input')
  const input = index === -1 ? undefined : argv[index + 1]
  if (!input || input.startsWith('--')) {
    throw new Error('Pass --input <path to the JSON file>')
  }
  return { input, confirm: argv.includes('--confirm') }
}

/** Writes need RUN_MILEAGE_DRIVER_SETUP_MUTATION=true as well as --confirm. */
export function assertDriverSetupMutationAllowed(): void {
  assertScriptMutationAllowed({ scriptName: DRIVER_SETUP_SCRIPT_NAME, envVar: DRIVER_SETUP_MUTATION_ENV })
}
