'use client'

import React, { type ReactNode, type ComponentProps, useEffect, useRef } from 'react'
import { useFormState as useFormStateLegacy, useFormStatus } from 'react-dom'
import { Button } from '@/components/ui-v2/forms/Button'
import { toast } from '@/components/ui-v2/feedback/Toast'

export type SmsQueueActionState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  changedAt: number
}

type SmsQueueActionFormProps = {
  action: (state: SmsQueueActionState, formData: FormData) => Promise<SmsQueueActionState>
  smsId: string
  confirmMessage: string
  children: ReactNode
  variant?: ComponentProps<typeof Button>['variant']
  leftIcon?: ReactNode
  successMessage?: string
  disabled?: boolean
}

const initialState: SmsQueueActionState = { status: 'idle', changedAt: 0 }

const useFormStateCompat = ((React as any).useActionState ??
  useFormStateLegacy) as (
  action: (state: SmsQueueActionState, formData: FormData) => Promise<SmsQueueActionState>,
  initialState: SmsQueueActionState
) => [SmsQueueActionState, (payload: FormData) => void, ...unknown[]]

export function SmsQueueActionForm({
  action,
  smsId,
  confirmMessage,
  children,
  variant = 'primary',
  leftIcon,
  successMessage,
  disabled = false,
}: SmsQueueActionFormProps) {
  const [state, formAction] = useFormStateCompat(action, initialState)
  const lastChangeRef = useRef<number>(0)

  useEffect(() => {
    if (state.changedAt === lastChangeRef.current || state.status === 'idle') {
      return
    }

    lastChangeRef.current = state.changedAt

    if (state.status === 'error') {
      toast.error(state.message ?? 'Failed to process SMS action.')
    } else if (state.status === 'success' && successMessage) {
      toast.success(successMessage)
    }
  }, [state, successMessage])

  return (
    <form
      action={formAction}
      className="inline"
      onSubmit={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        if (typeof window !== 'undefined') {
          const confirmed = window.confirm(confirmMessage)
          if (!confirmed) {
            event.preventDefault()
          }
        }
      }}
    >
      <input type="hidden" name="smsId" value={smsId} />
      <SubmitButton
        variant={variant}
        leftIcon={leftIcon}
        disabled={disabled}
      >
        {children}
      </SubmitButton>
    </form>
  )
}

function SubmitButton({
  children,
  variant,
  leftIcon,
  disabled,
}: {
  children: ReactNode
  variant?: ComponentProps<typeof Button>['variant']
  leftIcon?: ReactNode
  disabled?: boolean
}) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      variant={variant}
      leftIcon={leftIcon}
      disabled={disabled || pending}
      loading={pending}
    >
      {children}
    </Button>
  )
}
