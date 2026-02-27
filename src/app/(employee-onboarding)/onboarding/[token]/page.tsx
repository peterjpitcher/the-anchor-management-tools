import { validateInviteToken } from '@/app/actions/employeeInvite';
import Link from 'next/link';
import OnboardingClient from './OnboardingClient';

interface OnboardingPageProps {
  params: Promise<{ token: string }>;
}

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const { token } = await params;

  const tokenData = await validateInviteToken(token);

  if (tokenData.expired) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm text-center">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">This link has expired</h2>
        <p className="text-gray-600">
          Your invite link is no longer valid. Please contact your manager to request a new one.
        </p>
      </div>
    );
  }

  if (tokenData.completed) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm text-center">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Profile already complete</h2>
        <p className="text-gray-600 mb-4">
          Your employee profile has already been completed.
        </p>
        <Link
          href="/auth/login"
          className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500"
        >
          Sign in here
        </Link>
      </div>
    );
  }

  if (!tokenData.valid || !tokenData.employee_id || !tokenData.email) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm text-center">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid link</h2>
        <p className="text-gray-600">
          This invite link is not valid. Please contact your manager.
        </p>
      </div>
    );
  }

  return (
    <OnboardingClient
      token={token}
      email={tokenData.email}
      employeeId={tokenData.employee_id}
      hasAuthUser={tokenData.hasAuthUser}
    />
  );
}
