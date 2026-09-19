'use client'

import { useState } from 'react'
import { Dialog, DialogPanel, DialogTitle, Description } from '@headlessui/react'
import type { NavGroup } from './SidebarNav'

interface ShortcutPickerProps {
  /** Already filtered for the current user's permissions. */
  navGroups: NavGroup[]
  shortcutIds: string[]
  onChange: (ids: string[]) => void
  onOpenChange?: (open: boolean) => void
}

export function ShortcutPicker({ navGroups, shortcutIds, onChange, onOpenChange }: ShortcutPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const changeOpen = (value: boolean) => { setOpen(value); onOpenChange?.(value) }
  const allowedIds = new Set(navGroups.flatMap(group => group.items.map(item => item.id)))
  const selected = [...new Set(shortcutIds)].filter(id => allowedIds.has(id)).slice(0, 4)

  return (
    <>
      <button type="button" onClick={() => changeOpen(true)} className="rounded-default px-2 py-1 text-xs text-text-muted hover:bg-surface-hover focus-visible:outline-primary">
        Choose shortcuts
      </button>
      <Dialog open={open} onClose={changeOpen} className="relative z-50">
        <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-lg border border-border bg-surface p-4 text-text shadow-lg">
            <DialogTitle className="text-base font-semibold">Choose shortcuts</DialogTitle>
            <Description className="mt-1 text-xs text-text-muted">Choose up to four destinations. Changes are saved on this browser.</Description>
            <div className="mt-3 overflow-y-auto">
              {navGroups.map((group, index) => (
                <fieldset key={group.label ?? index} className="mb-2">
                  {group.label && <legend className="mb-1 text-xs font-semibold text-text-muted">{group.label}</legend>}
                  {group.items.map(item => (
                    <label key={item.id} className="flex min-h-8 items-center gap-2 rounded-default px-1 text-sm hover:bg-surface-hover">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={selected.includes(item.id)}
                        disabled={selected.length >= 4 && !selected.includes(item.id)}
                        onChange={event => onChange(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))}
                      />
                      {item.label}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
              <button type="button" onClick={() => onChange([])} className="rounded-default px-2 py-1 text-sm hover:bg-surface-hover">Use default shortcuts</button>
              <button type="button" onClick={() => changeOpen(false)} className="rounded-default bg-primary px-3 py-1 text-sm text-primary-fg">Done</button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
