import { getOnboardingSnapshot, validateInviteToken } from '@/app/actions/employeeInvite'
import { LinkButton } from '@/ds'
import { AuthCard } from '@/app/auth/_components/AuthCard'
import OnboardingClient from './_components/OnboardingClient'

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

  const snapshot = tokenData.inviteType === 'onboarding'
    ? await getOnboardingSnapshot(token)
    : null

  return (
    <OnboardingClient
      token={token}
      email={tokenData.email}
      inviteType={tokenData.inviteType ?? 'onboarding'}
      hasAuthUser={tokenData.hasAuthUser}
      initialData={snapshot?.success ? snapshot.data : null}
    />
  )
}
