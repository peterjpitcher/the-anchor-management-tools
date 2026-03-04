'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'

type TableSetupRow = {
  id: string
  name: string
  table_number: string
  capacity: number
  area_id: string | null
  area: string | null
  is_bookable: boolean
}

type AreaOption = {
  id: string
  name: string
}

type JoinGroup = {
  id: string
  name: string
  table_ids: string[]
}

type EditingGroup = {
  id: string | null
  name: string
  table_ids: string[]
}

type SpaceAreaLink = {
  venue_space_id: string
  table_area_id: string
}

type VenueSpace = {
  id: string
  name: string
  active: boolean
}

type TableSetupResponse = {
  success: boolean
  data?: {
    tables: TableSetupRow[]
    join_links: { table_id: string; join_table_id: string }[]
    areas: AreaOption[]
  }
  error?: string
}

type JoinGroupsResponse = {
  success: boolean
  data?: { groups: JoinGroup[] }
  error?: string
}

type SpaceAreaSetupResponse = {
  success: boolean
  data?: {
    venue_spaces: VenueSpace[]
    areas: AreaOption[]
    space_area_links: SpaceAreaLink[]
  }
  error?: string
}

type TableDraft = {
  name: string
  table_number: string
  capacity: string
  area: string
  is_bookable: boolean
}

function spaceAreaKey(spaceId: string, areaId: string): string {
  return `${spaceId}:${areaId}`
}

function parseSpaceAreaKey(value: string): SpaceAreaLink | null {
  const [venue_space_id, table_area_id] = value.split(':')
  if (!venue_space_id || !table_area_id) {
    return null
  }
  return { venue_space_id, table_area_id }
}

