'use client'

import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from './Button'

export interface FormSubmitButtonProps
  extends Omit<ButtonProps, 'type' | 'loading'> {
  pending?: boolean
  pendingLabel?: React.ReactNode
}

/**
 * Canonical submit button for server-action and client forms.
 * It prevents repeat submissions and keeps pending presentation consistent.
 */
export function FormSubmitButton({
  pending: pendingOverride,
  pendingLabel,
  children,
  disabled,
  ...props
}: FormSubmitButtonProps) {
  const formStatus = useFormStatus()
  const pending = pendingOverride ?? formStatus.pending

  return (
    <Button
      {...props}
      type="submit"
      loading={pending}
      disabled={disabled || pending}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
