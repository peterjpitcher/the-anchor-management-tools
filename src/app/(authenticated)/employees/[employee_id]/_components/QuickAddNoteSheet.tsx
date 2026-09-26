'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addEmployeeNote } from '@/app/actions/employeeActions'
import type { NoteFormState } from '@/types/actions'
import { Button, FormFooter, Icon, Modal, Textarea, toast } from '@/ds'

interface QuickAddNoteSheetProps {
  employeeId: string
  className?: string
}

/**
 * Fast path for adding an employee note on a phone: a prominent button that opens a bottom-sheet
 * composer, so a note can be added from the top of the page without scrolling down to the Notes
 * card. Uses the same addEmployeeNote server action.
 */
export function QuickAddNoteSheet({ employeeId, className }: QuickAddNoteSheetProps): React.JSX.Element {
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
        icon={<Icon name="plus" size={16} />}
        className={className}
      >
        Add Note
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Note">
        <form ref={formRef} action={dispatch} className="space-y-4">
          <input type="hidden" name="employee_id" value={employeeId} />
          <Textarea
            id="quick-note-text"
            name="note_text"
            label="Note"
            rows={4}
            placeholder="Add a time-stamped note..."
            error={state?.errors?.note_text?.join(' ') || undefined}
            autoFocus
          />
          <FormFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isPending}>
              Save Note
            </Button>
          </FormFooter>
        </form>
      </Modal>
    </>
  )
}
