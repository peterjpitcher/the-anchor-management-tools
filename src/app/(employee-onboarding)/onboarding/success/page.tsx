const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://manage.the-anchor.pub';

export default function OnboardingSuccessPage() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Profile complete!</h2>
        <p className="text-gray-600">
          Your employee profile has been submitted. Your manager has been notified and will be in touch soon.
        </p>
      </div>

      <div className="rounded-lg bg-blue-50 border border-blue-200 p-6">
        <h3 className="text-sm font-semibold text-blue-900 mb-1">How to log in next time</h3>
        <p className="text-sm text-blue-800 mb-3">
          Save the address below to access the staff portal in future. Use the email address and password you just created to sign in.
        </p>
        <div className="flex items-center gap-2 bg-white border border-blue-200 rounded-md px-3 py-2">
          <span className="text-sm font-mono text-gray-800 flex-1">{BASE_URL}</span>
          <a
            href={BASE_URL}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 shrink-0"
          >
            Open
          </a>
        </div>
      </div>
    </div>
  );
}
