'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, Stepper } from '@/ds'
import { StandalonePageHeader, StandaloneShell } from '@/components/shells/StandaloneShell'
import CreateAccountStep from '../steps/CreateAccountStep'
import PersonalStep from '../steps/PersonalStep'
import EmergencyContactsStep from '../steps/EmergencyContactsStep'
import FinancialStep from '../steps/FinancialStep'
import HealthStep from '../steps/HealthStep'
import TimeOffStep from '../steps/TimeOffStep'
import RightToWorkNoticeStep from '../steps/RightToWorkNoticeStep'
import ReviewStep from '../steps/ReviewStep'
import type { InviteType, OnboardingSnapshot } from '@/app/actions/employeeInvite'

interface OnboardingClientProps {
  token: string
  email: string
  inviteType: InviteType
  hasAuthUser: boolean
  initialData: OnboardingSnapshot | null
}

type SectionKey = 'personal' | 'emergency_contacts' | 'financial' | 'health' | 'time_off' | 'right_to_work_notice'

const ONBOARDING_STEPS = [
  { key: 'create_account', title: 'Create Account' },
  { key: 'personal', title: 'Personal Details' },
  { key: 'time_off', title: 'Time Off Booked' },
  { key: 'emergency_contacts', title: 'Emergency Contacts' },
  { key: 'financial', title: 'Financial Details' },
  { key: 'health', title: 'Health Information' },
  { key: 'right_to_work_notice', title: 'Right to Work' },
  { key: 'review', title: 'Review & Submit' },
] as const

function firstIncompleteStepIndex(savedSections: Record<SectionKey, boolean>): number {
  const orderedSections: SectionKey[] = ['personal', 'time_off', 'emergency_contacts', 'financial', 'health', 'right_to_work_notice']
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
    <StandaloneShell label="Staff Portal Setup">
      <StandalonePageHeader title="Set Up Staff Portal Access" />
      <Card>
        <CardBody>
          <CreateAccountStep
            token={token}
            email={email}
            description="Create a password for your staff portal account. Your existing employee details will not be changed."
            buttonLabel="Set Up Portal Access"
            loadingLabel="Setting up access..."
            onSuccess={() => router.push('/onboarding/success?type=portal_access')}
          />
        </CardBody>
      </Card>
    </StandaloneShell>
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
    time_off: false,
    emergency_contacts: false,
    financial: false,
    health: false,
    right_to_work_notice: false,
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

  // Back sits in each step's form footer, beside that step's own submit button.
  const onBack = currentStepIndex > 0 ? goToPrevStep : undefined

  const renderStepContent = () => {
    switch (currentStep?.key) {
      case 'create_account':
        return (
          <CreateAccountStep
            token={token}
            email={email}
            onBack={onBack}
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
            onBack={onBack}
            initialData={initialData?.personal}
            onSuccess={() => {
              markSectionComplete('personal')
              goToNextStep()
            }}
          />
        )
      case 'time_off':
        return (
          <TimeOffStep
            token={token}
            onBack={onBack}
            initialAnswer={initialData?.time_off?.answer ?? null}
            initialBlocks={initialData?.time_off?.blocks ?? []}
            initialSubmissionVersion={initialData?.time_off?.submissionVersion ?? 0}
            onSuccess={() => {
              markSectionComplete('time_off')
              goToNextStep()
            }}
          />
        )
      case 'emergency_contacts':
        return (
          <EmergencyContactsStep
            token={token}
            onBack={onBack}
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
            onBack={onBack}
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
            onBack={onBack}
            initialData={initialData?.health}
            onSuccess={() => {
              markSectionComplete('health')
              goToNextStep()
            }}
          />
        )
      case 'right_to_work_notice':
        return (
          <RightToWorkNoticeStep
            token={token}
            onBack={onBack}
            initialAcknowledged={initialData?.right_to_work_notice?.acknowledged ?? false}
            onSuccess={() => {
              markSectionComplete('right_to_work_notice')
              goToNextStep()
            }}
          />
        )
      case 'review':
        return (
          <ReviewStep
            token={token}
            savedSections={savedSections}
            onBack={onBack}
          />
        )
      default:
        return null
    }
  }

  return (
    <StandaloneShell label="Employee Onboarding" width="wide">
      <StandalonePageHeader title={currentStep?.title ?? ''} />

      {/* The Stepper is the rail of every step beside the form on a wide screen, and one line
          ("Step 2 of 8" with a bar) above the form on a phone, so it carries the step count at
          every width and the header does not repeat it. */}
      <div className="grid gap-6 shell:grid-cols-[16rem_minmax(0,1fr)]">
        <Stepper steps={stepperSteps} />

        <Card>
          <CardBody>{renderStepContent()}</CardBody>
        </Card>
      </div>
    </StandaloneShell>
  )
}
