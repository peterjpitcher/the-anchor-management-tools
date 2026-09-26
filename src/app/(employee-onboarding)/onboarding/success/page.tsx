import { getAppUrl } from '@/lib/env';
import { Alert, Card, CardBody, CardHeader, LinkButton } from '@/ds';
import { StandalonePageHeader, StandaloneShell } from '@/components/shells/StandaloneShell';

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
        {isPortalAccess
          ? 'Your staff portal account is ready to use.'
          : 'Your employee profile has been submitted. Your manager has been notified and will be in touch soon.'}
      </Alert>

      <Card>
        <CardHeader title="How to Log In Next Time" />
        <CardBody className="space-y-3">
          <p className="text-sm text-text-muted">
            Save the address below to access the staff portal in future. Use the email address and password you just created to sign in.
          </p>
          <div className="flex items-center gap-2 rounded-default border border-border bg-surface-2 px-3 py-2">
            <span className="min-w-0 flex-1 break-all font-mono text-sm text-text">{appUrl}</span>
            <LinkButton href={appUrl} variant="secondary" size="sm">
              Open
            </LinkButton>
          </div>
        </CardBody>
      </Card>
    </StandaloneShell>
  );
}
