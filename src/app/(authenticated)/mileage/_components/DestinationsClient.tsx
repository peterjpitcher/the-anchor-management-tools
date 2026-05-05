'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Modal, ModalActions, ConfirmModal } from '@/components/ui-v2/overlay/Modal'
import {
  createDestination,
  updateDestination,
  deleteDestination,
  upsertDistanceCache,
  type MileageDestination,
  type MileageDistance,
} from '@/app/actions/mileage'
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  MapPinIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline'

interface DestinationsClientProps {
  initialDestinations: MileageDestination[]
  initialDistances: MileageDistance[]
  canManage: boolean
}

const selectClassName =
  'block w-full rounded-md border border-gray-400 px-3 py-2 text-sm shadow-sm focus:border-primary-600 focus:ring-1 focus:ring-primary-600 min-h-[44px] sm:min-h-[36px]'

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function distanceKey(a: string, b: string): string {
  return canonicalPair(a, b).join(':')
}

function parseMileageInput(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d)?$/.test(trimmed)) return null
  const miles = Number(trimmed)
  if (!Number.isFinite(miles) || miles <= 0) return null
  return Math.round(miles * 10) / 10
}

export function DestinationsClient({
  initialDestinations,
  initialDistances,
  canManage,
}: DestinationsClientProps): React.JSX.Element {
  const [destinations, setDestinations] = useState(initialDestinations)
  const [distances, setDistances] = useState(initialDistances)
  const [isPending, startTransition] = useTransition()

  // Modal state
  const [showForm, setShowForm] = useState(false)
  const [editingDest, setEditingDest] = useState<MileageDestination | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MileageDestination | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Form fields
  const [name, setName] = useState('')
  const [postcode, setPostcode] = useState('')
  const [anchorDistanceDrafts, setAnchorDistanceDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialDestinations
        .filter((d) => !d.isHomeBase)
        .map((d) => [d.id, d.milesFromAnchor != null ? String(d.milesFromAnchor) : ''])
    )
  )
  const [anchorSavingId, setAnchorSavingId] = useState<string | null>(null)
  const [routeFromId, setRouteFromId] = useState('')
  const [routeToId, setRouteToId] = useState('')
  const [routeMiles, setRouteMiles] = useState('')
  const [routeSaving, setRouteSaving] = useState(false)
  const [distanceError, setDistanceError] = useState<string | null>(null)

  const nonHomeDestinations = destinations.filter((d) => !d.isHomeBase)
  const homeBase = destinations.find((d) => d.isHomeBase)
  const locationDistances = distances
    .filter(
      (distance) =>
        homeBase &&
        distance.fromDestinationId !== homeBase.id &&
        distance.toDestinationId !== homeBase.id
    )
    .sort((a, b) =>
      `${a.fromDestinationName} ${a.toDestinationName}`.localeCompare(
        `${b.fromDestinationName} ${b.toDestinationName}`
      )
    )

  function getDestinationName(id: string): string {
    return destinations.find((d) => d.id === id)?.name ?? 'Unknown destination'
  }

  function findDistance(fromId: string, toId: string): MileageDistance | null {
    const key = distanceKey(fromId, toId)
    return (
      distances.find(
        (distance) => distanceKey(distance.fromDestinationId, distance.toDestinationId) === key
      ) ?? null
    )
  }

  function applyDistanceUpdate(fromId: string, toId: string, miles: number): void {
    const [canonFrom, canonTo] = canonicalPair(fromId, toId)
    const key = distanceKey(canonFrom, canonTo)
    const updatedDistance: MileageDistance = {
      fromDestinationId: canonFrom,
      fromDestinationName: getDestinationName(canonFrom),
      toDestinationId: canonTo,
      toDestinationName: getDestinationName(canonTo),
      miles,
      lastUsedAt: new Date().toISOString(),
    }

    setDistances((prev) => {
      const existingIndex = prev.findIndex(
        (distance) => distanceKey(distance.fromDestinationId, distance.toDestinationId) === key
      )
      if (existingIndex === -1) {
        return [updatedDistance, ...prev]
      }
      const updated = [...prev]
      updated[existingIndex] = updatedDistance
      return updated
    })

    if (homeBase && (canonFrom === homeBase.id || canonTo === homeBase.id)) {
      const destinationId = canonFrom === homeBase.id ? canonTo : canonFrom
      setDestinations((prev) =>
        prev.map((destination) =>
          destination.id === destinationId
            ? { ...destination, milesFromAnchor: miles }
            : destination
        )
      )
      setAnchorDistanceDrafts((prev) => ({ ...prev, [destinationId]: String(miles) }))
    }
  }

  useEffect(() => {
    if (!routeFromId || !routeToId || routeFromId === routeToId) {
      setRouteMiles('')
      return
    }
    const existingDistance = findDistance(routeFromId, routeToId)
    setRouteMiles(existingDistance ? String(existingDistance.miles) : '')
  }, [routeFromId, routeToId, distances])

  function openCreate(): void {
    setEditingDest(null)
    setName('')
    setPostcode('')
    setFormError(null)
    setDistanceError(null)
    setShowForm(true)
  }

  function openEdit(dest: MileageDestination): void {
    setEditingDest(dest)
    setName(dest.name)
    setPostcode(dest.postcode ?? '')
    setFormError(null)
    setDistanceError(null)
    setShowForm(true)
  }

  function handleSubmit(): void {
    if (!name.trim()) {
      setFormError('Name is required')
      return
    }

    startTransition(async () => {
      if (editingDest) {
        const result = await updateDestination({
          id: editingDest.id,
          name: name.trim(),
          postcode: postcode.trim() || undefined,
        })
        if (result.error) {
          setFormError(result.error)
          return
        }
        // Update local state
        setDestinations((prev) =>
          prev.map((d) =>
            d.id === editingDest.id
              ? { ...d, name: name.trim(), postcode: postcode.trim() || null }
              : d
          )
        )
      } else {
        const result = await createDestination({
          name: name.trim(),
          postcode: postcode.trim() || undefined,
        })
        if (result.error) {
          setFormError(result.error)
          return
        }
        if (result.data) {
          setDestinations((prev) => [
            ...prev,
            {
              id: result.data!.id,
              name: name.trim(),
              postcode: postcode.trim() || null,
              isHomeBase: false,
              tripCount: 0,
              milesFromAnchor: null,
            },
          ].sort((a, b) => a.name.localeCompare(b.name)))
          setAnchorDistanceDrafts((prev) => ({ ...prev, [result.data!.id]: '' }))
        }
      }
      setShowForm(false)
    })
  }

  function handleDelete(): void {
    if (!deleteTarget) return
    startTransition(async () => {
      const result = await deleteDestination(deleteTarget.id)
      if (result.error) {
        setFormError(result.error)
        setDeleteTarget(null)
        return
      }
      setDestinations((prev) => prev.filter((d) => d.id !== deleteTarget.id))
      setDeleteTarget(null)
    })
  }

  function saveAnchorDistance(destination: MileageDestination): void {
    if (!homeBase) {
      setDistanceError('Home base destination not found')
      return
    }
    const miles = parseMileageInput(anchorDistanceDrafts[destination.id] ?? '')
    if (miles == null) {
      setDistanceError('Enter miles rounded to 1 decimal place')
      return
    }

    setFormError(null)
    setDistanceError(null)
    setAnchorSavingId(destination.id)
    startTransition(async () => {
      const result = await upsertDistanceCache({
        fromDestinationId: homeBase.id,
        toDestinationId: destination.id,
        miles,
      })
      setAnchorSavingId(null)
      if (result.error) {
        setDistanceError(result.error)
        return
      }
      applyDistanceUpdate(
        result.data?.fromDestinationId ?? homeBase.id,
        result.data?.toDestinationId ?? destination.id,
        result.data?.miles ?? miles
      )
    })
  }

  function saveRouteDistance(): void {
    if (!routeFromId || !routeToId) {
      setDistanceError('Choose two destinations')
      return
    }
    if (routeFromId === routeToId) {
      setDistanceError('Choose two different destinations')
      return
    }
    const miles = parseMileageInput(routeMiles)
    if (miles == null) {
      setDistanceError('Enter miles rounded to 1 decimal place')
      return
    }

    setFormError(null)
    setDistanceError(null)
    setRouteSaving(true)
    startTransition(async () => {
      const result = await upsertDistanceCache({
        fromDestinationId: routeFromId,
        toDestinationId: routeToId,
        miles,
      })
      setRouteSaving(false)
      if (result.error) {
        setDistanceError(result.error)
        return
      }
      applyDistanceUpdate(
        result.data?.fromDestinationId ?? routeFromId,
        result.data?.toDestinationId ?? routeToId,
        result.data?.miles ?? miles
      )
    })
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      {canManage && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlusIcon />}
            onClick={openCreate}
          >
            Add Destination
          </Button>
        </div>
      )}

      {/* Error banner */}
      {(formError || distanceError) && !showForm && !deleteTarget && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {formError ?? distanceError}
        </div>
      )}

      {/* Home base card */}
      {homeBase && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2">
            <MapPinIcon className="h-5 w-5 text-green-600" />
            <span className="font-medium text-green-800">{homeBase.name}</span>
            <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Home Base
            </span>
            {homeBase.postcode && (
              <span className="text-sm text-green-600">{homeBase.postcode}</span>
            )}
          </div>
        </div>
      )}

      {/* Destinations table */}
      {nonHomeDestinations.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <MapPinIcon className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            No destinations saved yet. Add your first destination above.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Postcode
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Miles from Anchor
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Trip Legs
                </th>
                {canManage && (
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {nonHomeDestinations.map((dest) => (
                <tr key={dest.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {dest.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {dest.postcode ?? '\u2014'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                    {canManage && homeBase ? (
                      <div className="flex items-center justify-end gap-2">
                        <Input
                          type="number"
                          min="0.1"
                          step="0.1"
                          inputSize="sm"
                          wrapperClassName="w-24"
                          value={anchorDistanceDrafts[dest.id] ?? ''}
                          onChange={(e) =>
                            setAnchorDistanceDrafts((prev) => ({
                              ...prev,
                              [dest.id]: e.target.value,
                            }))
                          }
                          aria-label={`Miles from ${homeBase.name} to ${dest.name}`}
                        />
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => saveAnchorDistance(dest)}
                          loading={anchorSavingId === dest.id && isPending}
                        >
                          Save
                        </Button>
                      </div>
                    ) : dest.milesFromAnchor != null ? (
                      `${dest.milesFromAnchor} mi`
                    ) : (
                      '\u2014'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                    {dest.tripCount}
                  </td>
                  {canManage && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          aria-label={`Edit ${dest.name}`}
                          onClick={() => openEdit(dest)}
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          aria-label={`Delete ${dest.name}`}
                          disabled={dest.tripCount > 0}
                          onClick={() => setDeleteTarget(dest)}
                        >
                          <TrashIcon className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ArrowsRightLeftIcon className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Location-to-location distances</h2>
        </div>

        {canManage && nonHomeDestinations.length >= 2 && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-end">
            <div>
              <label htmlFor="route-distance-from" className="mb-1 block text-xs font-medium text-gray-500">
                From
              </label>
              <select
                id="route-distance-from"
                className={selectClassName}
                value={routeFromId}
                onChange={(e) => {
                  setRouteFromId(e.target.value)
                  if (routeToId === e.target.value) setRouteToId('')
                }}
              >
                <option value="">Select location...</option>
                {nonHomeDestinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="route-distance-to" className="mb-1 block text-xs font-medium text-gray-500">
                To
              </label>
              <select
                id="route-distance-to"
                className={selectClassName}
                value={routeToId}
                onChange={(e) => setRouteToId(e.target.value)}
              >
                <option value="">Select location...</option>
                {nonHomeDestinations.map((destination) => (
                  <option
                    key={destination.id}
                    value={destination.id}
                    disabled={destination.id === routeFromId}
                  >
                    {destination.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="route-distance-miles" className="mb-1 block text-xs font-medium text-gray-500">
                Miles
              </label>
              <Input
                id="route-distance-miles"
                type="number"
                min="0.1"
                step="0.1"
                inputSize="sm"
                value={routeMiles}
                onChange={(e) => setRouteMiles(e.target.value)}
              />
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={saveRouteDistance}
              loading={routeSaving && isPending}
            >
              Save
            </Button>
          </div>
        )}

        {locationDistances.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
            <p className="text-sm text-gray-500">No location-to-location distances saved yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    From
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    To
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Miles
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {locationDistances.map((distance) => (
                  <tr
                    key={distanceKey(distance.fromDestinationId, distance.toDestinationId)}
                    className="hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      {distance.fromDestinationName}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {distance.toDestinationName}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                      {distance.miles} mi
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingDest ? 'Edit Destination' : 'Add Destination'}
        size="sm"
        footer={
          <ModalActions>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowForm(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              loading={isPending}
            >
              {editingDest ? 'Save Changes' : 'Add Destination'}
            </Button>
          </ModalActions>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {formError}
            </div>
          )}
          <div>
            <label htmlFor="dest-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              id="dest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Costco"
              maxLength={200}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="dest-postcode" className="block text-sm font-medium text-gray-700 mb-1">
              Postcode
            </label>
            <Input
              id="dest-postcode"
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              placeholder="e.g. TW16 5LN"
              maxLength={10}
            />
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Destination"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={isPending}
      />
    </div>
  )
}
