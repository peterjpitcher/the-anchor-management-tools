import { describe, expect, it } from 'vitest'
import {
  mapTripLegsToFormModel,
  validateAndBuildTripLegs,
  type TripFormMileageLeg,
  type TripFormStop,
} from '../tripFormModel'

describe('trip form model', () => {
  const HOME = '00000000-0000-4000-8000-000000000001'
  const DEST_A = '00000000-0000-4000-8000-000000000002'
  const DEST_B = '00000000-0000-4000-8000-000000000003'

  it('maps a single-stop round trip with return miles separated', () => {
    const legs: TripFormMileageLeg[] = [
      { fromDestinationId: HOME, toDestinationId: DEST_A, miles: 2.4 },
      { fromDestinationId: DEST_A, toDestinationId: HOME, miles: 2.4 },
    ]

    const model = mapTripLegsToFormModel(legs, HOME)

    expect(model.stops).toHaveLength(1)
    expect(model.stops[0].destinationId).toBe(DEST_A)
    expect(model.stops[0].miles).toBe('2.4')
    expect(model.returnMiles).toBe('2.4')
  })

  it('maps all intermediate and return distances for a multi-stop trip', () => {
    const legs: TripFormMileageLeg[] = [
      { fromDestinationId: HOME, toDestinationId: DEST_A, miles: 2.4 },
      { fromDestinationId: DEST_A, toDestinationId: DEST_B, miles: 8.1 },
      { fromDestinationId: DEST_B, toDestinationId: HOME, miles: 9.2 },
    ]

    const model = mapTripLegsToFormModel(legs, HOME)

    expect(model.stops.map((stop) => stop.destinationId)).toEqual([DEST_A, DEST_B])
    expect(model.stops.map((stop) => stop.miles)).toEqual(['2.4', '8.1'])
    expect(model.returnMiles).toBe('9.2')
  })

  it('rebuilds payload legs from stops and return miles', () => {
    const stops: TripFormStop[] = [
      { key: 'a', destinationId: DEST_A, miles: '2.4' },
      { key: 'b', destinationId: DEST_B, miles: '8.1' },
    ]

    const result = validateAndBuildTripLegs(HOME, stops, '9.2')

    expect(result.formError).toBeNull()
    expect(result.legs).toEqual([
      { fromDestinationId: HOME, toDestinationId: DEST_A, miles: 2.4 },
      { fromDestinationId: DEST_A, toDestinationId: DEST_B, miles: 8.1 },
      { fromDestinationId: DEST_B, toDestinationId: HOME, miles: 9.2 },
    ])
  })

  it('requires missing uncached miles before save', () => {
    const stops: TripFormStop[] = [{ key: 'a', destinationId: DEST_A, miles: '' }]

    const result = validateAndBuildTripLegs(HOME, stops, '')

    expect(result.formError).toBe('Please complete all stops before saving')
    expect(result.stopErrors.get(0)).toBe('Enter miles')
    expect(result.returnMilesError).toBe('Return miles are required')
  })

  it('rejects same-location legs and more than 1 decimal place', () => {
    const sameLocation = validateAndBuildTripLegs(
      HOME,
      [{ key: 'a', destinationId: HOME, miles: '1.0' }],
      '1.0'
    )
    const tooPrecise = validateAndBuildTripLegs(
      HOME,
      [{ key: 'a', destinationId: DEST_A, miles: '1.25' }],
      '1.0'
    )

    expect(sameLocation.stopErrors.get(0)).toBe('Choose a different destination')
    expect(tooPrecise.stopErrors.get(0)).toBe('Enter miles')
  })
})
