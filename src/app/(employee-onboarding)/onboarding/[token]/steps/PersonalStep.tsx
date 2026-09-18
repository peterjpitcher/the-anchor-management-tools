'use client';

import { useState } from 'react';
import { Button, Field, Input, Textarea } from '@/ds';
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

// A clash is a warning, not an error: the field keeps the DS focus pattern in the warning tone.
const PREFERRED_NAME_WARNING_CLASSES =
  'border-warning focus:border-warning focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-warning)_20%,transparent)]';

interface PersonalStepProps {
  token: string;
  initialData?: Partial<PersonalData>;
  onSuccess: (data: PersonalData) => void;
}

export default function PersonalStep({ token, initialData, onSuccess }: PersonalStepProps) {
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
      <div>
        <Field label="Preferred Name">
          <Input
            id="preferred_name"
            type="text"
            value={data.preferred_name}
            onChange={(e) => {
              setData({ ...data, preferred_name: e.target.value });
              if (preferredNameWarning) setPreferredNameWarning('');
            }}
            onBlur={handlePreferredNameBlur}
            aria-invalid={preferredNameWarning ? true : undefined}
            aria-describedby="preferred_name-help"
            className={preferredNameWarning ? PREFERRED_NAME_WARNING_CLASSES : undefined}
          />
        </Field>
        {preferredNameWarning && (
          <p className="mt-1 text-sm text-warning-fg" role="status">
            {preferredNameWarning}
          </p>
        )}
        <p id="preferred_name-help" className="mt-1 text-xs text-text-muted">
          What you would like the team to call you. Leave blank to use your first name. If someone
          here already goes by the same name, add your first initial, for example &quot;Jacob H&quot;.
        </p>
      </div>
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

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" variant="primary" className="w-full" disabled={loading}>
        {loading ? 'Saving...' : 'Save & Continue'}
      </Button>
    </form>
  );
}
