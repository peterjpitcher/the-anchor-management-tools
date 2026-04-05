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
  PlusIcon,
  TrashIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline'
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

interface LegInput {
  key: string
  destinationId: string
  miles: string
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

  const homeBase = destinations.find((d) => d.isHomeBase)
  const nonHomeDestinations = destinations.filter((d) => !d.isHomeBase)

  // Form state
  const [tripDate, setTripDate] = useState(getTodayIsoDate())
  const [description, setDescription] = useState('')
  const [stops, setStops] = useState<LegInput[]>([
    { key: crypto.randomUUID(), destinationId: '', miles: '' },
  ])

  // Populate form when editing
  useEffect(() => {
    if (editingTrip) {
      setTripDate(editingTrip.tripDate)
      setDescription(editingTrip.description ?? '')
      // Convert legs to stops (intermediate destinations, excluding home base start/end)
      const intermediateStops: LegInput[] = editingTrip.legs.map((leg) => ({
        key: crypto.randomUUID(),
        destinationId: leg.toDestinationId === homeBase?.id
          ? leg.fromDestinationId  // last leg: use from
          : leg.toDestinationId,
        miles: String(leg.miles),
      }))
      // Remove the last stop if it points to home base (it's the return leg)
      // Actually, each leg has its own miles. We want stops = list of intermediate destinations.
      // Leg pattern: Anchor -> A (legMiles), A -> B (legMiles), B -> Anchor (legMiles)
      // Stops: A (miles from prev), B (miles from A), then return (miles from B to Anchor)
      // For the form, we represent stops as the TO destination of each leg except the last
      // The last leg's TO is always Anchor, so its FROM is the last stop destination.
      if (editingTrip.legs.length > 0) {
        const formStops: LegInput[] = []
        for (let i = 0; i < editingTrip.legs.length; i++) {
          const leg = editingTrip.legs[i]
          if (i < editingTrip.legs.length - 1) {
            // Intermediate stop: the TO of this leg
            formStops.push({
              key: crypto.randomUUID(),
              destinationId: leg.toDestinationId,
              miles: String(leg.miles),
            })
          } else {
            // Last leg: goes back to Anchor. The FROM is the last stop.
            // We represent the return miles on the last stop.
            // Actually, the last stop destination was already added. We need to add
            // the final stop with its return miles.
            formStops.push({
              key: crypto.randomUUID(),
              destinationId: leg.fromDestinationId,
              miles: String(leg.miles),
            })
          }
        }
        setStops(formStops.length > 0 ? formStops : [{ key: crypto.randomUUID(), destinationId: '', miles: '' }])
      }
    } else {
      setTripDate(getTodayIsoDate())
      setDescription('')
      setStops([{ key: crypto.randomUUID(), destinationId: '', miles: '' }])
    }
    setError(null)
  }, [editingTrip, homeBase?.id, open])

  // Fetch cached distance when destination changes
  const fetchCachedDistance = useCallback(
    async (destId: string, prevDestId: string): Promise<number | null> => {
      if (!destId || !prevDestId) return null
      const result = await getDistanceCache(prevDestId, destId)
      return result.data?.miles ?? null
    },
    []
  )

  function handleDestinationChange(index: number, destId: string): void {
    const newStops = [...stops]
    newStops[index] = { ...newStops[index], destinationId: destId }
    setStops(newStops)

    // Prefill miles from cache
    if (destId && homeBase) {
      const prevDestId = index === 0 ? homeBase.id : stops[index - 1]?.destinationId
      if (prevDestId) {
        fetchCachedDistance(destId, prevDestId).then((cachedMiles) => {
          if (cachedMiles != null) {
            setStops((prev) => {
              const updated = [...prev]
              if (updated[index] && updated[index].destinationId === destId && !updated[index].miles) {
                updated[index] = { ...updated[index], miles: String(cachedMiles) }
              }
              return updated
            })
          }
        })
      }
    }
  }

  function handleMilesChange(index: number, miles: string): void {
    const newStops = [...stops]
    newStops[index] = { ...newStops[index], miles }
    setStops(newStops)
  }

  function addStop(): void {
    setStops((prev) => [...prev, { key: crypto.randomUUID(), destinationId: '', miles: '' }])
  }

  function removeStop(index: number): void {
    setStops((prev) => prev.filter((_, i) => i !== index))
  }

  // Build legs from stops for the form model:
  // Stop 0: Anchor -> stops[0].destination, miles = stops[0].miles (outbound)
  // Stop 1: stops[0].destination -> stops[1].destination, miles = stops[1].miles
  // ...
  // Last: stops[n-1].destination -> Anchor, with return miles stored separately
  // Actually the spec says legs include the return, so we need a return miles field.
  // Let's keep it simpler: each "stop" represents going TO that destination,
  // and the miles are the leg miles from the previous point to this stop.
  // The return leg (last stop -> Anchor) needs separate miles.
  const [returnMiles, setReturnMiles] = useState('')

