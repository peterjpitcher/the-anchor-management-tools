export default function OnboardingSuccessPage() {
  return (
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
  );
}
