import type { ReactNode } from 'react';

/**
 * A passthrough, deliberately. Each onboarding screen draws its own frame: the invite-link
 * states use the sign-in card (AuthCard) and the wizard and success screens use StandaloneShell
 * (src/components/shells/StandaloneShell.tsx). A frame here would sit around both and show the
 * brand twice, which is what this layout once did.
 */
export default function EmployeeOnboardingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
