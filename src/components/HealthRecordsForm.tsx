'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { upsertHealthRecord } from '@/app/actions/employeeActions';
import type { ActionFormState } from '@/types/actions';
import type { EmployeeHealthRecord } from '@/types/database';

interface HealthRecordsFormProps {
  employeeId: string;
  healthRecord: EmployeeHealthRecord | null;
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

export default function HealthRecordsForm({ employeeId, healthRecord }: HealthRecordsFormProps) {
  const [state, formAction] = useActionState(upsertHealthRecord, null);
  const [isRegisteredDisabled, setIsRegisteredDisabled] = useState(healthRecord?.is_registered_disabled || false);

  useEffect(() => {
    if (state?.type === 'success') {
      console.log(state.message);
    }
  }, [state]);

  const renderField = (field: any) => {
    const error = state?.errors?.[field.name];
    
    return (
      <div key={field.name} className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
        <label htmlFor={field.name} className="block text-sm font-medium text-gray-700 sm:col-span-1">
          {field.label}
        </label>
        <div className="mt-1 sm:col-span-3 sm:mt-0">
          {field.type === 'textarea' ? (
            <textarea
              name={field.name}
              id={field.name}
              defaultValue={field.defaultValue || ''}
              rows={3}
              className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
            />
          ) : field.type === 'checkbox' ? (
            <div className="flex h-5 items-center">
              <input
                id={field.name}
                name={field.name}
                type="checkbox"
                defaultChecked={field.defaultChecked}
                onChange={field.onChange}
                className="h-4 w-4 rounded border border-gray-300 text-green-600 focus:ring-green-500"
              />
            </div>
          ) : (
            <input
              type={field.type || 'text'}
              name={field.name}
              id={field.name}
              defaultValue={field.defaultValue || ''}
              className="block w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
            />
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    );
  };
  
  const generalFields = [
      { name: 'doctor_name', label: 'Doctor Name', defaultValue: healthRecord?.doctor_name },
      { name: 'doctor_address', label: 'Doctor Address', defaultValue: healthRecord?.doctor_address },
      { name: 'allergies', label: 'Allergies', type: 'textarea', defaultValue: healthRecord?.allergies },
      { name: 'illness_history', label: 'History of Illness', type: 'textarea', defaultValue: healthRecord?.illness_history },
      { name: 'recent_treatment', label: 'Recent Treatment (last 3 months)', type: 'textarea', defaultValue: healthRecord?.recent_treatment },
  ];
  
  const conditionFields = [
      { name: 'has_diabetes', label: 'Suffer with Diabetes?', type: 'checkbox', defaultChecked: healthRecord?.has_diabetes },
      { name: 'has_epilepsy', label: 'Suffer with Epilepsy/Fits/Blackouts?', type: 'checkbox', defaultChecked: healthRecord?.has_epilepsy },
      { name: 'has_skin_condition', label: 'Suffer with Eczema/Dermatitis/Skin Disease?', type: 'checkbox', defaultChecked: healthRecord?.has_skin_condition },
      { name: 'has_depressive_illness', label: 'Suffer with Depressive Illness?', type: 'checkbox', defaultChecked: healthRecord?.has_depressive_illness },
      { name: 'has_bowel_problems', label: 'Suffer with Bowel Problems?', type: 'checkbox', defaultChecked: healthRecord?.has_bowel_problems },
      { name: 'has_ear_problems', label: 'Suffer with Earache or Infection?', type: 'checkbox', defaultChecked: healthRecord?.has_ear_problems },
  ];
  
  const disabilityFields = [
      { name: 'disability_reg_number', label: 'Disability Registration Number', defaultValue: healthRecord?.disability_reg_number },
      { name: 'disability_reg_expiry_date', label: 'Registration Expiry Date', type: 'date', defaultValue: healthRecord?.disability_reg_expiry_date?.split('T')[0] },
      { name: 'disability_details', label: 'Disability Details', type: 'textarea', defaultValue: healthRecord?.disability_details },
  ];

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="employee_id" value={employeeId} />
      
      <div className="space-y-4">
        <div className="space-y-4">
            {generalFields.map(renderField)}
        </div>

        <div className="space-y-4 pt-6">
            <p className="text-base font-medium text-gray-900 sm:col-span-4">Conditions</p>
            {conditionFields.map(renderField)}
        </div>

        <div className="space-y-4 pt-6">
            {renderField({ 
                name: 'is_registered_disabled', 
                label: 'Is Registered Disabled?', 
                type: 'checkbox', 
                defaultChecked: isRegisteredDisabled, 
                onChange: (e:any) => setIsRegisteredDisabled(e.target.checked) 
            })}

            {isRegisteredDisabled && (
                <div className="space-y-4 pl-8 mt-4 border-l-2 border-gray-200">
                    {disabilityFields.map(renderField)}
                </div>
            )}
        </div>
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