'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Alert } from '@/ds'
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

  const selected = versions.find(v => v.id === selectedId) ?? null

  useEffect(() => {
    if (!selectedId || selectedId === activeVersionId) {
      setRows(activeRows)
      return
    }
    let live = true
    setLoading(true)
    getHoursVersionRows(selectedId)
      .then(result => {
        if (!live) return
        if (result.error) {
          toast.error(result.error)
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
        <p className="p-4 text-sm text-gray-600">Loading that schedule...</p>
      ) : rows.length === 0 ? (
        <div className="p-4">
          <Alert variant="warning">This schedule has no days set up.</Alert>
        </div>
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
