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

type JoinLink = {
  table_id: string
  join_table_id: string
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
    join_links: JoinLink[]
    areas: AreaOption[]
  }
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

function pairKey(tableId: string, joinTableId: string): string {
  return tableId < joinTableId ? `${tableId}:${joinTableId}` : `${joinTableId}:${tableId}`
}

function parsePairKey(key: string): { table_id: string; join_table_id: string } | null {
  const [table_id, join_table_id] = key.split(':')
  if (!table_id || !join_table_id || table_id === join_table_id) {
    return null
  }

  return table_id < join_table_id
    ? { table_id, join_table_id }
    : { table_id: join_table_id, join_table_id: table_id }
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
  const [joinLinkKeys, setJoinLinkKeys] = useState<Set<string>>(new Set())
  const [spaceAreaLinkKeys, setSpaceAreaLinkKeys] = useState<Set<string>>(new Set())
  const [venueSpaces, setVenueSpaces] = useState<VenueSpace[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [savingTables, setSavingTables] = useState(false)
  const [savingJoinLinks, setSavingJoinLinks] = useState(false)
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
      const incomingJoinLinks = tablePayload.data.join_links || []
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

      setJoinLinkKeys(
        new Set(
          incomingJoinLinks.map((row) => pairKey(row.table_id, row.join_table_id))
        )
      )

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

  useEffect(() => {
    void loadSetup()
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

  const joinPairs = useMemo(() => {
    const pairs: Array<{ key: string; left: TableSetupRow; right: TableSetupRow }> = []

    for (let index = 0; index < sortedTables.length; index += 1) {
      const left = sortedTables[index]
      for (let secondIndex = index + 1; secondIndex < sortedTables.length; secondIndex += 1) {
        const right = sortedTables[secondIndex]
        pairs.push({
          key: pairKey(left.id, right.id),
          left,
          right
        })
      }
    }

    return pairs
  }, [sortedTables])

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

  function toggleJoinLink(key: string) {
    setJoinLinkKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  async function saveJoinLinks() {
    setSavingJoinLinks(true)
    setErrorMessage(null)
    setStatusMessage(null)

    try {
      const join_links = Array.from(joinLinkKeys)
        .map((key) => parsePairKey(key))
        .filter((value): value is { table_id: string; join_table_id: string } => Boolean(value))

      const response = await fetch('/api/settings/table-bookings/tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ join_links })
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error((payload && payload.error) || 'Failed to update joinable-table rules')
      }

      await loadSetup()
      setStatusMessage('Joinable-table rules saved')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update joinable-table rules')
    } finally {
      setSavingJoinLinks(false)
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
                            [table.id]: {
                              ...current[table.id],
                              name: event.target.value
                            }
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
                            [table.id]: {
                              ...current[table.id],
                              table_number: event.target.value
                            }
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
                            [table.id]: {
                              ...current[table.id],
                              capacity: event.target.value
                            }
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
                            [table.id]: {
                              ...current[table.id],
                              area: event.target.value
                            }
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
                            [table.id]: {
                              ...current[table.id],
                              is_bookable: event.target.checked
                            }
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
                onClick={() => {
                  void saveAllTableChanges()
                }}
                disabled={savingTables || changedTableIds.length === 0}
                className="rounded-md bg-sidebar px-4 py-2 text-sm font-medium text-white hover:bg-sidebar/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingTables ? 'Saving…' : 'Save all table changes'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Add table</h3>
        <form onSubmit={createTable} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-medium text-gray-700">
            Name
            <input
              type="text"
              required
              value={newTable.name}
              onChange={(event) =>
                setNewTable((current) => ({
                  ...current,
                  name: event.target.value
                }))
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-xs font-medium text-gray-700">
            Table number
            <input
              type="text"
              required
              value={newTable.table_number}
              onChange={(event) =>
                setNewTable((current) => ({
                  ...current,
                  table_number: event.target.value
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
              required
              value={newTable.capacity}
              onChange={(event) =>
                setNewTable((current) => ({
                  ...current,
                  capacity: event.target.value
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
              value={newTable.area}
              onChange={(event) =>
                setNewTable((current) => ({
                  ...current,
                  area: event.target.value
                }))
              }
              placeholder="Main Bar"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex items-end gap-2 text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={newTable.is_bookable}
              onChange={(event) =>
                setNewTable((current) => ({
                  ...current,
                  is_bookable: event.target.checked
                }))
              }
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

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900">Joinable tables</h3>
        <p className="mt-1 text-xs text-gray-500">
          Choose table pairs that can be joined for larger bookings.
        </p>

        {loading ? (
          <p className="mt-3 text-sm text-gray-500">Loading joinable-table rules…</p>
        ) : joinPairs.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
            Add at least two tables before configuring joined-table rules.
          </p>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {joinPairs.map((pair) => (
              <label key={pair.key} className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={joinLinkKeys.has(pair.key)}
                  onChange={() => toggleJoinLink(pair.key)}
                />
                <span>
                  <span className="font-medium">{pair.left.name || pair.left.table_number}</span>
                  {' + '}
                  <span className="font-medium">{pair.right.name || pair.right.table_number}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="mt-4">
          <button
            type="button"
            disabled={savingJoinLinks || loading || joinPairs.length === 0}
            onClick={() => {
              void saveJoinLinks()
            }}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingJoinLinks ? 'Saving…' : 'Save joinable tables'}
          </button>
        </div>
      </div>

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
            onClick={() => {
              void saveSpaceAreaLinks()
            }}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingSpaceAreaLinks ? 'Saving…' : 'Save private-booking area mapping'}
          </button>
        </div>
      </div>
    </div>
  )
}
