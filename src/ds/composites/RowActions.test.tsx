import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Icon } from '../icons'
import { RowActions } from './RowActions'

describe('RowActions', () => {
  it('renders up to two actions as accessible icon buttons', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()

    render(
      <RowActions
        actions={[
          { key: 'edit', label: 'Edit entry', icon: <Icon name="edit" />, onSelect: onEdit },
          { key: 'delete', label: 'Delete entry', icon: <Icon name="trash" />, onSelect: onDelete, tone: 'danger' },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit entry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }))

    expect(onEdit).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('uses one action menu for three or more actions and keeps danger last', () => {
    render(
      <RowActions
        actions={[
          { key: 'delete', label: 'Delete client', onSelect: vi.fn(), tone: 'danger' },
          { key: 'view', label: 'View client', onSelect: vi.fn() },
          { key: 'edit', label: 'Edit client', onSelect: vi.fn() },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    const menuItems = screen.getAllByRole('menuitem')

    expect(menuItems).toHaveLength(3)
    expect(menuItems[2].textContent).toContain('Delete client')
  })

  it('does not render when there are no available actions', () => {
    const { container } = render(<RowActions actions={[false, null]} />)
    expect(container.firstChild).toBeNull()
  })
})
