'use client'

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Fieldset,
  FormFooter,
  Icon,
  Input,
  LinkButton,
  ProgressBar,
  SHELL_MEDIA_QUERY,
  Select,
  Textarea,
  toast,
} from '@/ds';
import { useMediaQuery } from '@/hooks/use-media-query';
import type { ActionFormState } from '@/types/actions';
import type { Employee } from '@/types/database';

interface EmployeeFormProps {
  employee?: Employee; // For editing, not used in this initial "add" form
  formAction: (prevState: ActionFormState | null, formData: FormData) => Promise<ActionFormState | null>; // Can be addEmployee or an updateEmployee action
  initialFormState: ActionFormState | null;
  /** Where Cancel goes. Without it the form has no Cancel button. */
  cancelHref?: string;
  submitButtonText?: string;
  draftMode?: boolean;
}

type FormField = {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'date' | 'password' | 'textarea' | 'select' | 'checkbox';
  required?: boolean;
  defaultValue?: string | null;
  defaultChecked?: boolean;
  options?: string[];
  /** Shown under the input. Added for preferred name, where the distinction from the legal name needs explaining. */
  hint?: string;
  /** Takes both columns of the field grid (long text). */
  wide?: boolean;
  /** A checkbox's own label, beside the box; `label` heads the group. */
  checkboxLabel?: string;
}

function SubmitButton({ text = 'Save Personal Details' }: { text?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} variant="primary">
      {text}
    </Button>
  );
}

