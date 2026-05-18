'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Stepper } from '@/ds'
import CreateAccountStep from '../steps/CreateAccountStep'
import PersonalStep from '../steps/PersonalStep'
import EmergencyContactsStep from '../steps/EmergencyContactsStep'
import FinancialStep from '../steps/FinancialStep'
import HealthStep from '../steps/HealthStep'
import ReviewStep from '../steps/ReviewStep'
import type { InviteType, OnboardingSnapshot } from '@/app/actions/employeeInvite'

interface OnboardingClientProps {
  token: string
  email: string
  inviteType: InviteType
  hasAuthUser: boolean
  initialData: OnboardingSnapshot | null
}

type SectionKey = 'personal' | 'emergency_contacts' | 'financial' | 'health'

const ONBOARDING_STEPS = [
  { key: 'create_account', title: 'Create Account' },
  { key: 'personal', title: 'Personal Details' },
  { key: 'emergency_contacts', title: 'Emergency Contacts' },
  { key: 'financial', title: 'Financial Details' },
  { key: 'health', title: 'Health Information' },
  { key: 'review', title: 'Review & Submit' },
] as const

function firstIncompleteStepIndex(savedSections: Record<SectionKey, boolean>): number {
  const orderedSections: SectionKey[] = ['personal', 'emergency_contacts', 'financial', 'health']
  const firstMissing = orderedSections.findIndex((section) => !savedSections[section])
  return firstMissing === -1 ? orderedSections.length : firstMissing
}

export default function OnboardingClient({
  token,
  email,
  inviteType,
  hasAuthUser,
  initialData,
}: OnboardingClientProps) {
  if (inviteType === 'portal_access') {
    return <PortalAccessSetup token={token} email={email} />
  }

  return (
    <OnboardingFlow
      token={token}
      email={email}
      hasAuthUser={hasAuthUser}
      initialData={initialData}
    />
  )
}

function PortalAccessSetup({ token, email }: { token: string; email: string }) {
  const router = useRouter()

  return (
    <div className="onboard">
      <div className="onboard__topbar">
        <span className="onboard__brand">The Anchor - Staff Portal Setup</span>
      </div>
      <div className="onboard__body" style={{ gridTemplateColumns: '1fr' }}>
        <div className="onboard__main">
          <h1 className="onboard__h1">Set Up Staff Portal Access</h1>
          <CreateAccountStep
            token={token}
            email={email}
            description="Create a password for your staff portal account. Your existing employee details will not be changed."
            buttonLabel="Set Up Portal Access"
            loadingLabel="Setting up access..."
            onSuccess={() => router.push('/onboarding/success?type=portal_access')}
          />
        </div>
      </div>
    </div>
  )
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
  }

  const [accountCreated, setAccountCreated] = useState(hasAuthUser)
  const [savedSections, setSavedSections] = useState<Record<SectionKey, boolean>>(initialSavedSections)

  const visibleSteps = useMemo(
    () =>
      accountCreated
        ? ONBOARDING_STEPS.filter((step) => step.key !== 'create_account')
        : ONBOARDING_STEPS,
    [accountCreated],
  )

  const initialStepIndex = accountCreated ? firstIncompleteStepIndex(initialSavedSections) : 0
  const [currentStepIndex, setCurrentStepIndex] = useState(initialStepIndex)

  const markSectionComplete = (section: SectionKey) => {
    setSavedSections((prev) => ({ ...prev, [section]: true }))
  }

  const goToNextStep = () => {
    setCurrentStepIndex((index) => Math.min(index + 1, visibleSteps.length - 1))
  }

  const goToPrevStep = () => {
    setCurrentStepIndex((index) => Math.max(index - 1, 0))
  }

  const currentStep = visibleSteps[currentStepIndex] ?? visibleSteps[visibleSteps.length - 1]

  const stepperSteps = visibleSteps.map((step, i) => ({
    label: step.title,
    status: (i < currentStepIndex ? 'done' : i === currentStepIndex ? 'active' : 'upcoming') as 'done' | 'active' | 'upcoming',
  }))

  const renderStepContent = () => {
    switch (currentStep?.key) {
      case 'create_account':
        return (
          <CreateAccountStep
            token={token}
            email={email}
            onSuccess={() => {
              setAccountCreated(true)
              setCurrentStepIndex(0)
            }}
          />
        )
      case 'personal':
        return (
          <PersonalStep
            token={token}
            initialData={initialData?.personal}
            onSuccess={() => {
              markSectionComplete('personal')
              goToNextStep()
            }}
          />
        )
      case 'emergency_contacts':
        return (
          <EmergencyContactsStep
            token={token}
            initialData={initialData?.emergency_contacts}
            onSuccess={() => {
              markSectionComplete('emergency_contacts')
              goToNextStep()
            }}
          />
        )
      case 'financial':
        return (
          <FinancialStep
            token={token}
            initialData={initialData?.financial}
            onSuccess={() => {
              markSectionComplete('financial')
              goToNextStep()
            }}
          />
        )
      case 'health':
        return (
          <HealthStep
            token={token}
            initialData={initialData?.health}
            onSuccess={() => {
              markSectionComplete('health')
              goToNextStep()
            }}
          />
        )
      case 'review':
        return (
          <ReviewStep
            token={token}
            savedSections={savedSections}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="onboard">
      <div className="onboard__topbar">
        <span className="onboard__brand">The Anchor - Employee Onboarding</span>
        <span className="text-xs text-text-muted">
          Step {currentStepIndex + 1} of {visibleSteps.length}
        </span>
      </div>

      <div className="onboard__body">
        <nav className="onboard__rail">
          <Stepper steps={stepperSteps} />
        </nav>

        <div className="onboard__main">
          <h1 className="onboard__h1">{currentStep?.title}</h1>

          {renderStepContent()}

          <div className="onboard__nav">
            {currentStepIndex > 0 && (
              <Button variant="secondary" onClick={goToPrevStep}>
                Back
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
