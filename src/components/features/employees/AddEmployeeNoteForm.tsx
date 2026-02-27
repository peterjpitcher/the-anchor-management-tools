'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { addEmployeeNote } from '@/app/actions/employeeActions'
import type { NoteFormState } from '@/types/actions'
import { Button } from '@/components/ui-v2/forms/Button'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { toast } from '@/components/ui-v2/feedback/Toast'

interface AddEmployeeNoteFormProps {
  employeeId: string
}

function SubmitNoteButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primary" size="md" disabled={pending}>
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
    <form action={dispatch} ref={formRef}>
      <div>
        <label htmlFor="note_text" className="sr-only">
          Add a note
        </label>
        <Textarea
          rows={3}
          name="note_text"
          id="note_text"
          placeholder="Add a time-stamped note..."
          defaultValue=""
          error={!!state?.errors?.note_text}
          fullWidth
        />
        {state?.errors?.note_text && (
          <p className="mt-1 text-sm text-red-600">{state.errors.note_text}</p>
        )}
      </div>

      <input type="hidden" name="employee_id" value={employeeId} />

      {state?.errors?.general && (
        <p className="mt-2 text-sm text-red-600">{state.errors.general}</p>
      )}
      {state?.type === 'error' && state.message && !state.errors && (
        <p className="mt-2 text-sm text-red-600">{state.message}</p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Notes are permanently recorded with a timestamp.
        </span>
        <SubmitNoteButton />
      </div>
    </form>
  )
}
