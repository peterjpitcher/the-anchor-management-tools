'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, CardBody, PageLoading } from '@/ds'
import type { BusinessHours } from '@/types/business-hours'
import { getHoursVersionRows, type HoursVersionSummary } from '@/app/actions/business-hours'
import { BusinessHoursManager } from './BusinessHoursManager'
import { HoursVersionStrip } from './HoursVersionStrip'

interface WeeklyScheduleClientProps {
  canManage: boolean
  versions: HoursVersionSummary[]
  activeVersionId: string | null
  activeRows: BusinessHours[]
}

/**
 * The weekly schedule editor, wrapped in its version picker.
 *
 * The live version is editable in place, which is how this screen has always
 * worked. A future version is only editable while it is a draft: once published
 * it governs real bookings, so a correction means scheduling another change
 * rather than quietly rewriting one people have already been booked against.
 */
export function WeeklyScheduleClient({
  canManage,
  versions,
  activeVersionId,
  activeRows,
}: WeeklyScheduleClientProps) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(activeVersionId)
  const [rows, setRows] = useState<BusinessHours[]>(activeRows)
  const [loading, setLoading] = useState(false)
  // A version that fails to load is an error, never shown as a schedule with no days.
  const [loadError, setLoadError] = useState<string | null>(null)

  const selected = versions.find(v => v.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId || selectedId === activeVersionId) {
      setRows(activeRows)
      setLoadError(null)
      return
    }
    let live = true
    setLoading(true)
    setLoadError(null)
    getHoursVersionRows(selectedId)
      .then(result => {
        if (!live) return
        if (result.error) {
          setLoadError(result.error)
          setRows([])
        } else {
          setRows(result.data ?? [])
        }
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [selectedId, activeVersionId, activeRows])

  const refresh = useCallback(() => router.refresh(), [router])

  // Published means it is deciding bookings, whether or not its date has arrived.
  const isReadOnly = selected ? selected.status !== 'draft' && !selected.isActive : false

  return (
    <div>
      <HoursVersionStrip
        versions={versions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        canManage={canManage}
        onChanged={refresh}
      />

      {loading ? (
        <PageLoading inline label="Loading that schedule" />
      ) : loadError ? (
        <CardBody>
          <Alert tone="danger" title="Could not load that schedule">{loadError}</Alert>
        </CardBody>
      ) : rows.length === 0 ? (
        <CardBody>
          <Alert tone="warning">This schedule has no days set up.</Alert>
        </CardBody>
      ) : (
        <BusinessHoursManager
          canManage={canManage}
          initialHours={rows}
          draftVersionId={selected && selected.status === 'draft' ? selected.id : null}
          readOnly={isReadOnly}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
