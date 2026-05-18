import { getOnboardingSnapshot, validateInviteToken } from '@/app/actions/employeeInvite'
import Link from 'next/link'
import { Icon, Button } from '@/ds'
import OnboardingClient from './_components/OnboardingClient'

interface OnboardingPageProps {
  params: Promise<{ token: string }>
}

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const { token } = await params

  const tokenData = await validateInviteToken(token)

  if (tokenData.expired) {
    return (
      <div className="auth">
        <div className="auth__card">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-warning/10 flex items-center justify-center">
              <Icon name="alertCircle" size={28} className="text-warning" />
            </div>
          </div>
          <h1 className="auth__h1 text-center">This link has expired</h1>
          <p className="auth__lead text-center">
            Your invite link is no longer valid. Please contact your manager to request a new one.
          </p>
        </div>
      </div>
    )
  }

  if (tokenData.completed) {
    return (
      <div className="auth">
        <div className="auth__card">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
              <Icon name="check" size={28} className="text-success" />
            </div>
          </div>
          <h1 className="auth__h1 text-center">
            {tokenData.inviteType === 'portal_access' ? 'Portal access already set up' : 'Profile already complete'}
          </h1>
          <p className="auth__lead text-center">
            {tokenData.inviteType === 'portal_access'
              ? 'Your staff portal access has already been set up.'
              : 'Your employee profile has already been completed.'}
          </p>
          <Link href="/auth/login" className="w-full">
            <Button variant="primary" size="lg" className="w-full" type="button">
              Sign in here
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  if (!tokenData.valid || !tokenData.employee_id || !tokenData.email) {
    return (
      <div className="auth">
        <div className="auth__card">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-danger/10 flex items-center justify-center">
              <Icon name="alertCircle" size={28} className="text-danger" />
            </div>
          </div>
          <h1 className="auth__h1 text-center">Invalid link</h1>
          <p className="auth__lead text-center">
            This invite link is not valid. Please contact your manager.
          </p>
        </div>
      </div>
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
