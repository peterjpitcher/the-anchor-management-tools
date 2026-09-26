'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { addEmployeeNote } from '@/app/actions/employeeActions'
import type { NoteFormState } from '@/types/actions'
import { Alert, Button, FormFooter, Textarea, toast } from '@/ds'

interface AddEmployeeNoteFormProps {
  employeeId: string
}

function SubmitNoteButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? 'Adding Note...' : 'Add Note'}
    </Button>
  )
}

export default function AddEmployeeNoteForm({ employeeId }: AddEmployeeNoteFormProps) {
  const router = useRouter()
  const initialState: NoteFormState = null
  const [state, dispatch] = useActionState(addEmployeeNote, initialState)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.type === 'success') {
      formRef.current?.reset()
      router.refresh()
    }

    if (state?.type === 'error' && state.message && !state.errors?.note_text) {
      toast.error(state.message)
    }
  }, [state, router])

  return (
    <form action={dispatch} ref={formRef} className="space-y-3">
      <Textarea
        rows={3}
        name="note_text"
        id="note_text"
        aria-label="Add a note"
        placeholder="Add a time-stamped note..."
        defaultValue=""
        error={state?.errors?.note_text?.join(' ') || undefined}
      />

      <input type="hidden" name="employee_id" value={employeeId} />

      {state?.errors?.general && (
        <Alert tone="danger" size="sm">{state.errors.general.join(' ')}</Alert>
      )}
      {state?.type === 'error' && state.message && !state.errors && (
        <Alert tone="danger" size="sm">{state.message}</Alert>
      )}

      <FormFooter start={<span className="text-xs">Notes are permanently recorded with a timestamp.</span>}>
        <SubmitNoteButton />
      </FormFooter>
    </form>
  )
}
