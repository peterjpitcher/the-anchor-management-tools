'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { Alert, Button, Input, Modal, Select } from '@/ds'
import {
  createTrip,
  updateTrip,
  getDistanceCache,
  getRatePreviewContext,
  type MileageDestination,
  type MileageTrip,
} from '@/app/actions/mileage'
import type { MileageDriver } from '@/app/actions/mileage-drivers'
import {
  calculateHmrcRateSplit,
  getStandardRate,
  REDUCED_RATE,
  THRESHOLD_MILES,
} from '@/lib/mileage/hmrcRates'
import {
  createEmptyStop,
  isRoundTripFromHome,
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
  drivers: MileageDriver[]
  editingTrip?: MileageTrip | null
}

export function TripForm({
  open,
  onClose,
  onSuccess,
  destinations,
  drivers,
  editingTrip,
}: TripFormProps): React.JSX.Element {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [returnMilesError, setReturnMilesError] = useState<string | null>(null)
  const [stopErrors, setStopErrors] = useState<Map<number, string>>(new Map())

  const homeBase = destinations.find((d) => d.isHomeBase)
  const nonHomeDestinations = destinations.filter((d) => !d.isHomeBase)
  // One-way trips (for example a drive up and a drive home on different days) cannot be edited
  // in this round-trip form without doubling their miles, so the form locks them.
  const isLockedShape = Boolean(editingTrip && homeBase && !isRoundTripFromHome(editingTrip.legs, homeBase.id))

  const [tripDate, setTripDate] = useState(getTodayIsoDate())
  const [description, setDescription] = useState('')
  const [stops, setStops] = useState<TripFormStop[]>([createEmptyStop()])
  const [returnMiles, setReturnMiles] = useState('')
  const [previewCumulativeMiles, setPreviewCumulativeMiles] = useState(0)
  const [driverId, setDriverId] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

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
      // Trips from before the driver backfill have no driver, so staff choose one when editing.
      setDriverId(editingTrip.driverId ?? '')
    } else if (!editingTrip) {
      setTripDate(getTodayIsoDate())
      setDescription('')
      setStops([createEmptyStop()])
      setReturnMiles('')
      setDriverId('')
      // A fresh reference per new trip: retrying the same save returns the trip it created.
      setRequestId(crypto.randomUUID())
    }

    setError(null)
    setReturnMilesError(null)
    setStopErrors(new Map())
    setPreviewCumulativeMiles(0)
  }, [editingTrip, homeBase, open])

  useEffect(() => {
    if (!open || !tripDate) return
    let cancelled = false

    getRatePreviewContext({
      tripDate,
      driverId: driverId || null,
      excludeTripId: editingTrip?.id ?? null,
    }).then((result) => {
      if (cancelled || result.error || !result.data) return
      setPreviewCumulativeMiles(result.data.cumulativeMilesBefore)
    })

    return () => {
      cancelled = true
    }
  }, [open, tripDate, driverId, editingTrip?.id])

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

  const standardRate = getStandardRate(tripDate)
  const rateSplit = calculateHmrcRateSplit(previewCumulativeMiles, totalMiles, tripDate)
  const crossesThreshold =
    rateSplit.milesAtStandardRate > 0 && rateSplit.milesAtReducedRate > 0

  function handleSubmit(): void {
    if (isLockedShape) return
    if (!driverId) {
      setError('Choose who drove.')
      return
    }
    if (!description.trim()) {
      setError('Enter the reason for the trip.')
      return
    }

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
            description: description.trim(),
            driverId,
            // Sent exactly as loaded: never parse it into a Date, which drops microseconds.
            expectedUpdatedAt: editingTrip.updatedAt,
            legs: validation.legs,
          })
        : await createTrip({
            tripDate,
            description: description.trim(),
            driverId,
            requestId,
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
      width="lg"
      footer={
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} loading={isPending} disabled={isLockedShape}>
            {editingTrip ? 'Save Changes' : 'Save Trip'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="rounded-md bg-danger-soft p-3 text-sm text-red-700">{error}</div>
        )}

        {isLockedShape && (
          <Alert
            tone="warning"
            title="This trip can't be edited here yet"
            description="It was recorded one way, for example a drive up and a drive home on different days. Saving it in this form would turn it into a round trip, so the form is locked for it."
          />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="trip-date" className="mb-1 block text-sm font-medium text-text">
              Trip date <span aria-hidden="true">*</span>
            </label>
            <Input
              id="trip-date"
              type="date"
              max={getTodayIsoDate()}
              value={tripDate}
              onChange={(e) => setTripDate(e.target.value)}
              disabled={isLockedShape}
            />
          </div>
          <div>
            <label htmlFor="trip-driver" className="mb-1 block text-sm font-medium text-text">
              Who drove <span aria-hidden="true">*</span>
            </label>
            <Select
              id="trip-driver"
              className="w-full"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              placeholder="Choose who drove"
              disabled={isLockedShape}
            >
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="trip-desc" className="mb-1 block text-sm font-medium text-text">
              Reason for trip <span aria-hidden="true">*</span>
            </label>
            <Input
              id="trip-desc"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Collect wholesale order"
              disabled={isLockedShape}
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-text mb-3">Route</h4>

          <div className="flex items-center gap-2 mb-3 text-sm text-text-muted">
            <span className="inline-flex items-center justify-center rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-green-700">
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
                  <div className="mb-1 ml-6 text-xs font-medium text-text-muted">
                    {fromName} {'\u2192'} {toName}
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <Select
                        className="w-full"
                        value={stop.destinationId}
                        onChange={(e) => handleDestinationChange(index, e.target.value)}
                        aria-label={`Stop ${index + 1} destination`}
                        error={stopErrors.has(index)}
                        placeholder="Select destination..."
                      >
                        {nonHomeDestinations.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Input
                      className="w-28 shrink-0"
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
                        size="sm"
                        icon={<TrashIcon className="h-4 w-4 text-red-400" />}
                        aria-label={`Remove stop ${index + 1}`}
                        onClick={() => removeStop(index)}
                      />
                    )}
                  </div>
                  {stop.destinationId && !stop.miles && !stopErrors.has(index) && (
                    <p className="mt-1 ml-6 text-xs text-text-muted">
                      Enter miles once; this route pair will be saved for future trips.
                    </p>
                  )}
                  {stopErrors.has(index) && (
                    <p className="mt-1 ml-6 text-xs text-danger">{stopErrors.get(index)}</p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-2">
            <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={addStop}>
              Add Stop
            </Button>
          </div>

          <div className="mt-3">
            <div className="mb-1 ml-6 text-xs font-medium text-text-muted">
              {getDestinationName(stops[stops.length - 1]?.destinationId) ?? 'Last stop'} {'\u2192'}{' '}
              {homeBase?.name ?? 'The Anchor'}
            </div>
            <div className="flex items-center gap-2">
              <ArrowRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="inline-flex items-center justify-center rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-green-700">
                Return
              </span>
              <span className="text-sm font-medium text-text-muted">{homeBase?.name ?? 'The Anchor'}</span>
              <Input
                className="w-28 shrink-0 ml-auto"
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
              <p className="mt-1 ml-6 text-xs text-text-muted">
                Enter miles once; this route pair will be saved for future trips.
              </p>
            )}
            {returnMilesError && (
              <p className="mt-1 ml-6 text-xs text-danger">{returnMilesError}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-text">Total Miles</span>
            <span className="text-lg font-semibold text-text">
              {totalMiles > 0 ? totalMiles.toFixed(1) : '0.0'}
            </span>
          </div>
          {totalMiles > 0 && (
            <div className="mt-2 space-y-1 text-sm text-text-muted">
              {crossesThreshold ? (
                <>
                  <div>
                    {rateSplit.milesAtStandardRate.toFixed(1)} mi @ {'\u00A3'}{standardRate.toFixed(2)} ={' '}
                    {'\u00A3'}{(rateSplit.milesAtStandardRate * standardRate).toFixed(2)}
                  </div>
                  <div>
                    {rateSplit.milesAtReducedRate.toFixed(1)} mi @ {'\u00A3'}{REDUCED_RATE.toFixed(2)} ={' '}
                    {'\u00A3'}{(rateSplit.milesAtReducedRate * REDUCED_RATE).toFixed(2)}
                  </div>
                  <div className="border-t border-border-strong pt-1 font-medium text-text">
                    Amount Due: {'\u00A3'}{rateSplit.amountDue.toFixed(2)}
                  </div>
                  <div className="text-xs text-warning">
                    This trip crosses the {THRESHOLD_MILES.toLocaleString()}-mile threshold
                  </div>
                </>
              ) : (
                <div>
                  {totalMiles.toFixed(1)} mi @{' '}
                  {'\u00A3'}{rateSplit.milesAtReducedRate > 0 ? REDUCED_RATE.toFixed(2) : standardRate.toFixed(2)}{' '}
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