export function TableSetupManager() {
  const [tables, setTables] = useState<TableSetupRow[]>([])
  const [areas, setAreas] = useState<AreaOption[]>([])
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>({})
  const [joinGroups, setJoinGroups] = useState<JoinGroup[]>([])
  const [editingGroup, setEditingGroup] = useState<EditingGroup | null>(null)
  const [spaceAreaLinkKeys, setSpaceAreaLinkKeys] = useState<Set<string>>(new Set())
  const [venueSpaces, setVenueSpaces] = useState<VenueSpace[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [savingTables, setSavingTables] = useState(false)
  const [savingGroup, setSavingGroup] = useState(false)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [savingSpaceAreaLinks, setSavingSpaceAreaLinks] = useState(false)
  const [creatingTable, setCreatingTable] = useState(false)
  const [newTable, setNewTable] = useState<TableDraft>({
    name: '',
    table_number: '',
    capacity: '4',
    area: '',
    is_bookable: true
  })

  async function loadSetup() {
    setLoading(true)
    setErrorMessage(null)

    try {
      const [tableResponse, spaceAreaResponse] = await Promise.all([
        fetch('/api/settings/table-bookings/tables', { cache: 'no-store' }),
        fetch('/api/settings/table-bookings/space-area-links', { cache: 'no-store' })
      ])

      const tablePayload = (await tableResponse.json()) as TableSetupResponse
      if (!tableResponse.ok || !tablePayload.success || !tablePayload.data) {
        throw new Error(tablePayload.error || 'Failed to load table setup')
      }

      const spaceAreaPayload = (await spaceAreaResponse.json()) as SpaceAreaSetupResponse
      if (!spaceAreaResponse.ok || !spaceAreaPayload.success || !spaceAreaPayload.data) {
        throw new Error(spaceAreaPayload.error || 'Failed to load private booking mappings')
      }

      const incomingTables = tablePayload.data.tables || []
      const incomingAreas = tablePayload.data.areas || []

      setTables(incomingTables)
      setAreas(incomingAreas)
      setDrafts(() => {
        const next: Record<string, TableDraft> = {}
        for (const table of incomingTables) {
          next[table.id] = {
            name: table.name || '',
            table_number: table.table_number || '',
            capacity: String(table.capacity || 1),
            area: table.area || '',
            is_bookable: table.is_bookable !== false
          }
        }
        return next
      })

      setVenueSpaces(spaceAreaPayload.data.venue_spaces || [])
      setSpaceAreaLinkKeys(
        new Set(
          (spaceAreaPayload.data.space_area_links || []).map((row) =>
            spaceAreaKey(row.venue_space_id, row.table_area_id)
          )
        )
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load table setup')
    } finally {
      setLoading(false)
    }
  }

  async function loadJoinGroups() {
    setLoadingGroups(true)
    try {
      const response = await fetch('/api/settings/table-bookings/join-groups', { cache: 'no-store' })
      const payload = (await response.json()) as JoinGroupsResponse
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Failed to load join groups')
      }
      setJoinGroups(payload.data.groups)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load join groups')
    } finally {
      setLoadingGroups(false)
    }
  }

  useEffect(() => {
    void loadSetup()
    void loadJoinGroups()
  }, [])

  const sortedTables = useMemo(() => {
    return [...tables].sort((a, b) => {
      const aNumber = a.table_number || ''
      const bNumber = b.table_number || ''
      if (aNumber !== bNumber) {
        return aNumber.localeCompare(bNumber, undefined, { numeric: true, sensitivity: 'base' })
      }
      return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    })
  }, [tables])

  const sortedAreas = useMemo(() => {
    return [...areas].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    )
  }, [areas])

  const sortedVenueSpaces = useMemo(() => {
    return [...venueSpaces].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
    )
  }, [venueSpaces])

  const tableById = useMemo(() => {
    return new Map(tables.map((table) => [table.id, table]))
  }, [tables])

  const changedTableIds = useMemo(() => {
    const changed: string[] = []

    for (const table of sortedTables) {
      const draft = drafts[table.id]
      if (!draft) continue

      const baselineName = (table.name || '').trim()
      const baselineNumber = (table.table_number || '').trim()
      const baselineArea = (table.area || '').trim()
      const baselineCapacity = Number(table.capacity || 0)
      const baselineBookable = table.is_bookable !== false

      const draftName = draft.name.trim()
      const draftNumber = draft.table_number.trim()
      const draftArea = draft.area.trim().replace(/\s+/g, ' ')
      const draftCapacity = Number.parseInt(draft.capacity, 10)
      const draftBookable = draft.is_bookable

      if (
        draftName !== baselineName ||
        draftNumber !== baselineNumber ||
        draftArea !== baselineArea ||
        draftBookable !== baselineBookable ||
        !Number.isFinite(draftCapacity) ||
        draftCapacity !== baselineCapacity
      ) {
        changed.push(table.id)
      }
    }

    return changed
  }, [drafts, sortedTables])

  async function saveAllTableChanges() {
    if (changedTableIds.length === 0) {
      setStatusMessage('No table changes to save')
      setErrorMessage(null)
      return
    }

    setSavingTables(true)
    setErrorMessage(null)
    setStatusMessage(null)

    const idsToSave = [...changedTableIds]

    try {
      for (const tableId of idsToSave) {
        const draft = drafts[tableId]
        const table = tableById.get(tableId)
        if (!draft || !table) continue

        const capacity = Number.parseInt(draft.capacity, 10)
        const tableLabel = table.name || table.table_number || 'table'

        if (!Number.isFinite(capacity) || capacity < 1) {
          throw new Error(`Capacity must be at least 1 for ${tableLabel}`)
        }

        if (!draft.name.trim()) {
          throw new Error(`Table name is required for ${tableLabel}`)
        }

        if (!draft.table_number.trim()) {
          throw new Error(`Table number is required for ${tableLabel}`)
        }

        const response = await fetch('/api/settings/table-bookings/tables', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: tableId,
            name: draft.name.trim(),
            table_number: draft.table_number.trim(),
            capacity,
            area: draft.area.trim() || null,
            is_bookable: draft.is_bookable
          })
        })

        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error((payload && payload.error) || `Failed to update ${tableLabel}`)
        }
      }

      await loadSetup()
      setStatusMessage(
        `${idsToSave.length} table ${idsToSave.length === 1 ? 'change' : 'changes'} saved`
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save table changes')
    } finally {
      setSavingTables(false)
    }
  }

  async function createTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const capacity = Number.parseInt(newTable.capacity, 10)
    if (!Number.isFinite(capacity) || capacity < 1) {
      setErrorMessage('Capacity must be at least 1')
      return
    }

    if (!newTable.name.trim() || !newTable.table_number.trim()) {
      setErrorMessage('Name and table number are required')
      return
    }

    setCreatingTable(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      const response = await fetch('/api/settings/table-bookings/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTable.name.trim(),
          table_number: newTable.table_number.trim(),
          capacity,
          area: newTable.area.trim() || null,
          is_bookable: newTable.is_bookable
        })
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((payload && payload.error) || 'Failed to create table')
      }

      await loadSetup()
      setNewTable({
        name: '',
        table_number: '',
        capacity: '4',
        area: '',
        is_bookable: true
      })
      setStatusMessage('Table created')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create table')
    } finally {
      setCreatingTable(false)
    }
  }

  async function saveGroup() {
    if (!editingGroup) return

    const name = editingGroup.name.trim()
    if (!name) {
      setErrorMessage('Group name is required')
      return
    }

    setSavingGroup(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      const isNew = editingGroup.id === null
      const response = await fetch('/api/settings/table-bookings/join-groups', {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingGroup.id ? { id: editingGroup.id } : {}),
          name,
          table_ids: editingGroup.table_ids
        })
      })

      const payload = (await response.json().catch(() => null)) as JoinGroupsResponse | null
      if (!response.ok) {
        throw new Error((payload && payload.error) || 'Failed to save group')
      }

      if (payload?.data?.groups) {
        setJoinGroups(payload.data.groups)
      }
      setEditingGroup(null)
      setStatusMessage(isNew ? 'Join group created' : 'Join group updated')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save group')
    } finally {
      setSavingGroup(false)
    }
  }

  async function deleteGroup(id: string) {
    setDeletingGroupId(id)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      const response = await fetch('/api/settings/table-bookings/join-groups', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })

      const payload = (await response.json().catch(() => null)) as JoinGroupsResponse | null
      if (!response.ok) {
        throw new Error((payload && payload.error) || 'Failed to delete group')
      }

      if (payload?.data?.groups) {
        setJoinGroups(payload.data.groups)
      }
      setConfirmDeleteId(null)
      setStatusMessage('Join group deleted')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete group')
    } finally {
      setDeletingGroupId(null)
    }
  }

  function toggleSpaceAreaLink(venueSpaceId: string, tableAreaId: string) {
    const key = spaceAreaKey(venueSpaceId, tableAreaId)
    setSpaceAreaLinkKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  async function saveSpaceAreaLinks() {
    setSavingSpaceAreaLinks(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      const space_area_links = Array.from(spaceAreaLinkKeys)
        .map((key) => parseSpaceAreaKey(key))
        .filter((value): value is SpaceAreaLink => Boolean(value))

      const response = await fetch('/api/settings/table-bookings/space-area-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ space_area_links })
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((payload && payload.error) || 'Failed to save private-booking area mappings')
      }

      await loadSetup()
      setStatusMessage('Private-booking area mappings saved')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to save private-booking area mappings'
      )
    } finally {
      setSavingSpaceAreaLinks(false)
    }
  }

  return (
    <div className="space-y-6">
      {statusMessage && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMessage}
        </div>
      )}

      <datalist id="table-area-options">
        {sortedAreas.map((area) => (
          <option key={area.id} value={area.name} />
        ))}
      </datalist>

      {/* Existing tables */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Existing tables</h3>
        <p className="mt-1 text-xs text-gray-500">
          Configure table name, number, capacity, bookable state and area for each table.
        </p>
        {changedTableIds.length > 0 && (
          <p className="mt-1 text-xs font-medium text-amber-700">
            Unsaved table changes: {changedTableIds.length}
          </p>
        )}

        {loading ? (
          <p className="mt-3 text-sm text-gray-500">Loading table setup…</p>
        ) : sortedTables.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
            No tables found. Add your first table below.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {sortedTables.map((table) => {
              const draft = drafts[table.id]
              if (!draft) return null

              return (
                <div key={table.id} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <label className="text-xs font-medium text-gray-700">
                      Name
                      <input
                        type="text"
                        value={draft.name}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [table.id]: { ...current[table.id], name: event.target.value }
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="text-xs font-medium text-gray-700">
                      Table number
                      <input
                        type="text"
                        value={draft.table_number}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [table.id]: { ...current[table.id], table_number: event.target.value }
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="text-xs font-medium text-gray-700">
                      Capacity
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={draft.capacity}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [table.id]: { ...current[table.id], capacity: event.target.value }
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="text-xs font-medium text-gray-700">
                      Area
                      <input
                        type="text"
                        list="table-area-options"
                        value={draft.area}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [table.id]: { ...current[table.id], area: event.target.value }
                          }))
                        }
                        placeholder="Main Bar"
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>

                    <label className="flex items-end gap-2 text-xs font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={draft.is_bookable}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [table.id]: { ...current[table.id], is_bookable: event.target.checked }
                          }))
                        }
                      />
                      <span>Bookable</span>
                    </label>
                  </div>
                </div>
              )
            })}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => { void saveAllTableChanges() }}
                disabled={savingTables || changedTableIds.length === 0}
                className="rounded-md bg-sidebar px-4 py-2 text-sm font-medium text-white hover:bg-sidebar/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingTables ? 'Saving…' : 'Save all table changes'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add table */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Add table</h3>
        <form onSubmit={createTable} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-medium text-gray-700">
            Name
            <input
              type="text"
              required
              value={newTable.name}
              onChange={(event) => setNewTable((c) => ({ ...c, name: event.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-gray-700">
            Table number
            <input
              type="text"
              required
              value={newTable.table_number}
              onChange={(event) => setNewTable((c) => ({ ...c, table_number: event.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-gray-700">
            Capacity
            <input
              type="number"
              min={1}
              max={100}
              required
              value={newTable.capacity}
              onChange={(event) => setNewTable((c) => ({ ...c, capacity: event.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-gray-700">
            Area
            <input
              type="text"
              list="table-area-options"
              value={newTable.area}
              onChange={(event) => setNewTable((c) => ({ ...c, area: event.target.value }))}
              placeholder="Main Bar"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex items-end gap-2 text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={newTable.is_bookable}
              onChange={(event) => setNewTable((c) => ({ ...c, is_bookable: event.target.checked }))}
            />
            <span>Bookable</span>
          </label>

          <div className="md:col-span-2 xl:col-span-5">
            <button
              type="submit"
              disabled={creatingTable}
              className="rounded-md bg-sidebar px-4 py-2 text-sm font-medium text-white hover:bg-sidebar/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creatingTable ? 'Creating…' : 'Create table'}
            </button>
          </div>
        </form>
      </div>

      {/* Join groups */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Table join groups</h3>
            <p className="mt-1 text-xs text-gray-500">
              Tables in the same group can be booked together in any combination. The system
              automatically generates all valid multi-table options from each group.
            </p>
          </div>
          {!editingGroup && (
            <button
              type="button"
              onClick={() => {
                setEditingGroup({ id: null, name: '', table_ids: [] })
                setErrorMessage(null)
              }}
              className="shrink-0 rounded-md bg-sidebar px-3 py-1.5 text-sm font-medium text-white hover:bg-sidebar/90"
            >
              + New group
            </button>
          )}
        </div>

        {/* Edit / create form */}
        {editingGroup && (
          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4">
            <h4 className="mb-3 text-sm font-semibold text-blue-900">
              {editingGroup.id ? 'Edit group' : 'New group'}
            </h4>

            <label className="block text-xs font-medium text-gray-700">
              Group name
              <input
                type="text"
                value={editingGroup.name}
                onChange={(event) =>
                  setEditingGroup((current) =>
                    current ? { ...current, name: event.target.value } : null
                  )
                }
                placeholder="e.g. Dining Room"
                className="mt-1 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>

            <p className="mt-3 text-xs font-medium text-gray-700">Tables in this group</p>
            {loading ? (
              <p className="mt-2 text-xs text-gray-500">Loading tables…</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {sortedTables.map((table) => {
                  const checked = editingGroup.table_ids.includes(table.id)
                  return (
                    <label
                      key={table.id}
                      className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setEditingGroup((current) => {
                            if (!current) return null
                            return {
                              ...current,
                              table_ids: checked
                                ? current.table_ids.filter((id) => id !== table.id)
                                : [...current.table_ids, table.id]
                            }
                          })
                        }
                      />
                      <span>
                        <span className="font-medium">{table.name || table.table_number}</span>
                        {table.area && (
                          <span className="ml-1 text-xs text-gray-400">({table.area})</span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { void saveGroup() }}
                disabled={savingGroup}
                className="rounded-md bg-sidebar px-4 py-2 text-sm font-medium text-white hover:bg-sidebar/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingGroup ? 'Saving…' : 'Save group'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingGroup(null)
                  setErrorMessage(null)
                }}
                disabled={savingGroup}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Group list */}
        {loadingGroups ? (
          <p className="mt-4 text-sm text-gray-500">Loading join groups…</p>
        ) : joinGroups.length === 0 && !editingGroup ? (
          <p className="mt-4 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
            No join groups yet. Create one to allow tables to be booked together.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {joinGroups.map((group) => {
              const groupTables = sortedTables.filter((t) => group.table_ids.includes(t.id))
              const pairCount = (group.table_ids.length * (group.table_ids.length - 1)) / 2
              const isConfirmingDelete = confirmDeleteId === group.id

              return (
                <div
                  key={group.id}
                  className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{group.name}</p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {groupTables.length > 0
                          ? groupTables.map((t) => t.name || t.table_number).join(' · ')
                          : 'No tables assigned'}
                      </p>
                      {group.table_ids.length >= 2 && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          {group.table_ids.length} tables · {pairCount} pairs ·{' '}
                          {2 ** group.table_ids.length - group.table_ids.length - 1} multi-table combinations
                        </p>
                      )}
                    </div>

                    {!isConfirmingDelete ? (
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGroup({
                              id: group.id,
                              name: group.name,
                              table_ids: [...group.table_ids]
                            })
                            setErrorMessage(null)
                          }}
                          disabled={!!editingGroup}
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(group.id)}
                          disabled={!!editingGroup}
                          className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-gray-600">Delete this group?</span>
                        <button
                          type="button"
                          onClick={() => { void deleteGroup(group.id) }}
                          disabled={deletingGroupId === group.id}
                          className="rounded border border-red-400 bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {deletingGroupId === group.id ? 'Deleting…' : 'Yes, delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-white"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Private booking area mapping */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Private booking area mapping</h3>
        <p className="mt-1 text-xs text-gray-500">
          Map private-booking spaces to table areas. During a mapped private booking, those table areas are blocked from table allocation.
        </p>

        {loading ? (
          <p className="mt-3 text-sm text-gray-500">Loading private-booking mappings…</p>
        ) : sortedAreas.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
            Add at least one table area before mapping private-booking spaces.
          </p>
        ) : sortedVenueSpaces.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
            No private-booking spaces found.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {sortedVenueSpaces.map((space) => (
              <div key={space.id} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{space.name}</p>
                  {!space.active && (
                    <span className="rounded-md bg-gray-200 px-2 py-0.5 text-[11px] text-gray-700">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {sortedAreas.map((area) => {
                    const key = spaceAreaKey(space.id, area.id)
                    return (
                      <label
                        key={key}
                        className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={spaceAreaLinkKeys.has(key)}
                          onChange={() => toggleSpaceAreaLink(space.id, area.id)}
                        />
                        <span>{area.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <button
            type="button"
            disabled={savingSpaceAreaLinks || loading || sortedAreas.length === 0 || sortedVenueSpaces.length === 0}
            onClick={() => { void saveSpaceAreaLinks() }}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingSpaceAreaLinks ? 'Saving…' : 'Save private-booking area mapping'}
          </button>
        </div>
      </div>
    </div>
  )
}
