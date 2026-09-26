'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { upsertFinancialDetails } from '@/app/actions/employeeActions';
import type { ActionFormState } from '@/types/actions';
import type { EmployeeFinancialDetails } from '@/types/database';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, Button, Card, CardBody, CardHeader, Field, FormFooter, Input, LinkButton, Textarea, toast } from '@/ds';

interface FinancialDetailsFormProps {
  employeeId: string;
  financialDetails: EmployeeFinancialDetails | null;
  onSave?: (data: FormData) => void;
  draftMode?: boolean;
  /** Where Cancel goes. Without it the form has no Cancel button. */
  cancelHref?: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      loading={pending}
      variant="primary"
    >
      Save Financial Details
    </Button>
  );
}

export default function FinancialDetailsForm({ employeeId, financialDetails, onSave, draftMode = false, cancelHref }: FinancialDetailsFormProps) {
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

      <Card>
        <CardHeader title="Financial Details" subtitle="Confidential financial and payment information" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {details.map(field => {
            const error = state?.errors?.[field.name]?.join(' ') || undefined;
            return (
              <Field
                key={field.name}
                label={field.label}
                className={field.name === 'branch_address' ? 'sm:col-span-2' : undefined}
              >
                {field.name === 'branch_address' ? (
                  <Textarea
                    name={field.name}
                    id={field.name}
                    defaultValue={field.defaultValue || ''}
                    rows={2}
                    error={error}
                  />
                ) : (
                  <Input
                    type="text"
                    name={field.name}
                    id={field.name}
                    defaultValue={field.defaultValue || ''}
                    placeholder={field.placeholder}
                    error={error}
                  />
                )}
              </Field>
            );
          })}
        </CardBody>
      </Card>

      {state?.type === 'error' && !state.errors && (
        <Alert tone="danger">{state.message}</Alert>
      )}

      <FormFooter>
        {cancelHref && (
          <LinkButton href={cancelHref} variant="secondary">
            Cancel
          </LinkButton>
        )}
        <SubmitButton />
      </FormFooter>
    </form>
  );
}
