import type { ReactNode } from 'react';

/**
 * A passthrough, deliberately.
 *
 * This layout used to render its own header ("The Anchor / Employee Onboarding") and wrap
 * everything in max-w-2xl, 672px. OnboardingClient renders its own topbar inside that, so every
 * new starter saw the brand twice. Worse, the flow's own grid in globals.css is built for
 * max-width 1100px with a 260px stepper rail, and its single column fallback only applies at
 * 820px and below. Above 820px the form fields were being squeezed into roughly 280px inside a
 * 672px shell, under a duplicated header. This is the first screen anybody who works here sees.
 *
 * The chrome and the width now belong to the flow itself, in one place.
 */
export default function EmployeeOnboardingLayout({ children }: { children: ReactNode }) {
  return <div className="employee-onboarding-shell min-h-screen bg-bg">{children}</div>;
}
