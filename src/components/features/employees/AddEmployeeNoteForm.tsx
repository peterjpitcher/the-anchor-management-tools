'use client'

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { addEmployeeNote } from '@/app/actions/employeeActions'
import type { NoteFormState } from '@/types/actions'
import { Alert, Button, FormFooter, Textarea, toast } from '@/ds'

interface AddEmployeeNoteFormProps {
  employeeId: string
}

export default function AddEmployeeNoteForm({ employeeId }: AddEmployeeNoteFormProps) {
  const router = useRouter()
  const initialState: NoteFormState = null
  const [state, dispatch, pending] = useActionState(addEmployeeNote, initialState)
  const formRef = useRef<HTMLFormElement>(null)
  const handledState = useRef<NoteFormState>(null)

  useEffect(() => {
    if (!state || handledState.current === state) return
    handledState.current = state

    if (state.type === 'success') {
      formRef.current?.reset()
      router.refresh()
    }

    if (state.type === 'error' && state.message && !state.errors?.note_text) {
      toast.error(state.message)
    }
  }, [state, router])

  // onSubmit rather than a form action: a React 19 form action clears the box on every submit,
  // so a refused note was lost. The box is cleared above only once the note has saved.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(() => dispatch(formData))
  }

  return (
    <form onSubmit={handleSubmit} ref={formRef} className="space-y-3">
      <Textarea
        rows={3}
        name="note_text"
        id="note_text"
        aria-label="Add a note"
        placeholder="Add a note..."
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

      <FormFooter start={<span className="text-xs">Each note is kept with the date and time it was added and who added it.</span>}>
        <Button type="submit" variant="primary" loading={pending}>
          Add Note
        </Button>
      </FormFooter>
    </form>
  )
}
