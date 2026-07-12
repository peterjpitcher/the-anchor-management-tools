'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addEmployeeNote } from '@/app/actions/employeeActions'
import type { NoteFormState } from '@/types/actions'
import { Modal, Button, Textarea, toast } from '@/ds'
import { PlusIcon } from '@heroicons/react/24/outline'

interface QuickAddNoteSheetProps {
  employeeId: string
  className?: string
}

/**
 * Fast path for adding an employee note on mobile: a prominent button that opens a
 * bottom-sheet composer, so a note can be added from the top of the page without
 * scrolling down to the Notes section. Uses the same addEmployeeNote server action.
 */
export function QuickAddNoteSheet({ employeeId, className }: QuickAddNoteSheetProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const initialState: NoteFormState = null
  const [state, dispatch, isPending] = useActionState(addEmployeeNote, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.type === 'success') {
      formRef.current?.reset()
      setOpen(false)
      router.refresh()
      toast.success('Note added')
    } else if (state?.type === 'error' && state.message && !state.errors?.note_text) {
      toast.error(state.message)
    }
  }, [state, router])

  return (
    <>
      <Button
        type="button"
        variant="primary"
        onClick={() => setOpen(true)}
        icon={<PlusIcon className="h-4 w-4" />}
        className={className}
      >
        Add note
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add note">
        <form ref={formRef} action={dispatch} className="space-y-4">
          <input type="hidden" name="employee_id" value={employeeId} />
          <div>
            <label htmlFor="quick-note-text" className="sr-only">Note</label>
            <Textarea
              id="quick-note-text"
              name="note_text"
              rows={4}
              placeholder="Add a time-stamped note..."
              error={!!state?.errors?.note_text}
              fullWidth
              autoFocus
            />
            {state?.errors?.note_text && (
              <p className="mt-1 text-sm text-red-600">{state.errors.note_text}</p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={isPending} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={isPending} className="w-full sm:w-auto">
              Save note
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
