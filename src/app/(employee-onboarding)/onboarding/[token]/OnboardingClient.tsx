'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import CreateAccountStep from './steps/CreateAccountStep';
import PersonalStep from './steps/PersonalStep';
import EmergencyContactsStep from './steps/EmergencyContactsStep';
import FinancialStep from './steps/FinancialStep';
import HealthStep from './steps/HealthStep';
import ReviewStep from './steps/ReviewStep';

interface OnboardingClientProps {
  token: string;
  email: string;
  employeeId: string;
  hasAuthUser: boolean;
}

type SectionKey = 'personal' | 'emergency_contacts' | 'financial' | 'health';

const STEPS = [
  { key: 'create_account', title: 'Create Account' },
  { key: 'personal', title: 'Personal Details' },
  { key: 'emergency_contacts', title: 'Emergency Contacts' },
  { key: 'financial', title: 'Financial Details' },
  { key: 'health', title: 'Health Information' },
  { key: 'review', title: 'Review & Submit' },
] as const;

export default function OnboardingClient({
  token,
  email,
  employeeId,
  hasAuthUser,
}: OnboardingClientProps) {
  // If account already exists, skip the create account step
  const initialStep = hasAuthUser ? 1 : 0;
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [accountCreated, setAccountCreated] = useState(hasAuthUser);
  const [savedSections, setSavedSections] = useState<Record<SectionKey, boolean>>({
    personal: false,
    emergency_contacts: false,
    financial: false,
    health: false,
  });

  // Sign-in state (for returning visitors who have an account but no session)
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [signInPassword, setSignInPassword] = useState('');
  const [signInError, setSignInError] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignInError('');
    setSignInLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password: signInPassword });
      if (error) {
        setSignInError(error.message || 'Sign in failed. Please check your password.');
      } else {
        setNeedsSignIn(false);
      }
    } finally {
      setSignInLoading(false);
    }
  };

  const markSectionComplete = (section: SectionKey) => {
    setSavedSections((prev) => ({ ...prev, [section]: true }));
  };

  const visibleSteps = hasAuthUser || accountCreated
    ? STEPS.filter((s) => s.key !== 'create_account')
    : STEPS;

  const adjustedStep = hasAuthUser || accountCreated ? currentStep - 1 : currentStep;
  const activeVisibleStep = Math.max(0, adjustedStep);

  // If returning visitor with account but needs to sign in
  if (hasAuthUser && needsSignIn) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Welcome back</h2>
        <p className="text-sm text-gray-600 mb-6">Please sign in to continue with your profile.</p>
        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              readOnly
              className="block w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={signInPassword}
              onChange={(e) => setSignInPassword(e.target.value)}
              required
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          {signInError && <p className="text-sm text-red-600">{signInError}</p>}
          <button
            type="submit"
            disabled={signInLoading}
            className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
          >
            {signInLoading ? 'Signing in...' : 'Sign In & Continue'}
          </button>
        </form>
      </div>
    );
  }

  const renderStepContent = () => {
    const stepKey = currentStep === 0 && !accountCreated ? 'create_account' : visibleSteps[activeVisibleStep]?.key;

    switch (stepKey) {
      case 'create_account':
        return (
          <CreateAccountStep
            token={token}
            email={email}
            onSuccess={() => {
              setAccountCreated(true);
              setCurrentStep(1);
            }}
          />
        );
      case 'personal':
        return (
          <PersonalStep
            token={token}
            onSuccess={() => {
              markSectionComplete('personal');
              setCurrentStep((s) => s + 1);
            }}
          />
        );
      case 'emergency_contacts':
        return (
          <EmergencyContactsStep
            token={token}
            onSuccess={() => {
              markSectionComplete('emergency_contacts');
              setCurrentStep((s) => s + 1);
            }}
          />
        );
      case 'financial':
        return (
          <FinancialStep
            token={token}
            onSuccess={() => {
              markSectionComplete('financial');
              setCurrentStep((s) => s + 1);
            }}
          />
        );
      case 'health':
        return (
          <HealthStep
            token={token}
            onSuccess={() => {
              markSectionComplete('health');
              setCurrentStep((s) => s + 1);
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

  const totalSteps = visibleSteps.length;
  const displayStep = activeVisibleStep + 1;
  const currentStepData = visibleSteps[activeVisibleStep];

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Step {displayStep} of {totalSteps}
            </p>
            <h2 className="text-lg font-semibold text-gray-900 mt-0.5">
              {currentStepData?.title}
            </h2>
          </div>
          <span className="text-sm text-gray-400">{Math.round((displayStep / totalSteps) * 100)}%</span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-300"
            style={{ width: `${(displayStep / totalSteps) * 100}%` }}
          />
        </div>

        {/* Step dots */}
        <div className="flex items-center gap-2 mt-4">
          {visibleSteps.map((step, index) => (
            <button
              key={step.key}
              onClick={() => {
                // Only allow going back to completed steps
                if (index < activeVisibleStep) {
                  setCurrentStep(hasAuthUser ? index + 1 : index);
                }
              }}
              className={`flex-1 h-1 rounded-full transition-colors ${
                index < activeVisibleStep
                  ? 'bg-green-500 cursor-pointer'
                  : index === activeVisibleStep
                  ? 'bg-green-400'
                  : 'bg-gray-200 cursor-default'
              }`}
              title={step.title}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        {renderStepContent()}
      </div>
    </div>
  );
}
