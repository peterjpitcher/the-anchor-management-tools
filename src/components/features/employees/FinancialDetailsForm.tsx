'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { upsertFinancialDetails } from '@/app/actions/employeeActions';
import type { ActionFormState } from '@/types/actions';
import type { EmployeeFinancialDetails } from '@/types/database';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { Input } from '@/components/ui-v2/forms/Input';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Button } from '@/components/ui-v2/forms/Button';

interface FinancialDetailsFormProps {
  employeeId: string;
  financialDetails: EmployeeFinancialDetails | null;
  onSave?: (data: FormData) => void;
  draftMode?: boolean;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      loading={pending}
      variant="primary"
    >
      {pending ? 'Saving...' : 'Save Changes'}
    </Button>
  );
}

export default function FinancialDetailsForm({ employeeId, financialDetails, onSave, draftMode = false }: FinancialDetailsFormProps) {
  const [state, formAction] = useActionState(upsertFinancialDetails, null);
  const pathname = usePathname();
  const router = useRouter();
  const isNewEmployee = pathname?.includes('/employees/new');

  useEffect(() => {
    if (state?.type === 'success' && !draftMode) {
      // Only redirect when editing an existing employee
      if (!isNewEmployee) {
        toast.success(state.message || 'Financial details updated successfully.');
        router.push(`/employees/${employeeId}`);
      }
    }
  }, [state, isNewEmployee, draftMode, router, employeeId]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (draftMode && onSave) {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      onSave(formData);
    }
  };

  const details = [
    { name: 'ni_number', label: 'NI Number', defaultValue: financialDetails?.ni_number },
    { name: 'payee_name', label: 'Account Name(s)', defaultValue: financialDetails?.payee_name },
    { name: 'bank_name', label: 'Bank / Building Society', defaultValue: financialDetails?.bank_name },
    { name: 'bank_sort_code', label: 'Sort Code', defaultValue: financialDetails?.bank_sort_code, placeholder: '00-00-00' },
    { name: 'bank_account_number', label: 'Account Number', defaultValue: financialDetails?.bank_account_number, placeholder: '8 digits' },
    { name: 'branch_address', label: 'Branch Address', defaultValue: financialDetails?.branch_address },
  ];

  return (
    <form action={draftMode ? undefined : formAction} onSubmit={draftMode ? handleSubmit : undefined} className="space-y-6">
      <input type="hidden" name="employee_id" value={employeeId} />

      <div className="space-y-4">
        {details.map(field => (
          <div key={field.name} className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
            <label htmlFor={field.name} className="block text-sm font-medium text-gray-700 sm:col-span-1">
              {field.label}
            </label>
            <div className="mt-1 sm:col-span-3 sm:mt-0">
              {field.name === 'branch_address' ? (
                <Textarea
                  name={field.name}
                  id={field.name}
                  defaultValue={field.defaultValue || ''}
                  rows={2}
                  error={!!state?.errors?.[field.name]}
                />
              ) : (
                <Input
                  type="text"
                  name={field.name}
                  id={field.name}
                  defaultValue={field.defaultValue || ''}
                  placeholder={field.placeholder}
                  error={!!state?.errors?.[field.name]}
                  fullWidth
                />
              )}
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
