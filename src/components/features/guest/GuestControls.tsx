import { cn } from '@/lib/utils'
import { GUEST_INPUT_CLASS, GUEST_INPUT_INVALID_CLASS, GUEST_TEXTAREA_CLASS } from './styles'

/**
 * The guest form controls: one look for every text box, select and textarea on
 * a guest page. Hook-free, so a server-rendered form can use them, and they
 * forward every native attribute (name, defaultValue, onChange, aria-*).
 *
 * Label a control with `GuestField` and spread `guestFieldControlProps` onto it.
 * `invalid` swaps the border to the danger colour; the field's error text is
 * what carries the message.
 */

type InvalidProp = {
  /** Draws the danger border. Pair it with the `error` of the surrounding GuestField. */
  invalid?: boolean
}

/**
 * `cn()` knows the guest tokens, so the danger border replaces the resting
 * border colour (keeping the 1.5px width and the gold focus border), and a
 * caller's `className` wins over the same property in the base.
 */
function controlClass(invalid: boolean | undefined, ...extra: Array<string | false | undefined>): string {
  return cn(GUEST_INPUT_CLASS, invalid && GUEST_INPUT_INVALID_CLASS, ...extra)
}

export function GuestInput({
  invalid,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & InvalidProp): React.JSX.Element {
  return <input {...props} className={controlClass(invalid, className)} />
}

export function GuestSelect({
  invalid,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & InvalidProp): React.JSX.Element {
  return (
    <select {...props} className={controlClass(invalid, className)}>
      {children}
    </select>
  )
}

export function GuestTextarea({
  invalid,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & InvalidProp): React.JSX.Element {
  return <textarea {...props} className={controlClass(invalid, GUEST_TEXTAREA_CLASS, className)} />
}
