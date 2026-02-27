import type { ReactNode } from 'react';

export default function EmployeeOnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="mx-auto max-w-2xl px-4 py-4">
          <h1 className="text-lg font-semibold text-gray-900">The Anchor</h1>
          <p className="text-sm text-gray-500">Employee Onboarding</p>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
