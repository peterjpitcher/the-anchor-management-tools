'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  Empty,
  Field,
  Icon,
  IconButton,
  Input,
  Modal,
  PageLayout,
  RowActions,
  Section,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import {
  createDestination,
  updateDestination,
  deleteDestination,
  upsertDistanceCache,
  deleteDistanceCache,
  type MileageDestination,
  type MileageDistance,
} from '@/app/actions/mileage'
import { MILEAGE_DESTINATIONS_LAYOUT } from '../_shared/nav'

interface DestinationsClientProps {
  initialDestinations: MileageDestination[]
  initialDistances: MileageDistance[]
  canManage: boolean
}

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
  const [distanceDeleteTarget, setDistanceDeleteTarget] = useState<{
    fromId: string
    toId: string
    label: string
  } | null>(null)
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

  function applyDistanceDelete(fromId: string, toId: string): void {
    const [canonFrom, canonTo] = canonicalPair(fromId, toId)
    const key = distanceKey(canonFrom, canonTo)
    setDistances((prev) =>
      prev.filter((distance) => distanceKey(distance.fromDestinationId, distance.toDestinationId) !== key)
    )

    if (homeBase && (canonFrom === homeBase.id || canonTo === homeBase.id)) {
      const destinationId = canonFrom === homeBase.id ? canonTo : canonFrom
      setDestinations((prev) =>
        prev.map((destination) =>
          destination.id === destinationId
            ? { ...destination, milesFromAnchor: null }
            : destination
        )
      )
      setAnchorDistanceDrafts((prev) => ({ ...prev, [destinationId]: '' }))
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

  function handleDeleteDistance(): void {
    if (!distanceDeleteTarget) return

    setFormError(null)
    setDistanceError(null)
    startTransition(async () => {
      const result = await deleteDistanceCache({
        fromDestinationId: distanceDeleteTarget.fromId,
        toDestinationId: distanceDeleteTarget.toId,
      })
      if (result.error) {
        setDistanceError(result.error)
        setDistanceDeleteTarget(null)
        return
      }
      applyDistanceDelete(
        result.data?.fromDestinationId ?? distanceDeleteTarget.fromId,
        result.data?.toDestinationId ?? distanceDeleteTarget.toId
      )
      setDistanceDeleteTarget(null)
    })
  }

  function destinationActions(dest: MileageDestination): React.JSX.Element {
    return (
      <RowActions
        actions={[
          {
            key: 'edit',
            label: `Edit ${dest.name}`,
            icon: <Icon name="edit" size={16} />,
            onSelect: () => openEdit(dest),
          },
          {
            key: 'delete',
            label: `Delete ${dest.name}`,
            icon: <Icon name="trash" size={16} />,
            tone: 'danger',
            disabled: dest.tripCount > 0,
            onSelect: () => setDeleteTarget(dest),
          },
        ]}
      />
    )
  }

  /** The miles-from-home editor, the same in the table and on a phone card. */
  function anchorMilesEditor(dest: MileageDestination, home: MileageDestination): React.JSX.Element {
    return (
      <div className="flex items-center justify-end gap-2">
        <Input
          type="number"
          min="0.1"
          step="0.1"
          className="flex-1"
          value={anchorDistanceDrafts[dest.id] ?? ''}
          onChange={(e) =>
            setAnchorDistanceDrafts((prev) => ({
              ...prev,
              [dest.id]: e.target.value,
            }))
          }
          aria-label={`Miles from ${home.name} to ${dest.name}`}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => saveAnchorDistance(dest)}
          loading={anchorSavingId === dest.id && isPending}
        >
          Save
        </Button>
        {dest.milesFromAnchor != null && (
          <IconButton
            size="sm"
            icon={<Icon name="trash" size={16} className="text-danger" />}
            label={`Clear miles from ${home.name} to ${dest.name}`}
            onClick={() =>
              setDistanceDeleteTarget({
                fromId: home.id,
                toId: dest.id,
                label: `${home.name} to ${dest.name}`,
              })
            }
          />
        )}
      </div>
    )
  }

  function deleteDistanceButton(distance: MileageDistance): React.JSX.Element {
    return (
      <IconButton
        size="sm"
        className="shrink-0"
        icon={<Icon name="trash" size={16} className="text-danger" />}
        label={`Delete distance from ${distance.fromDestinationName} to ${distance.toDestinationName}`}
        onClick={() =>
          setDistanceDeleteTarget({
            fromId: distance.fromDestinationId,
            toId: distance.toDestinationId,
            label: `${distance.fromDestinationName} to ${distance.toDestinationName}`,
          })
        }
      />
    )
  }

  return (
    <PageLayout
      {...MILEAGE_DESTINATIONS_LAYOUT}
      headerActions={
        canManage ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Icon name="plus" size={16} />}
            onClick={openCreate}
          >
            New Destination
          </Button>
        ) : undefined
      }
    >
      {/* Error banner */}
      {(formError || distanceError) && !showForm && !deleteTarget && !distanceDeleteTarget && (
        <Alert tone="danger">{formError ?? distanceError}</Alert>
      )}

      {/* Home base */}
      {homeBase && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Icon name="mapPin" size={20} className="text-success" />
            <span className="font-medium text-text-strong">{homeBase.name}</span>
            <Badge tone="success" className="ml-2">
              Home Base
            </Badge>
            {homeBase.postcode && (
              <span className="text-sm text-text-muted">{homeBase.postcode}</span>
            )}
          </CardBody>
        </Card>
      )}

      {/* Destinations */}
      {nonHomeDestinations.length === 0 ? (
        <Card>
          <Empty
            size="sm"
            icon={<Icon name="mapPin" size={48} />}
            title="No destinations yet"
            description={canManage ? 'Use New Destination to save the first one.' : 'Saved places show here.'}
          />
        </Card>
      ) : (
        <>
          {/* Desktop table (hidden on phones, where a card list renders below instead) */}
          <Card padding="none" className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Postcode</TableHead>
                  <TableHead align="right">Miles from Anchor</TableHead>
                  <TableHead align="right">Trips</TableHead>
                  {canManage && <TableHead align="right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonHomeDestinations.map((dest) => (
                  <TableRow key={dest.id}>
                    <TableCell className="font-medium">{dest.name}</TableCell>
                    <TableCell className="text-text-muted">{dest.postcode ?? '-'}</TableCell>
                    <TableCell align="right" className="text-text-muted">
                      {canManage && homeBase
                        ? anchorMilesEditor(dest, homeBase)
                        : dest.milesFromAnchor != null
                          ? `${dest.milesFromAnchor} mi`
                          : '-'}
                    </TableCell>
                    <TableCell align="right" className="text-text-muted">{dest.tripCount}</TableCell>
                    {canManage && (
                      <TableCell align="right">{destinationActions(dest)}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Phone card list */}
          <div className="space-y-3 md:hidden">
            {nonHomeDestinations.map((dest) => (
              <Card key={dest.id}>
                <CardBody className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text">{dest.name}</p>
                      <p className="mt-0.5 text-xs text-text-muted">{dest.postcode ?? '-'}</p>
                    </div>
                    {canManage && destinationActions(dest)}
                  </div>

                  <div className="text-sm">
                    <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Trips</p>
                    <p className="mt-0.5 text-text">{dest.tripCount}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Miles from Anchor</p>
                    {canManage && homeBase ? (
                      <div className="mt-1">{anchorMilesEditor(dest, homeBase)}</div>
                    ) : (
                      <p className="mt-0.5 text-sm text-text">
                        {dest.milesFromAnchor != null ? `${dest.milesFromAnchor} mi` : '-'}
                      </p>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}

      <Section
        title="Location-to-Location Distances"
        icon={<Icon name="arrowLeftRight" size={20} />}
      >
        <div className="space-y-4">
          {canManage && nonHomeDestinations.length >= 2 && (
            <Card>
              <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-end">
                <Select
                  id="route-distance-from"
                  label="From"
                  value={routeFromId}
                  onChange={(e) => {
                    setRouteFromId(e.target.value)
                    if (routeToId === e.target.value) setRouteToId('')
                  }}
                  placeholder="Select location..."
                >
                  {nonHomeDestinations.map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.name}
                    </option>
                  ))}
                </Select>

                <Select
                  id="route-distance-to"
                  label="To"
                  value={routeToId}
                  onChange={(e) => setRouteToId(e.target.value)}
                  placeholder="Select location..."
                >
                  {nonHomeDestinations.map((destination) => (
                    <option
                      key={destination.id}
                      value={destination.id}
                      disabled={destination.id === routeFromId}
                    >
                      {destination.name}
                    </option>
                  ))}
                </Select>

                <Input
                  id="route-distance-miles"
                  label="Miles"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={routeMiles}
                  onChange={(e) => setRouteMiles(e.target.value)}
                />

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={saveRouteDistance}
                  loading={routeSaving && isPending}
                >
                  Save Distance
                </Button>
              </CardBody>
            </Card>
          )}

          {locationDistances.length === 0 ? (
            <Card>
              <Empty size="sm" title="No distances yet" description="Saved distances between two places show here." />
            </Card>
          ) : (
            <>
              {/* Desktop table (hidden on phones, where a card list renders below instead) */}
              <Card padding="none" className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead align="right">Miles</TableHead>
                      {canManage && <TableHead align="right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locationDistances.map((distance) => (
                      <TableRow key={distanceKey(distance.fromDestinationId, distance.toDestinationId)}>
                        <TableCell className="font-medium">{distance.fromDestinationName}</TableCell>
                        <TableCell className="text-text-muted">{distance.toDestinationName}</TableCell>
                        <TableCell align="right" className="text-text-muted">{distance.miles} mi</TableCell>
                        {canManage && (
                          <TableCell align="right">{deleteDistanceButton(distance)}</TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              {/* Phone card list */}
              <div className="space-y-3 md:hidden">
                {locationDistances.map((distance) => (
                  <Card key={distanceKey(distance.fromDestinationId, distance.toDestinationId)}>
                    <CardBody className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text">
                          {distance.fromDestinationName}{' '}
                          <span className="text-text-soft" aria-hidden="true">→</span>{' '}
                          {distance.toDestinationName}
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted">{distance.miles} mi</p>
                      </div>
                      {canManage && deleteDistanceButton(distance)}
                    </CardBody>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </Section>

      {/* Create/Edit Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingDest ? 'Edit Destination' : 'New Destination'}
        width="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowForm(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={isPending}
            >
              {editingDest ? 'Save Changes' : 'Create Destination'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field
            label="Name"
            required
            hint={
              editingDest
                ? 'If this place has moved, add it as a new destination instead, so earlier trips keep the address they used.'
                : undefined
            }
          >
            <Input
              id="dest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Costco"
              maxLength={200}
              autoFocus
            />
          </Field>
          <Input
            id="dest-postcode"
            label="Postcode"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            placeholder="e.g. TW16 5LN"
            maxLength={10}
          />
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Destination"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
      />

      <ConfirmDialog
        open={!!distanceDeleteTarget}
        onClose={() => setDistanceDeleteTarget(null)}
        onConfirm={handleDeleteDistance}
        title="Delete Distance"
        message={`Delete the saved distance for ${distanceDeleteTarget?.label}? Future trips will need miles entered again.`}
        confirmLabel="Delete"
        tone="danger"
      />
    </PageLayout>
  )
}
