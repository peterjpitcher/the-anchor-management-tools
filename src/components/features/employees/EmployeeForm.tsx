'use client'

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
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
  /** Shown and sent, but not editable here (it is changed by an action on the employee page). */
  readOnly?: boolean;
}

/**
 * What the edit form says about a status it will not change. Only Onboarding to Active is a
 * plain edit; every other move goes through the separation actions on the employee's page, which
 * settle their last day, shifts and access.
 */
function statusLockedHint(status: Employee['status']): string {
  switch (status) {
    case 'Started Separation':
      return 'This employee is part-way through a separation. Use Cancel Separation or Mark as Former on their page to change it.';
    case 'Former':
      return 'Former employees cannot be changed back here.';
    default:
      return 'To start a separation, use Begin Separation on the employee page.';
  }
}

export default function EmployeeForm({
  employee,
  formAction,
  initialFormState,
  cancelHref,
  submitButtonText = 'Save Personal Details',
}: EmployeeFormProps) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(formAction, initialFormState);
  const [currentStep, setCurrentStep] = useState(0);
  // Phones fill the form in one step at a time; the switch matches the app shell's.
  const isMobile = useMediaQuery(SHELL_MEDIA_QUERY);
  const handledState = useRef<ActionFormState | null>(initialFormState);

  // Status is a choice only for a new starter (Onboarding or Active). Otherwise it is shown and
  // sent unchanged: the separation flow owns every other move.
  const statusEditable = !employee || employee.status === 'Onboarding';
  const statusOptions = ['Onboarding', 'Active'];
  // While separating, the last day is set by the separation and changed only through it.
  const endDateLocked = employee?.status === 'Started Separation';

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
        statusEditable
          ? { name: 'status', label: 'Status', type: 'select', required: true, options: statusOptions, defaultValue: employee?.status || 'Active' }
          : { name: 'status', label: 'Status', type: 'text', readOnly: true, defaultValue: employee?.status, hint: statusLockedHint(employee?.status ?? 'Active') },
        { name: 'employment_start_date', label: 'Employment Start Date', type: 'date', required: true, defaultValue: employee?.employment_start_date?.split('T')[0] },
        {
          name: 'employment_end_date',
          label: 'Employment End Date',
          type: 'date',
          defaultValue: employee?.employment_end_date?.split('T')[0],
          ...(endDateLocked
            ? {
                readOnly: true,
                hint: 'Set by the separation. To change it, use Cancel Separation on the employee page, then Begin Separation again with the new date.',
              }
            : {}),
        },
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

  // Field errors from the server, in form order, for the summary above the buttons. On a phone
  // the other steps are hidden, so without the summary (and the jump below) a refused save
  // looked like nothing had happened.
  const errorEntries = state?.type === 'error' && state.errors
    ? Object.entries(state.errors).filter(([, messages]) => messages && messages.length > 0)
    : [];
  const fieldLabel = (name: string): string =>
    formSteps.flatMap((step) => step.fields).find((field) => field.name === name)?.label ?? 'Form';
  const firstErrorStep = formSteps.findIndex((step) =>
    step.fields.some((field) => Boolean(state?.errors?.[field.name]?.length))
  );

  useEffect(() => {
    if (!state || handledState.current === state) return;
    handledState.current = state;

    if (state.type === 'success') {
      // Only an existing employee is sent to their page; a new one is routed by the caller.
      if (employee) {
        if (state.warning) {
          toast.warning(state.message);
        } else {
          toast.success(state.message || 'Employee updated successfully.');
        }
        router.push(`/employees/${employee.employee_id}`);
      }
      return;
    }

    if (isMobile && firstErrorStep >= 0) {
      setCurrentStep(firstErrorStep);
    }
  }, [state, router, employee, isMobile, firstErrorStep]);

  // onSubmit rather than a form action: a React 19 form action resets the form after every
  // submit, so a refused save wiped what had been typed.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };

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
        readOnly={field.readOnly}
        error={error}
      />
    );
  };

  return (
    // Phones skip the browser's own checks: it cannot point at a field on a hidden step, so it
    // refused to submit without saying why. The server checks every field and the form jumps to
    // the first step with an error.
    <form onSubmit={handleSubmit} noValidate={isMobile} className="space-y-6">
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

      {errorEntries.length > 0 && (
        <Alert tone="danger" title="Please check these fields">
          <ul className="list-disc space-y-1 pl-5">
            {errorEntries.map(([name, messages]) => (
              <li key={name}>
                {fieldLabel(name)}: {messages?.join(' ')}
              </li>
            ))}
          </ul>
        </Alert>
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
        {(!isMobile || isLastStep) && (
          <Button type="submit" loading={pending} variant="primary">
            {submitButtonText}
          </Button>
        )}
      </FormFooter>
    </form>
  );
}
