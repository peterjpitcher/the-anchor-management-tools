'use client';

import { useState } from 'react';
import { Alert, Button, Field, Input, Textarea } from '@/ds';
import { StepFooter } from './StepParts';
import { checkPreferredNameAvailability, saveOnboardingSection } from '@/app/actions/employeeInvite';

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

interface PersonalStepProps {
  token: string;
  initialData?: Partial<PersonalData>;
  onSuccess: (data: PersonalData) => void;
  onBack?: () => void;
}

export default function PersonalStep({ token, initialData, onSuccess, onBack }: PersonalStepProps) {
  const [data, setData] = useState<PersonalData>({
    first_name: initialData?.first_name ?? '',
    last_name: initialData?.last_name ?? '',
    preferred_name: initialData?.preferred_name ?? '',
    date_of_birth: initialData?.date_of_birth ?? '',
    address: initialData?.address ?? '',
    post_code: initialData?.post_code ?? '',
    phone_number: initialData?.phone_number ?? '',
    mobile_number: initialData?.mobile_number ?? '',
  });
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

    if (!data.first_name.trim()) {
      setError('First name is required.');
      return;
    }
    if (!data.last_name.trim()) {
      setError('Last name is required.');
      return;
    }

    setLoading(true);
    try {
      const result = await saveOnboardingSection(token, 'personal', {
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        preferred_name: data.preferred_name.trim() || null,
        date_of_birth: data.date_of_birth || null,
        address: data.address || null,
        post_code: data.post_code || null,
        phone_number: data.phone_number || null,
        mobile_number: data.mobile_number || null,
      });

      if (result.success) {
        onSuccess(data);
      } else {
        setError(result.error || 'Failed to save. Please try again.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const field = (id: keyof PersonalData, label: string, type = 'text', required = false) => (
    <Field label={label} required={required}>
      <Input
        id={id}
        type={type}
        value={data[id]}
        onChange={(e) => setData({ ...data, [id]: e.target.value })}
        required={required}
      />
    </Field>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('first_name', 'First Name', 'text', true)}
        {field('last_name', 'Last Name', 'text', true)}
      </div>
      {/* A clash is a warning, not an error: it does not stop saving here (the server still
          enforces the rule), so the field draws in amber with the message under it. */}
      <Field
        label="Preferred Name"
        hint={'What you would like the team to call you. Leave blank to use your first name. If someone here already goes by the same name, add your first initial, for example "Jacob H".'}
      >
        <Input
          id="preferred_name"
          type="text"
          value={data.preferred_name}
          onChange={(e) => {
            setData({ ...data, preferred_name: e.target.value });
            if (preferredNameWarning) setPreferredNameWarning('');
          }}
          onBlur={handlePreferredNameBlur}
          warning={preferredNameWarning || undefined}
        />
      </Field>
      {field('date_of_birth', 'Date of Birth', 'date')}
      <Field label="Address">
        <Textarea
          id="address"
          value={data.address}
          onChange={(e) => setData({ ...data, address: e.target.value })}
          rows={3}
        />
      </Field>
      {field('post_code', 'Post Code')}
      {field('phone_number', 'Phone Number', 'tel')}
      {field('mobile_number', 'Mobile Number', 'tel')}

      {error && <Alert tone="danger">{error}</Alert>}

      <StepFooter onBack={onBack}>
        <Button type="submit" variant="primary" loading={loading}>
          Save & Continue
        </Button>
      </StepFooter>
    </form>
  );
}
