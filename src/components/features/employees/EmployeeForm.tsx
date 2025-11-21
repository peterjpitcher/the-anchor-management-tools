'use client'

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ActionFormState } from '@/types/actions';
import type { Employee } from '@/types/database';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Input } from '@/components/ui-v2/forms/Input';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Select } from '@/components/ui-v2/forms/Select';
import { Button } from '@/components/ui-v2/forms/Button';

interface EmployeeFormProps {
  employee?: Employee; // For editing, not used in this initial "add" form
  formAction: (prevState: ActionFormState | null, formData: FormData) => Promise<ActionFormState | null>; // Can be addEmployee or an updateEmployee action
  initialFormState: ActionFormState | null;
  showTitle?: boolean;
  showCancel?: boolean;
  submitButtonText?: string;
  draftMode?: boolean;
}

type FormField = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  defaultValue?: string | null;
  options?: string[];
}

function SubmitButton({ text = 'Save Employee' }: { text?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      loading={pending}
      variant="primary"
      className="w-full sm:w-auto"
    >
      {text}
    </Button>
  );
}

export default function EmployeeForm({
  employee,
  formAction,
  initialFormState,
  showTitle = true,
  showCancel = true,
  submitButtonText = 'Save Employee',
  draftMode = false,
}: EmployeeFormProps) {
  const router = useRouter();
  const [state, dispatch] = useActionState(formAction, initialFormState);
  const [currentStep, setCurrentStep] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (state?.type === 'success' && !draftMode) {
      // Only redirect if we're editing an existing employee
      // For new employees, the parent component handles navigation
      if (employee) {
        router.push('/employees');
      }
      // Optionally, show a success toast message here using a library like react-hot-toast
      // For example: toast.success(state.message);
    }
    // No changes needed for error states here as they are handled by displaying messages in the form
  }, [state, router, employee, draftMode]);

  const formSteps: { title: string; fields: FormField[] }[] = [
    {
      title: 'Basic Information',
      fields: [
        { name: 'first_name', label: 'First Name', type: 'text', required: true, defaultValue: employee?.first_name },
        { name: 'last_name', label: 'Last Name', type: 'text', required: true, defaultValue: employee?.last_name },
        { name: 'email_address', label: 'Email Address', type: 'email', required: true, defaultValue: employee?.email_address },
        { name: 'phone_number', label: 'Phone Number', type: 'tel', defaultValue: employee?.phone_number },
      ]
    },
    {
      title: 'Employment Details',
      fields: [
        { name: 'job_title', label: 'Job Title', type: 'text', required: true, defaultValue: employee?.job_title },
        { name: 'status', label: 'Status', type: 'select', required: true, options: ['Active', 'Former', 'Prospective'], defaultValue: employee?.status || 'Active' },
        { name: 'employment_start_date', label: 'Employment Start Date', type: 'date', required: true, defaultValue: employee?.employment_start_date?.split('T')[0] },
        { name: 'employment_end_date', label: 'Employment End Date', type: 'date', defaultValue: employee?.employment_end_date?.split('T')[0] },
      ]
    },
    {
      title: 'Personal Details',
      fields: [
        { name: 'date_of_birth', label: 'Date of Birth', type: 'date', defaultValue: employee?.date_of_birth?.split('T')[0] },
        { name: 'address', label: 'Address', type: 'textarea', defaultValue: employee?.address },
      ]
    }
  ];

  const totalSteps = formSteps.length;
  const currentStepData = formSteps[currentStep];
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  return (
    <form action={dispatch} className="space-y-6">
      <input type="hidden" name="employee_id" value={employee?.employee_id || ''} />
      {showTitle && (
        <div>
          <h3 className="text-lg sm:text-xl font-medium leading-6 text-gray-900">
            {employee ? 'Edit Employee' : 'Add New Employee'}
          </h3>
          <p className="mt-1 text-sm sm:text-base text-gray-500">
            Please fill in the details of the employee.
          </p>
        </div>
      )}

      {/* Progress Indicator */}
      {isMobile && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">Step {currentStep + 1} of {totalSteps}</span>
            <span className="text-sm font-medium text-gray-900">{currentStepData.title}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Desktop: Show all fields */}
        {!isMobile && formSteps.map((step) => (
          <div key={step.title} className="space-y-4">
            <h4 className="font-medium text-gray-900 border-b pb-2">{step.title}</h4>
            {step.fields.map((field) => (
              <div key={field.name} className="space-y-2 sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2 sm:space-y-0">
                <label htmlFor={field.name} className="block text-sm sm:text-base font-medium text-gray-700 sm:col-span-1">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                <div className="mt-1 sm:col-span-3 sm:mt-0">
                  {field.type === 'textarea' ? (
                    <Textarea
                      id={field.name}
                      name={field.name}
                      rows={3}
                      defaultValue={field.defaultValue || ''}
                      error={!!state?.errors?.[field.name]}
                    />
                  ) : field.type === 'select' ? (
                    <Select
                      id={field.name}
                      name={field.name}
                      defaultValue={field.defaultValue || (field.name === 'status' ? 'Active' : '')}
                      required={field.required}
                      error={!!state?.errors?.[field.name]}
                      options={field.options?.map(option => ({ label: option, value: option }))}
                    />
                  ) : (
                    <Input
                      type={field.type}
                      name={field.name}
                      id={field.name}
                      defaultValue={field.defaultValue || ''}
                      required={field.required}
                      error={!!state?.errors?.[field.name]}
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
        ))}

        {/* Mobile: Show current step fields */}
        {isMobile && currentStepData.fields.map((field) => (
          <div key={field.name} className="space-y-2">
            <label htmlFor={field.name} className="block text-sm font-medium text-gray-700">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            <div>
              {field.type === 'textarea' ? (
                <Textarea
                  id={field.name}
                  name={field.name}
                  rows={3}
                  defaultValue={field.defaultValue || ''}
                  error={!!state?.errors?.[field.name]}
                />
              ) : field.type === 'select' ? (
                <Select
                  id={field.name}
                  name={field.name}
                  defaultValue={field.defaultValue || (field.name === 'status' ? 'Active' : '')}
                  required={field.required}
                  error={!!state?.errors?.[field.name]}
                  options={field.options?.map(option => ({ label: option, value: option }))}
                />
              ) : (
                <Input
                  type={field.type}
                  name={field.name}
                  id={field.name}
                  defaultValue={field.defaultValue || ''}
                  required={field.required}
                  error={!!state?.errors?.[field.name]}
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

      <div className="sticky bottom-0 -mx-4 sm:mx-0 bg-white border-t sm:border-0 pt-5 px-4 sm:px-0 pb-4 sm:pb-0">
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 sm:gap-0 sm:space-x-3">
          {/* Mobile navigation */}
          {isMobile ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
                  disabled={isFirstStep}
                  className="w-full"
                  leftIcon={<ChevronLeftIcon className="h-5 w-5" />}
                >
                  Previous
                </Button>
                {!isLastStep ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setCurrentStep(prev => Math.min(totalSteps - 1, prev + 1))}
                    className="w-full"
                    rightIcon={<ChevronRightIcon className="h-5 w-5" />}
                  >
                    Next
                  </Button>
                ) : (
                  <SubmitButton text={submitButtonText} />
                )}
              </div>
              {showCancel && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => router.push(employee?.employee_id ? `/employees/${employee.employee_id}` : '/employees')}
                >
                  Cancel
                </Button>
              )}
            </>
          ) : (
            /* Desktop layout */
            <>
              {showCancel && (
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => router.push(employee?.employee_id ? `/employees/${employee.employee_id}` : '/employees')}
                >
                  Cancel
                </Button>
              )}
              <SubmitButton text={submitButtonText} />
            </>
          )}
        </div>
      </div>
    </form>
  );
} 