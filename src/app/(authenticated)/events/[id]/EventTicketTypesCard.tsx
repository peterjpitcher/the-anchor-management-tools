'use client'

import { useState, useTransition } from 'react'
import {
  Card, CardHeader, CardBody,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Badge,
  Button,
  Input,
  EmptyState,
  ConfirmDialog,
  toast,
} from '@/ds'
import type { EventTicketTypeRow } from '@/lib/events/ticket-types'
import {
  createEventTicketType,
  updateEventTicketType,
  deleteEventTicketType,
} from '@/app/actions/eventTicketTypes'

interface EventTicketTypesCardProps {
  eventId: string
  initialTicketTypes: EventTicketTypeRow[]
  canManage: boolean
}

interface DraftRow {
  name: string
  base_price: string
  capacity: string
}

const EMPTY_DRAFT: DraftRow = { name: '', base_price: '', capacity: '' }

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '-'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/**
 * Ticket-types editor for an event. Only rendered when the feature flag is on and
 * the event is not communal/mixed. Wraps the flag-gated, RBAC-checked, audited
 * server actions in `eventTicketTypes.ts`.
 */
export function EventTicketTypesCard({ eventId, initialTicketTypes, canManage }: EventTicketTypesCardProps) {
  const [ticketTypes, setTicketTypes] = useState<EventTicketTypeRow[]>(initialTicketTypes)
  const [isPending, startTransition] = useTransition()

  const [addDraft, setAddDraft] = useState<DraftRow>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<DraftRow>(EMPTY_DRAFT)
  const [removeId, setRemoveId] = useState<string | null>(null)

  const refreshLocal = (next: EventTicketTypeRow[]) => setTicketTypes(next)

  const parseDraft = (draft: DraftRow): { name: string; base_price: number; capacity: number | null } | null => {
    const name = draft.name.trim()
    if (!name) {
      toast.error('Name is required')
      return null
    }
    const basePrice = Number(draft.base_price)
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      toast.error('Enter a valid price')
      return null
    }
    let capacity: number | null = null
    if (draft.capacity.trim() !== '') {
      const parsedCapacity = Number(draft.capacity)
      if (!Number.isInteger(parsedCapacity) || parsedCapacity < 0) {
        toast.error('Capacity must be a whole number (leave blank for a shared pool)')
        return null
      }
      capacity = parsedCapacity
    }
    return { name, base_price: basePrice, capacity }
  }

  const handleAdd = () => {
    const values = parseDraft(addDraft)
    if (!values) return
    startTransition(async () => {
      const nextSort = ticketTypes.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1
      const result = await createEventTicketType(eventId, { ...values, sort_order: nextSort })
      if (result.error || !result.data) {
        toast.error(result.error || 'Failed to add ticket type')
        return
      }
      refreshLocal([...ticketTypes, result.data])
      setAddDraft(EMPTY_DRAFT)
      toast.success('Ticket type added')
    })
  }

  const startEdit = (row: EventTicketTypeRow) => {
    setEditingId(row.id)
    setEditDraft({
      name: row.name,
      base_price: String(Number(row.base_price)),
      capacity: row.capacity === null ? '' : String(row.capacity),
    })
  }

  const handleSaveEdit = (id: string) => {
    const values = parseDraft(editDraft)
    if (!values) return
    startTransition(async () => {
      const result = await updateEventTicketType(id, values)
      if (result.error || !result.data) {
        toast.error(result.error || 'Failed to update ticket type')
        return
      }
      refreshLocal(ticketTypes.map((t) => (t.id === id ? result.data! : t)))
      setEditingId(null)
      toast.success('Ticket type updated')
    })
  }

  const handleToggleActive = (row: EventTicketTypeRow) => {
    startTransition(async () => {
      const result = await updateEventTicketType(row.id, { is_active: !row.is_active })
      if (result.error || !result.data) {
        toast.error(result.error || 'Failed to update ticket type')
        return
      }
      refreshLocal(ticketTypes.map((t) => (t.id === row.id ? result.data! : t)))
      toast.success(row.is_active ? 'Ticket type deactivated' : 'Ticket type activated')
    })
  }

  const handleRemove = (id: string) => {
    startTransition(async () => {
      const result = await deleteEventTicketType(id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      // The action deactivates types that have bookings and hard-deletes the rest.
      // Re-fetch is avoided; conservatively drop the row and rely on the server.
      refreshLocal(ticketTypes.filter((t) => t.id !== id))
      setRemoveId(null)
      toast.success('Ticket type removed')
    })
  }

  return (
    <Card>
      <CardHeader
        title="Ticket types"
        subtitle="Each type has its own name and price. Leave capacity blank to share the event pool."
      />
      <CardBody>
        {ticketTypes.length === 0 ? (
          <EmptyState title="No ticket types" description="Add a ticket type below to get started." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Base price</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ticketTypes.map((row) => {
                    const isEditing = editingId === row.id
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              aria-label="Ticket type name"
                              value={editDraft.name}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                            />
                          ) : (
                            row.name
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              aria-label="Base price"
                              type="number"
                              min="0"
                              step="0.01"
                              value={editDraft.base_price}
                              onChange={(e) => setEditDraft((d) => ({ ...d, base_price: e.target.value }))}
                            />
                          ) : (
                            formatCurrency(Number(row.base_price))
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              aria-label="Capacity (blank = shared)"
                              type="number"
                              min="0"
                              step="1"
                              placeholder="Shared"
                              value={editDraft.capacity}
                              onChange={(e) => setEditDraft((d) => ({ ...d, capacity: e.target.value }))}
                            />
                          ) : row.capacity === null ? (
                            <Badge tone="neutral">Shared</Badge>
                          ) : (
                            row.capacity
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge tone={row.is_active ? 'success' : 'neutral'}>
                            {row.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            {isEditing ? (
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => handleSaveEdit(row.id)}
                                  disabled={isPending}
                                >
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setEditingId(null)}
                                  disabled={isPending}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => startEdit(row)}
                                  disabled={isPending}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleToggleActive(row)}
                                  disabled={isPending}
                                >
                                  {row.is_active ? 'Deactivate' : 'Activate'}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="danger"
                                  onClick={() => setRemoveId(row.id)}
                                  disabled={isPending}
                                >
                                  Remove
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card layout */}
            <div className="block sm:hidden space-y-3">
              {ticketTypes.map((row) => {
                const isEditing = editingId === row.id
                return (
                  <div key={row.id} className="rounded-default border border-border p-4">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div>
                          <label
                            className="mb-1 block text-sm font-medium text-text-strong"
                            htmlFor={`edit-ticket-type-name-${row.id}`}
                          >
                            Name
                          </label>
                          <Input
                            id={`edit-ticket-type-name-${row.id}`}
                            value={editDraft.name}
                            onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1 block text-sm font-medium text-text-strong"
                            htmlFor={`edit-ticket-type-price-${row.id}`}
                          >
                            Base price
                          </label>
                          <Input
                            id={`edit-ticket-type-price-${row.id}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={editDraft.base_price}
                            onChange={(e) => setEditDraft((d) => ({ ...d, base_price: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label
                            className="mb-1 block text-sm font-medium text-text-strong"
                            htmlFor={`edit-ticket-type-capacity-${row.id}`}
                          >
                            Capacity
                          </label>
                          <Input
                            id={`edit-ticket-type-capacity-${row.id}`}
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Shared"
                            value={editDraft.capacity}
                            onChange={(e) => setEditDraft((d) => ({ ...d, capacity: e.target.value }))}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleSaveEdit(row.id)}
                            disabled={isPending}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditingId(null)}
                            disabled={isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium text-text-strong">{row.name}</div>
                          <Badge tone={row.is_active ? 'success' : 'neutral'}>
                            {row.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="mt-2 text-sm text-text-muted">
                          {formatCurrency(Number(row.base_price))}
                        </div>
                        <div className="mt-1 text-sm text-text-muted">
                          Capacity:{' '}
                          {row.capacity === null ? (
                            <Badge tone="neutral">Shared</Badge>
                          ) : (
                            row.capacity
                          )}
                        </div>
                        {canManage && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => startEdit(row)}
                              disabled={isPending}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => handleToggleActive(row)}
                              disabled={isPending}
                            >
                              {row.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() => setRemoveId(row.id)}
                              disabled={isPending}
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {canManage && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="new-ticket-type-name">
                Name
              </label>
              <Input
                id="new-ticket-type-name"
                value={addDraft.name}
                placeholder="e.g. Adult"
                onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="w-full sm:w-32">
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="new-ticket-type-price">
                Base price
              </label>
              <Input
                id="new-ticket-type-price"
                type="number"
                min="0"
                step="0.01"
                value={addDraft.base_price}
                placeholder="0.00"
                onChange={(e) => setAddDraft((d) => ({ ...d, base_price: e.target.value }))}
              />
            </div>
            <div className="w-full sm:w-32">
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="new-ticket-type-capacity">
                Capacity
              </label>
              <Input
                id="new-ticket-type-capacity"
                type="number"
                min="0"
                step="1"
                value={addDraft.capacity}
                placeholder="Shared"
                onChange={(e) => setAddDraft((d) => ({ ...d, capacity: e.target.value }))}
              />
            </div>
            <Button type="button" className="w-full sm:w-auto" onClick={handleAdd} disabled={isPending}>
              Add type
            </Button>
          </div>
        )}
      </CardBody>

      <ConfirmDialog
        open={removeId !== null}
        onClose={() => setRemoveId(null)}
        onConfirm={() => removeId && handleRemove(removeId)}
        title="Remove ticket type"
        message="Types with existing bookings are deactivated (kept for history); unused types are deleted. Continue?"
        confirmLabel="Remove"
        tone="danger"
      />
    </Card>
  )
}
