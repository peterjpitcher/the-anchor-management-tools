'use client';

import { useState } from 'react';
import { submitOnboardingProfile } from '@/app/actions/employeeInvite';
import { useRouter } from 'next/navigation';

interface ReviewStepProps {
  token: string;
  savedSections: {
    personal: boolean;
    emergency_contacts: boolean;
    financial: boolean;
    health: boolean;
  };
}

export default function ReviewStep({ token, savedSections }: ReviewStepProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await submitOnboardingProfile(token);
      if (result.success) {
        router.push('/onboarding/success');
      } else {
        setError(result.error || 'Failed to submit. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const sections = [
    { key: 'personal', label: 'Personal Details' },
    { key: 'emergency_contacts', label: 'Emergency Contacts' },
    { key: 'financial', label: 'Financial Details' },
    { key: 'health', label: 'Health Information' },
  ] as const;

  const allComplete = sections.every((s) => savedSections[s.key]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Please review your completed sections below. Once you submit, your profile will be activated and your manager will be notified.
      </p>

      <div className="space-y-2">
        {sections.map((section) => (
          <div key={section.key} className="flex items-center gap-3 rounded-md border border-gray-200 px-4 py-3">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                savedSections[section.key]
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {savedSections[section.key] ? '✓' : '!'}
            </span>
            <span className="text-sm text-gray-800">{section.label}</span>
            <span className={`ml-auto text-xs font-medium ${savedSections[section.key] ? 'text-green-600' : 'text-yellow-600'}`}>
              {savedSections[section.key] ? 'Complete' : 'Incomplete'}
            </span>
          </div>
        ))}
      </div>

      {!allComplete && (
        <p className="text-sm text-yellow-700 bg-yellow-50 rounded-md px-4 py-3">
          Please complete all sections before submitting. Personal details and emergency contacts are required.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={loading || !allComplete}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
      >
        {loading ? 'Submitting...' : 'Complete Profile'}
      </button>
    </div>
  );
}
