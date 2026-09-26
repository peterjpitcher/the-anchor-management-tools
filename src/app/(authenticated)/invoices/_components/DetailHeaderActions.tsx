'use client'

import { useRouter } from 'next/navigation'
import { Button, Dropdown, DropdownItem, Icon, LinkButton } from '@/ds'
import type { IconName } from '@/ds/icons'

/**
 * One header action on an invoice, quote or recurring invoice page.
 *
 * `tone` is `secondary` by default, `danger` for something that cannot be undone from the screen
 * (delete, void) and `primary` for the record's next step. An action either links (`href`) or
 * runs `onSelect`.
 */
export interface DetailHeaderAction {
  key: string
  label: string
  icon: IconName
  tone?: 'secondary' | 'danger' | 'primary'
  href?: string
  onSelect?: () => void
  disabled?: boolean
  loading?: boolean
  /** The hover hint, for example why the action is disabled. */
  title?: string
}

/** A header shows at most this many actions; the rest go in the "More" menu. */
const MAX_VISIBLE_ACTIONS = 3

function isDanger(action: DetailHeaderAction): boolean {
  return action.tone === 'danger'
}

/**
 * The header actions of a finance detail page, laid out by the page contract: secondary actions
 * first, then the "More" menu, then destructive actions, then the primary action last. With more
 * than three actions, the primary action always shows and the others show in the order given
 * until three are on screen; the rest collapse into a labelled "More" menu.
 *
 * Dialogs opened from the menu must live in the page, outside the menu: a menu unmounts its
 * items when it closes, which is the same click that chose the item.
 */
export function DetailHeaderActions({ actions }: { actions: DetailHeaderAction[] }): React.JSX.Element | null {
  const router = useRouter()

  if (actions.length === 0) return null

  const primary = actions.filter((action) => action.tone === 'primary')
  const others = actions.filter((action) => action.tone !== 'primary')
  const overflowing = actions.length > MAX_VISIBLE_ACTIONS
  const shown = overflowing ? others.slice(0, Math.max(0, MAX_VISIBLE_ACTIONS - primary.length)) : others
  const menu = overflowing ? others.slice(shown.length) : []
  // Destructive items sit at the end of the menu, as they sit after the secondary actions.
  const menuItems = [...menu.filter((action) => !isDanger(action)), ...menu.filter(isDanger)]

  const renderButton = (action: DetailHeaderAction): React.JSX.Element => {
    const variant = action.tone ?? 'secondary'
    const icon = <Icon name={action.icon} size={16} />
    if (action.href) {
      return (
        <LinkButton key={action.key} href={action.href} variant={variant} size="sm" leftIcon={icon} disabled={action.disabled}>
          {action.label}
        </LinkButton>
      )
    }
    return (
      <Button
        key={action.key}
        type="button"
        variant={variant}
        size="sm"
        onClick={action.onSelect}
        disabled={action.disabled}
        loading={action.loading}
        title={action.title}
        leftIcon={icon}
      >
        {action.label}
      </Button>
    )
  }

  return (
    <>
      {shown.filter((action) => !isDanger(action)).map(renderButton)}
      {menuItems.length > 0 && (
        <Dropdown
          width="auto"
          trigger={
            <Button type="button" size="sm" variant="secondary" iconRight={<Icon name="chevronDown" size={14} />}>
              More
            </Button>
          }
        >
          {menuItems.map((action) => (
            <DropdownItem
              key={action.key}
              icon={<Icon name={action.icon} size={16} />}
              danger={isDanger(action)}
              disabled={action.disabled || action.loading}
              onClick={() => {
                if (action.href) router.push(action.href)
                else action.onSelect?.()
              }}
            >
              {action.label}
            </DropdownItem>
          ))}
        </Dropdown>
      )}
      {shown.filter(isDanger).map(renderButton)}
      {primary.map(renderButton)}
    </>
  )
}
