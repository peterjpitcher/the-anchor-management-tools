'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, Stepper } from '@/ds'
import { StandalonePageHeader, StandaloneShell } from '@/components/shells/StandaloneShell'
import { AuthCard } from '@/app/auth/_components/AuthCard'
import CreateAccountStep from '../steps/CreateAccountStep'
import PersonalStep from '../steps/PersonalStep'
import EmergencyContactsStep from '../steps/EmergencyContactsStep'
import FinancialStep from '../steps/FinancialStep'
import HealthStep from '../steps/HealthStep'
import TimeOffStep from '../steps/TimeOffStep'
import RightToWorkNoticeStep from '../steps/RightToWorkNoticeStep'
import ReviewStep from '../steps/ReviewStep'
import { OnboardingSignInForm } from './OnboardingAccess'
import type { InviteType, OnboardingSnapshot } from '@/app/actions/employeeInvite'
import {
  isEmergencyContactsComplete,
  isFinancialComplete,
  isPersonalComplete,
  type OnboardingSectionKey,
} from '@/lib/employees/onboarding-rules'

interface OnboardingClientProps {
  token: string
  email: string
  inviteType: InviteType
  hasAuthUser: boolean
  initialData: OnboardingSnapshot | null
}

type SectionKey = OnboardingSectionKey

/** What the starter has saved, section by section: the snapshot without its completeness flags. */
export type OnboardingValues = Omit<OnboardingSnapshot, 'completedSections'>

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

