'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { upsertHealthRecord } from '@/app/actions/employeeActions';
import type { EmployeeHealthRecord } from '@/types/database';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from '@/components/ui-v2/feedback/Toast';
import { Input } from '@/components/ui-v2/forms/Input';
import { Textarea } from '@/components/ui-v2/forms/Textarea';
import { Checkbox } from '@/components/ui-v2/forms/Checkbox';
import { Button } from '@/components/ui-v2/forms/Button';

interface HealthRecordsFormProps {
  employeeId: string;
  healthRecord: EmployeeHealthRecord | null;
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

export default function HealthRecordsForm({ employeeId, healthRecord }: HealthRecordsFormProps) {
  const [state, formAction] = useActionState(upsertHealthRecord, null);
  const [hasAllergies, setHasAllergies] = useState(Boolean(healthRecord?.has_allergies ?? healthRecord?.allergies));
  const [hadAbsence, setHadAbsence] = useState(Boolean(healthRecord?.had_absence_over_2_weeks_last_3_years));
  const [hadOutpatient, setHadOutpatient] = useState(Boolean(healthRecord?.had_outpatient_treatment_over_3_months_last_3_years));
  const [isRegisteredDisabled, setIsRegisteredDisabled] = useState(healthRecord?.is_registered_disabled || false);
  const pathname = usePathname();
  const router = useRouter();
  const isNewEmployee = pathname?.includes('/employees/new');

  useEffect(() => {
    if (state?.type === 'success') {
      if (!isNewEmployee) {
        toast.success(state.message || 'Health record updated successfully.');
        router.push(`/employees/${employeeId}`);
      }
    }
  }, [state, isNewEmployee, router, employeeId]);

  interface FieldConfig {
    name: string;
    label: string;
    type?: 'textarea' | 'checkbox' | 'text' | 'email' | 'select' | 'date';
    defaultValue?: string | null;
    defaultChecked?: boolean;
    rows?: number;
    helpText?: string;
    options?: Array<{ value: string; label: string }>;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }
  
  const renderField = (field: FieldConfig) => {
    const error = state?.errors?.[field.name];
    
    return (
      <div key={field.name} className="sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2">
        <label htmlFor={field.name} className="block text-sm font-medium text-gray-700 sm:col-span-1">
          {field.label}
        </label>
        <div className="mt-1 sm:col-span-3 sm:mt-0">
          {field.type === 'textarea' ? (
            <Textarea
              name={field.name}
              id={field.name}
              defaultValue={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
              rows={3}
              error={!!error}
            />
          ) : field.type === 'checkbox' ? (
            <div className="flex h-5 items-center">
              <Checkbox
                id={field.name}
                name={field.name}
                defaultChecked={field.defaultChecked}
                onChange={field.onChange}
              />
            </div>
          ) : (
            <Input
              type={field.type || 'text'}
              name={field.name}
              id={field.name}
              defaultValue={field.defaultValue || ''}
              error={!!error}
            />
          )}
        </div>
      </div>
    );
  };
  
  const generalFields: FieldConfig[] = [
      { name: 'doctor_name', label: 'Doctor Name', defaultValue: healthRecord?.doctor_name },
      { name: 'doctor_address', label: 'Doctor Address', defaultValue: healthRecord?.doctor_address },
      { name: 'illness_history', label: 'Additional Medical Notes', type: 'textarea' as const, defaultValue: healthRecord?.illness_history },
  ];

  const questionnaireFields: FieldConfig[] = [
      { 
        name: 'has_allergies', 
        label: 'Do you have any allergies?', 
        type: 'checkbox' as const, 
        defaultChecked: hasAllergies, 
        onChange: (e: any) => setHasAllergies(e.target.checked) 
      },
      { 
        name: 'had_absence_over_2_weeks_last_3_years', 
        label: 'In the past 3 years, been off work for 2+ weeks due to illness/accident?', 
        type: 'checkbox' as const, 
        defaultChecked: hadAbsence, 
        onChange: (e: any) => setHadAbsence(e.target.checked) 
      },
      { 
        name: 'had_outpatient_treatment_over_3_months_last_3_years', 
        label: 'In the past 3 years, attended outpatient treatment for 3+ months?', 
        type: 'checkbox' as const, 
        defaultChecked: hadOutpatient, 
        onChange: (e: any) => setHadOutpatient(e.target.checked) 
      },
  ]
  
  const conditionFields: FieldConfig[] = [
      { name: 'has_diabetes', label: 'Suffer with Diabetes?', type: 'checkbox' as const, defaultChecked: healthRecord?.has_diabetes },
      { name: 'has_epilepsy', label: 'Suffer with Epilepsy/Fits/Blackouts?', type: 'checkbox' as const, defaultChecked: healthRecord?.has_epilepsy },
      { name: 'has_skin_condition', label: 'Suffer with Eczema/Dermatitis/Skin Disease?', type: 'checkbox' as const, defaultChecked: healthRecord?.has_skin_condition },
      { name: 'has_depressive_illness', label: 'Suffer with Depressive Illness?', type: 'checkbox' as const, defaultChecked: healthRecord?.has_depressive_illness },
      { name: 'has_bowel_problems', label: 'Suffer with Bowel Problems?', type: 'checkbox' as const, defaultChecked: healthRecord?.has_bowel_problems },
      { name: 'has_ear_problems', label: 'Suffer with Earache or Infection?', type: 'checkbox' as const, defaultChecked: healthRecord?.has_ear_problems },
  ];
  
  const disabilityFields: FieldConfig[] = [
      { name: 'disability_reg_number', label: 'Disability Registration Number', defaultValue: healthRecord?.disability_reg_number },
      { name: 'disability_reg_expiry_date', label: 'Registration Expiry Date', type: 'date' as const, defaultValue: healthRecord?.disability_reg_expiry_date?.split('T')[0] },
      { name: 'disability_details', label: 'Disability Details', type: 'textarea' as const, defaultValue: healthRecord?.disability_details },
  ];

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="employee_id" value={employeeId} />
      
      <div className="space-y-4">
        <div className="space-y-4">
            {generalFields.map(renderField)}
        </div>

        <div className="space-y-4 pt-6">
          <p className="text-base font-medium text-gray-900 sm:col-span-4">Health Questionnaire</p>
          {questionnaireFields.map(renderField)}

          {hasAllergies && (
            <div className="pl-8 mt-2">
              {renderField({ name: 'allergies', label: 'If yes, please specify', type: 'textarea', defaultValue: healthRecord?.allergies })}
            </div>
          )}

          {(hadAbsence || hadOutpatient) && (
            <div className="pl-8 mt-2">
              {renderField({ 
                name: 'absence_or_treatment_details', 
                label: 'If yes to either, please provide details', 
                type: 'textarea', 
                defaultValue: healthRecord?.absence_or_treatment_details 
              })}
            </div>
          )}
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
