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
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export function Stepper({ steps, className }: StepperProps) {
  return (
    <nav className={className} aria-label="Progress">
      <ol className="flex flex-col gap-1">
        {steps.map((step, i) => (
          <li
            key={i}
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
                'text-[13px] font-semibold',
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
