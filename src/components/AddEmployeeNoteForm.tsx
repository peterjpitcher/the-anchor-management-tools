'use client'

import { useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { addEmployeeNote, type NoteFormState } from '@/app/actions/employeeActions';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'; 
import type { User } from '@supabase/supabase-js';

interface AddEmployeeNoteFormProps {
  employeeId: string;
  // currentUser: User | null; // No longer passed as prop, will be fetched
}

function SubmitNoteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-emphasis focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
    >
      {pending ? 'Adding Note...' : 'Add Note'}
    </button>
  );
}

export default function AddEmployeeNoteForm({ employeeId }: AddEmployeeNoteFormProps) {
  const supabase = createClientComponentClient(); // Create client instance
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const addNoteWithEmployeeId = addEmployeeNote.bind(null, employeeId);
  const initialState: NoteFormState = null;
  const [state, dispatch] = useActionState(addNoteWithEmployeeId, initialState);
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
        <textarea
          rows={3}
          name="note_text"
          id="note_text"
          className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
          placeholder="Add a time-stamped note..."
          defaultValue=""
        />
        {state?.errors?.note_text && (
          <p className="mt-1 text-sm text-red-600">{state.errors.note_text}</p>
        )}
      </div>
      
      {/* Hidden field for created_by_user_id */}
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