'use client';

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { upsertHealthRecord } from '@/app/actions/employeeActions';
import type { ActionFormState } from '@/types/actions';
import type { EmployeeHealthRecord } from '@/types/database';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, FormFooter, Input, LinkButton, Textarea, toast } from '@/ds';
import { HEALTH_CONDITION_FIELDS, HEALTH_QUESTIONS } from '@/lib/employees/health-questions';

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
      // Every label here is the question the starter is asked in onboarding (health-questions.ts),
      // so a manager edits the answer to the question that was actually asked.
      { name: 'doctor_name', label: HEALTH_QUESTIONS.doctor_name, defaultValue: healthRecord?.doctor_name },
      { name: 'doctor_address', label: HEALTH_QUESTIONS.doctor_address, defaultValue: healthRecord?.doctor_address },
      { name: 'illness_history', label: HEALTH_QUESTIONS.illness_history, type: 'textarea' as const, defaultValue: healthRecord?.illness_history },
      { name: 'recent_treatment', label: HEALTH_QUESTIONS.recent_treatment, type: 'textarea' as const, defaultValue: healthRecord?.recent_treatment },
  ];

  const questionnaireFields: FieldConfig[] = [
      { 
        name: 'has_allergies', 
        label: HEALTH_QUESTIONS.has_allergies, 
        type: 'checkbox' as const, 
        defaultChecked: hasAllergies, 
        onChange: (checked: boolean) => setHasAllergies(checked)
      },
      { 
        name: 'had_absence_over_2_weeks_last_3_years', 
        label: HEALTH_QUESTIONS.had_absence_over_2_weeks_last_3_years, 
        type: 'checkbox' as const, 
        defaultChecked: hadAbsence, 
        onChange: (checked: boolean) => setHadAbsence(checked)
      },
      { 
        name: 'had_outpatient_treatment_over_3_months_last_3_years', 
        label: HEALTH_QUESTIONS.had_outpatient_treatment_over_3_months_last_3_years, 
        type: 'checkbox' as const, 
        defaultChecked: hadOutpatient, 
        onChange: (checked: boolean) => setHadOutpatient(checked)
      },
  ]
  
  const conditionFields: FieldConfig[] = HEALTH_CONDITION_FIELDS.map((field) => ({
      name: field,
      label: HEALTH_QUESTIONS[field],
      type: 'checkbox' as const,
      defaultChecked: healthRecord?.[field],
  }));
  
  const disabilityFields: FieldConfig[] = [
      { name: 'disability_reg_number', label: HEALTH_QUESTIONS.disability_reg_number, defaultValue: healthRecord?.disability_reg_number },
      { name: 'disability_reg_expiry_date', label: HEALTH_QUESTIONS.disability_reg_expiry_date, type: 'date' as const, defaultValue: healthRecord?.disability_reg_expiry_date?.split('T')[0] },
      { name: 'disability_details', label: HEALTH_QUESTIONS.disability_details, type: 'textarea' as const, defaultValue: healthRecord?.disability_details },
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
            renderField({ name: 'allergies', label: HEALTH_QUESTIONS.allergies, type: 'textarea', defaultValue: healthRecord?.allergies })
          )}

          {(hadAbsence || hadOutpatient) && (
            renderField({
              name: 'absence_or_treatment_details',
              label: HEALTH_QUESTIONS.absence_or_treatment_details,
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
            label: HEALTH_QUESTIONS.is_registered_disabled,
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
