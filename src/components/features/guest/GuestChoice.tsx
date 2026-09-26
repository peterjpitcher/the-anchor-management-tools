import { cn } from '@/lib/utils'
import { GUEST_CHOICE_ROW_CLASS } from './styles'

type GuestChoiceProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> & {
  type: 'checkbox' | 'radio'
  /** The visible label. The whole row is the label, so the full 44px target is clickable. */
  label: React.ReactNode
  /** Draws the row as a bordered tile, for a list of options that each carry two lines. */
  boxed?: boolean
}

const BOXED_CLASS = 'rounded-guest-field border border-guest-border px-3 py-2'

/**
 * A tick box or radio with its label, as one 44px row.
 *
 * No size utility on the box: `.guest-theme` in globals.css sizes every tick
 * and radio at 20px in brand green, and the row carries the touch target.
 * Every native attribute (name, value, checked, onChange, aria-*) goes to the
 * input.
 */
export function GuestChoice({ label, id, boxed = false, ...inputProps }: GuestChoiceProps): React.JSX.Element {
  return (
    <label htmlFor={id} className={cn(GUEST_CHOICE_ROW_CLASS, boxed && BOXED_CLASS)}>
      <input id={id} {...inputProps} />
      <span>{label}</span>
    </label>
  )
}
