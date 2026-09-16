import { afterEach, describe, expect, it } from 'vitest'
import {
  DRIVER_SETUP_MUTATION_ENV,
  DriverSetupConflictError,
  assertDriverSetupMutationAllowed,
  driverSetupInputSchema,
  planDriverSetup,
  readDriverSetupArgs,
} from '@/lib/mileage/driver-setup'

const input = driverSetupInputSchema.parse({
  drivers: [
    { displayName: 'Driver A', drivesOjProjects: true, vehicles: [{ validFrom: '2023-06-01', fuelType: 'petrol', engineCc: 1598 }] },
    { displayName: 'Driver B', drivesOjProjects: false, vehicles: [{ validFrom: '2022-01-01', fuelType: 'diesel', engineCc: 1995 }] },
  ],
})

describe('driverSetupInputSchema', () => {
  it('requires exactly one OJ Projects driver', () => {
    const result = driverSetupInputSchema.safeParse({
      drivers: [
        { displayName: 'Driver A', drivesOjProjects: true, vehicles: [{ validFrom: '2024-01-01', fuelType: 'petrol', engineCc: 1400 }] },
        { displayName: 'Driver B', drivesOjProjects: true, vehicles: [{ validFrom: '2024-01-01', fuelType: 'petrol', engineCc: 1400 }] },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('requires an engine size unless the car is electric', () => {
    const result = driverSetupInputSchema.safeParse({
      drivers: [{ displayName: 'Driver A', drivesOjProjects: true, vehicles: [{ validFrom: '2024-01-01', fuelType: 'petrol', engineCc: null }] }],
    })
    expect(result.success).toBe(false)

    const electric = driverSetupInputSchema.safeParse({
      drivers: [{ displayName: 'Driver A', drivesOjProjects: true, vehicles: [{ validFrom: '2024-01-01', fuelType: 'electric_home', engineCc: null }] }],
    })
    expect(electric.success).toBe(true)
  })

  it('refuses driver names that differ only by case or spaces', () => {
    const result = driverSetupInputSchema.safeParse({
      drivers: [
        { displayName: 'Driver A', drivesOjProjects: true, vehicles: [{ validFrom: '2024-01-01', fuelType: 'petrol', engineCc: 1400 }] },
        { displayName: ' driver a ', drivesOjProjects: false, vehicles: [{ validFrom: '2024-01-01', fuelType: 'petrol', engineCc: 1400 }] },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('refuses dates that are not real calendar dates', () => {
    const result = driverSetupInputSchema.safeParse({
      drivers: [{ displayName: 'Driver A', drivesOjProjects: true, vehicles: [{ validFrom: '2024-02-30', fuelType: 'petrol', engineCc: 1400 }] }],
    })
    expect(result.success).toBe(false)
  })

  it('refuses two cars for one driver from the same date', () => {
    const result = driverSetupInputSchema.safeParse({
      drivers: [
        {
          displayName: 'Driver A',
          drivesOjProjects: true,
          vehicles: [
            { validFrom: '2024-01-01', fuelType: 'petrol', engineCc: 1400 },
            { validFrom: '2024-01-01', fuelType: 'diesel', engineCc: 1600 },
          ],
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('refuses a fuel type outside the list', () => {
    const result = driverSetupInputSchema.safeParse({
      drivers: [{ displayName: 'Driver A', drivesOjProjects: true, vehicles: [{ validFrom: '2024-01-01', fuelType: 'hybrid', engineCc: 1400 }] }],
    })
    expect(result.success).toBe(false)
  })
})

describe('planDriverSetup', () => {
  it('creates drivers and cars, clearing the OJ Projects flag on others first', () => {
    const plan = planDriverSetup(input, [], [])
    expect(plan.actions.map((action) => action.kind)).toEqual(['create_driver', 'create_vehicle', 'create_driver', 'create_vehicle'])
    expect(plan.actions[0]).toMatchObject({ kind: 'create_driver', displayName: 'Driver B', drivesOjProjects: false })
    expect(plan.actions[2]).toMatchObject({ kind: 'create_driver', displayName: 'Driver A', drivesOjProjects: true })
    expect(plan.actions[3]).toEqual({
      kind: 'create_vehicle',
      displayName: 'Driver A',
      validFrom: '2023-06-01',
      fuelType: 'petrol',
      engineCc: 1598,
      description: null,
    })
    expect(plan.warnings).toEqual([])
  })

  it('is a no-op when run again with the same data', () => {
    const plan = planDriverSetup(
      input,
      [
        { id: 'a', displayName: 'Driver A', isActive: true, drivesOjProjects: true },
        { id: 'b', displayName: 'Driver B', isActive: true, drivesOjProjects: false },
      ],
      [
        { driverId: 'a', validFrom: '2023-06-01', fuelType: 'petrol', engineCc: 1598 },
        { driverId: 'b', validFrom: '2022-01-01', fuelType: 'diesel', engineCc: 1995 },
      ]
    )
    expect(plan.actions).toEqual([])
  })

  it('moves the OJ Projects flag by clearing the old holder before setting the new one', () => {
    const swapped = driverSetupInputSchema.parse({
      drivers: [
        { displayName: 'Driver A', drivesOjProjects: false, vehicles: [{ validFrom: '2023-06-01', fuelType: 'petrol', engineCc: 1598 }] },
        { displayName: 'Driver B', drivesOjProjects: true, vehicles: [{ validFrom: '2022-01-01', fuelType: 'diesel', engineCc: 1995 }] },
      ],
    })
    const plan = planDriverSetup(
      swapped,
      [
        { id: 'a', displayName: 'Driver A', isActive: true, drivesOjProjects: true },
        { id: 'b', displayName: 'Driver B', isActive: true, drivesOjProjects: false },
      ],
      [
        { driverId: 'a', validFrom: '2023-06-01', fuelType: 'petrol', engineCc: 1598 },
        { driverId: 'b', validFrom: '2022-01-01', fuelType: 'diesel', engineCc: 1995 },
      ]
    )
    expect(plan.actions).toEqual([
      { kind: 'update_driver', driverId: 'a', displayName: 'Driver A', drivesOjProjects: false },
      { kind: 'update_driver', driverId: 'b', displayName: 'Driver B', drivesOjProjects: true },
    ])
  })

  it('reactivates an inactive driver named in the input and adds a new car', () => {
    const plan = planDriverSetup(
      input,
      [
        { id: 'a', displayName: 'Driver A', isActive: true, drivesOjProjects: true },
        { id: 'b', displayName: 'Driver B', isActive: false, drivesOjProjects: false },
      ],
      [{ driverId: 'a', validFrom: '2023-06-01', fuelType: 'petrol', engineCc: 1598 }]
    )
    expect(plan.actions).toEqual([
      { kind: 'update_driver', driverId: 'b', displayName: 'Driver B', drivesOjProjects: false },
      { kind: 'create_vehicle', displayName: 'Driver B', validFrom: '2022-01-01', fuelType: 'diesel', engineCc: 1995, description: null },
    ])
  })

  it('refuses to change a car that is already recorded for the same date', () => {
    expect(() =>
      planDriverSetup(
        input,
        [{ id: 'a', displayName: 'Driver A', isActive: true, drivesOjProjects: true }],
        [{ driverId: 'a', validFrom: '2023-06-01', fuelType: 'diesel', engineCc: 1598 }]
      )
    ).toThrow(DriverSetupConflictError)
  })

  it('warns when a driver has no car covering the start of the catch-up', () => {
    const late = driverSetupInputSchema.parse({
      drivers: [{ displayName: 'Driver A', drivesOjProjects: true, vehicles: [{ validFrom: '2025-03-01', fuelType: 'petrol', engineCc: 1400 }] }],
    })
    expect(planDriverSetup(late, [], []).warnings).toEqual([
      'Driver A: no car is recorded before 2025-03-01, so VAT on trips from 2024-01-01 to 2025-02-28 cannot be priced',
    ])
  })

  it('refuses when an existing OJ Projects driver is left out of the input', () => {
    expect(() =>
      planDriverSetup(input, [{ id: 'z', displayName: 'Driver Z', isActive: true, drivesOjProjects: true }], [])
    ).toThrow(DriverSetupConflictError)
  })
})

describe('readDriverSetupArgs', () => {
  it('requires an input path', () => {
    expect(() => readDriverSetupArgs([])).toThrow('Pass --input <path to the JSON file>')
    expect(() => readDriverSetupArgs(['--input'])).toThrow('Pass --input <path to the JSON file>')
    expect(() => readDriverSetupArgs(['--input', '--confirm'])).toThrow('Pass --input <path to the JSON file>')
  })

  it('is a dry run unless --confirm is passed', () => {
    expect(readDriverSetupArgs(['--input', '/tmp/drivers.json'])).toEqual({ input: '/tmp/drivers.json', confirm: false })
    expect(readDriverSetupArgs(['--input', '/tmp/drivers.json', '--confirm'])).toEqual({ input: '/tmp/drivers.json', confirm: true })
  })
})

describe('assertDriverSetupMutationAllowed', () => {
  const previous = process.env[DRIVER_SETUP_MUTATION_ENV]

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[DRIVER_SETUP_MUTATION_ENV]
    } else {
      process.env[DRIVER_SETUP_MUTATION_ENV] = previous
    }
  })

  it('blocks writes unless RUN_MILEAGE_DRIVER_SETUP_MUTATION is true', () => {
    expect(DRIVER_SETUP_MUTATION_ENV).toBe('RUN_MILEAGE_DRIVER_SETUP_MUTATION')
    delete process.env[DRIVER_SETUP_MUTATION_ENV]
    expect(() => assertDriverSetupMutationAllowed()).toThrow(
      'mileage-driver-setup blocked by safety guard. Set RUN_MILEAGE_DRIVER_SETUP_MUTATION=true to run this mutation script.'
    )
    process.env[DRIVER_SETUP_MUTATION_ENV] = 'false'
    expect(() => assertDriverSetupMutationAllowed()).toThrow('blocked by safety guard')
    process.env[DRIVER_SETUP_MUTATION_ENV] = 'true'
    expect(() => assertDriverSetupMutationAllowed()).not.toThrow()
  })
})
