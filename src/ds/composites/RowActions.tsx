'use client'

import { cn } from '@/lib/utils'
import { Icon } from '../icons'
import { Dropdown, DropdownItem } from '../primitives/Dropdown'
import { IconButton } from '../primitives/IconButton'
import { Tooltip } from '../primitives/Tooltip'

export interface RowAction {
  key: string
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}

export interface RowActionsProps {
  actions: Array<RowAction | false | null | undefined>
  mode?: 'auto' | 'icons' | 'menu'
  label?: string
  className?: string
}

/**
 * One row-action policy for every list:
 * up to two actions use labelled icon buttons; larger sets use one menu.
 */
export function RowActions({
  actions: actionCandidates,
  mode = 'auto',
  label = 'Actions',
  className,
}: RowActionsProps) {
  const actions = actionCandidates
    .filter((action): action is RowAction => Boolean(action))
    .sort((left, right) => Number(left.tone === 'danger') - Number(right.tone === 'danger'))

  if (actions.length === 0) return null

  const resolvedMode = mode === 'auto' ? (actions.length <= 2 ? 'icons' : 'menu') : mode

  if (resolvedMode === 'menu') {
    return (
      <div className={cn('inline-flex', className)} onClick={(event) => event.stopPropagation()}>
        <Dropdown
          trigger={(
            <IconButton
              icon={<Icon name="moreHorizontal" size={18} />}
              label={label}
              size="sm"
            />
          )}
        >
          {actions.map((action) => (
            <DropdownItem
              key={action.key}
              icon={action.icon}
              danger={action.tone === 'danger'}
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.label}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
    )
  }

  return (
    <div
      className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)}
      onClick={(event) => event.stopPropagation()}
      aria-label={label}
    >
      {actions.map((action) => (
        <Tooltip key={action.key} content={action.label}>
          <IconButton
            icon={action.icon}
            label={action.label}
            size="sm"
            disabled={action.disabled}
            className={cn(
              action.tone === 'danger' && 'text-danger hover:bg-danger-soft hover:text-danger',
            )}
            onClick={action.onSelect}
          />
        </Tooltip>
      ))}
    </div>
  )
}
