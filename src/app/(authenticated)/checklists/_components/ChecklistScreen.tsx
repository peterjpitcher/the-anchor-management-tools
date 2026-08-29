'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Card, CardHeader, CardBody } from '@/ds'
import {
  hourLabel,
  londonClockLabel,
  msUntilNextRefresh,
  type RefreshReason,
} from '@/lib/checklists/business-day'
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
  // The instant this screen's content goes stale, and why. Null until the first payload.
  const [refreshDueAt, setRefreshDueAt] = useState<number | null>(null)
  const [refreshReason, setRefreshReason] = useState<RefreshReason>('boundary')
  const [refreshDue, setRefreshDue] = useState(false)
  const [notice, setNotice] = useState<RefreshReason | null>(null)
  const lastRefreshAt = useRef(0)

  const businessDate = initial?.businessDate
  const startHour = initial?.businessDayStartHour
  const nextWindowStart = initial?.nextWindowStart ?? null
  const hiddenCount = initial?.hiddenCount ?? 0
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

  const handleBusyChange = useCallback((taskId: string, busy: boolean) => {
    setBusyTaskIds(prev => {
      if (busy === prev.has(taskId)) return prev
      const next = new Set(prev)
      if (busy) next.add(taskId)
      else next.delete(taskId)
      return next
    })
  }, [])

  // Work out when this screen's content next changes, and why.
  //
  // The list the server sent is a snapshot: tasks whose window has not opened yet were
  // withheld. Two things make it stale, the next window opening and the day rolling over
  // at 05:00, and the payload tells us when both are. These iPads live on the bar, are
  // rarely reloaded by hand and are often left on one tab for hours, so the screen has to
  // notice on its own. It previously only refetched when someone ticked something, which
  // meant a tab last touched before 21:00 never showed the closing list at all: everything
  // on it was done, so there was nothing left to tick, so nothing ever refetched.
  useEffect(() => {
    if (!startHour) {
      setRefreshDueAt(null)
      return
    }
    const { ms, reason } = msUntilNextRefresh(new Date(), nextWindowStart, startHour)
    // A second's grace so the server has certainly crossed the same line.
    setRefreshDueAt(Date.now() + ms + 1000)
    setRefreshReason(reason)
  }, [startHour, businessDate, nextWindowStart])

  const checkRefreshDue = useCallback(() => {
    if (refreshDueAt == null) return
    if (Date.now() < refreshDueAt) return
    // A floor against a refresh storm if a payload ever came back with a deadline that is
    // already past. The deadline is otherwise always in the future, so a second pass for
    // the same boundary is not reachable.
    if (Date.now() - lastRefreshAt.current < 10_000) return
    setRefreshDue(true)
  }, [refreshDueAt])

  // Three ways to notice, all landing on the same guarded check:
  //  - a timer armed at the deadline: exactly one wake-up per boundary, no idle network,
  //  - visibilitychange and pageshow: recovers a tab iPadOS suspended or bfcached through
  //    the deadline, where the timer never fired,
  //  - a 60s heartbeat that only compares two numbers: the safety net for Safari throttling
  //    a long timer to death. It costs no network and no database work, which is why this
  //    is not a polling refresh.
  useEffect(() => {
    if (refreshDueAt == null) return

    const timer = setTimeout(checkRefreshDue, Math.max(0, refreshDueAt - Date.now()))
    const heartbeat = setInterval(checkRefreshDue, 60_000)
    const onWake = () => {
      if (document.visibilityState === 'visible') checkRefreshDue()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('pageshow', onWake)

    return () => {
      clearTimeout(timer)
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('pageshow', onWake)
    }
  }, [refreshDueAt, checkRefreshDue])

  useEffect(() => {
    if (!refreshDue) return
    // Never yank the page out from under a tick that is still saving. If a write
    // hangs (lost signal on the bar wifi), give up waiting after 30 seconds
    // rather than stranding the screen on a stale list indefinitely.
    const go = () => {
      lastRefreshAt.current = Date.now()
      setRefreshDue(false)
      setNotice(refreshReason)
      refresh()
    }
    if (busyTaskIds.size === 0) {
      go()
      return
    }
    const giveUp = setTimeout(go, 30_000)
    return () => clearTimeout(giveUp)
  }, [refreshDue, refreshReason, busyTaskIds, refresh])

  // Clear the notice once the new data has actually landed.
  useEffect(() => {
    if (!notice) return
    const clear = setTimeout(() => setNotice(null), 15_000)
    return () => clearTimeout(clear)
  }, [notice, businessDate, hiddenCount])

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

  // When the next batch lands, in the words staff use: "9pm", "9:30pm".
  const nextWindowLabel = nextWindowStart ? londonClockLabel(new Date(nextWindowStart)) : null
  const dayEndsLabel = hourLabel(startHour ?? 5)
  // Only promise that the screen updates itself when it actually will.
  const comingLater =
    nextWindowLabel && hiddenCount > 0
      ? `${hiddenCount === 1 ? 'One more task appears' : `${hiddenCount} more tasks appear`} at ${nextWindowLabel}. Leave this screen open and it will update on its own.`
      : `Nothing else is due before ${dayEndsLabel}.`

  return (
    // Same shell as the FOH vouchers screen: centred, capped at max-w-3xl, with
    // a row of count tiles at the top. Both are iPad screens used mid-shift.
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* Announced rather than shown as a toast: the screen may have been
          unattended for hours, so whoever picks it up next needs to see that the
          list moved on rather than wonder where last night's tasks went. */}
      <div aria-live="polite" role="status" className="sr-only">
        {notice === 'boundary' ? 'Moved on to today’s checklist.' : ''}
        {notice === 'window' ? 'New tasks have just appeared.' : ''}
      </div>
      {notice === 'boundary' && (
        <Alert variant="info" title="Moved on to today&rsquo;s checklist">
          Last night&rsquo;s list has closed. This is today&rsquo;s.
        </Alert>
      )}
      {notice === 'window' && (
        <Alert variant="info" title="New tasks have just appeared">
          They have been added to the list below.
        </Alert>
      )}
      {allTasks.length > 0 && (
        <>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
              <dd className="text-3xl font-extrabold text-gray-900">{toDoCount}</dd>
              <dt className="mt-1 text-sm font-medium text-gray-600">To do</dt>
            </div>
            <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
              <dd className="text-3xl font-extrabold text-gray-900">{doneCount}</dd>
              <dt className="mt-1 text-sm font-medium text-gray-600">Done</dt>
            </div>
            {/* Deliberately not labelled "Total": this counts what is showing, and more
                tasks arrive later in the day. It read "Total 28" on a 50 task day. */}
            <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
              <dd className="text-3xl font-extrabold text-gray-900">{allTasks.length}</dd>
              <dt className="mt-1 text-sm font-medium text-gray-600">Showing</dt>
            </div>
          </dl>
          {/* Suppressed when everything is ticked, because the all-done alert below says
              the same thing more fully. */}
          {hiddenCount > 0 && nextWindowLabel && !allDone && (
            <p className="text-center text-sm text-text-muted">
              {hiddenCount === 1 ? 'One more task appears' : `${hiddenCount} more tasks appear`} at{' '}
              {nextWindowLabel}.
            </p>
          )}
        </>
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
          Everything due so far is ticked off. {comingLater}
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
          {nextWindowLabel && hiddenCount > 0
            ? `The first tasks appear at ${nextWindowLabel}. Leave this screen open and it will update on its own.`
            : `There is nothing else due before ${dayEndsLabel}.`}
        </Alert>
      )}
    </div>
  )
}
