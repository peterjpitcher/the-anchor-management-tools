'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Card, CardHeader, CardBody, Badge, Button, Input, Checkbox, Empty, ConfirmDialog, Fieldset, FormFooter, Stat, SubHeading, toast } from '@/ds'
import { eventTicketTypeSaleTone } from '../_shared/status-ui'
import { resolveTicketTypeSellPrice, type EventTicketTypeRow } from '@/lib/events/ticket-types'
import { createEventTicketType, updateEventTicketType, deleteEventTicketType } from '@/app/actions/eventTicketTypes'
import type { TicketSettingsEvent } from './EventTicketSettings'

interface Props {
  eventId: string
  initialTicketTypes: EventTicketTypeRow[]
  canManage: boolean
  allowMultiple?: boolean
  event?: TicketSettingsEvent
}
interface DraftRow { name: string; base_price: string; capacity: string; free: boolean }
const EMPTY: DraftRow = { name: '', base_price: '', capacity: '', free: false }
const currency = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)

export function EventTicketTypesCard({ eventId, initialTicketTypes, canManage, allowMultiple = true, event }: Props) {
  const router = useRouter()
  const [types, setTypes] = useState(initialTicketTypes)
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftRow>(EMPTY)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setTypes(initialTicketTypes), [initialTicketTypes])
  const activeCount = types.filter(type => type.is_active).length
  const edit = (row?: EventTicketTypeRow) => {
    setError(null)
    setEditing(row?.id ?? 'new')
    setDraft(row ? { name: row.name, base_price: String(Number(row.base_price)), capacity: row.capacity == null ? '' : String(row.capacity), free: Number(row.base_price) === 0 } : EMPTY)
  }
  const save = () => {
    if (!draft.name.trim()) { setError('Give this ticket a name'); return }
    const price = draft.free ? 0 : Number(draft.base_price)
    if (!draft.free && (!draft.base_price.trim() || !Number.isFinite(price) || price <= 0)) {
      setError('Enter a ticket price above £0, or choose Free ticket'); return
    }
    const capacity = draft.capacity.trim() ? Number(draft.capacity) : null
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0)) { setError('Capacity must be a whole number, or leave it blank'); return }
    setError(null)
    startTransition(async () => {
      try {
        const values = { name: draft.name.trim(), base_price: price, capacity, is_free_ticket: draft.free }
        const result = editing === 'new'
          ? await createEventTicketType(eventId, { ...values, sort_order: types.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1 })
          : await updateEventTicketType(editing!, values)
        if (result.error || !result.data) { setError(result.error || 'Ticket could not be saved'); return }
        setTypes(current => editing === 'new' ? [...current, result.data!] : current.map(row => row.id === editing ? result.data! : row))
        setEditing(null)
        toast.success('Ticket saved')
        router.refresh()
      } catch { setError('Ticket could not be saved. Please try again.') }
    })
  }
  const toggle = (row: EventTicketTypeRow) => startTransition(async () => {
    setError(null)
    try {
      const result = await updateEventTicketType(row.id, { is_active: !row.is_active })
      if (result.error || !result.data) { setError(result.error || 'Ticket could not be updated'); return }
      setTypes(current => current.map(type => type.id === row.id ? result.data! : type))
      router.refresh()
    } catch { setError('Ticket could not be updated. Please try again.') }
  })
  const remove = () => startTransition(async () => {
    if (!removeId) return
    try {
      const result = await deleteEventTicketType(removeId)
      if (result.error) { setError(result.error); setRemoveId(null); return }
      setTypes(current => result.data ? current.map(type => type.id === removeId ? result.data! : type) : current.filter(type => type.id !== removeId))
      setRemoveId(null)
      toast.success('Ticket removed from sale')
      router.refresh()
    } catch { setError('Ticket could not be removed. Please try again.'); setRemoveId(null) }
  })
  const canAdd = canManage && (allowMultiple || types.length === 0) && editing !== 'new'
  return <Card>
    <CardHeader
      title="Ticket Prices"
      subtitle="Set the full price here"
      action={canAdd ? <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => edit()}>Add Ticket Type</Button> : undefined}
    />
    <CardBody className="space-y-4">
      <p className="text-sm text-text-muted">Online discounts are applied below. Existing bookings keep their agreed price.</p>
      {!types.length && <Empty size="sm" title="No Ticket Prices Yet" description="Add your first ticket to set the entry price." />}
      {types.map(row => <div key={row.id} className="space-y-4 rounded-default border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><SubHeading>{row.name}</SubHeading><p className="mt-1 text-sm text-text-muted">{row.capacity == null ? 'Shares the event capacity' : `${row.capacity} tickets available in this type`}</p></div>
          <Badge tone={eventTicketTypeSaleTone(row.is_active)}>{row.is_active ? 'On sale' : 'Off sale'}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Full price" value={currency(Number(row.base_price))} />
          <Stat label="Online now" value={event?.payment_mode === 'prepaid' ? currency(resolveTicketTypeSellPrice(Number(row.base_price), event)) : 'Pay on arrival'} />
        </div>
        {canManage && <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => edit(row)}>Edit {row.name}</Button>
          {allowMultiple && <>
            <Button type="button" variant="secondary" size="sm" disabled={pending || (row.is_active && activeCount <= 1)} onClick={() => toggle(row)}>{row.is_active ? 'Take Off Sale' : 'Put On Sale'}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending || (row.is_active && activeCount <= 1)} onClick={() => setRemoveId(row.id)}>Remove</Button>
          </>}
        </div>}
      </div>)}
      {editing && <div className="rounded-default border border-border p-4"><Fieldset legend={editing === 'new' ? 'New Ticket Type' : 'Edit Ticket'} disabled={pending}><div className="space-y-4">
        <Input label="Ticket name" maxLength={80} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
        <Checkbox label="Free ticket" checked={draft.free} onChange={checked => setDraft(current => ({ ...current, free: checked }))} />
        {!draft.free && <Input label="Full ticket price (£)" type="number" min="0.01" step="0.01" value={draft.base_price} onChange={event => setDraft(current => ({ ...current, base_price: event.target.value }))} />}
        {allowMultiple && <Input label="Ticket capacity (blank to share the event capacity)" type="number" min="0" step="1" value={draft.capacity} onChange={event => setDraft(current => ({ ...current, capacity: event.target.value }))} />}
        <FormFooter>
          <Button type="button" variant="secondary" onClick={() => { setEditing(null); setError(null) }}>Cancel</Button>
          <Button type="button" variant="primary" onClick={save} loading={pending}>Save Ticket</Button>
        </FormFooter>
      </div></Fieldset></div>}
      {error && <Alert tone="danger" size="sm">{error}</Alert>}
    </CardBody>
    <ConfirmDialog open={removeId !== null} onClose={() => setRemoveId(null)} onConfirm={remove} title="Remove Ticket From Sale" message="Tickets already booked are kept for your records. This type will no longer be offered to new guests." confirmLabel="Remove From Sale" tone="danger" />
  </Card>
}
