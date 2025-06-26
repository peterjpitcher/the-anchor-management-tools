'use client'

import { useEffect } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ActionFormState } from '@/types/actions';
import type { Employee } from '@/types/database';

interface EmployeeFormProps {
  employee?: Employee; // For editing, not used in this initial "add" form
  formAction: (prevState: ActionFormState | null, formData: FormData) => Promise<ActionFormState | null>; // Can be addEmployee or an updateEmployee action
  initialFormState: ActionFormState | null;
  showTitle?: boolean;
  showCancel?: boolean;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-50"
    >
      {pending ? 'Saving...' : 'Save Employee'}
    </button>
  );
}

export default function EmployeeForm({
  employee,
  formAction,
  initialFormState,
  showTitle = true,
  showCancel = true,
}: EmployeeFormProps) {
  const router = useRouter();
  const [state, dispatch] = useActionState(formAction, initialFormState);

  useEffect(() => {
    if (state?.type === 'success' && state.employeeId) {
      // Redirect to the employee's detail page
      router.push(`/employees/${state.employeeId}`);
      // Optionally, show a success toast message here using a library like react-hot-toast
      // For example: toast.success(state.message);
    } else if (state?.type === 'success') {
      // Fallback if employeeId is not in state for some reason, go to list
      router.push('/employees');
    }
    // No changes needed for error states here as they are handled by displaying messages in the form
  }, [state, router]);

  const formFields = [
    { name: 'first_name', label: 'First Name', type: 'text', required: true, defaultValue: employee?.first_name },
    { name: 'last_name', label: 'Last Name', type: 'text', required: true, defaultValue: employee?.last_name },
    { name: 'email_address', label: 'Email Address', type: 'email', required: true, defaultValue: employee?.email_address },
    { name: 'job_title', label: 'Job Title', type: 'text', required: true, defaultValue: employee?.job_title },
    { name: 'employment_start_date', label: 'Employment Start Date', type: 'date', required: true, defaultValue: employee?.employment_start_date?.split('T')[0] },
    { name: 'status', label: 'Status', type: 'select', required: true, options: ['Active', 'Former'], defaultValue: employee?.status || 'Active' },
    { name: 'date_of_birth', label: 'Date of Birth', type: 'date', defaultValue: employee?.date_of_birth?.split('T')[0] },
    { name: 'address', label: 'Address', type: 'textarea', defaultValue: employee?.address },
    { name: 'phone_number', label: 'Phone Number', type: 'tel', defaultValue: employee?.phone_number },
    { name: 'employment_end_date', label: 'Employment End Date', type: 'date', defaultValue: employee?.employment_end_date?.split('T')[0] },
  ];

  return (
    <form action={dispatch} className="space-y-6">
      <input type="hidden" name="employee_id" value={employee?.employee_id || ''} />
      {showTitle && (
        <div>
          <h3 className="text-lg font-medium leading-6 text-gray-900">
            {employee ? 'Edit Employee' : 'Add New Employee'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Please fill in the details of the employee.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {formFields.map((field) => (
          <div key={field.name} className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
            <label htmlFor={field.name} className="block text-sm font-medium text-gray-700 sm:col-span-1">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            <div className="mt-1 sm:col-span-3 sm:mt-0">
              {field.type === 'textarea' ? (
                <textarea
                  id={field.name}
                  name={field.name}
                  rows={3}
                  className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  defaultValue={field.defaultValue || ''}
                />
              ) : field.type === 'select' ? (
                <select
                  id={field.name}
                  name={field.name}
                  className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  defaultValue={field.defaultValue || (field.name === 'status' ? 'Active' : '')}
                  required={field.required}
                >
                  {field.options?.map(option => (
                      <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  name={field.name}
                  id={field.name}
                  className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm disabled:bg-gray-50"
                  defaultValue={field.defaultValue || ''}
                  required={field.required}
                />
              )}
              {state?.errors?.[field.name] && (
                <p className="mt-2 text-sm text-red-600" id={`${field.name}-error`}>
                  {state.errors[field.name]}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {state?.type === 'error' && !state.errors && (
        <p className="mt-2 text-sm text-red-600">{state.message}</p>
      )}
      {/* General success message can be shown here if needed, or use toasts */}

      <div className="pt-5">
        <div className="flex justify-end space-x-3">
          {showCancel && (
            <Link
              // If editing, cancel goes back to employee detail page, otherwise to list
              href={employee?.employee_id ? `/employees/${employee.employee_id}` : '/employees'}
              className="rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              Cancel
            </Link>
          )}
          <SubmitButton />
        </div>
      </div>
    </form>
  );
} 