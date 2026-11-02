import { getAppUrl } from '@/lib/env';
import { Alert, Card, CardBody, CardHeader, LinkButton } from '@/ds';
import { StandalonePageHeader, StandaloneShell } from '@/components/shells/StandaloneShell';
import { FinishedSignOutButton } from '../[token]/_components/OnboardingAccess';

interface OnboardingSuccessPageProps {
  searchParams?: Promise<{ type?: string }>;
}

export default async function OnboardingSuccessPage({ searchParams }: OnboardingSuccessPageProps) {
  const params = await searchParams;
  const isPortalAccess = params?.type === 'portal_access';
  const appUrl = getAppUrl();

  return (
    <StandaloneShell label={isPortalAccess ? 'Staff Portal Setup' : 'Employee Onboarding'}>
      <StandalonePageHeader title={isPortalAccess ? 'Staff Portal Access Ready' : 'Profile Complete'} />

      <Alert tone="success" role="status">
        {/* No promise that the manager was told: this page cannot know whether that email went.
            A failed send is recorded as a note on the employee's record for staff to see. */}
        {isPortalAccess
          ? 'Your staff portal account is ready to use.'
          : 'Thank you. Your employee profile has been submitted and your manager will be in touch about your first shift.'}
      </Alert>

      <Card>
        <CardHeader title="How to Sign In Next Time" />
        <CardBody className="space-y-3">
          <p className="text-sm text-text-muted">
            Save the address below to access the staff portal in future. Sign in with your email address and password.
          </p>
          <div className="flex items-center gap-2 rounded-default border border-border bg-surface-2 px-3 py-2">
            <span className="min-w-0 flex-1 break-all font-mono text-sm text-text">{appUrl}</span>
            <LinkButton href={appUrl} variant="secondary" size="sm">
              Open
            </LinkButton>
          </div>
          <p className="text-sm text-text-muted">
            When we send you something to read and sign, such as your worker agreement, we will email you a link. You
            will also find it under My Documents in the staff portal.
          </p>
        </CardBody>
      </Card>

      {/* Only an onboarding link signs the browser in (createEmployeeAccount). Setting up portal
          access does not, so offering Sign Out there would end whoever else is signed in. */}
      {isPortalAccess ? null : (
        <Card>
          <CardHeader title="Using a Shared Device?" />
          <CardBody className="space-y-3">
            <FinishedSignOutButton />
          </CardBody>
        </Card>
      )}
    </StandaloneShell>
  );
}
