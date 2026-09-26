'use client';

import { useState } from 'react';
import { Alert, Button, Field, Input } from '@/ds';
import { StepFooter, StepSection } from './StepParts';
import { saveOnboardingSection } from '@/app/actions/employeeInvite';

interface ContactData {
  name: string;
  relationship: string;
  phone_number: string;
  mobile_number: string;
  address: string;
}

interface EmergencyContactsData {
  primary: ContactData;
  secondary: ContactData;
}

interface EmergencyContactsStepProps {
  token: string;
  initialData?: EmergencyContactsData;
  onSuccess: (data: EmergencyContactsData) => void;
  onBack?: () => void;
}

const emptyContact = (): ContactData => ({
  name: '',
  relationship: '',
  phone_number: '',
  mobile_number: '',
  address: '',
});

export default function EmergencyContactsStep({ token, initialData, onSuccess, onBack }: EmergencyContactsStepProps) {
  const [data, setData] = useState<EmergencyContactsData>({
    primary: initialData?.primary ?? emptyContact(),
    secondary: initialData?.secondary ?? emptyContact(),
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!data.primary.name.trim()) {
      setError('Primary contact name is required.');
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        primary: {
          name: data.primary.name.trim(),
          relationship: data.primary.relationship || null,
          phone_number: data.primary.phone_number || null,
          mobile_number: data.primary.mobile_number || null,
          address: data.primary.address || null,
        },
      };

      if (data.secondary.name.trim()) {
        payload.secondary = {
          name: data.secondary.name.trim(),
          relationship: data.secondary.relationship || null,
          phone_number: data.secondary.phone_number || null,
          mobile_number: data.secondary.mobile_number || null,
          address: data.secondary.address || null,
        };
      }

      const result = await saveOnboardingSection(token, 'emergency_contacts', payload);
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

  const renderContactFields = (
    label: string,
    values: ContactData,
    onChange: (field: keyof ContactData, value: string) => void,
    required = false
  ) => (
    <StepSection title={label} required={required}>
      {(['name', 'relationship', 'phone_number', 'mobile_number', 'address'] as (keyof ContactData)[]).map((field) => (
        <Field key={field} label={field.replace(/_/g, ' ')} required={field === 'name' && required}>
          <Input
            type="text"
            value={values[field]}
            onChange={(e) => onChange(field, e.target.value)}
            required={field === 'name' && required}
          />
        </Field>
      ))}
    </StepSection>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {renderContactFields(
        'Primary Contact',
        data.primary,
        (field, value) => setData({ ...data, primary: { ...data.primary, [field]: value } }),
        true
      )}

      <hr className="border-border" />

      {renderContactFields(
        'Secondary Contact (Optional)',
        data.secondary,
        (field, value) => setData({ ...data, secondary: { ...data.secondary, [field]: value } }),
        false
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <StepFooter onBack={onBack}>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? 'Saving...' : 'Save & Continue'}
        </Button>
      </StepFooter>
    </form>
  );
}
