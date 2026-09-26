import { cn } from '@/lib/utils'

interface Step {
  label: string
  status: 'done' | 'active' | 'upcoming'
}

interface StepperProps {
  steps: Step[]
  className?: string
}

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

/** The step a phone shows: the active one, else the first not yet done, else the last. */
function currentStepIndex(steps: Step[]): number {
  const active = steps.findIndex((step) => step.status === 'active')
  if (active >= 0) return active
  const upcoming = steps.findIndex((step) => step.status === 'upcoming')
  if (upcoming >= 0) return upcoming
  return Math.max(steps.length - 1, 0)
}

/**
 * Progress through a multi-step form. From the shell breakpoint up it is the full list of
 * steps. Below it, where a list of every step would push the form off the screen, it is
 * one line: "Step 2 of 5" with the current step's name and a bar of the steps.
 */
export function Stepper({ steps, className }: StepperProps) {
  const current = currentStepIndex(steps)
  const currentStep = steps[current]

  return (
    <nav className={className} aria-label="Progress">
      {currentStep && (
        <div className="shell:hidden flex flex-col gap-2 rounded-lg bg-primary-soft px-3 py-2">
          <p className="min-w-0 text-ui">
            <span className="block text-xs text-text-muted">{`Step ${current + 1} of ${steps.length}`}</span>
            <span className="block font-semibold text-text break-words">{currentStep.label}</span>
          </p>
          <div className="flex gap-1" aria-hidden="true">
            {steps.map((step, i) => (
              <span
                key={i}
                className={cn(
                  'h-1 min-w-0 flex-1 rounded-pill',
                  step.status === 'done' && 'bg-success',
                  step.status === 'active' && 'bg-primary',
                  step.status === 'upcoming' && 'bg-border-strong'
                )}
              />
            ))}
          </div>
        </div>
      )}

      <ol className="max-shell:hidden flex flex-col gap-1">
        {steps.map((step, i) => (
          <li
            key={i}
            aria-current={step.status === 'active' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-3 py-2 px-3 rounded-lg',
              step.status === 'active' && 'bg-primary-soft'
            )}
          >
            <span
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 border-[1.5px]',
                step.status === 'done' &&
                  'bg-success border-success text-white',
                step.status === 'active' &&
                  'bg-primary border-primary text-white',
                step.status === 'upcoming' &&
                  'bg-surface border-border-strong text-text-muted'
              )}
            >
              {step.status === 'done' ? <CheckIcon /> : i + 1}
            </span>
            <span
              className={cn(
                'text-ui font-semibold',
                step.status === 'upcoming' ? 'text-text-muted' : 'text-text'
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
