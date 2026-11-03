import { getOnboardingSnapshot, validateInviteToken } from '@/app/actions/employeeInvite'
import { LinkButton } from '@/ds'
import { AuthCard } from '@/app/auth/_components/AuthCard'
import OnboardingClient from './_components/OnboardingClient'
import { OnboardingSignInCard, RetryLoadButton, SignOutAndRetryButton } from './_components/OnboardingAccess'

interface OnboardingPageProps {
  params: Promise<{ token: string }>
}

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const { token } = await params

  const tokenData = await validateInviteToken(token)

  if (tokenData.expired) {
    return (
      <AuthCard
        title="This Link Has Expired"
        lead="Your invite link is no longer valid. Please contact your manager to request a new one."
        icon={{ name: 'alertCircle', tone: 'warning' }}
      />
    )
  }

  if (tokenData.completed) {
    const portalAccess = tokenData.inviteType === 'portal_access'
    return (
      <AuthCard
        title={portalAccess ? 'Portal Access Already Set Up' : 'Profile Already Complete'}
        lead={
          portalAccess
            ? 'Your staff portal access has already been set up.'
            : 'Your employee profile has already been completed.'
        }
        icon={{ name: 'check', tone: 'success' }}
      >
        <LinkButton href="/auth/login" variant="primary" size="lg" className="w-full">
          Sign In Here
        </LinkButton>
      </AuthCard>
    )
  }

  if (!tokenData.valid || !tokenData.employee_id || !tokenData.email) {
    return (
      <AuthCard
        title="Invalid Link"
        lead="This invite link is not valid. Please contact your manager."
        icon={{ name: 'alertCircle', tone: 'danger' }}
      />
    )
  }

  if (tokenData.inviteType !== 'onboarding') {
    return (
      <OnboardingClient
        token={token}
        email={tokenData.email}
        inviteType={tokenData.inviteType ?? 'onboarding'}
        hasAuthUser={tokenData.hasAuthUser}
        initialData={null}
      />
    )
  }

  const snapshot = await getOnboardingSnapshot(token)

  if (!snapshot.success) {
    // Once a password is set the link needs a session for that account (onboarding-session.ts).
    if (snapshot.code === 'sign_in_required') {
      return <OnboardingSignInCard token={token} email={tokenData.email} />
    }

    if (snapshot.code === 'wrong_account') {
      return (
        <AuthCard
          title="Signed In as Someone Else"
          lead="This onboarding link belongs to a different account. Sign out, then open the link again."
          icon={{ name: 'alertCircle', tone: 'warning' }}
        >
          <SignOutAndRetryButton />
        </AuthCard>
      )
    }

    // Never fall back to an empty form here: saving an empty step would write blanks over the
    // details the starter has already given.
    return (
      <AuthCard
        title="We Could Not Load Your Details"
        lead="Something went wrong loading your profile. Nothing has been lost. Please try again in a moment, and if it keeps happening, contact your manager."
        icon={{ name: 'alertCircle', tone: 'danger' }}
      >
        <RetryLoadButton />
      </AuthCard>
    )
  }

  return (
    <OnboardingClient
      token={token}
      email={tokenData.email}
      inviteType="onboarding"
      hasAuthUser={tokenData.hasAuthUser}
      initialData={snapshot.data}
    />
  )
}
