'use client'

import { useEffect, useRef, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { addEmployeeAttachment } from '@/app/actions/employeeActions';
import type { AttachmentFormState } from '@/types/actions';
import { useSupabase } from '@/components/providers/SupabaseProvider';
import type { AttachmentCategory } from '@/types/database';
import { Button } from '@/components/ui-v2/forms/Button';

interface AddEmployeeAttachmentFormProps {
  employeeId: string;
  onSuccess?: () => void;
}

function SubmitAttachmentButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" disabled={pending}>
      {pending ? 'Uploading...' : 'Upload Attachment'}
    </Button>
  );
}

export default function AddEmployeeAttachmentForm({ employeeId, onSuccess }: AddEmployeeAttachmentFormProps) {
  const initialState: AttachmentFormState = null;
  const [state, dispatch] = useActionState(addEmployeeAttachment, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = useSupabase();

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
  }, [supabase]);

  useEffect(() => {
    if (state?.type === 'success' && state.message) {
      formRef.current?.reset();
      if (fileInputRef.current) fileInputRef.current.value = ''; // Explicitly clear file input
      // Call the onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      } else {
        // Fallback to router refresh if no callback provided
        setTimeout(() => {
          router.refresh();
        }, 100);
      }
    }
    // Error messages are displayed inline via state.errors
  }, [state, router, onSuccess]);

  return (
    <form action={dispatch} ref={formRef} className="space-y-6 mt-4 border-t border-gray-200 pt-6">
      <input type="hidden" name="employee_id" value={employeeId} />
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
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-l-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-soft file:text-primary hover:file:bg-primary-soft/80"
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
            className="mt-2 block w-full rounded-md border-0 py-1.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-primary sm:text-sm sm:leading-6"
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
            className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-sm sm:leading-6"
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