  useEffect(() => {
    if (editingTrip && editingTrip.legs.length > 0) {
      // The last leg's miles are the return miles
      const lastLeg = editingTrip.legs[editingTrip.legs.length - 1]
      setReturnMiles(String(lastLeg.miles))
      // Reconstruct stops more carefully
      const formStops: LegInput[] = []
      for (let i = 0; i < editingTrip.legs.length - 1; i++) {
        const leg = editingTrip.legs[i]
        formStops.push({
          key: crypto.randomUUID(),
          destinationId: leg.toDestinationId,
          miles: String(leg.miles),
        })
      }
      // If only 1 leg total (Anchor -> dest -> Anchor collapsed into single-stop form)
      if (editingTrip.legs.length === 1) {
        // Single leg Anchor -> Anchor shouldn't happen, but handle gracefully
        formStops.push({
          key: crypto.randomUUID(),
          destinationId: editingTrip.legs[0].toDestinationId,
          miles: String(editingTrip.legs[0].miles),
        })
        setReturnMiles('')
      } else {
        // The from_destination of the last leg is the last intermediate stop
        // which should already be the to_destination of the second-to-last leg
      }
      if (formStops.length > 0) {
        setStops(formStops)
      }
    } else if (!editingTrip) {
      setReturnMiles('')
    }
  }, [editingTrip, open])

  // Fetch return miles cache when last stop changes
  useEffect(() => {
    const lastStop = stops[stops.length - 1]
    if (lastStop?.destinationId && homeBase && !returnMiles) {
      fetchCachedDistance(homeBase.id, lastStop.destinationId).then((cached) => {
        if (cached != null) {
          setReturnMiles(String(cached))
        }
      })
    }
  }, [stops, homeBase, returnMiles, fetchCachedDistance])

  // Calculate totals
  const totalMiles =
    stops.reduce((sum, s) => sum + (parseFloat(s.miles) || 0), 0) +
    (parseFloat(returnMiles) || 0)

  const rateSplit = calculateHmrcRateSplit(cumulativeMilesBefore, totalMiles)
  const crossesThreshold =
    rateSplit.milesAtStandardRate > 0 && rateSplit.milesAtReducedRate > 0

  function handleSubmit(): void {
    setError(null)

    if (!homeBase) {
      setError('Home base not configured')
      return
    }

    // Validate stops
    const validStops = stops.filter((s) => s.destinationId && parseFloat(s.miles) > 0)
    if (validStops.length === 0) {
      setError('Add at least one stop with miles')
      return
    }

    const returnMilesNum = parseFloat(returnMiles)
    if (!returnMilesNum || returnMilesNum <= 0) {
      setError('Return miles are required')
      return
    }

    // Build legs
    const legs: Array<{ fromDestinationId: string; toDestinationId: string; miles: number }> = []

    // First leg: Anchor -> first stop
    legs.push({
      fromDestinationId: homeBase.id,
      toDestinationId: validStops[0].destinationId,
      miles: parseFloat(validStops[0].miles),
    })

    // Middle legs
    for (let i = 1; i < validStops.length; i++) {
      legs.push({
        fromDestinationId: validStops[i - 1].destinationId,
        toDestinationId: validStops[i].destinationId,
        miles: parseFloat(validStops[i].miles),
      })
    }

    // Return leg: last stop -> Anchor
    legs.push({
      fromDestinationId: validStops[validStops.length - 1].destinationId,
      toDestinationId: homeBase.id,
      miles: returnMilesNum,
    })

    startTransition(async () => {
      const result = editingTrip
        ? await updateTrip({
            id: editingTrip.id,
            tripDate,
            description: description.trim() || undefined,
            legs,
          })
        : await createTrip({
            tripDate,
            description: description.trim() || undefined,
            legs,
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

        {/* Date & Description */}
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

        {/* Route Builder */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Route</h4>

          {/* Origin: The Anchor (fixed) */}
          <div className="flex items-center gap-2 mb-3 text-sm text-gray-600">
            <span className="inline-flex items-center justify-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Start
            </span>
            <span className="font-medium">{homeBase?.name ?? 'The Anchor'}</span>
          </div>

          {/* Stops */}
          <div className="space-y-3">
            {stops.map((stop, index) => (
              <div key={stop.key} className="flex items-center gap-2">
                <ArrowRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
                <select
                  className="block w-full rounded-md border border-gray-400 px-3 py-2 text-sm shadow-sm focus:border-primary-600 focus:ring-1 focus:ring-primary-600 min-h-[44px] sm:min-h-[40px]"
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
                  aria-label={`Stop ${index + 1} miles`}
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
            ))}
          </div>

          {/* Add stop button */}
          <div className="mt-2">
            <Button variant="ghost" size="xs" leftIcon={<PlusIcon />} onClick={addStop}>
              Add Stop
            </Button>
          </div>

          {/* Return leg */}
          <div className="mt-3 flex items-center gap-2">
            <ArrowRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
            <span className="inline-flex items-center justify-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Return
            </span>
            <span className="text-sm font-medium text-gray-600">{homeBase?.name ?? 'The Anchor'}</span>
            <Input
              wrapperClassName="w-28 shrink-0 ml-auto"
              value={returnMiles}
              onChange={(e) => setReturnMiles(e.target.value)}
              placeholder="Miles"
              type="number"
              min="0.1"
              step="0.1"
              aria-label="Return miles"
            />
          </div>
        </div>

        {/* Totals */}
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
