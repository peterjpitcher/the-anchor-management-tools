'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, Button } from '@/ds'
import { getDueChecklistPrompts, type DuePrompt } from '@/app/actions/checklists'

// Mid-shift prompt (spec 9.2). Mounted on the FOH screen. Polls the server every 60s for
// pending checks whose window has opened. getDueChecklistPrompts() returns [] unless both
// module_enabled and prompts_enabled are on, so this component stays silent until the flags
// are switched on. It renders nothing when there is nothing to show, takes no required
// props, and never throws in render.
//
// Closing tasks prompt here too. They used to be excluded along with open and anytime, which
// left the closedown as the one thing nothing in the product ever chased: the last nudge of
// the night landed at 20:00 and whole closing lists went unticked. The server holds them
// back until half an hour before close, so this only interrupts service at the point it
// matters.

const DISMISSED_KEY = 'checklist-prompt-dismissed'
const POLL_MS = 60_000

// How long "Later" silences the closing prompt before it asks again. A closedown is the one
// thing worth being a nuisance about, and the FOH iPad's sessionStorage effectively never
// clears, so a permanent dismissal there would silence it for the whole night.
const CLOSE_SNOOZE_MS = 30 * 60 * 1000

// Dismissed instance ids, per device, mapped to the epoch millisecond they wake up again.
// 0 means never, which is the original session-scoped behaviour and stays the default for
// during-service checks. sessionStorage scope: a dismissal lasts until sessionStorage clears
// (tab/session end re-arms). A different pending instance still prompts, it carries a new id.
function readDismissed(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    // Legacy shape: a plain array of ids, all of them permanent.
    if (Array.isArray(parsed)) {
      return Object.fromEntries((parsed as string[]).map((id) => [id, 0]))
    }
    if (parsed && typeof parsed === 'object') return parsed as Record<string, number>
    return {}
  } catch {
    return {}
  }
}

function writeDismissed(entries: Record<string, number>): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(entries))
  } catch {
    /* sessionStorage unavailable, ignore */
  }
}

/** Still silenced? Permanent (0) always is; a snoozed one wakes up once its time passes. */
function isDismissed(entries: Record<string, number>, id: string): boolean {
  const until = entries[id]
  if (until === undefined) return false
  if (until === 0) return true
  return Date.now() < until
}

// The guard defers opening: never steal focus while the user is typing/booking or the tab
// is hidden. It only blocks opening; an already-open modal stays open.
function isGuarded(): boolean {
  if (typeof document === 'undefined') return true
  if (document.visibilityState !== 'visible') return true
  const el = document.activeElement as HTMLElement | null
  if (el) {
    const tag = el.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (el.isContentEditable) return true
  }
  return false
}

export function ChecklistMidShiftPrompt() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [prompts, setPrompts] = useState<DuePrompt[]>([])
  const openRef = useRef(false)

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await getDueChecklistPrompts()
        if (cancelled) return
        if (res.error || !res.data) return
        const dismissed = readDismissed()
        const visible = res.data.filter((p) => !isDismissed(dismissed, p.id))
        setPrompts(visible)
        if (visible.length === 0) {
          // Nothing owed (or everything completed on another device): close the modal.
          setOpen(false)
          return
        }
        // Defer opening while typing/hidden; keep the prompt owed and retry next tick.
        if (!openRef.current && isGuarded()) return
        setOpen(true)
      } catch {
        /* swallow: never throw from the polling loop */
      }
    }

    check()
    const id = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const closePrompts = prompts.filter((p) => p.slot === 'close')
  const otherPrompts = prompts.filter((p) => p.slot !== 'close')
  const closingOnly = closePrompts.length > 0 && otherPrompts.length === 0

  function handleLater() {
    const dismissed = readDismissed()
    const snoozeUntil = Date.now() + CLOSE_SNOOZE_MS
    for (const p of prompts) {
      dismissed[p.id] = p.slot === 'close' ? snoozeUntil : 0
    }
    writeDismissed(dismissed)
    setOpen(false)
  }

  function handleOpenChecklist() {
    setOpen(false)
    router.push('/checklists')
  }

  if (!open || prompts.length === 0) return null

  return (
    <Modal
      open={open}
      onClose={handleLater}
      title={closingOnly ? 'Time to start closing' : 'Checks are due'}
      footer={
        <>
          <Button variant="ghost" onClick={handleLater}>
            Later
          </Button>
          <Button variant="primary" onClick={handleOpenChecklist}>
            Open checklist
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">
        {closingOnly ? 'The closing checklist is open:' : 'These checks are due:'}
      </p>
      <ul className="mt-3 space-y-2">
        {/* The closing list is 22 tasks. One line for the lot, rather than a modal that
            needs scrolling before anyone can act on it. */}
        {closePrompts.length > 0 && (
          <li className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
            <span className="min-w-0 truncate text-sm font-medium text-text">
              Closing checklist
            </span>
            <span className="shrink-0 text-xs text-text-muted">
              {closePrompts.length} {closePrompts.length === 1 ? 'task' : 'tasks'}
            </span>
          </li>
        )}
        {otherPrompts.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
            <span className="min-w-0 truncate text-sm font-medium text-text">{p.title}</span>
            <span className="shrink-0 text-xs text-text-muted">{p.slot}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
