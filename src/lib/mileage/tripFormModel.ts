export interface TripFormStop {
  key: string
  destinationId: string
  miles: string
}

export interface TripFormLeg {
  fromDestinationId: string
  toDestinationId: string
  miles: number
}

export interface TripFormMileageLeg {
  fromDestinationId: string
  toDestinationId: string
  miles: number
}

export interface TripFormModel {
  stops: TripFormStop[]
  returnMiles: string
}

export interface TripFormValidationResult {
  legs: TripFormLeg[]
  stopErrors: Map<number, string>
  returnMilesError: string | null
  formError: string | null
}

export function createEmptyStop(): TripFormStop {
  return { key: crypto.randomUUID(), destinationId: '', miles: '' }
}

export function mileageToInputValue(miles: number): string {
  return Number.isInteger(miles) ? String(miles) : String(miles)
}

export function mapTripLegsToFormModel(
  legs: TripFormMileageLeg[],
  homeBaseId: string
): TripFormModel {
  if (legs.length === 0) {
    return { stops: [createEmptyStop()], returnMiles: '' }
  }

  const returnLeg = legs[legs.length - 1]
  const stops: TripFormStop[] = []

  for (let i = 0; i < legs.length - 1; i++) {
    const leg = legs[i]
    stops.push({
      key: crypto.randomUUID(),
      destinationId: leg.toDestinationId,
      miles: mileageToInputValue(leg.miles),
    })
  }

  if (returnLeg.toDestinationId === homeBaseId && returnLeg.fromDestinationId !== homeBaseId) {
    if (
      stops.length === 0 ||
      stops[stops.length - 1].destinationId !== returnLeg.fromDestinationId
    ) {
      stops.push({
        key: crypto.randomUUID(),
        destinationId: returnLeg.fromDestinationId,
        miles: '',
      })
    }
    return {
      stops: stops.length > 0 ? stops : [createEmptyStop()],
      returnMiles: mileageToInputValue(returnLeg.miles),
    }
  }

  stops.push({
    key: crypto.randomUUID(),
    destinationId: returnLeg.toDestinationId,
    miles: mileageToInputValue(returnLeg.miles),
  })

  return { stops: stops.length > 0 ? stops : [createEmptyStop()], returnMiles: '' }
}

export function validateAndBuildTripLegs(
  homeBaseId: string | undefined,
  stops: TripFormStop[],
  returnMiles: string
): TripFormValidationResult {
  const stopErrors = new Map<number, string>()
  const legs: TripFormLeg[] = []

  if (!homeBaseId) {
    return {
      legs,
      stopErrors,
      returnMilesError: null,
      formError: 'Home base not configured',
    }
  }

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]
    if (!stop.destinationId) {
      stopErrors.set(i, 'Select a destination')
    } else if (stop.destinationId === (i === 0 ? homeBaseId : stops[i - 1]?.destinationId)) {
      stopErrors.set(i, 'Choose a different destination')
    } else if (!isValidMileageInput(stop.miles)) {
      stopErrors.set(i, 'Enter miles')
    }
  }

  const returnMilesError = isValidMileageInput(returnMiles) ? null : 'Return miles are required'

  if (stopErrors.size > 0 || returnMilesError) {
    return {
      legs,
      stopErrors,
      returnMilesError,
      formError:
        stopErrors.size > 0
          ? 'Please complete all stops before saving'
          : returnMilesError,
    }
  }

  legs.push({
    fromDestinationId: homeBaseId,
    toDestinationId: stops[0].destinationId,
    miles: roundMiles(parseFloat(stops[0].miles)),
  })

  for (let i = 1; i < stops.length; i++) {
    legs.push({
      fromDestinationId: stops[i - 1].destinationId,
      toDestinationId: stops[i].destinationId,
      miles: roundMiles(parseFloat(stops[i].miles)),
    })
  }

  legs.push({
    fromDestinationId: stops[stops.length - 1].destinationId,
    toDestinationId: homeBaseId,
    miles: roundMiles(parseFloat(returnMiles)),
  })

  return { legs, stopErrors, returnMilesError: null, formError: null }
}

export function isValidMileageInput(value: string): boolean {
  const miles = parseFloat(value)
  return Number.isFinite(miles) && miles > 0 && hasAtMostOneDecimalPlace(value)
}

export function roundMiles(miles: number): number {
  return Math.round(miles * 10) / 10
}

function hasAtMostOneDecimalPlace(value: string): boolean {
  return /^\d+(\.\d)?$/.test(value.trim())
}
