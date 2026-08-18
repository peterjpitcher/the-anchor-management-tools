'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Card, CardHeader, CardBody } from '@/ds'
import { msUntilNextBoundary } from '@/lib/checklists/business-day'
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
  const identityChangedByUser = useRef(false)
  const [candidates, setCandidates] = useState<AttributionCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(() => new Set())
  const [boundaryReached, setBoundaryReached] = useState(false)
  const [rolledOver, setRolledOver] = useState(false)

  const businessDate = initial?.businessDate
  const startHour = initial?.businessDayStartHour
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
        if (res.data) {
          setCandidates(res.data)

          const latestClockIn = res.data.reduce<AttributionCandidate | null>((latest, candidate) => {
            if (!candidate.clockedInAt) return latest
            if (!latest?.clockedInAt || candidate.clockedInAt > latest.clockedInAt) return candidate
            return latest
          }, null)

          if (latestClockIn && !identityChangedByUser.current) {
            const next = { employeeId: latestClockIn.employeeId, name: latestClockIn.name }
            setIdentity(next)
            try {
              sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(next))
            } catch {
              /* sessionStorage unavailable, ignore */
            }
          }
        }
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
    identityChangedByUser.current = true
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

  // Roll the screen over at the business-day boundary.
  //
  // These iPads live on the bar and are rarely reloaded by hand. Without this the
  // fix would only move the stale-screen problem from midnight to 5am: at 05:01
  // the server has a new day's list and the tab is still showing last night's.
  const handleBusyChange = useCallback((taskId: string, busy: boolean) => {
    setBusyTaskIds(prev => {
      if (busy === prev.has(taskId)) return prev
      const next = new Set(prev)
      if (busy) next.add(taskId)
      else next.delete(taskId)
      return next
    })
  }, [])

  useEffect(() => {
    if (!startHour) return
    const delay = msUntilNextBoundary(new Date(), startHour)
    // A second's grace so the server has certainly crossed the boundary too.
    const timer = setTimeout(() => setBoundaryReached(true), delay + 1000)
    return () => clearTimeout(timer)
  }, [startHour, businessDate])

  useEffect(() => {
    if (!boundaryReached) return
    // Never yank the page out from under a tick that is still saving. If a write
    // hangs (lost signal on the bar wifi), give up waiting after 30 seconds
    // rather than stranding the screen on yesterday indefinitely.
    if (busyTaskIds.size === 0) {
      setBoundaryReached(false)
      setRolledOver(true)
      refresh()
      return
    }
    const giveUp = setTimeout(() => {
      setBoundaryReached(false)
      setRolledOver(true)
      refresh()
    }, 30_000)
    return () => clearTimeout(giveUp)
  }, [boundaryReached, busyTaskIds, refresh])

  // Clear the notice once the new day's data has actually landed.
  useEffect(() => {
    if (!rolledOver) return
    const clear = setTimeout(() => setRolledOver(false), 15_000)
    return () => clearTimeout(clear)
  }, [rolledOver, businessDate])

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

  // Done tasks are hidden by default; the toggle in the sticky bar reveals them
  // (that is also where a just-ticked task goes if you need to undo it).
  const allTasks = groups.flatMap((g) => g.tasks)
  const doneCount = allTasks.filter((t) => t.state === 'done').length
  const visibleGroups = groups
    .map((g) => ({
      ...g,
      tasks: showDone ? g.tasks : g.tasks.filter((t) => t.state !== 'done'),
    }))
    .filter((g) => g.tasks.length > 0)
  const allDone = groups.length > 0 && visibleGroups.length === 0 && !showDone

  const toDoCount = allTasks.length - doneCount

  return (
    // Same shell as the FOH vouchers screen: centred, capped at max-w-3xl, with
    // a row of count tiles at the top. Both are iPad screens used mid-shift.
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* Announced rather than shown as a toast: the screen may have been
          unattended for hours, so whoever picks it up next needs to see that the
          list moved on rather than wonder where last night's tasks went. */}
      <div aria-live="polite" role="status" className="sr-only">
        {rolledOver ? 'Moved on to today’s checklist.' : ''}
      </div>
      {rolledOver && (
        <Alert variant="info" title="Moved on to today&rsquo;s checklist">
          Last night&rsquo;s list has closed. This is today&rsquo;s.
        </Alert>
      )}
      {allTasks.length > 0 && (
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
            <dd className="text-3xl font-extrabold text-gray-900">{toDoCount}</dd>
            <dt className="mt-1 text-sm font-medium text-gray-600">To do</dt>
          </div>
          <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
            <dd className="text-3xl font-extrabold text-gray-900">{doneCount}</dd>
            <dt className="mt-1 text-sm font-medium text-gray-600">Done</dt>
          </div>
          <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
            <dd className="text-3xl font-extrabold text-gray-900">{allTasks.length}</dd>
            <dt className="mt-1 text-sm font-medium text-gray-600">Total</dt>
          </div>
        </dl>
      )}

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
        <div className="sticky top-0 z-20 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
          <AttributionPicker
            identity={identity}
            candidates={candidates}
            loading={candidatesLoading}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={chooseIdentity}
          />
          {doneCount > 0 && (
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2">
              <span className="text-xs text-text-muted">
                {doneCount} of {allTasks.length} done
              </span>
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-pressed={showDone}
                className="min-h-[44px] rounded-md px-3 py-2 text-sm font-medium text-primary hover:bg-surface-2"
              >
                {showDone ? 'Hide done' : `Show done (${doneCount})`}
              </button>
            </div>
          )}
        </div>
      )}

      {allDone && (
        <Alert variant="success" title="All done for now.">
          Every task that is due has been completed. New tasks appear when they are due.
        </Alert>
      )}

      {visibleGroups.map((group) => (
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
                onBusyChange={handleBusyChange}
              />
            ))}
          </CardBody>
        </Card>
      ))}

      {groups.length === 0 && !unavailable && generationStatus !== 'skipped_closed' && (
        <Alert variant="info" title="Nothing needs doing right now.">
          Tasks appear here when they are due.
        </Alert>
      )}
    </div>
  )
}
