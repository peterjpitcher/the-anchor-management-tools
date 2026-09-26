'use client'

import type { ReactNode } from 'react'
import { Button } from '@/ds'

/**
 * One action in an employee page's header, described rather than rendered, so the same action can
 * be a button on a desktop and an item in the phone "More" menu. The dialog an action opens is
 * rendered by whoever owns the action, outside any menu: a menu unmounts its items when it closes,
 * which is the same click that chose the item.
 */
export interface EmployeeHeaderAction {
  key: string
  label: string
  onSelect: () => void
  /** Danger actions are red: a destructive or final step. */
  tone?: 'default' | 'danger'
  /** Busy: shows the loading state and cannot be chosen again. */
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
}

/** The desktop button for an action: small, secondary unless it is a danger action. */
export function EmployeeActionButton({ action }: { action: EmployeeHeaderAction }): React.JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant={action.tone === 'danger' ? 'danger' : 'secondary'}
      onClick={action.onSelect}
      loading={action.loading}
      disabled={action.disabled}
      icon={action.icon}
    >
      {action.label}
    </Button>
  )
}
