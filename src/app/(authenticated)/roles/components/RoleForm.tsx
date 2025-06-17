'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

interface RoleFormProps {
  action: (prevState: any, formData: FormData) => Promise<{ error?: string; success?: boolean }>;
  initialData?: {
    id?: string;
    name?: string;
    description?: string;
  };
}

export default function RoleForm({ action, initialData }: RoleFormProps) {
  const [state, formAction, isPending] = useActionState(action, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      router.push('/roles');
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-6 bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
      {state?.error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{state.error}</p>
        </div>
      )}

      {initialData?.id && (
        <input type="hidden" name="roleId" value={initialData.id} />
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
          Role Name
        </label>
        <div className="mt-1">
          <input
            type="text"
            name="name"
            id="name"
            required
            defaultValue={initialData?.name}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="e.g., Event Manager"
          />
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Choose a descriptive name for this role
        </p>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <div className="mt-1">
          <textarea
            name="description"
            id="description"
            rows={3}
            defaultValue={initialData?.description}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="Describe the purpose and responsibilities of this role"
          />
        </div>
      </div>

      <div className="flex justify-end space-x-3">
        <Link
          href="/roles"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isPending ? 'Saving...' : initialData?.id ? 'Update Role' : 'Create Role'}
        </button>
      </div>
    </form>
  );
}