'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Icon } from '@/ds';
import { submitOnboardingProfile } from '@/app/actions/employeeInvite';
import { useRouter } from 'next/navigation';
import {
  ONBOARDING_SECTION_ICON,
  ONBOARDING_SECTION_LABEL,
  ONBOARDING_SECTION_TONE,
  type OnboardingSectionState,
} from '../../_shared/status-ui';
import { StepFooter } from './StepParts';

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
  onBack?: () => void;
}

export default function ReviewStep({ token, savedSections, onBack }: ReviewStepProps) {
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

      <ul className="divide-y divide-border rounded-lg border border-border">
        {sections.map((section) => {
          const state: OnboardingSectionState = savedSections[section.key] ? 'complete' : 'incomplete';
          return (
            <li key={section.key} className="flex items-center gap-3 px-4 py-3">
              <Icon
                name={ONBOARDING_SECTION_ICON[state].name}
                size={18}
                className={ONBOARDING_SECTION_ICON[state].className}
              />
              <span className="text-sm text-text">{section.label}</span>
              <Badge tone={ONBOARDING_SECTION_TONE[state]} size="sm" className="ml-auto">
                {ONBOARDING_SECTION_LABEL[state]}
              </Badge>
            </li>
          );
        })}
      </ul>

      {!allComplete && (
        <Alert tone="warning" role="status">
          Please complete all sections before submitting. Personal details (first and last name) must be completed before submitting.
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <StepFooter onBack={onBack}>
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={loading || !allComplete}
        >
          {loading ? 'Submitting...' : 'Complete Profile'}
        </Button>
      </StepFooter>
    </div>
  );
}
