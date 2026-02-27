'use client';

import { useState } from 'react';
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
  onSuccess: (data: EmergencyContactsData) => void;
}

const emptyContact = (): ContactData => ({
  name: '',
  relationship: '',
  phone_number: '',
  mobile_number: '',
  address: '',
});

export default function EmergencyContactsStep({ token, onSuccess }: EmergencyContactsStepProps) {
  const [data, setData] = useState<EmergencyContactsData>({
    primary: emptyContact(),
    secondary: emptyContact(),
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
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </h3>
      {(['name', 'relationship', 'phone_number', 'mobile_number', 'address'] as (keyof ContactData)[]).map((field) => (
        <div key={field}>
          <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">
            {field.replace(/_/g, ' ')}
            {field === 'name' && required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <input
            type="text"
            value={values[field]}
            onChange={(e) => onChange(field, e.target.value)}
            required={field === 'name' && required}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>
      ))}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {renderContactFields(
        'Primary Contact',
        data.primary,
        (field, value) => setData({ ...data, primary: { ...data.primary, [field]: value } }),
        true
      )}

      <hr className="border-gray-200" />

      {renderContactFields(
        'Secondary Contact (Optional)',
        data.secondary,
        (field, value) => setData({ ...data, secondary: { ...data.secondary, [field]: value } }),
        false
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
      >
        {loading ? 'Saving...' : 'Save & Continue'}
      </button>
    </form>
  );
}
