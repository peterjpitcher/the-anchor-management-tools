'use client'

import { Radio } from '@/ds'
import { cn } from '@/lib/utils'

/**
 * The options of one question as a list of labelled radios, each in a full-width row. Used by
 * the scored check and by "check yourself" cards.
 *
 * Staff read these on a phone, so the text is 16px rather than the design system's 13px control
 * text: the DS Radio draws its label in `text-ui`, so this list sets that token to the base size
 * for everything inside it. The Radio already lifts each label to the 44px touch target on a
 * touch screen.
 */
const READABLE_CONTROL_TEXT = '[--text-ui:1rem] [--text-ui--line-height:1.5rem]'

interface AnswerOptionsProps {
  /** Shared by the radios of one question, and unique on the page. */
  name: string
  options: readonly string[]
  /** The chosen option's index in `options`, or null. */
  value: number | null
  onChange: (index: number) => void
  disabled?: boolean
}

export function AnswerOptions({ name, options, value, onChange, disabled = false }: AnswerOptionsProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-2', READABLE_CONTROL_TEXT)}>
      {options.map((option, index) => (
        <Radio
          key={`${name}-${index}`}
          id={`${name}-${index}`}
          name={name}
          value={String(index)}
          label={option}
          checked={value === index}
          disabled={disabled}
          onChange={() => onChange(index)}
          className={cn(
            'min-h-touch rounded-default border px-3 py-2.5',
            value === index ? 'border-primary bg-primary-soft' : 'border-border bg-surface',
          )}
        />
      ))}
    </div>
  )
}
