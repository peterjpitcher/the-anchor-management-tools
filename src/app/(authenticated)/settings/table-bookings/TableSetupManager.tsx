'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Empty,
  Field,
  FormFooter,
  Icon,
  Input,
  PageLoading,
  Section,
  toast,
} from '@/ds'
import { activeStateTone } from '../_shared/status-ui'

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

type PacingSettings = {
  busy_threshold_covers: number
  filling_threshold_covers: number
  window_minutes: number
}

type PacingSettingsResponse = {
  success: boolean
  data?: PacingSettings
  error?: string
}

type KitchenPacingSettings = {
  enabled: boolean
  window_minutes: number
  pace_covers_regular: number
  pace_covers_sunday: number
  walk_in_reserve_regular: number
  walk_in_reserve_sunday: number
}

type KitchenPacingSettingsResponse = {
  success: boolean
  data?: KitchenPacingSettings
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
  // Errors from saving. A block that failed to load shows its own error instead: never an empty
  // list or the default values, which a save would then write over the real settings.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [setupLoadError, setSetupLoadError] = useState<string | null>(null)
  const [pacingLoadError, setPacingLoadError] = useState<string | null>(null)
  const [kitchenPacingLoadError, setKitchenPacingLoadError] = useState<string | null>(null)
  const [groupsLoadError, setGroupsLoadError] = useState<string | null>(null)
  const [savingTables, setSavingTables] = useState(false)
  const [savingGroup, setSavingGroup] = useState(false)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [savingSpaceAreaLinks, setSavingSpaceAreaLinks] = useState(false)
  const [creatingTable, setCreatingTable] = useState(false)
  const [loadingPacing, setLoadingPacing] = useState(true)
  const [savingPacing, setSavingPacing] = useState(false)
  const [pacingDraft, setPacingDraft] = useState({
    busy_threshold_covers: '30',
    filling_threshold_covers: '20',
    window_minutes: '60'
  })
  const [loadingKitchenPacing, setLoadingKitchenPacing] = useState(true)
  const [savingKitchenPacing, setSavingKitchenPacing] = useState(false)
  const [kitchenPacingDraft, setKitchenPacingDraft] = useState({
    enabled: false,
    window_minutes: '30',
    pace_covers_regular: '25',
    pace_covers_sunday: '20',
    walk_in_reserve_regular: '6',
    walk_in_reserve_sunday: '6'
  })
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
      setSetupLoadError(null)
    } catch (error) {
      setSetupLoadError(error instanceof Error ? error.message : 'Failed to load table setup')
    } finally {
      setLoading(false)
    }
  }

  async function loadPacingSettings() {
    setLoadingPacing(true)
    try {
      const response = await fetch('/api/settings/table-bookings/pacing', { cache: 'no-store' })
      const payload = (await response.json()) as PacingSettingsResponse
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Failed to load pacing settings')
      }
      setPacingDraft({
        busy_threshold_covers: String(payload.data.busy_threshold_covers),
        filling_threshold_covers: String(payload.data.filling_threshold_covers),
        window_minutes: String(payload.data.window_minutes)
      })
      setPacingLoadError(null)
    } catch (error) {
      setPacingLoadError(error instanceof Error ? error.message : 'Failed to load pacing settings')
    } finally {
      setLoadingPacing(false)
    }
  }

  async function loadKitchenPacing() {
    setLoadingKitchenPacing(true)
    try {
      const response = await fetch('/api/settings/table-bookings/kitchen-pacing', { cache: 'no-store' })
      const payload = (await response.json()) as KitchenPacingSettingsResponse
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || 'Failed to load kitchen pacing settings')
      }
      setKitchenPacingDraft({
        enabled: payload.data.enabled,
        window_minutes: String(payload.data.window_minutes),
        pace_covers_regular: String(payload.data.pace_covers_regular),
        pace_covers_sunday: String(payload.data.pace_covers_sunday),
        walk_in_reserve_regular: String(payload.data.walk_in_reserve_regular),
        walk_in_reserve_sunday: String(payload.data.walk_in_reserve_sunday)
      })
      setKitchenPacingLoadError(null)
    } catch (error) {
      setKitchenPacingLoadError(error instanceof Error ? error.message : 'Failed to load kitchen pacing settings')
    } finally {
      setLoadingKitchenPacing(false)
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
      setGroupsLoadError(null)
    } catch (error) {
      setGroupsLoadError(error instanceof Error ? error.message : 'Failed to load join groups')
    } finally {
      setLoadingGroups(false)
    }
  }

  useEffect(() => {
    void loadSetup()
    void loadPacingSettings()
    void loadKitchenPacing()
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
      toast.info('No table changes to save')
      setErrorMessage(null)
      return
    }

    setSavingTables(true)
    setErrorMessage(null)

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
      toast.success(
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
      toast.success('Table created')
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
      toast.success(isNew ? 'Join group created' : 'Join group updated')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save group')
    } finally {
      setSavingGroup(false)
    }
  }

  async function deleteGroup(id: string) {
    setDeletingGroupId(id)
    setErrorMessage(null)

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
      toast.success('Join group deleted')
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
      toast.success('Private-booking area mappings saved')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to save private-booking area mappings'
      )
    } finally {
      setSavingSpaceAreaLinks(false)
    }
  }

  async function savePacingSettings() {
    const busy = Number.parseInt(pacingDraft.busy_threshold_covers, 10)
    const filling = Number.parseInt(pacingDraft.filling_threshold_covers, 10)
    const windowMinutes = Number.parseInt(pacingDraft.window_minutes, 10)

    if (!Number.isFinite(busy) || busy < 2 || busy > 200) {
      setErrorMessage('Busy threshold must be between 2 and 200 covers')
      return
    }

    if (!Number.isFinite(filling) || filling < 1 || filling > 199) {
      setErrorMessage('Filling threshold must be between 1 and 199 covers')
      return
    }

    if (filling >= busy) {
      setErrorMessage('Filling threshold must be lower than busy threshold')
      return
    }

    if (!Number.isFinite(windowMinutes) || windowMinutes < 30 || windowMinutes > 180 || windowMinutes % 2 !== 0) {
      setErrorMessage('Window must be an even number between 30 and 180 minutes')
      return
    }

    setSavingPacing(true)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/settings/table-bookings/pacing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          busy_threshold_covers: busy,
          filling_threshold_covers: filling,
          window_minutes: windowMinutes
        })
      })

      const payload = (await response.json().catch(() => null)) as PacingSettingsResponse | null
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.error || 'Failed to save pacing settings')
      }

      setPacingDraft({
        busy_threshold_covers: String(payload.data.busy_threshold_covers),
        filling_threshold_covers: String(payload.data.filling_threshold_covers),
        window_minutes: String(payload.data.window_minutes)
      })
      toast.success('Pacing settings saved')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save pacing settings')
    } finally {
      setSavingPacing(false)
    }
  }

  async function saveKitchenPacing() {
    const windowMinutes = Number.parseInt(kitchenPacingDraft.window_minutes, 10)
    const paceRegular = Number.parseInt(kitchenPacingDraft.pace_covers_regular, 10)
    const paceSunday = Number.parseInt(kitchenPacingDraft.pace_covers_sunday, 10)
    const reserveRegular = Number.parseInt(kitchenPacingDraft.walk_in_reserve_regular, 10)
    const reserveSunday = Number.parseInt(kitchenPacingDraft.walk_in_reserve_sunday, 10)

    if (!Number.isFinite(windowMinutes) || windowMinutes < 10 || windowMinutes > 180 || windowMinutes % 5 !== 0) {
      setErrorMessage('Window must be a multiple of 5 between 10 and 180 minutes')
      return
    }

    for (const [label, value] of [
      ['Regular pace', paceRegular],
      ['Sunday pace', paceSunday]
    ] as const) {
      if (!Number.isFinite(value) || value < 1 || value > 500) {
        setErrorMessage(`${label} must be between 1 and 500 covers`)
        return
      }
    }

    for (const [label, value] of [
      ['Regular walk-in reserve', reserveRegular],
      ['Sunday walk-in reserve', reserveSunday]
    ] as const) {
      if (!Number.isFinite(value) || value < 0 || value > 500) {
        setErrorMessage(`${label} must be between 0 and 500 covers`)
        return
      }
    }

    setSavingKitchenPacing(true)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/settings/table-bookings/kitchen-pacing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: kitchenPacingDraft.enabled,
          window_minutes: windowMinutes,
          pace_covers_regular: paceRegular,
          pace_covers_sunday: paceSunday,
          walk_in_reserve_regular: reserveRegular,
          walk_in_reserve_sunday: reserveSunday
        })
      })

      const payload = (await response.json().catch(() => null)) as KitchenPacingSettingsResponse | null
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.error || 'Failed to save kitchen pacing settings')
      }

      setKitchenPacingDraft({
        enabled: payload.data.enabled,
        window_minutes: String(payload.data.window_minutes),
        pace_covers_regular: String(payload.data.pace_covers_regular),
        pace_covers_sunday: String(payload.data.pace_covers_sunday),
        walk_in_reserve_regular: String(payload.data.walk_in_reserve_regular),
        walk_in_reserve_sunday: String(payload.data.walk_in_reserve_sunday)
      })
      toast.success('Kitchen pacing settings saved')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save kitchen pacing settings')
    } finally {
      setSavingKitchenPacing(false)
    }
  }

  const kitchenCeilingRegular = Math.max(
    0,
    (Number.parseInt(kitchenPacingDraft.pace_covers_regular, 10) || 0) -
      (Number.parseInt(kitchenPacingDraft.walk_in_reserve_regular, 10) || 0)
  )
  const kitchenCeilingSunday = Math.max(
    0,
    (Number.parseInt(kitchenPacingDraft.pace_covers_sunday, 10) || 0) -
      (Number.parseInt(kitchenPacingDraft.walk_in_reserve_sunday, 10) || 0)
  )

  const confirmDeleteGroup = joinGroups.find((group) => group.id === confirmDeleteId) ?? null

  /** A block whose data failed to load: the error and a retry, in place of the block's content. */
  const loadFailure = (title: string, message: string, retry: () => void) => (
    <CardBody>
      <Alert
        tone="danger"
        title={title}
        actions={
          <Button size="sm" variant="secondary" onClick={retry}>
            Try Again
          </Button>
        }
      >
        {message}
      </Alert>
    </CardBody>
  )

  return (
    <Section
      title="Tables & Pacing"
      description="The tables themselves, how they join, and the busy labels guests see."
    >
      <div className="space-y-6">
        {errorMessage && (
          <Alert tone="danger" size="sm" closable onClose={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        )}

        <datalist id="table-area-options">
          {sortedAreas.map((area) => (
            <option key={area.id} value={area.name} />
          ))}
        </datalist>

        {/* Booking pacing */}
        <Card>
          <CardHeader title="Booking Pacing" />
          {loadingPacing ? (
            <PageLoading inline label="Loading pacing settings" />
          ) : pacingLoadError ? (
            loadFailure('Could not load pacing settings', pacingLoadError, () => { void loadPacingSettings() })
          ) : (
            <CardBody className="space-y-4">
              <p className="text-sm text-text-muted">
                Tune the soft customer-facing busy labels. These settings do not block bookings.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <Input
                  label="Filling up threshold"
                  type="number"
                  min={1}
                  max={199}
                  value={pacingDraft.filling_threshold_covers}
                  onChange={(event) =>
                    setPacingDraft((current) => ({
                      ...current,
                      filling_threshold_covers: event.target.value
                    }))
                  }
                />

                <Input
                  label="Busy threshold"
                  type="number"
                  min={2}
                  max={200}
                  value={pacingDraft.busy_threshold_covers}
                  onChange={(event) =>
                    setPacingDraft((current) => ({
                      ...current,
                      busy_threshold_covers: event.target.value
                    }))
                  }
                />

                <Input
                  label="Window minutes"
                  type="number"
                  min={30}
                  max={180}
                  step={2}
                  value={pacingDraft.window_minutes}
                  onChange={(event) =>
                    setPacingDraft((current) => ({
                      ...current,
                      window_minutes: event.target.value
                    }))
                  }
                />
              </div>
              <FormFooter>
                <Button
                  variant="primary"
                  onClick={() => { void savePacingSettings() }}
                  disabled={savingPacing}
                  loading={savingPacing}
                >
                  Save Pacing Settings
                </Button>
              </FormFooter>
            </CardBody>
          )}
        </Card>

        {/* Kitchen pacing (cap) */}
        <Card>
          <CardHeader title="Kitchen Pacing (Cap)" />
          {loadingKitchenPacing ? (
            <PageLoading inline label="Loading kitchen pacing settings" />
          ) : kitchenPacingLoadError ? (
            loadFailure('Could not load kitchen pacing settings', kitchenPacingLoadError, () => { void loadKitchenPacing() })
          ) : (
            <CardBody className="space-y-4">
              <p className="text-sm text-text-muted">
                When on, online bookings that would push food covers over the cap in the window are declined and
                asked to pick another time. Staff can override. Walk-ins bypass but use the reserve.
              </p>
              <Checkbox
                label={`Kitchen pacing is ${kitchenPacingDraft.enabled ? 'on' : 'off'}`}
                checked={kitchenPacingDraft.enabled}
                onChange={(checked) =>
                  setKitchenPacingDraft((current) => ({
                    ...current,
                    enabled: checked
                  }))
                }
              />

              <div className="grid gap-4 md:grid-cols-3">
                <Input
                  label="Window minutes"
                  type="number"
                  min={10}
                  max={180}
                  step={5}
                  value={kitchenPacingDraft.window_minutes}
                  onChange={(event) =>
                    setKitchenPacingDraft((current) => ({
                      ...current,
                      window_minutes: event.target.value
                    }))
                  }
                />

                <Input
                  label="Regular pace (covers)"
                  type="number"
                  min={1}
                  max={500}
                  value={kitchenPacingDraft.pace_covers_regular}
                  onChange={(event) =>
                    setKitchenPacingDraft((current) => ({
                      ...current,
                      pace_covers_regular: event.target.value
                    }))
                  }
                />

                <Input
                  label="Sunday pace (covers)"
                  type="number"
                  min={1}
                  max={500}
                  value={kitchenPacingDraft.pace_covers_sunday}
                  onChange={(event) =>
                    setKitchenPacingDraft((current) => ({
                      ...current,
                      pace_covers_sunday: event.target.value
                    }))
                  }
                />

                <Input
                  label="Regular walk-in reserve (covers)"
                  type="number"
                  min={0}
                  max={500}
                  value={kitchenPacingDraft.walk_in_reserve_regular}
                  onChange={(event) =>
                    setKitchenPacingDraft((current) => ({
                      ...current,
                      walk_in_reserve_regular: event.target.value
                    }))
                  }
                />

                <Input
                  label="Sunday walk-in reserve (covers)"
                  type="number"
                  min={0}
                  max={500}
                  value={kitchenPacingDraft.walk_in_reserve_sunday}
                  onChange={(event) =>
                    setKitchenPacingDraft((current) => ({
                      ...current,
                      walk_in_reserve_sunday: event.target.value
                    }))
                  }
                />
              </div>

              <p className="text-xs text-text-muted">
                Online ceiling per window (pace &minus; reserve):{' '}
                <span className="font-medium text-text">{kitchenCeilingRegular}</span> regular ·{' '}
                <span className="font-medium text-text">{kitchenCeilingSunday}</span> Sunday
              </p>

              <FormFooter>
                <Button
                  variant="primary"
                  onClick={() => { void saveKitchenPacing() }}
                  disabled={savingKitchenPacing}
                  loading={savingKitchenPacing}
                >
                  Save Kitchen Pacing Settings
                </Button>
              </FormFooter>
            </CardBody>
          )}
        </Card>

        {/* Existing tables */}
        <Card>
          <CardHeader
            title="Existing Tables"
            action={
              changedTableIds.length > 0 ? (
                <span className="text-xs font-medium text-warning-fg">
                  Unsaved table changes: {changedTableIds.length}
                </span>
              ) : undefined
            }
          />
          {loading ? (
            <PageLoading inline label="Loading table setup" />
          ) : setupLoadError ? (
            loadFailure('Could not load tables', setupLoadError, () => { void loadSetup() })
          ) : sortedTables.length === 0 ? (
            <Empty size="sm" title="No tables found" description="Add your first table below." />
          ) : (
            <>
              <CardBody className="pb-0">
                <p className="text-sm text-text-muted">
                  Configure table name, number, capacity, bookable state and area for each table.
                </p>
              </CardBody>
              <div className="divide-y divide-border">
                {sortedTables.map((table) => {
                  const draft = drafts[table.id]
                  if (!draft) return null

                  return (
                    <div key={table.id} className="px-pad-card py-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        <Input
                          label="Name"
                          type="text"
                          value={draft.name}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [table.id]: { ...current[table.id], name: event.target.value }
                            }))
                          }
                        />

                        <Input
                          label="Table number"
                          type="text"
                          value={draft.table_number}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [table.id]: { ...current[table.id], table_number: event.target.value }
                            }))
                          }
                        />

                        <Input
                          label="Capacity"
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
                        />

                        <Input
                          label="Area"
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
                        />

                        {/* Sits level with the fields beside it: bottom of the row, field height. */}
                        <div className="flex items-end">
                          <Checkbox
                            label="Bookable"
                            checked={draft.is_bookable}
                            onChange={(checked) =>
                              setDrafts((current) => ({
                                ...current,
                                [table.id]: { ...current[table.id], is_bookable: checked }
                              }))
                            }
                            className="h-input-h items-center"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <CardBody className="border-t border-border">
                <FormFooter>
                  <Button
                    variant="primary"
                    onClick={() => { void saveAllTableChanges() }}
                    disabled={savingTables || changedTableIds.length === 0}
                    loading={savingTables}
                  >
                    Save All Table Changes
                  </Button>
                </FormFooter>
              </CardBody>
            </>
          )}
        </Card>

        {/* Add table */}
        <Card>
          <CardHeader title="Add Table" />
          <CardBody>
            <form onSubmit={createTable} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Input
                label="Name"
                type="text"
                required
                value={newTable.name}
                onChange={(event) => setNewTable((c) => ({ ...c, name: event.target.value }))}
              />

              <Input
                label="Table number"
                type="text"
                required
                value={newTable.table_number}
                onChange={(event) => setNewTable((c) => ({ ...c, table_number: event.target.value }))}
              />

              <Input
                label="Capacity"
                type="number"
                min={1}
                max={100}
                required
                value={newTable.capacity}
                onChange={(event) => setNewTable((c) => ({ ...c, capacity: event.target.value }))}
              />

              <Input
                label="Area"
                type="text"
                list="table-area-options"
                value={newTable.area}
                onChange={(event) => setNewTable((c) => ({ ...c, area: event.target.value }))}
                placeholder="Main Bar"
              />

              <div className="flex items-end">
                <Checkbox
                  label="Bookable"
                  checked={newTable.is_bookable}
                  onChange={(checked) => setNewTable((c) => ({ ...c, is_bookable: checked }))}
                  className="h-input-h items-center"
                />
              </div>

              <FormFooter className="md:col-span-2 xl:col-span-5">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={creatingTable}
                  loading={creatingTable}
                >
                  Create Table
                </Button>
              </FormFooter>
            </form>
          </CardBody>
        </Card>

        {/* Join groups */}
        <Card>
          <CardHeader
            title="Table Join Groups"
            action={
              !editingGroup ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Icon name="plus" size={16} />}
                  onClick={() => {
                    setEditingGroup({ id: null, name: '', table_ids: [] })
                    setErrorMessage(null)
                  }}
                >
                  New Group
                </Button>
              ) : undefined
            }
          />
          <CardBody className={editingGroup ? 'space-y-4' : undefined}>
            <p className="text-sm text-text-muted">
              Tables in the same group can be booked together in any combination. The system automatically
              generates all valid multi-table options from each group.
            </p>

            {/* Edit / create form */}
            {editingGroup && (
              <Card variant="secondary">
                <CardHeader title={editingGroup.id ? 'Edit Group' : 'New Group'} />
                <CardBody className="space-y-4">
                  <Input
                    label="Group name"
                    type="text"
                    value={editingGroup.name}
                    onChange={(event) =>
                      setEditingGroup((current) =>
                        current ? { ...current, name: event.target.value } : null
                      )
                    }
                    placeholder="e.g. Dining Room"
                    className="max-w-xs"
                  />

                  <Field label="Tables in this group">
                    {loading ? (
                      <PageLoading inline label="Loading tables" />
                    ) : setupLoadError ? (
                      <Alert tone="danger" size="sm">Could not load the tables: {setupLoadError}</Alert>
                    ) : (
                      <div role="group" aria-label="Tables in this group" className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                        {sortedTables.map((table) => {
                          const checked = editingGroup.table_ids.includes(table.id)
                          return (
                            <Checkbox
                              key={table.id}
                              label={table.name || table.table_number}
                              description={table.area ?? undefined}
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
                              className="rounded-default border border-border bg-surface px-3 py-2"
                            />
                          )
                        })}
                      </div>
                    )}
                  </Field>

                  <FormFooter>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingGroup(null)
                        setErrorMessage(null)
                      }}
                      disabled={savingGroup}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => { void saveGroup() }}
                      disabled={savingGroup}
                      loading={savingGroup}
                    >
                      Save Group
                    </Button>
                  </FormFooter>
                </CardBody>
              </Card>
            )}
          </CardBody>

          {/* Group list */}
          {loadingGroups ? (
            <PageLoading inline label="Loading join groups" />
          ) : groupsLoadError ? (
            loadFailure('Could not load join groups', groupsLoadError, () => { void loadJoinGroups() })
          ) : joinGroups.length === 0 && !editingGroup ? (
            <Empty
              size="sm"
              title="No join groups yet"
              description="Create one to allow tables to be booked together."
            />
          ) : joinGroups.length === 0 ? null : (
            <div className="divide-y divide-border border-t border-border">
              {joinGroups.map((group) => {
                const groupTables = sortedTables.filter((t) => group.table_ids.includes(t.id))
                const pairCount = (group.table_ids.length * (group.table_ids.length - 1)) / 2

                return (
                  <div key={group.id} className="px-pad-card py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text">{group.name}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {groupTables.length > 0
                            ? groupTables.map((t) => t.name || t.table_number).join(' · ')
                            : 'No tables assigned'}
                        </p>
                        {group.table_ids.length >= 2 && (
                          <p className="mt-0.5 text-xs text-text-soft">
                            {group.table_ids.length} tables · {pairCount} pairs ·{' '}
                            {2 ** group.table_ids.length - group.table_ids.length - 1} multi-table combinations
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => {
                            setEditingGroup({
                              id: group.id,
                              name: group.name,
                              table_ids: [...group.table_ids]
                            })
                            setErrorMessage(null)
                          }}
                          disabled={!!editingGroup}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="xs"
                          onClick={() => setConfirmDeleteId(group.id)}
                          disabled={!!editingGroup || deletingGroupId === group.id}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <ConfirmDialog
          open={confirmDeleteGroup !== null}
          onClose={() => setConfirmDeleteId(null)}
          onConfirm={() => (confirmDeleteGroup ? deleteGroup(confirmDeleteGroup.id) : undefined)}
          tone="danger"
          title="Delete Join Group"
          message={confirmDeleteGroup ? `Delete the "${confirmDeleteGroup.name}" group?` : undefined}
          confirmLabel="Delete"
        />

        {/* Private booking area mapping */}
        <Card>
          <CardHeader title="Private Booking Area Mapping" />
          <CardBody>
            <p className="text-sm text-text-muted">
              Map private-booking spaces to table areas. During a mapped private booking, those table areas
              are blocked from table allocation.
            </p>
          </CardBody>
          {loading ? (
            <PageLoading inline label="Loading private-booking mappings" />
          ) : setupLoadError ? (
            loadFailure('Could not load private-booking mappings', setupLoadError, () => { void loadSetup() })
          ) : sortedAreas.length === 0 ? (
            <Empty size="sm" title="No table areas yet" description="Add at least one table area before mapping private-booking spaces." />
          ) : sortedVenueSpaces.length === 0 ? (
            <Empty size="sm" title="No private-booking spaces found" />
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {sortedVenueSpaces.map((space) => (
                <div key={space.id} className="px-pad-card py-3">
                  <div className="mb-2 flex items-center gap-2">
                    <p className="text-sm font-medium text-text">{space.name}</p>
                    {!space.active && (
                      <Badge tone={activeStateTone(false)} size="sm">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <div role="group" aria-label={`Table areas for ${space.name}`} className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {sortedAreas.map((area) => {
                      const key = spaceAreaKey(space.id, area.id)
                      return (
                        <Checkbox
                          key={key}
                          label={area.name}
                          checked={spaceAreaLinkKeys.has(key)}
                          onChange={() => toggleSpaceAreaLink(space.id, area.id)}
                          className="rounded-default border border-border bg-surface px-2.5 py-1.5"
                        />
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <CardBody className="border-t border-border">
            <FormFooter>
              <Button
                variant="primary"
                disabled={
                  savingSpaceAreaLinks ||
                  loading ||
                  setupLoadError !== null ||
                  sortedAreas.length === 0 ||
                  sortedVenueSpaces.length === 0
                }
                onClick={() => { void saveSpaceAreaLinks() }}
                loading={savingSpaceAreaLinks}
              >
                Save Private-Booking Area Mapping
              </Button>
            </FormFooter>
          </CardBody>
        </Card>
      </div>
    </Section>
  )
}
