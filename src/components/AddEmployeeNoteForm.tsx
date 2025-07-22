'use client'

import { useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { addEmployeeNote } from '@/app/actions/employeeActions';
import type { NoteFormState } from '@/types/actions';
import { createClient } from '@/lib/supabase/client'; 
import type { User } from '@supabase/supabase-js';
import { Button } from '@/components/ui-v2/forms/Button';
import { Textarea } from '@/components/ui-v2/forms/Textarea';

interface AddEmployeeNoteFormProps {
  employeeId: string;
  // currentUser: User | null; // No longer passed as prop, will be fetched
}

function SubmitNoteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" disabled={pending}>
      {pending ? 'Adding Note...' : 'Add Note'}
    </Button>
  );
}

export default function AddEmployeeNoteForm({ employeeId }: AddEmployeeNoteFormProps) {
  const supabase = createClient(); // Create client instance
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const initialState: NoteFormState = null;
  const [state, dispatch] = useActionState(addEmployeeNote, initialState);
  const formRef = useRef<HTMLFormElement>(null); // To reset the form

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    getUser();
  }, [supabase]);

  useEffect(() => {
    if (state?.type === 'success') {
      formRef.current?.reset(); // Reset form fields
      // Optionally show a success toast message
      // e.g. toast.success(state.message)
    }
    if (state?.type === 'error' && state.message && !state.errors?.general && !state.errors?.note_text) {
        // General errors not tied to a field
        alert(`Error: ${state.message}`); // simple alert for now
    }
  }, [state]);

  return (
    <form action={dispatch} ref={formRef} className="mt-4">
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
      
      {/* Hidden fields */}
      <input type="hidden" name="employee_id" value={employeeId} />
      {currentUser?.id && (
        <input type="hidden" name="created_by_user_id" value={currentUser.id} />
      )}

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
  );
} 