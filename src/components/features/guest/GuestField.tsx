import { cn } from '@/lib/utils'

type GuestFieldProps = {
  /** Required. Wires the label, the hint and error ids, and the control. */
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  /** The control itself. Spread `guestFieldControlProps` onto it. */
  children: React.ReactNode
  className?: string
}

type GuestFieldControlProps = {
  id: string
  required?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/** Deterministic ids for the hint and error paragraphs of a field. */
export function guestFieldIds(id: string): { hintId: string; errorId: string } {
  return { hintId: `${id}-hint`, errorId: `${id}-error` }
}

/**
 * The attributes a control inside `GuestField` needs.
 *
 * Composition here is deliberately cloneElement-free: `GuestField` renders the
 * label, hint and error with predictable ids, and the caller spreads this onto
 * its own control. That keeps every primitive hook-free and safe to render from
 * a server component, and keeps the control's own type intact.
 *
 *   <GuestField id="party_size" label="Party size" hint={hint} error={error} required>
 *     <input
 *       {...guestFieldControlProps({ id: 'party_size', hint, error, required: true })}
 *       name="party_size"
 *       className={cn(GUEST_INPUT_CLASS, error && GUEST_INPUT_INVALID_CLASS)}
 *     />
 *   </GuestField>
 */
export function guestFieldControlProps(options: {
  id: string
  hint?: string
  error?: string
  required?: boolean
}): GuestFieldControlProps {
  const { hintId, errorId } = guestFieldIds(options.id)

  const describedBy = [options.hint ? hintId : null, options.error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  return {
    id: options.id,
    ...(options.required ? { required: true } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(options.error ? { 'aria-invalid': true as const } : {}),
  }
}

/** Label, optional hint, control, optional error. */
export function GuestField({
  id,
  label,
  hint,
  error,
  required = false,
  children,
  className,
}: GuestFieldProps): React.JSX.Element {
  const { hintId, errorId } = guestFieldIds(id)

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="font-anchor-body text-[14px] font-semibold text-guest-text">
        {label}
        {/* The control carries `required`, which is what assistive tech reads.
            This marker is purely visual. */}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>

      {hint ? (
        <p id={hintId} className="font-anchor-body text-[12px] leading-[1.55] text-guest-text-muted">
          {hint}
        </p>
      ) : null}

      {children}

      {error ? (
        <p
          id={errorId}
          className="font-anchor-body text-[13px] font-medium leading-[1.55] text-anchor-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
