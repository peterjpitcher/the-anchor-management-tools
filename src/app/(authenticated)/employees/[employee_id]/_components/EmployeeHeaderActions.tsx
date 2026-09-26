'use client'

import { Button, Dropdown, DropdownItem, Icon, LinkButton } from '@/ds'
import { useDeleteEmployeeAction } from '@/components/features/employees/DeleteEmployeeButton'
import { useEmployeeStatusActions } from '@/components/features/employees/EmployeeStatusActions'
import {
  EmployeeActionButton,
  type EmployeeHeaderAction,
} from '@/components/features/employees/employeeHeaderActions'

interface EmployeeHeaderActionsProps {
  employeeId: string
  /** The name the delete dialog asks about. */
  employeeName: string
  status: string
  employmentStartDate: string | null
  canEdit: boolean
  canDelete: boolean
}

interface DocumentLink {
  key: string
  label: string
  href: string
}

/**
 * Employee page header actions. Desktop shows every action in one row, secondary first and Edit
 * Employee last. Phones show one "More" menu (the DS Dropdown) and Edit Employee, so the header
 * is one tidy row instead of a block of full-size buttons. The menu is portalled and anchored to
 * its trigger, and moves and flips to stay on screen, so the same menu works at every phone width.
 *
 * The status and delete actions open dialogs. A menu unmounts its items when it closes, which is
 * the same click that chose the item, so the dialogs live here, outside the menu, and the menu
 * items only open them.
 */
export function EmployeeHeaderActions({
  employeeId,
  employeeName,
  status,
  employmentStartDate,
  canEdit,
  canDelete,
}: EmployeeHeaderActionsProps): React.JSX.Element {
  const statusActions = useEmployeeStatusActions({ employeeId, status, canEdit, employmentStartDate })
  const deleteAction = useDeleteEmployeeAction({ employeeId, employeeName })

  // An onboarding employee has no details to put in their starter pack or contract yet.
  const documents: DocumentLink[] = status === 'Onboarding'
    ? []
    : [
        { key: 'starter-pack', label: 'New Starter PDF', href: `/api/employees/${employeeId}/starter-pack` },
        { key: 'contract', label: 'Casual Worker Agreement', href: `/api/employees/${employeeId}/employment-contract` },
      ]

  const actions: EmployeeHeaderAction[] = [
    ...statusActions.actions,
    ...(canDelete ? [deleteAction.action] : []),
  ]

  const editLink = canEdit ? (
    <LinkButton href={`/employees/${employeeId}/edit`} size="sm" variant="primary">
      Edit Employee
    </LinkButton>
  ) : null

  const hasMenu = documents.length > 0 || actions.length > 0

  const menu = (
    <Dropdown
      trigger={
        <Button type="button" size="sm" variant="secondary" iconRight={<Icon name="chevronDown" size={14} />}>
          More
        </Button>
      }
    >
      {documents.map((document) => (
        <DropdownItem
          key={document.key}
          icon={<Icon name="download" size={16} />}
          onClick={() => window.open(document.href, '_blank', 'noopener,noreferrer')}
        >
          {document.label}
        </DropdownItem>
      ))}
      {actions.map((action) => (
        <DropdownItem
          key={action.key}
          icon={action.icon}
          danger={action.tone === 'danger'}
          disabled={action.disabled || action.loading}
          onClick={action.onSelect}
        >
          {action.label}
        </DropdownItem>
      ))}
    </Dropdown>
  )

  return (
    <>
      {/* Phones: More, then Edit Employee. */}
      <div className="flex items-center gap-2 shell:hidden">
        {hasMenu && menu}
        {editLink}
      </div>

      {/* Desktop: the full row */}
      <div className="hidden flex-wrap items-center justify-end gap-2 shell:flex">
        {documents.map((document) => (
          <LinkButton
            key={document.key}
            href={document.href}
            size="sm"
            variant="secondary"
            target="_blank"
            icon={<Icon name="download" size={16} />}
          >
            {document.label}
          </LinkButton>
        ))}
        {actions.map((action) => (
          <EmployeeActionButton key={action.key} action={action} />
        ))}
        {editLink}
      </div>

      {/* Rendered once, outside both the menu and the rows, so a dialog opened from a menu item
          outlives the menu closing. DS Modals render on the body. */}
      {statusActions.dialogs}
      {canDelete && deleteAction.dialog}
    </>
  )
}