export default function EmployeeForm({
  employee,
  formAction,
  initialFormState,
  cancelHref,
  submitButtonText = 'Save Personal Details',
  draftMode = false,
}: EmployeeFormProps) {
  const router = useRouter();
  const [state, dispatch] = useActionState(formAction, initialFormState);
  const [currentStep, setCurrentStep] = useState(0);
  // Phones fill the form in one step at a time; the switch matches the app shell's.
  const isMobile = useMediaQuery(SHELL_MEDIA_QUERY);

  useEffect(() => {
    if (state?.type === 'success' && !draftMode) {
      // Only redirect if we're editing an existing employee
      // For new employees, the parent component handles navigation
      if (employee) {
        toast.success(state.message || 'Employee updated successfully.');
        router.push(`/employees/${employee.employee_id}`);
      }
    }
    // No changes needed for error states here as they are handled by displaying messages in the form
  }, [state, router, employee, draftMode]);

  const statusOptions = (() => {
    switch (employee?.status) {
      case 'Onboarding':
        return ['Onboarding', 'Active'];
      case 'Started Separation':
        return ['Active', 'Started Separation'];
      case 'Former':
        return ['Former'];
      default:
        return ['Active', 'Started Separation'];
    }
  })();

  const formSteps: { title: string; fields: FormField[] }[] = [
    {
      title: 'Basic Information',
      fields: [
        { name: 'first_name', label: 'First Name', type: 'text', required: true, defaultValue: employee?.first_name },
        { name: 'last_name', label: 'Last Name', type: 'text', required: true, defaultValue: employee?.last_name },
        {
          name: 'preferred_name',
          label: 'Preferred Name',
          type: 'text',
          defaultValue: employee?.preferred_name,
          hint: 'What the team calls this person, shown everywhere in the app. Their legal name above is still used for contracts and payroll. Leave blank to use their first name. Two active employees cannot share a preferred name, so use "Jacob H" and "Jacob W" where first names clash.',
          wide: true,
        },
        { name: 'email_address', label: 'Email Address', type: 'email', required: true, defaultValue: employee?.email_address },
        { name: 'phone_number', label: 'Telephone', type: 'tel', defaultValue: employee?.phone_number },
        { name: 'mobile_number', label: 'Mobile', type: 'tel', defaultValue: employee?.mobile_number },
      ]
    },
    {
      title: 'Employment Details',
      fields: [
        { name: 'job_title', label: 'Job Title', type: 'text', required: true, defaultValue: employee?.job_title },
        { name: 'status', label: 'Status', type: 'select', required: true, options: statusOptions, defaultValue: employee?.status || 'Active' },
        { name: 'employment_start_date', label: 'Employment Start Date', type: 'date', required: true, defaultValue: employee?.employment_start_date?.split('T')[0] },
        { name: 'employment_end_date', label: 'Employment End Date', type: 'date', defaultValue: employee?.employment_end_date?.split('T')[0] },
        { name: 'first_shift_date', label: 'First Shift Date', type: 'date', defaultValue: employee?.first_shift_date?.split('T')[0] },
        ...(employee ? [{ name: 'timeclock_pin', label: 'Timeclock PIN', type: 'password' as const, defaultValue: '' }] : []),
      ]
    },
    {
      title: 'Personal Details',
      fields: [
        { name: 'date_of_birth', label: 'Date of Birth', type: 'date', defaultValue: employee?.date_of_birth?.split('T')[0] },
        { name: 'post_code', label: 'Post Code', type: 'text', defaultValue: employee?.post_code },
        { name: 'address', label: 'Address', type: 'textarea', defaultValue: employee?.address, wide: true },
      ]
    },
    {
      title: 'Additional',
      fields: [
        { name: 'uniform_preference', label: 'Uniform Preference', type: 'text', defaultValue: employee?.uniform_preference },
        { name: 'keyholder_status', label: 'Keyholder Status', type: 'checkbox', checkboxLabel: 'Employee is a keyholder', defaultChecked: employee?.keyholder_status ?? false },
      ]
    }
  ];

  const totalSteps = formSteps.length;
  const currentStepData = formSteps[currentStep];
  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  const fieldError = (name: string): string | undefined => state?.errors?.[name]?.join(' ') || undefined;

  const renderControl = (field: FormField) => {
    const error = fieldError(field.name);
    if (field.type === 'textarea') {
      return (
        <Textarea
          id={field.name}
          name={field.name}
          rows={3}
          defaultValue={field.defaultValue || ''}
          error={error}
        />
      );
    }
    if (field.type === 'checkbox') {
      return (
        <Checkbox
          id={field.name}
          name={field.name}
          label={field.checkboxLabel ?? field.label}
          defaultChecked={field.defaultChecked}
          value="true"
        />
      );
    }
    if (field.type === 'select') {
      return (
        <Select
          id={field.name}
          name={field.name}
          defaultValue={field.defaultValue || (field.name === 'status' ? 'Active' : '')}
          required={field.required}
          error={error}
          options={field.options?.map(option => ({ label: option, value: option }))}
        />
      );
    }
    return (
      <Input
        type={field.type}
        name={field.name}
        id={field.name}
        defaultValue={field.defaultValue || ''}
        required={field.required}
        error={error}
      />
    );
  };

  return (
    <form action={dispatch} className="space-y-6">
      <input type="hidden" name="employee_id" value={employee?.employee_id || ''} />
      {/* An unticked checkbox sends nothing, so the hidden "false" goes first and a ticked box
          overrides it. It sits outside the field so it does not steal the label. */}
      <input type="hidden" name="keyholder_status" value="false" />

      {/* Progress Indicator */}
      {isMobile && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-text-muted">Step {currentStep + 1} of {totalSteps}</span>
            <span className="text-sm font-medium text-text">{currentStepData.title}</span>
          </div>
          <ProgressBar value={((currentStep + 1) / totalSteps) * 100} size="md" label="Form progress" />
        </div>
      )}

      {/*
        Every step stays mounted, on mobile as well as desktop, and inactive
        steps are hidden with CSS. Rendering only the current step unmounted
        the other inputs, so the submitted FormData held just that step's
        fields and employeeSchema rejected every save on a narrow screen.
      */}
      {formSteps.map((step, stepIndex) => (
        <div
          key={step.title}
          className={isMobile && stepIndex !== currentStep ? 'hidden' : undefined}
          aria-hidden={isMobile && stepIndex !== currentStep}
        >
          <Card>
            {/* The mobile step indicator above already names the current step. */}
            {!isMobile && <CardHeader title={step.title} />}
            <CardBody className="grid gap-4 sm:grid-cols-2">
              {step.fields.map((field) => {
                const error = fieldError(field.name);
                // A checkbox answers its own question under a group legend styled like a Field
                // label; it has no error of its own, so the Fieldset shows it.
                if (field.type === 'checkbox') {
                  return (
                    <Fieldset
                      key={field.name}
                      legend={field.label}
                      required={field.required}
                      hint={error ? undefined : field.hint}
                      error={error}
                      className={field.wide ? 'sm:col-span-2' : undefined}
                    >
                      {renderControl(field)}
                    </Fieldset>
                  );
                }
                return (
                  <Field
                    key={field.name}
                    label={field.label}
                    required={field.required}
                    hint={error ? undefined : field.hint}
                    className={field.wide ? 'sm:col-span-2' : undefined}
                  >
                    {renderControl(field)}
                  </Field>
                );
              })}
            </CardBody>
          </Card>
        </div>
      ))}

      {state?.type === 'error' && !state.errors && (
        <Alert tone="danger">{state.message}</Alert>
      )}

      {/* Phones step through the form; Save appears on the last step. */}
      {isMobile && (
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
            disabled={isFirstStep}
            icon={<Icon name="chevronLeft" size={16} />}
          >
            Previous
          </Button>
          {!isLastStep && (
            <Button
              type="button"
              variant="primary"
              onClick={() => setCurrentStep(prev => Math.min(totalSteps - 1, prev + 1))}
              iconRight={<Icon name="chevronRight" size={16} />}
            >
              Next
            </Button>
          )}
        </div>
      )}

      <FormFooter>
        {cancelHref && (
          <LinkButton href={cancelHref} variant="secondary">
            Cancel
          </LinkButton>
        )}
        {(!isMobile || isLastStep) && <SubmitButton text={submitButtonText} />}
      </FormFooter>
    </form>
  );
}
