import { getAppUrl } from '@/lib/env';

interface OnboardingSuccessPageProps {
  searchParams?: Promise<{ type?: string }>;
}

export default async function OnboardingSuccessPage({ searchParams }: OnboardingSuccessPageProps) {
  const params = await searchParams;
  const isPortalAccess = params?.type === 'portal_access';
  const appUrl = getAppUrl();

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <div className="rounded-lg border border-border bg-surface p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-soft">
          <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-text-strong mb-2">
          {isPortalAccess ? 'Staff portal access ready!' : 'Profile complete!'}
        </h2>
        <p className="text-text-muted">
          {isPortalAccess
            ? 'Your staff portal account is ready to use.'
            : 'Your employee profile has been submitted. Your manager has been notified and will be in touch soon.'}
        </p>
      </div>

      <div className="rounded-lg border border-info-border bg-info-soft p-6">
        <h3 className="text-sm font-semibold text-info-fg mb-1">How to log in next time</h3>
        <p className="text-sm text-info-fg mb-3">
          Save the address below to access the staff portal in future. Use the email address and password you just created to sign in.
        </p>
        <div className="flex items-center gap-2 rounded-md border border-info-border bg-surface px-3 py-2">
          <span className="min-w-0 flex-1 break-all text-sm font-mono text-text">{appUrl}</span>
          <a
            href={appUrl}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            Open
          </a>
        </div>
      </div>
    </div>
  );
}