type StepKey = (typeof ONBOARDING_STEPS)[number]['key']

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

  // The page shows its own error when the saved details cannot be loaded. The wizard never starts
  // on empty forms, because saving an empty step would write blanks over what is stored.
  if (!initialData) {
    return (
      <AuthCard
        title="We Could Not Load Your Details"
        lead="Please reload the page. If it keeps happening, contact your manager."
        icon={{ name: 'alertCircle', tone: 'danger' }}
      />
    )
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
}: {
  token: string
  email: string
  hasAuthUser: boolean
  initialData: OnboardingSnapshot
}) {
  const { completedSections: initialSavedSections, ...initialValues } = initialData

  // The last saved values of every section live here, not in the steps. A step is unmounted when
  // the starter moves on, so a step that read the page-load data again after Back showed blanks
  // for anything saved since, and saving it then wrote those blanks over the NI number, bank
  // details and health answers.
  const [values, setValues] = useState<OnboardingValues>(initialValues)
  const [savedSections, setSavedSections] = useState<Record<SectionKey, boolean>>(initialSavedSections)
  const [accountCreated, setAccountCreated] = useState(hasAuthUser)
  // Set when an action says the browser needs a session for this starter. The step stays where
  // it is, and the card asks them to sign in first.
  const [needsSignIn, setNeedsSignIn] = useState(false)
  // Set by Edit on the review screen, so saving that step goes straight back to the review.
  const [returnToReview, setReturnToReview] = useState(false)

  const visibleSteps = useMemo(
    () =>
      accountCreated
        ? ONBOARDING_STEPS.filter((step) => step.key !== 'create_account')
        : ONBOARDING_STEPS,
    [accountCreated],
  )

  const [currentStepIndex, setCurrentStepIndex] = useState(() =>
    accountCreated ? firstIncompleteStepIndex(initialSavedSections) : 0,
  )

  const currentStep = visibleSteps[currentStepIndex] ?? visibleSteps[visibleSteps.length - 1]

  const goToStep = (key: StepKey) => {
    const index = visibleSteps.findIndex((step) => step.key === key)
    if (index !== -1) setCurrentStepIndex(index)
  }

  const goToNextStep = () => {
    if (returnToReview) {
      setReturnToReview(false)
      goToStep('review')
      return
    }
    setCurrentStepIndex((index) => Math.min(index + 1, visibleSteps.length - 1))
  }

  // Back from a step opened with Edit on the review means the starter is moving around again, so
  // Save and Continue goes to the next step, not straight back to the review past the one they
  // meant to change.
  const goToPrevStep = () => {
    setReturnToReview(false)
    setCurrentStepIndex((index) => Math.max(index - 1, 0))
  }

  /** Keep what was saved, mark whether it is complete, and move on. */
  const sectionSaved = <K extends SectionKey>(section: K, saved: OnboardingValues[K], complete: boolean) => {
    setValues((prev) => ({ ...prev, [section]: saved }))
    setSavedSections((prev) => ({ ...prev, [section]: complete }))
    goToNextStep()
  }

  const requireSignIn = () => setNeedsSignIn(true)

  // A new step: back to the top of the page, and focus on its heading, so a keyboard or screen
  // reader user starts at the step they have just moved to rather than at the old Save button.
  // Keyed on the step itself, so it never runs on the first render and steals focus on load.
  const headerRef = useRef<HTMLDivElement | null>(null)
  const viewKey = needsSignIn ? 'sign_in' : currentStep?.key
  const lastViewKey = useRef(viewKey)
  useEffect(() => {
    if (lastViewKey.current === viewKey) return
    lastViewKey.current = viewKey
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0 })
    }
    const heading = headerRef.current?.querySelector('h1')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
  }, [viewKey])

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
            onSuccess={(signedIn) => {
              setAccountCreated(true)
              setCurrentStepIndex(0)
              // The account is made either way. Without a session the next save would be
              // refused, so ask them to sign in now rather than after they have typed a step.
              if (!signedIn) setNeedsSignIn(true)
            }}
          />
        )
      case 'personal':
        return (
          <PersonalStep
            token={token}
            onBack={onBack}
            initialData={values.personal}
            saved={savedSections.personal}
            onSignInRequired={requireSignIn}
            onSuccess={(saved) => {
              const personal = { ...values.personal, ...saved }
              sectionSaved('personal', personal, isPersonalComplete(personal))
            }}
          />
        )
      case 'time_off':
        return (
          <TimeOffStep
            token={token}
            onBack={onBack}
            initialAnswer={values.time_off.answer}
            initialBlocks={values.time_off.blocks}
            initialSubmissionVersion={values.time_off.submissionVersion}
            saved={savedSections.time_off}
            onSignInRequired={requireSignIn}
            onSuccess={(saved) => sectionSaved('time_off', saved, true)}
          />
        )
      case 'emergency_contacts':
        return (
          <EmergencyContactsStep
            token={token}
            onBack={onBack}
            initialData={values.emergency_contacts}
            saved={savedSections.emergency_contacts}
            onSignInRequired={requireSignIn}
            onSuccess={(saved) => sectionSaved('emergency_contacts', saved, isEmergencyContactsComplete(saved.primary))}
          />
        )
      case 'financial':
        return (
          <FinancialStep
            token={token}
            onBack={onBack}
            initialData={values.financial}
            saved={savedSections.financial}
            onSignInRequired={requireSignIn}
            onSuccess={(saved) => sectionSaved('financial', saved, isFinancialComplete(saved))}
          />
        )
      case 'health':
        return (
          <HealthStep
            token={token}
            onBack={onBack}
            initialData={values.health}
            saved={savedSections.health}
            onSignInRequired={requireSignIn}
            onSuccess={(saved) => sectionSaved('health', saved, true)}
          />
        )
      case 'right_to_work_notice':
        return (
          <RightToWorkNoticeStep
            token={token}
            onBack={onBack}
            initialAcknowledged={values.right_to_work_notice.acknowledged}
            saved={savedSections.right_to_work_notice}
            onSignInRequired={requireSignIn}
            onSuccess={() => sectionSaved('right_to_work_notice', { acknowledged: true }, true)}
          />
        )
      case 'review':
        return (
          <ReviewStep
            token={token}
            values={values}
            savedSections={savedSections}
            onBack={onBack}
            onSignInRequired={requireSignIn}
            onEdit={(section) => {
              setReturnToReview(true)
              goToStep(section)
            }}
            onIncomplete={(section) => setSavedSections((prev) => ({ ...prev, [section]: false }))}
          />
        )
      default:
        return null
    }
  }

  return (
    <StandaloneShell label="Employee Onboarding" width="wide">
      <div ref={headerRef}>
        <StandalonePageHeader title={needsSignIn ? 'Sign In to Carry On' : (currentStep?.title ?? '')} />
      </div>

      {/* The Stepper is the rail of every step beside the form on a wide screen, and one line
          ("Step 2 of 8" with a bar) above the form on a phone, so it carries the step count at
          every width and the header does not repeat it. */}
      <div className="grid gap-6 shell:grid-cols-[16rem_minmax(0,1fr)]">
        <Stepper steps={stepperSteps} />

        <Card>
          <CardBody>
            {needsSignIn ? (
              <OnboardingSignInForm token={token} email={email} onSignedIn={() => setNeedsSignIn(false)} />
            ) : null}
            {/* Hidden rather than unmounted while they sign in, so what they typed into the step
                is still there to save afterwards. */}
            <div hidden={needsSignIn}>{renderStepContent()}</div>
          </CardBody>
        </Card>
      </div>
    </StandaloneShell>
  )
}
