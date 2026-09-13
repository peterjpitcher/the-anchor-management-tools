'use client'

import { useState, useTransition } from 'react'
import { Alert, Badge, Button, Card, EmptyState, Form, Input, PageLayout, Section } from '@/ds'
import {
  createMaintenanceArea,
  listMaintenanceAreasForAdmin,
  renameMaintenanceArea,
  reorderMaintenanceAreas,
  setMaintenanceAreaActive,
} from '@/app/actions/maintenance-areas'
import { MAINTENANCE_AREA_NAME_MAX_LENGTH } from '@/lib/maintenance/areas'
import type { MaintenanceArea } from '@/types/maintenance'

interface MaintenanceAreasClientProps {
  initialAreas: MaintenanceArea[]
  initialError: string | null
}

/**
 * Area administration. Areas are turned off, never deleted: an area that has ever
 * been used is referenced by items whose history would go with it, and the
 * database refuses the delete anyway. "Turn off" is the whole of removal here,
 * which is why nothing on this page is styled as a destructive action.
 */
export default function MaintenanceAreasClient({
  initialAreas,
  initialError,
}: MaintenanceAreasClientProps) {
  const [areas, setAreas] = useState<MaintenanceArea[]>(initialAreas)
  const [error, setError] = useState<string | null>(initialError)
  const [notice, setNotice] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [isPending, startTransition] = useTransition()

  const activeCount = areas.filter((area) => area.active).length

  function reportFailure(message: string): void {
    setNotice(null)
    setError(message)
  }

  function reportSuccess(message: string): void {
    setError(null)
    setNotice(message)
  }

  /** Pulls the whole list back after a write, so the screen matches the database. */
  async function refresh(): Promise<void> {
    const result = await listMaintenanceAreasForAdmin()
    if (result.error) {
      reportFailure(result.error)
      return
    }
    setAreas(result.data ?? [])
  }

  function handleAdd(event: React.FormEvent): void {
    event.preventDefault()
    const name = newName.trim()
    if (!name) {
      reportFailure('Give the area a name.')
      return
    }

    startTransition(async () => {
      const result = await createMaintenanceArea({ name })
      if (result.error) {
        reportFailure(result.error)
        return
      }
      setNewName('')
      reportSuccess(`Added ${result.data?.name ?? name}.`)
      await refresh()
    })
  }

  function startEditing(area: MaintenanceArea): void {
    setEditingId(area.id)
    setEditingName(area.name)
    setError(null)
    setNotice(null)
  }

  function cancelEditing(): void {
    setEditingId(null)
    setEditingName('')
  }

  function handleRename(area: MaintenanceArea): void {
    const name = editingName.trim()
    if (!name) {
      reportFailure('Give the area a name.')
      return
    }

    startTransition(async () => {
      const result = await renameMaintenanceArea({ id: area.id, name })
      if (result.error) {
        reportFailure(result.error)
        return
      }
      cancelEditing()
      // Items are not snapshotted against a name, so this changes what every
      // existing item in this area displays. Say so rather than let it surprise.
      reportSuccess(`Renamed to ${result.data?.name ?? name}. Existing items now show the new name.`)
      await refresh()
    })
  }

  function handleToggleActive(area: MaintenanceArea): void {
    startTransition(async () => {
      const result = await setMaintenanceAreaActive({ id: area.id, active: !area.active })
      if (result.error) {
        reportFailure(result.error)
        return
      }
      reportSuccess(
        area.active
          ? `${area.name} is off. Existing items keep it and stay filterable by it.`
          : `${area.name} is back on and can be chosen again.`,
      )
      await refresh()
    })
  }

  function handleMove(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= areas.length) return

    const orderedIds = areas.map((area) => area.id)
    const moved = orderedIds[index]
    orderedIds[index] = orderedIds[target]
    orderedIds[target] = moved

    startTransition(async () => {
      const result = await reorderMaintenanceAreas({ orderedIds })
      if (result.error) {
        reportFailure(result.error)
        return
      }
      // Never blank the list on a success that came back without rows: re-read
      // instead, so the screen still matches the database.
      if (result.data) {
        setAreas(result.data)
      } else {
        await refresh()
      }
      reportSuccess('Order saved.')
    })
  }

  return (
    <PageLayout
      title="Maintenance Areas"
      subtitle="The parts of the pub a maintenance item can belong to"
      breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Maintenance Areas' }]}
      backButton={{ label: 'Back to Settings', href: '/settings' }}
    >
      <div className="space-y-6">
        <p className="text-sm text-text-muted">
          Areas are turned off rather than deleted, so nothing already logged loses its place.
          An area that is off stays on existing items and can still be filtered by, but it cannot
          be chosen for anything new. There are {activeCount} areas available to choose from.
        </p>

        {error ? <Alert tone="danger" title="That did not work">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        <Section title="Add an area">
          <Card>
            <Form onSubmit={handleAdd}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Input
                    label="Area name"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    maxLength={MAINTENANCE_AREA_NAME_MAX_LENGTH}
                    placeholder="For example, Function Room"
                    hint="Capitals and extra spaces are ignored when checking for duplicates."
                    disabled={isPending}
                  />
                </div>
                <Button type="submit" disabled={isPending} loading={isPending}>
                  Add area
                </Button>
              </div>
            </Form>
          </Card>
        </Section>

        <Section title="Areas" description="Shown to staff in this order.">
          <Card>
            {areas.length === 0 ? (
              <EmptyState
                title="No areas yet"
                description="Add the first area above before logging any maintenance."
              />
            ) : (
              <ul className="divide-y divide-border">
                {areas.map((area, index) => (
                  <li key={area.id} className="px-4 py-4">
                    {editingId === area.id ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex-1">
                          <Input
                            label={`Rename ${area.name}`}
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            maxLength={MAINTENANCE_AREA_NAME_MAX_LENGTH}
                            autoFocus
                            disabled={isPending}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleRename(area)}
                            disabled={isPending}
                          >
                            Save
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={cancelEditing}
                            disabled={isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-text">{area.name}</p>
                          {/* State in words, not by colour alone. */}
                          <Badge tone={area.active ? 'success' : 'neutral'}>
                            {area.active ? 'Available' : 'Off, existing items only'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleMove(index, -1)}
                            disabled={isPending || index === 0}
                            aria-label={`Move up ${area.name}`}
                          >
                            Move up
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleMove(index, 1)}
                            disabled={isPending || index === areas.length - 1}
                            aria-label={`Move down ${area.name}`}
                          >
                            Move down
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => startEditing(area)}
                            disabled={isPending}
                          >
                            Rename
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleToggleActive(area)}
                            disabled={isPending}
                          >
                            {area.active ? 'Turn off' : 'Turn back on'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
      </div>
    </PageLayout>
  )
}
