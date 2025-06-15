'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { upsertFinancialDetails } from '@/app/actions/employeeActions';
import type { ActionFormState } from '@/types/actions';
import type { EmployeeFinancialDetails } from '@/types/database';

interface FinancialDetailsFormProps {
  employeeId: string;
  financialDetails: EmployeeFinancialDetails | null;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 disabled:opacity-50"
    >
      {pending ? 'Saving...' : 'Save Changes'}
    </button>
  );
}

export default function FinancialDetailsForm({ employeeId, financialDetails }: FinancialDetailsFormProps) {
  const [state, formAction] = useActionState(upsertFinancialDetails, null);

  useEffect(() => {
    if (state?.type === 'success') {
      // Potentially show a toast message here
      console.log(state.message);
    }
  }, [state]);

  const details = [
    { name: 'ni_number', label: 'NI Number', defaultValue: financialDetails?.ni_number },
    { name: 'payee_name', label: 'Payee Name', defaultValue: financialDetails?.payee_name },
    { name: 'bank_name', label: 'Bank Name', defaultValue: financialDetails?.bank_name },
    { name: 'bank_sort_code', label: 'Sort Code', defaultValue: financialDetails?.bank_sort_code },
    { name: 'bank_account_number', label: 'Account Number', defaultValue: financialDetails?.bank_account_number },
    { name: 'branch_address', label: 'Branch Address', defaultValue: financialDetails?.branch_address },
  ];

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="employee_id" value={employeeId} />
      
      <div className="space-y-4">
        {details.map(field => (
          <div key={field.name} className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
            <label htmlFor={field.name} className="block text-sm font-medium text-gray-700 sm:col-span-1">
              {field.label}
            </label>
            <div className="mt-1 sm:col-span-3 sm:mt-0">
              <input
                type="text"
                name={field.name}
                id={field.name}
                defaultValue={field.defaultValue || ''}
                className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
               {state?.errors?.[field.name] && (
                <p className="mt-2 text-sm text-red-600">{state.errors[field.name]}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-4">
        <SubmitButton />
      </div>
       {state?.type === 'error' && !state.errors && (
          <p className="mt-2 text-sm text-red-600">{state.message}</p>
        )}
    </form>
  );
} 