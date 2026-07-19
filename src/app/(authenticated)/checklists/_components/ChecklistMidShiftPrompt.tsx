'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, Button } from '@/ds'
import { getDueChecklistPrompts, type DuePrompt } from '@/app/actions/checklists'

// Mid-shift prompt (spec 9.2). Mounted on the FOH screen. Polls the server every 60s for
// pending during-service checks whose window has opened. getDueChecklistPrompts() returns
// [] unless both module_enabled and prompts_enabled are on, so this component stays silent
// until the flags are switched on. It renders nothing when there is nothing to show, takes
// no required props, and never throws in render.

const DISMISSED_KEY = 'checklist-prompt-dismissed'
const POLL_MS = 60_000

// Dismissed instance ids, per device. sessionStorage scope: a dismissed id stays quiet
// until sessionStorage clears (tab/session end re-arms). A different pending instance still
// prompts because it carries a new id.
function readDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function writeDismissed(ids: Set<string>): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    /* sessionStorage unavailable, ignore */
  }
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
        const visible = res.data.filter((p) => !dismissed.has(p.id))
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

  function handleLater() {
    const dismissed = readDismissed()
    for (const p of prompts) dismissed.add(p.id)
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
      title="Checks are due"
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
      <p className="text-sm text-muted">These checks are due:</p>
      <ul className="mt-3 space-y-2">
        {prompts.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
            <span className="min-w-0 truncate text-sm font-medium text-text">{p.title}</span>
            <span className="shrink-0 text-xs text-muted">{p.slot}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
