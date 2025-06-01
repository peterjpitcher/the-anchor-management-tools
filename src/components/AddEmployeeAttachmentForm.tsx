'use client'

import { useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { addEmployeeAttachment, type AttachmentFormState } from '@/app/actions/employeeActions';
import { supabase } from '@/lib/supabase'; // For fetching categories client-side
import type { AttachmentCategory } from '@/types/database';

interface AddEmployeeAttachmentFormProps {
  employeeId: string;
}

function SubmitAttachmentButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-50"
    >
      {pending ? 'Uploading...' : 'Upload Attachment'}
    </button>
  );
}

export default function AddEmployeeAttachmentForm({ employeeId }: AddEmployeeAttachmentFormProps) {
  const addAttachmentWithEmployeeId = addEmployeeAttachment.bind(null, employeeId);
  const initialState: AttachmentFormState = null;
  const [state, dispatch] = useActionState(addAttachmentWithEmployeeId, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); 

  const [categories, setCategories] = useState<AttachmentCategory[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);

  useEffect(() => {
    async function fetchCategories() {
      setIsLoadingCategories(true);
      const { data, error } = await supabase.from('attachment_categories').select('*').order('category_name');
      if (error) {
        console.error('Error fetching attachment categories:', error);
        // Potentially set an error state to display to the user
      } else {
        setCategories(data || []);
      }
      setIsLoadingCategories(false);
    }
    fetchCategories();
  }, []);

  useEffect(() => {
    if (state?.type === 'success') {
      formRef.current?.reset();
      if (fileInputRef.current) fileInputRef.current.value = ''; // Explicitly clear file input
      // Consider toast notification for success
    }
    // Error messages are displayed inline via state.errors
  }, [state]);

  return (
    <form action={dispatch} ref={formRef} className="space-y-6 mt-4 border-t border-gray-200 pt-6">
      <div>
        <label htmlFor="attachment_file" className="block text-sm font-medium leading-6 text-gray-900">
          File
        </label>
        <div className="mt-2">
          <input
            id="attachment_file"
            name="attachment_file"
            type="file"
            ref={fileInputRef}
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-l-lg file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
          />
        </div>
        {state?.errors?.file && <p className="mt-1 text-sm text-red-600">{state.errors.file}</p>}
      </div>

      <div>
        <label htmlFor="category_id" className="block text-sm font-medium leading-6 text-gray-900">
          Category
        </label>
        {isLoadingCategories ? (
          <p className="text-sm text-gray-500 mt-2">Loading categories...</p>
        ) : (
          <select
            id="category_id"
            name="category_id"
            className="mt-2 block w-full rounded-md border-0 py-1.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-orange-600 sm:text-sm sm:leading-6"
            defaultValue=""
          >
            <option value="" disabled>Select a category</option>
            {categories.map(cat => (
              <option key={cat.category_id} value={cat.category_id}>{cat.category_name}</option>
            ))}
          </select>
        )}
        {state?.errors?.category_id && <p className="mt-1 text-sm text-red-600">{state.errors.category_id}</p>}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium leading-6 text-gray-900">
          Description (Optional)
        </label>
        <div className="mt-2">
          <textarea
            id="description"
            name="description"
            rows={2}
            className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-orange-600 sm:text-sm sm:leading-6"
            defaultValue=""
          />
        </div>
        {state?.errors?.description && <p className="mt-1 text-sm text-red-600">{state.errors.description}</p>}
      </div>

      {state?.type === 'error' && state.errors?.general && (
        <p className="mt-1 text-sm text-red-600">{state.errors.general}</p>
      )}
      {state?.type === 'error' && state.message && !state.errors && (
        <p className="mt-1 text-sm text-red-600">{state.message}</p>
      )}

      <div className="flex justify-end">
        <SubmitAttachmentButton />
      </div>
    </form>
  );
} 