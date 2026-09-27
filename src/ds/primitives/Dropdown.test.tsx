import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dropdown, DropdownItem, DropdownLabel } from './Dropdown'
import { Button } from './Button'

describe('Dropdown', () => {
  it('portals the menu out of a clipping ancestor such as a scrolling table', async () => {
    const user = userEvent.setup()
    render(
      <div data-testid="clip" className="overflow-x-auto">
        <Dropdown trigger={<Button>Actions</Button>}>
          <DropdownItem onClick={() => undefined}>Edit</DropdownItem>
        </Dropdown>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'Actions' }))

    const menu = screen.getByRole('menu')
    expect(screen.getByTestId('clip')).not.toContainElement(menu)
    expect(document.body).toContainElement(menu)
  })

  it('shows a label as a heading that is not a menu item', async () => {
    const user = userEvent.setup()
    render(
      <Dropdown trigger={<Button>Export</Button>}>
        <DropdownLabel>Documents</DropdownLabel>
        <DropdownItem onClick={() => undefined}>Starter pack</DropdownItem>
        <DropdownLabel>Danger</DropdownLabel>
        <DropdownItem danger onClick={() => undefined}>Delete</DropdownItem>
      </Dropdown>,
    )

    await user.click(screen.getByRole('button', { name: 'Export' }))

    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Starter pack', 'Delete'])
    const label = within(menu).getByText('Documents')
    expect(label).toHaveAttribute('role', 'presentation')
    expect(label).toHaveClass('uppercase', 'text-text-muted')
  })

  it.each([
    [undefined, ['w-48']],
    ['sm', ['w-48']],
    ['md', ['w-64']],
    ['lg', ['w-80']],
    ['auto', ['w-max', 'min-w-48', 'max-w-80']],
  ] as const)('sizes the menu for width=%s', async (width, classes) => {
    const user = userEvent.setup()
    render(
      <Dropdown trigger={<Button>Actions</Button>} width={width}>
        <DropdownItem onClick={() => undefined}>Post-event Book Next Screen</DropdownItem>
      </Dropdown>,
    )

    await user.click(screen.getByRole('button', { name: 'Actions' }))

    const menu = screen.getByRole('menu')
    expect(menu).toHaveClass(...classes)
    for (const other of ['w-48', 'w-64', 'w-80', 'w-max'].filter((name) => !(classes as readonly string[]).includes(name))) {
      expect(menu).not.toHaveClass(other)
    }
  })

  it('closes after a choice by default', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(
      <Dropdown trigger={<Button>Row</Button>}>
        <DropdownItem onClick={onEdit}>Edit</DropdownItem>
      </Dropdown>,
    )

    const trigger = screen.getByRole('button', { name: 'Row' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('stays open after a click on an item with closeOnSelect={false}', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <Dropdown trigger={<Button>View</Button>}>
        <DropdownItem closeOnSelect={false} onClick={onToggle}>Show cancelled</DropdownItem>
        <DropdownItem onClick={() => undefined}>Reset</DropdownItem>
      </Dropdown>,
    )

    await user.click(screen.getByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('menuitem', { name: 'Show cancelled' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('stays open after Enter on an item with closeOnSelect={false}', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <Dropdown trigger={<Button>Options</Button>}>
        <DropdownItem closeOnSelect={false} onClick={onToggle}>Compact rows</DropdownItem>
      </Dropdown>,
    )

    screen.getByRole('button', { name: 'Options' }).focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu).toHaveAttribute('aria-activedescendant'))
    await user.keyboard('{Enter}')

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('still closes on Enter for an ordinary item', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(
      <Dropdown trigger={<Button>Open</Button>}>
        <DropdownItem onClick={onOpen}>Open in new tab</DropdownItem>
      </Dropdown>,
    )

    screen.getByRole('button', { name: 'Open' }).focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu).toHaveAttribute('aria-activedescendant'))
    await user.keyboard('{Enter}')

    expect(onOpen).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('keeps the deprecated items and label API', async () => {
    const user = userEvent.setup()
    const onDuplicate = vi.fn()
    render(
      <Dropdown
        label="More"
        items={[
          { key: 'duplicate', label: 'Duplicate', onClick: onDuplicate },
          { key: 'delete', label: 'Delete', danger: true },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('text-danger')
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(onDuplicate).toHaveBeenCalledTimes(1)
  })
})
