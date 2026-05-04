'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import {
  createTrip,
  updateTrip,
  getDistanceCache,
  type MileageDestination,
  type MileageTrip,
} from '@/app/actions/mileage'
import {
  calculateHmrcRateSplit,
  STANDARD_RATE,
  REDUCED_RATE,
  THRESHOLD_MILES,
} from '@/lib/mileage/hmrcRates'
import {
  createEmptyStop,
  mapTripLegsToFormModel,
  validateAndBuildTripLegs,
  type TripFormStop,
} from '@/lib/mileage/tripFormModel'
import { PlusIcon, TrashIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { getTodayIsoDate } from '@/lib/dateUtils'

interface TripFormProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  destinations: MileageDestination[]
  /** Current tax year cumulative miles (excluding the editing trip) */
  cumulativeMilesBefore: number
  editingTrip?: MileageTrip | null
}

export function TripForm({
  open,
  onClose,
  onSuccess,
  destinations,
  cumulativeMilesBefore,
  editingTrip,
}: TripFormProps): React.JSX.Element {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [returnMilesError, setReturnMilesError] = useState<string | null>(null)
  const [stopErrors, setStopErrors] = useState<Map<number, string>>(new Map())

  const homeBase = destinations.find((d) => d.isHomeBase)
  const nonHomeDestinations = destinations.filter((d) => !d.isHomeBase)

  const [tripDate, setTripDate] = useState(getTodayIsoDate())
  const [description, setDescription] = useState('')
  const [stops, setStops] = useState<TripFormStop[]>([createEmptyStop()])
  const [returnMiles, setReturnMiles] = useState('')

  const getDestinationName = useCallback(
    (id: string | undefined): string | null => {
      if (!id) return null
      return destinations.find((d) => d.id === id)?.name ?? null
    },
    [destinations]
  )

  const fetchCachedDistance = useCallback(
    async (fromDestId: string, toDestId: string): Promise<number | null> => {
      if (!fromDestId || !toDestId || fromDestId === toDestId) return null
      const result = await getDistanceCache(fromDestId, toDestId)
      return result.data?.miles ?? null
    },
    []
  )

  useEffect(() => {
    if (editingTrip && homeBase) {
      const model = mapTripLegsToFormModel(editingTrip.legs, homeBase.id)
      setTripDate(editingTrip.tripDate)
      setDescription(editingTrip.description ?? '')
      setStops(model.stops)
      setReturnMiles(model.returnMiles)
    } else if (!editingTrip) {
      setTripDate(getTodayIsoDate())
      setDescription('')
      setStops([createEmptyStop()])
      setReturnMiles('')
    }

    setError(null)
    setReturnMilesError(null)
    setStopErrors(new Map())
  }, [editingTrip, homeBase, open])

  function fillStopMilesFromCache(index: number, destId: string, prevDestId: string): void {
    fetchCachedDistance(prevDestId, destId).then((cachedMiles) => {
      if (cachedMiles == null) return
      setStops((prev) => {
        const updated = [...prev]
        if (updated[index]?.destinationId === destId && !updated[index].miles) {
          updated[index] = { ...updated[index], miles: String(cachedMiles) }
        }
        return updated
      })
    })
  }

  function fillReturnMilesFromCache(destId: string): void {
    if (!homeBase) return
    fetchCachedDistance(destId, homeBase.id).then((cachedMiles) => {
      if (cachedMiles != null) {
        setReturnMiles((prev) => (prev === '' ? String(cachedMiles) : prev))
      }
    })
  }

  function handleDestinationChange(index: number, destId: string): void {
    const prevDestId = index === 0 ? homeBase?.id : stops[index - 1]?.destinationId
    const nextDestId = stops[index + 1]?.destinationId
    const isLastStop = index === stops.length - 1

    setStops((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], destinationId: destId, miles: '' }
      if (updated[index + 1]) {
        updated[index + 1] = { ...updated[index + 1], miles: '' }
      }
      return updated
    })
    setStopErrors((prev) => {
      const updated = new Map(prev)
      updated.delete(index)
      if (index + 1 < stops.length) updated.delete(index + 1)
      return updated
    })

    if (isLastStop) {
      setReturnMiles('')
      setReturnMilesError(null)
    }

    if (!destId || !prevDestId) return

    fillStopMilesFromCache(index, destId, prevDestId)

    if (nextDestId) {
      fillStopMilesFromCache(index + 1, nextDestId, destId)
    } else if (isLastStop) {
      fillReturnMilesFromCache(destId)
    }
  }

  function handleMilesChange(index: number, miles: string): void {
    setStops((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], miles }
      return updated
    })
    setStopErrors((prev) => {
      const updated = new Map(prev)
      updated.delete(index)
      return updated
    })
  }

  function addStop(): void {
    setStops((prev) => [...prev, createEmptyStop()])
    setReturnMiles('')
    setReturnMilesError(null)
  }

  function removeStop(index: number): void {
    const prevDestId = index === 0 ? homeBase?.id : stops[index - 1]?.destinationId
    const nextStop = stops[index + 1]
    const wasLastStop = index === stops.length - 1
    const newLastDestId = wasLastStop ? stops[index - 1]?.destinationId : undefined

    setStops((prev) => {
      const updated = prev.filter((_, i) => i !== index)
      if (updated[index]) {
        updated[index] = { ...updated[index], miles: '' }
      }
      return updated.length > 0 ? updated : [createEmptyStop()]
    })
    setStopErrors(new Map())

    if (wasLastStop) {
      setReturnMiles('')
      setReturnMilesError(null)
    }

    if (prevDestId && nextStop?.destinationId) {
      fillStopMilesFromCache(index, nextStop.destinationId, prevDestId)
    }
    if (wasLastStop && newLastDestId) {
      fillReturnMilesFromCache(newLastDestId)
    }
  }

  useEffect(() => {
    if (!homeBase || returnMiles) return
    const lastStop = stops[stops.length - 1]
    if (lastStop?.destinationId) {
      fillReturnMilesFromCache(lastStop.destinationId)
    }
  }, [stops, homeBase, returnMiles])

  const totalMiles =
    stops.reduce((sum, s) => sum + (parseFloat(s.miles) || 0), 0) +
    (parseFloat(returnMiles) || 0)

  const rateSplit = calculateHmrcRateSplit(cumulativeMilesBefore, totalMiles)
  const crossesThreshold =
    rateSplit.milesAtStandardRate > 0 && rateSplit.milesAtReducedRate > 0

  function handleSubmit(): void {
    const validation = validateAndBuildTripLegs(homeBase?.id, stops, returnMiles)
    setError(validation.formError)
    setStopErrors(validation.stopErrors)
    setReturnMilesError(validation.returnMilesError)

    if (validation.formError) return

    startTransition(async () => {
      const result = editingTrip
        ? await updateTrip({
            id: editingTrip.id,
            tripDate,
            description: description.trim() || undefined,
            legs: validation.legs,
          })
        : await createTrip({
            tripDate,
            description: description.trim() || undefined,
            legs: validation.legs,
          })

      if (result.error) {
        setError(result.error)
        return
      }

      onSuccess()
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingTrip ? 'Edit Trip' : 'New Trip'}
      size="lg"
      footer={
        <ModalActions>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={isPending}>
            {editingTrip ? 'Save Changes' : 'Save Trip'}
          </Button>
        </ModalActions>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="trip-date" className="block text-sm font-medium text-gray-700 mb-1">
              Trip Date <span className="text-red-500">*</span>
            </label>
            <Input
              id="trip-date"
              type="date"
              value={tripDate}
              onChange={(e) => setTripDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="trip-desc" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <Input
              id="trip-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Supply run"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Route</h4>

          <div className="flex items-center gap-2 mb-3 text-sm text-gray-600">
            <span className="inline-flex items-center justify-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Start
            </span>
            <span className="font-medium">{homeBase?.name ?? 'The Anchor'}</span>
          </div>

          <div className="space-y-3">
            {stops.map((stop, index) => {
              const fromName =
                index === 0
                  ? homeBase?.name ?? 'The Anchor'
                  : getDestinationName(stops[index - 1]?.destinationId) ?? 'Previous stop'
              const toName = getDestinationName(stop.destinationId) ?? `Stop ${index + 1}`
              return (
                <div key={stop.key}>
                  <div className="mb-1 ml-6 text-xs font-medium text-gray-500">
                    {fromName} {'\u2192'} {toName}
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
                    <select
                      className={`block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:border-primary-600 focus:ring-1 focus:ring-primary-600 min-h-[44px] sm:min-h-[40px] ${stopErrors.has(index) ? 'border-red-400' : 'border-gray-400'}`}
                      value={stop.destinationId}
                      onChange={(e) => handleDestinationChange(index, e.target.value)}
                      aria-label={`Stop ${index + 1} destination`}
                    >
                      <option value="">Select destination...</option>
                      {nonHomeDestinations.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      wrapperClassName="w-28 shrink-0"
                      value={stop.miles}
                      onChange={(e) => handleMilesChange(index, e.target.value)}
                      placeholder="Miles"
                      type="number"
                      min="0.1"
                      step="0.1"
                      aria-label={`Miles from ${fromName} to ${toName}`}
                    />
                    {stops.length > 1 && (
                      <Button
                        variant="ghost"
                        size="xs"
                        iconOnly
                        aria-label={`Remove stop ${index + 1}`}
                        onClick={() => removeStop(index)}
                      >
                        <TrashIcon className="h-4 w-4 text-red-400" />
                      </Button>
                    )}
                  </div>
                  {stop.destinationId && !stop.miles && !stopErrors.has(index) && (
                    <p className="mt-1 ml-6 text-xs text-gray-500">
                      Enter miles once; this route pair will be saved for future trips.
                    </p>
                  )}
                  {stopErrors.has(index) && (
                    <p className="mt-1 ml-6 text-xs text-red-600">{stopErrors.get(index)}</p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-2">
            <Button variant="ghost" size="xs" leftIcon={<PlusIcon />} onClick={addStop}>
              Add Stop
            </Button>
          </div>

          <div className="mt-3">
            <div className="mb-1 ml-6 text-xs font-medium text-gray-500">
              {getDestinationName(stops[stops.length - 1]?.destinationId) ?? 'Last stop'} {'\u2192'}{' '}
              {homeBase?.name ?? 'The Anchor'}
            </div>
            <div className="flex items-center gap-2">
              <ArrowRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="inline-flex items-center justify-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Return
              </span>
              <span className="text-sm font-medium text-gray-600">{homeBase?.name ?? 'The Anchor'}</span>
              <Input
                wrapperClassName="w-28 shrink-0 ml-auto"
                value={returnMiles}
                onChange={(e) => {
                  setReturnMiles(e.target.value)
                  setReturnMilesError(null)
                }}
                placeholder="Miles"
                type="number"
                min="0.1"
                step="0.1"
                aria-label="Return miles"
              />
            </div>
            {stops[stops.length - 1]?.destinationId && !returnMiles && !returnMilesError && (
              <p className="mt-1 ml-6 text-xs text-gray-500">
                Enter miles once; this route pair will be saved for future trips.
              </p>
            )}
            {returnMilesError && (
              <p className="mt-1 ml-6 text-xs text-red-600">{returnMilesError}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Total Miles</span>
            <span className="text-lg font-semibold text-gray-900">
              {totalMiles > 0 ? totalMiles.toFixed(1) : '0.0'}
            </span>
          </div>
          {totalMiles > 0 && (
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              {crossesThreshold ? (
                <>
                  <div>
                    {rateSplit.milesAtStandardRate.toFixed(1)} mi @ {'\u00A3'}{STANDARD_RATE.toFixed(2)} ={' '}
                    {'\u00A3'}{(rateSplit.milesAtStandardRate * STANDARD_RATE).toFixed(2)}
                  </div>
                  <div>
                    {rateSplit.milesAtReducedRate.toFixed(1)} mi @ {'\u00A3'}{REDUCED_RATE.toFixed(2)} ={' '}
                    {'\u00A3'}{(rateSplit.milesAtReducedRate * REDUCED_RATE).toFixed(2)}
                  </div>
                  <div className="border-t border-gray-300 pt-1 font-medium text-gray-900">
                    Amount Due: {'\u00A3'}{rateSplit.amountDue.toFixed(2)}
                  </div>
                  <div className="text-xs text-amber-600">
                    This trip crosses the {THRESHOLD_MILES.toLocaleString()}-mile threshold
                  </div>
                </>
              ) : (
                <div>
                  {totalMiles.toFixed(1)} mi @{' '}
                  {'\u00A3'}{rateSplit.milesAtReducedRate > 0 ? REDUCED_RATE.toFixed(2) : STANDARD_RATE.toFixed(2)}{' '}
                  = {'\u00A3'}{rateSplit.amountDue.toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
