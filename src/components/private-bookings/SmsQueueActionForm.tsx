'use client'

import type { ReactNode, ComponentProps } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'

export function SmsQueueActionForm({
  action,
  smsId,
  confirmMessage,
  children,
  variant = 'primary',
  leftIcon,
}: {
  action: (formData: FormData) => Promise<void>
  smsId: string
  confirmMessage: string
  children: ReactNode
  variant?: ComponentProps<typeof Button>['variant']
  leftIcon?: ReactNode
}) {
  return (
    <form
      action={action}
      className="inline"
      onSubmit={(event) => {
        if (typeof window !== 'undefined') {
          const confirmed = window.confirm(confirmMessage)
          if (!confirmed) {
            event.preventDefault()
          }
        }
      }}
    >
      <input type="hidden" name="smsId" value={smsId} />
      <Button type="submit" variant={variant} leftIcon={leftIcon}>
        {children}
      </Button>
    </form>
  )
}
