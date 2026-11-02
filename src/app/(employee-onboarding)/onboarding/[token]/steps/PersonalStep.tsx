'use client';

import { useState } from 'react';
import { Alert, Button, Field, Input, Textarea } from '@/ds';
import { StepFooter, thrownStepError } from './StepParts';
import { checkPreferredNameAvailability, saveOnboardingSection } from '@/app/actions/employeeInvite';
import { dateOfBirthError } from '@/lib/employees/field-rules';

interface PersonalData {
  first_name: string;
  last_name: string;
  preferred_name: string;
  date_of_birth: string;
  address: string;
  post_code: string;
  phone_number: string;
  mobile_number: string;
}

type PersonalErrors = Partial<Record<keyof PersonalData, string>>;

interface PersonalStepProps {
  token: string;
  /** The last saved values, from the wizard (not the page load), so Back shows what was saved. */
  initialData?: Partial<PersonalData>;
  /** Already saved and complete: unchanged values move on without saving again. */
  saved?: boolean;
  onSuccess: (data: PersonalData) => void;
  onBack?: () => void;
  /** Called when the server says this browser needs to sign in first. */
  onSignInRequired?: () => void;
}

const CHECK_FIELDS_MESSAGE = 'Please check the fields marked below.';

function validatePersonal(data: PersonalData): PersonalErrors {
  const errors: PersonalErrors = {};
  if (!data.first_name.trim()) errors.first_name = 'First name is required';
  if (!data.last_name.trim()) errors.last_name = 'Last name is required';
  // The same check the server applies (field-rules.ts): required, real, and 16 to 100.
  const dobProblem = dateOfBirthError(data.date_of_birth);
  if (dobProblem) errors.date_of_birth = dobProblem;
  return errors;
}

function trimmed(data: PersonalData): PersonalData {
  return {
    ...data,
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    preferred_name: data.preferred_name.trim(),
  };
}

export default function PersonalStep({ token, initialData, saved = false, onSuccess, onBack, onSignInRequired }: PersonalStepProps) {
  const [startingValues] = useState<PersonalData>(() => ({
    first_name: initialData?.first_name ?? '',
    last_name: initialData?.last_name ?? '',
    preferred_name: initialData?.preferred_name ?? '',
    date_of_birth: initialData?.date_of_birth ?? '',
    address: initialData?.address ?? '',
    post_code: initialData?.post_code ?? '',
    phone_number: initialData?.phone_number ?? '',
    mobile_number: initialData?.mobile_number ?? '',
  }));
  const [data, setData] = useState<PersonalData>(startingValues);
  const [fieldErrors, setFieldErrors] = useState<PersonalErrors>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Warned as they leave the field rather than when they press Save. The uniqueness rule only
  // applies to Active staff, so without this the clash stays invisible until the very last step.
  const [preferredNameWarning, setPreferredNameWarning] = useState('');

  const handlePreferredNameBlur = async () => {
    const candidate = data.preferred_name.trim();
    if (!candidate) {
      setPreferredNameWarning('');
      return;
    }
    try {
      const result = await checkPreferredNameAvailability(token, candidate);
      setPreferredNameWarning(result.available ? '' : (result.message ?? ''));
    } catch {
      // A failed availability check must never block typing. Saving still enforces it.
      setPreferredNameWarning('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const errors = validatePersonal(data);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError(CHECK_FIELDS_MESSAGE);
      return;
    }

    const values = trimmed(data);

    // Nothing changed since the last save: move on without writing it again.
    if (saved && JSON.stringify(values) === JSON.stringify(trimmed(startingValues))) {
      onSuccess(values);
      return;
    }

    setLoading(true);
    try {
      const result = await saveOnboardingSection(token, 'personal', {
        first_name: values.first_name,
        last_name: values.last_name,
        preferred_name: values.preferred_name || null,
        date_of_birth: values.date_of_birth || null,
        address: values.address || null,
        post_code: values.post_code || null,
        phone_number: values.phone_number || null,
        mobile_number: values.mobile_number || null,
      });

      if (result.success) {
        onSuccess(values);
      } else {
        if (result.code === 'sign_in_required') onSignInRequired?.();
        const serverErrors = (result.fieldErrors ?? {}) as PersonalErrors;
        setFieldErrors(serverErrors);
        setError(Object.keys(serverErrors).length > 0 ? CHECK_FIELDS_MESSAGE : (result.error || 'Failed to save. Please try again.'));
      }
    } catch (caught) {
      setError(thrownStepError('Saving personal details', caught));
    } finally {
      setLoading(false);
    }
  };

  const field = (
    id: keyof PersonalData,
    label: string,
    options: { type?: string; required?: boolean; autoComplete?: string } = {},
  ) => (
    <Field label={label} required={options.required} error={fieldErrors[id]}>
      <Input
        id={id}
        type={options.type ?? 'text'}
        autoComplete={options.autoComplete}
        value={data[id]}
        onChange={(e) => setData({ ...data, [id]: e.target.value })}
        required={options.required}
      />
    </Field>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('first_name', 'First Name', { required: true, autoComplete: 'given-name' })}
        {field('last_name', 'Last Name', { required: true, autoComplete: 'family-name' })}
      </div>
      {/* A clash is a warning, not an error: it does not stop saving here (the server still
          enforces the rule), so the field draws in amber with the message under it. */}
      <Field
        label="Preferred Name"
        hint={'What you would like the team to call you. Leave blank to use your first name. If someone here already goes by the same name, add your first initial, for example "Jacob H".'}
        error={fieldErrors.preferred_name}
      >
        <Input
          id="preferred_name"
          type="text"
          autoComplete="nickname"
          value={data.preferred_name}
          onChange={(e) => {
            setData({ ...data, preferred_name: e.target.value });
            if (preferredNameWarning) setPreferredNameWarning('');
          }}
          onBlur={handlePreferredNameBlur}
          warning={preferredNameWarning || undefined}
        />
      </Field>
      {field('date_of_birth', 'Date of Birth', { type: 'date', required: true, autoComplete: 'bday' })}
      <Field label="Address" error={fieldErrors.address}>
        <Textarea
          id="address"
          autoComplete="street-address"
          value={data.address}
          onChange={(e) => setData({ ...data, address: e.target.value })}
          rows={3}
        />
      </Field>
      {field('post_code', 'Post Code', { autoComplete: 'postal-code' })}
      {field('phone_number', 'Phone Number', { type: 'tel', autoComplete: 'tel' })}
      {field('mobile_number', 'Mobile Number', { type: 'tel', autoComplete: 'tel' })}

      {error && <Alert tone="danger">{error}</Alert>}

      <StepFooter onBack={onBack}>
        <Button type="submit" variant="primary" loading={loading}>
          Save & Continue
        </Button>
      </StepFooter>
    </form>
  );
}
