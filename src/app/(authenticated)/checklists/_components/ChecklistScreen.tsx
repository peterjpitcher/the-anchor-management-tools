'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Card, CardHeader, CardBody } from '@/ds'
import { getAttributionCandidates } from '@/app/actions/checklists'
import type { TodayChecklistResult, AttributionCandidate } from '@/app/actions/checklists'
import { AttributionPicker, type Identity } from './AttributionPicker'
import { TaskRow } from './TaskRow'

const IDENTITY_KEY = 'checklist-identity'

function departmentLabel(dept: string): string {
  if (!dept) return ''
  return dept.charAt(0).toUpperCase() + dept.slice(1)
}

interface ChecklistScreenProps {
  initial?: TodayChecklistResult
  error?: string
}

export function ChecklistScreen({ initial, error }: ChecklistScreenProps) {
  const router = useRouter()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [candidates, setCandidates] = useState<AttributionCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const businessDate = initial?.businessDate
  // Department can vary per group. We seed the picker with the first group's
  // department: getAttributionCandidates returns every active employee, only the
  // clocked-in/rostered ordering is department-specific.
  const firstDept = initial?.groups[0]?.department

  // Restore the chosen identity on mount / reload.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(IDENTITY_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Identity
        if (parsed?.employeeId && parsed?.name) setIdentity(parsed)
      }
    } catch {
      /* sessionStorage unavailable, ignore */
    }
  }, [])

  // Load attribution candidates once there is a date and a department.
  useEffect(() => {
    if (!businessDate || !firstDept) return
    let active = true
    setCandidatesLoading(true)
    getAttributionCandidates({ date: businessDate, department: firstDept })
      .then((res) => {
        if (!active) return
        if (res.data) setCandidates(res.data)
        setCandidatesLoading(false)
      })
      .catch(() => {
        if (active) setCandidatesLoading(false)
      })
    return () => {
      active = false
    }
  }, [businessDate, firstDept])

  const chooseIdentity = useCallback((next: Identity) => {
    setIdentity(next)
    try {
      sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(next))
    } catch {
      /* sessionStorage unavailable, ignore */
    }
    setPickerOpen(false)
  }, [])

  const refresh = useCallback(() => {
    router.refresh()
  }, [router])

  const needIdentity = useCallback(() => {
    setPickerOpen(true)
  }, [])

  if (error) {
    return (
      <Alert variant="danger" title="Could not load the checklist">
        {error}. Please use the paper list and tell Peter.
      </Alert>
    )
  }
  if (!initial) {
    return (
      <Alert variant="danger" title="Could not load the checklist">
        Please use the paper list and tell Peter.
      </Alert>
    )
  }
  if (!initial.moduleEnabled) {
    return (
      <Alert variant="info" title="Checklists are not switched on yet.">
        There is nothing to do here for now.
      </Alert>
    )
  }

  const { generationStatus, groups } = initial
  const unavailable = generationStatus === 'none' || generationStatus === 'failed'

  return (
    <div className="space-y-4">
      {unavailable && (
        <Alert variant="warning" title="Today's checklist is not available">
          Please use the paper list and tell Peter.
        </Alert>
      )}
      {generationStatus === 'skipped_closed' && (
        <Alert variant="info" title="Closed today, no checklist.">
          There is nothing to complete today.
        </Alert>
      )}
      {generationStatus === 'running' && (
        <Alert variant="info" title="Today's checklist is being prepared.">
          Refresh in a moment if a task is missing.
        </Alert>
      )}

      {groups.length > 0 && (
        <div className="sticky top-0 z-20 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
          <AttributionPicker
            identity={identity}
            candidates={candidates}
            loading={candidatesLoading}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={chooseIdentity}
          />
        </div>
      )}

      {groups.map((group) => (
        <Card key={group.checklistId}>
          <CardHeader title={group.checklistName} subtitle={departmentLabel(group.department)} />
          <CardBody className="space-y-2">
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                identity={identity}
                onChanged={refresh}
                onNeedIdentity={needIdentity}
              />
            ))}
          </CardBody>
        </Card>
      ))}

      {groups.length === 0 && !unavailable && generationStatus !== 'skipped_closed' && (
        <Alert variant="info" title="No tasks for today.">
          There is nothing to complete right now.
        </Alert>
      )}
    </div>
  )
}
