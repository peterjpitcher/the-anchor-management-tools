'use client';

import { useState } from 'react';
import { Badge, Button } from '@/ds';
import { submitOnboardingProfile } from '@/app/actions/employeeInvite';
import { useRouter } from 'next/navigation';

interface ReviewStepProps {
  token: string;
  savedSections: {
    personal: boolean;
    time_off: boolean;
    emergency_contacts: boolean;
    financial: boolean;
    health: boolean;
    right_to_work_notice: boolean;
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to submit. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sections = [
    { key: 'personal', label: 'Personal Details' },
    { key: 'time_off', label: 'Time Off Booked' },
    { key: 'emergency_contacts', label: 'Emergency Contacts' },
    { key: 'financial', label: 'Financial Details' },
    { key: 'health', label: 'Health Information' },
    { key: 'right_to_work_notice', label: 'Right to Work' },
  ] as const;

  const allComplete = sections.every((s) => savedSections[s.key]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-muted">
        Please review your completed sections below. Once you submit, your profile will be activated and your manager will be notified.
      </p>

      <div className="space-y-2">
        {sections.map((section) => (
          <div key={section.key} className="flex items-center gap-3 rounded-md border border-border px-4 py-3">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                savedSections[section.key]
                  ? 'border-success-border bg-success-soft text-success-fg'
                  : 'border-warning-border bg-warning-soft text-warning-fg'
              }`}
            >
              {savedSections[section.key] ? '✓' : '!'}
            </span>
            <span className="text-sm text-text">{section.label}</span>
            <Badge tone={savedSections[section.key] ? 'success' : 'warning'} size="sm" className="ml-auto">
              {savedSections[section.key] ? 'Complete' : 'Incomplete'}
            </Badge>
          </div>
        ))}
      </div>

      {!allComplete && (
        <p className="rounded-md border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          Please complete all sections before submitting. Personal details (first and last name) must be completed before submitting.
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button
        type="button"
        variant="primary"
        className="w-full"
        onClick={handleSubmit}
        disabled={loading || !allComplete}
      >
        {loading ? 'Submitting...' : 'Complete Profile'}
      </Button>
    </div>
  );
}
