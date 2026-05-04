'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import CreateAccountStep from './steps/CreateAccountStep';
import PersonalStep from './steps/PersonalStep';
import EmergencyContactsStep from './steps/EmergencyContactsStep';
import FinancialStep from './steps/FinancialStep';
import HealthStep from './steps/HealthStep';
import ReviewStep from './steps/ReviewStep';
import type { InviteType, OnboardingSnapshot } from '@/app/actions/employeeInvite';

interface OnboardingClientProps {
  token: string;
  email: string;
  inviteType: InviteType;
  hasAuthUser: boolean;
  initialData: OnboardingSnapshot | null;
}

type SectionKey = 'personal' | 'emergency_contacts' | 'financial' | 'health';

const ONBOARDING_STEPS = [
  { key: 'create_account', title: 'Create Account' },
  { key: 'personal', title: 'Personal Details' },
  { key: 'emergency_contacts', title: 'Emergency Contacts' },
  { key: 'financial', title: 'Financial Details' },
  { key: 'health', title: 'Health Information' },
  { key: 'review', title: 'Review & Submit' },
] as const;

function firstIncompleteStepIndex(savedSections: Record<SectionKey, boolean>): number {
  const orderedSections: SectionKey[] = ['personal', 'emergency_contacts', 'financial', 'health'];
  const firstMissing = orderedSections.findIndex((section) => !savedSections[section]);
  return firstMissing === -1 ? orderedSections.length : firstMissing;
}

export default function OnboardingClient({
  token,
  email,
  inviteType,
  hasAuthUser,
  initialData,
}: OnboardingClientProps) {
  if (inviteType === 'portal_access') {
    return <PortalAccessSetup token={token} email={email} />;
  }

  return (
    <OnboardingFlow
      token={token}
      email={email}
      hasAuthUser={hasAuthUser}
      initialData={initialData}
    />
  );
}

function PortalAccessSetup({ token, email }: { token: string; email: string }) {
  const router = useRouter();

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Set Up Staff Portal Access</h2>
      <CreateAccountStep
        token={token}
        email={email}
        description="Create a password for your staff portal account. Your existing employee details will not be changed."
        buttonLabel="Set Up Portal Access"
        loadingLabel="Setting up access..."
        onSuccess={() => router.push('/onboarding/success?type=portal_access')}
      />
    </div>
  );
}

function OnboardingFlow({
  token,
  email,
  hasAuthUser,
  initialData,
}: Omit<OnboardingClientProps, 'inviteType'>) {
  const initialSavedSections = initialData?.completedSections ?? {
    personal: false,
    emergency_contacts: false,
    financial: false,
    health: false,
  };

  const [accountCreated, setAccountCreated] = useState(hasAuthUser);
  const [savedSections, setSavedSections] = useState<Record<SectionKey, boolean>>(initialSavedSections);

  const visibleSteps = useMemo(
    () => accountCreated
      ? ONBOARDING_STEPS.filter((step) => step.key !== 'create_account')
      : ONBOARDING_STEPS,
    [accountCreated],
  );

  const initialStepIndex = accountCreated ? firstIncompleteStepIndex(initialSavedSections) : 0;
  const [currentStepIndex, setCurrentStepIndex] = useState(initialStepIndex);

  const markSectionComplete = (section: SectionKey) => {
    setSavedSections((prev) => ({ ...prev, [section]: true }));
  };

  const goToNextStep = () => {
    setCurrentStepIndex((index) => Math.min(index + 1, visibleSteps.length - 1));
  };

  const currentStep = visibleSteps[currentStepIndex] ?? visibleSteps[visibleSteps.length - 1];

  const renderStepContent = () => {
    switch (currentStep?.key) {
      case 'create_account':
        return (
          <CreateAccountStep
            token={token}
            email={email}
            onSuccess={() => {
              setAccountCreated(true);
              setCurrentStepIndex(0);
            }}
          />
        );
      case 'personal':
        return (
          <PersonalStep
            token={token}
            initialData={initialData?.personal}
            onSuccess={() => {
              markSectionComplete('personal');
              goToNextStep();
            }}
          />
        );
      case 'emergency_contacts':
        return (
          <EmergencyContactsStep
            token={token}
            initialData={initialData?.emergency_contacts}
            onSuccess={() => {
              markSectionComplete('emergency_contacts');
              goToNextStep();
            }}
          />
        );
      case 'financial':
        return (
          <FinancialStep
            token={token}
            initialData={initialData?.financial}
            onSuccess={() => {
              markSectionComplete('financial');
              goToNextStep();
            }}
          />
        );
      case 'health':
        return (
          <HealthStep
            token={token}
            initialData={initialData?.health}
            onSuccess={() => {
              markSectionComplete('health');
              goToNextStep();
            }}
          />
        );
      case 'review':
        return (
          <ReviewStep
            token={token}
            savedSections={savedSections}
          />
        );
      default:
        return null;
    }
  };

  const displayStep = currentStepIndex + 1;
  const totalSteps = visibleSteps.length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Step {displayStep} of {totalSteps}
            </p>
            <h2 className="text-lg font-semibold text-gray-900 mt-0.5">
              {currentStep?.title}
            </h2>
          </div>
          <span className="text-sm text-gray-400">{Math.round((displayStep / totalSteps) * 100)}%</span>
        </div>

        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-300"
            style={{ width: `${(displayStep / totalSteps) * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-2 mt-4">
          {visibleSteps.map((step, index) => (
            <button
              type="button"
              key={step.key}
              onClick={() => {
                if (index < currentStepIndex) {
                  setCurrentStepIndex(index);
                }
              }}
              className={`flex-1 h-1 rounded-full transition-colors ${
                index < currentStepIndex
                  ? 'bg-green-500 cursor-pointer'
                  : index === currentStepIndex
                    ? 'bg-green-400'
                    : 'bg-gray-200 cursor-default'
              }`}
              title={step.title}
            />
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-sm">
        {renderStepContent()}
      </div>
    </div>
  );
}
