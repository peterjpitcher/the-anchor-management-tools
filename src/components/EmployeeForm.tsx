'use client'

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ActionFormState } from '@/types/actions';
import type { Employee } from '@/types/database';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

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
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-green-600 px-4 py-3 sm:py-2 text-base sm:text-sm font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 disabled:opacity-50 min-h-[44px] w-full sm:w-auto"
    >
      {pending ? 'Saving...' : text}
    </button>
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
                <textarea
                  id={field.name}
                  name={field.name}
                  rows={3}
                  className="block w-full sm:max-w-lg rounded-md border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[88px]"
                  defaultValue={field.defaultValue || ''}
                />
              ) : field.type === 'select' ? (
                <select
                  id={field.name}
                  name={field.name}
                  className="block w-full sm:max-w-lg rounded-md border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px] bg-white"
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
                  className="block w-full sm:max-w-lg rounded-md border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-green-500 focus:ring-green-500 disabled:bg-gray-50 min-h-[44px]"
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
        ))}
        
        {/* Mobile: Show current step fields */}
        {isMobile && currentStepData.fields.map((field) => (
          <div key={field.name} className="space-y-2">
            <label htmlFor={field.name} className="block text-sm font-medium text-gray-700">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            <div>
              {field.type === 'textarea' ? (
                <textarea
                  id={field.name}
                  name={field.name}
                  rows={3}
                  className="block w-full rounded-md border border-gray-300 px-3 py-3 text-base shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[88px]"
                  defaultValue={field.defaultValue || ''}
                />
              ) : field.type === 'select' ? (
                <select
                  id={field.name}
                  name={field.name}
                  className="block w-full rounded-md border border-gray-300 px-3 py-3 text-base shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px] bg-white"
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
                  className="block w-full rounded-md border border-gray-300 px-3 py-3 text-base shadow-sm focus:border-green-500 focus:ring-green-500 disabled:bg-gray-50 min-h-[44px]"
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

      <div className="sticky bottom-0 -mx-4 sm:mx-0 bg-white border-t sm:border-0 pt-5 px-4 sm:px-0 pb-4 sm:pb-0">
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 sm:gap-0 sm:space-x-3">
          {/* Mobile navigation */}
          {isMobile ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
                  disabled={isFirstStep}
                  className="rounded-md border border-gray-300 bg-white py-3 px-4 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  <ChevronLeftIcon className="h-5 w-5 mr-1" />
                  Previous
                </button>
                {!isLastStep ? (
                  <button
                    type="button"
                    onClick={() => setCurrentStep(prev => Math.min(totalSteps - 1, prev + 1))}
                    className="rounded-md bg-green-600 py-3 px-4 text-base font-semibold text-white shadow-sm hover:bg-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 min-h-[44px] flex items-center justify-center"
                  >
                    Next
                    <ChevronRightIcon className="h-5 w-5 ml-1" />
                  </button>
                ) : (
                  <SubmitButton text={submitButtonText} />
                )}
              </div>
              {showCancel && (
                <Link
                  href={employee?.employee_id ? `/employees/${employee.employee_id}` : '/employees'}
                  className="rounded-md border border-gray-300 bg-white py-3 px-4 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 min-h-[44px] w-full text-center"
                >
                  Cancel
                </Link>
              )}
            </>
          ) : (
            /* Desktop layout */
            <>
              {showCancel && (
                <Link
                  href={employee?.employee_id ? `/employees/${employee.employee_id}` : '/employees'}
                  className="rounded-md border border-gray-300 bg-white py-3 sm:py-2 px-4 text-base sm:text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 min-h-[44px] w-full sm:w-auto text-center"
                >
                  Cancel
                </Link>
              )}
              <SubmitButton text={submitButtonText} />
            </>
          )}
        </div>
      </div>
    </form>
  );
} 