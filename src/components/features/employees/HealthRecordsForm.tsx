'use client';

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { upsertHealthRecord } from '@/app/actions/employeeActions';
import type { ActionFormState } from '@/types/actions';
import type { EmployeeHealthRecord } from '@/types/database';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, FormFooter, Input, LinkButton, Textarea, toast } from '@/ds';

interface HealthRecordsFormProps {
  employeeId: string;
  healthRecord: EmployeeHealthRecord | null;
  /** Where Cancel goes. Without it the form has no Cancel button. */
  cancelHref?: string;
}

export default function HealthRecordsForm({ employeeId, healthRecord, cancelHref }: HealthRecordsFormProps) {
  const [state, formAction, pending] = useActionState(upsertHealthRecord, null);
  const [hasAllergies, setHasAllergies] = useState(Boolean(healthRecord?.has_allergies ?? healthRecord?.allergies));
  const [hadAbsence, setHadAbsence] = useState(Boolean(healthRecord?.had_absence_over_2_weeks_last_3_years));
  const [hadOutpatient, setHadOutpatient] = useState(Boolean(healthRecord?.had_outpatient_treatment_over_3_months_last_3_years));
  const [isRegisteredDisabled, setIsRegisteredDisabled] = useState(healthRecord?.is_registered_disabled || false);
  const router = useRouter();
  const handledState = useRef<ActionFormState | null>(null);

  useEffect(() => {
    if (state?.type !== 'success' || handledState.current === state) return;
    handledState.current = state;
    toast.success(state.message || 'Health record updated successfully.');
    router.push(`/employees/${employeeId}`);
  }, [state, router, employeeId]);

  // onSubmit rather than a form action: a React 19 form action resets the form after every
  // submit, so a refused save wiped the answers.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  interface FieldConfig {
    name: string;
    label: string;
    type?: 'textarea' | 'checkbox' | 'text' | 'email' | 'select' | 'date';
    defaultValue?: string | null;
    defaultChecked?: boolean;
    rows?: number;
    helpText?: string;
    options?: Array<{ value: string; label: string }>;
    onChange?: (checked: boolean) => void;
  }
  
  const renderField = (field: FieldConfig) => {
    const error = state?.errors?.[field.name]?.join(' ') || undefined;

    if (field.type === 'checkbox') {
      return (
        <Checkbox
          key={field.name}
          id={field.name}
          name={field.name}
          label={field.label}
          defaultChecked={field.defaultChecked}
          onChange={field.onChange}
        />
      );
    }

    return (
      <Field
        key={field.name}
        label={field.label}
        className={field.type === 'textarea' ? 'sm:col-span-2' : undefined}
      >
        {field.type === 'textarea' ? (
          <Textarea
            name={field.name}
            id={field.name}
            defaultValue={typeof field.defaultValue === 'string' ? field.defaultValue : ''}
            rows={3}
            error={error}
          />
        ) : (
          <Input
            type={field.type || 'text'}
            name={field.name}
            id={field.name}
            defaultValue={field.defaultValue || ''}
            error={error}
          />
        )}
      </Field>
    );
  };

  const generalFields: FieldConfig[] = [
      { name: 'doctor_name', label: 'Doctor Name', defaultValue: healthRecord?.doctor_name },
      { name: 'doctor_address', label: 'Doctor Address', defaultValue: healthRecord?.doctor_address },
      // The same two questions the employee answers in onboarding, under the same names.
      { name: 'illness_history', label: 'Illness history', type: 'textarea' as const, defaultValue: healthRecord?.illness_history },
      { name: 'recent_treatment', label: 'Recent treatment', type: 'textarea' as const, defaultValue: healthRecord?.recent_treatment },
  ];

  const questionnaireFields: FieldConfig[] = [
      { 
        name: 'has_allergies', 
        label: 'Do you have any allergies?', 
        type: 'checkbox' as const, 
        defaultChecked: hasAllergies, 
        onChange: (checked: boolean) => setHasAllergies(checked)
      },
      { 
        name: 'had_absence_over_2_weeks_last_3_years', 
        label: 'In the past 3 years, been off work for 2+ weeks due to illness/accident?', 
        type: 'checkbox' as const, 
        defaultChecked: hadAbsence, 
        onChange: (checked: boolean) => setHadAbsence(checked)
      },
      { 
        name: 'had_outpatient_treatment_over_3_months_last_3_years', 
        label: 'In the past 3 years, attended outpatient treatment for 3+ months?', 
        type: 'checkbox' as const, 
        defaultChecked: hadOutpatient, 
        onChange: (checked: boolean) => setHadOutpatient(checked)
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
    <form onSubmit={handleSubmit} className="space-y-6">
      <input type="hidden" name="employee_id" value={employeeId} />

      <Card>
        <CardHeader title="Doctor and Medical Notes" subtitle="Confidential health and medical information" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {generalFields.map(renderField)}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Health Questionnaire" />
        <CardBody className="space-y-4">
          {questionnaireFields.map(renderField)}

          {hasAllergies && (
            renderField({ name: 'allergies', label: 'If yes, please specify', type: 'textarea', defaultValue: healthRecord?.allergies })
          )}

          {(hadAbsence || hadOutpatient) && (
            renderField({
              name: 'absence_or_treatment_details',
              label: 'If yes to either, please provide details',
              type: 'textarea',
              defaultValue: healthRecord?.absence_or_treatment_details
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Conditions" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {conditionFields.map(renderField)}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Disability" />
        <CardBody className="space-y-4">
          {renderField({
            name: 'is_registered_disabled',
            label: 'Is Registered Disabled?',
            type: 'checkbox',
            defaultChecked: isRegisteredDisabled,
            onChange: (checked: boolean) => setIsRegisteredDisabled(checked)
          })}

          {/* Unticking hides these, and the save clears them, so old details are not kept. */}
          {isRegisteredDisabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              {disabilityFields.map(renderField)}
            </div>
          )}
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
        <Button type="submit" loading={pending} variant="primary">
          Save Health Records
        </Button>
      </FormFooter>
    </form>
  );
}
