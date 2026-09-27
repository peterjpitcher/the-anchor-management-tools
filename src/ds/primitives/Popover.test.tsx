import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Popover, usePopoverClose } from './Popover'
import { Button } from './Button'
import { Drawer } from './Drawer'

function CloseFromInside() {
  const close = usePopoverClose()
  return (
    <button type="button" onClick={close}>
      Apply
    </button>
  )
}

describe('Popover', () => {
  it('puts aria-expanded and aria-haspopup on the trigger button itself and keeps its id', async () => {
    const user = userEvent.setup()
    render(
      <>
        <label htmlFor="staff-picker">Employees</label>
        <Popover trigger={<Button id="staff-picker">Pick staff</Button>}>
          <p>Panel</p>
        </Popover>
      </>,
    )

    const trigger = screen.getByRole('button', { name: 'Employees' })
    expect(trigger).toHaveAttribute('id', 'staff-picker')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // No wrapper pretending to be a second button around the real one.
    expect(trigger.parentElement?.getAttribute('role')).not.toBe('button')
    expect(trigger.parentElement).not.toHaveAttribute('aria-expanded')

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Employees' })).toHaveTextContent('Panel')
  })

  it('portals the panel out of a clipping ancestor', async () => {
    const user = userEvent.setup()
    render(
      <div data-testid="clip" className="overflow-hidden">
        <Popover trigger={<Button>Filters</Button>}>
          <p>Panel body</p>
        </Popover>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'Filters' }))

    const panel = screen.getByRole('dialog')
    expect(screen.getByTestId('clip')).not.toContainElement(panel)
    expect(document.body).toContainElement(panel)
  })

  it('works inside a drawer: a click in the portalled panel closes neither', async () => {
    // The ingredient drawer opens its price history this way.
    const user = userEvent.setup()
    const onDrawerClose = vi.fn()
    render(
      <Drawer open onClose={onDrawerClose} title="Edit Ingredient">
        <Popover trigger={<Button>Price History</Button>}>
          <p>No price history recorded yet</p>
        </Popover>
      </Drawer>,
    )

    await user.click(screen.getByRole('button', { name: 'Price History' }))
    await user.click(screen.getByText('No price history recorded yet'))

    expect(screen.getByRole('dialog', { name: 'Price History' })).toBeInTheDocument()
    expect(onDrawerClose).not.toHaveBeenCalled()
  })

  it('closes from inside through the children function', async () => {
    const user = userEvent.setup()
    render(
      <Popover trigger={<Button>Columns</Button>}>
        {({ close }) => (
          <button type="button" onClick={close}>
            Done
          </button>
        )}
      </Popover>,
    )

    const trigger = screen.getByRole('button', { name: 'Columns' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes from inside through usePopoverClose', async () => {
    const user = userEvent.setup()
    render(
      <Popover trigger={<Button>Sort</Button>}>
        <CloseFromInside />
      </Popover>,
    )

    await user.click(screen.getByRole('button', { name: 'Sort' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reports opening and closing through onOpenChange', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Popover trigger={<Button>Subscribe</Button>} onOpenChange={onOpenChange}>
        <p>Feed</p>
      </Popover>,
    )

    expect(onOpenChange).not.toHaveBeenCalled()
    const trigger = screen.getByRole('button', { name: 'Subscribe' })
    await user.click(trigger)
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(true))
    await user.click(trigger)
    await waitFor(() => expect(onOpenChange).toHaveBeenLastCalledWith(false))
    expect(onOpenChange).toHaveBeenCalledTimes(2)
  })

  it('takes a wrapper class, a panel width and panel classes', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Popover className="w-full" width="lg" panelClassName="p-2" trigger={<Button fullWidth>Wide</Button>}>
        <p>Panel</p>
      </Popover>,
    )

    expect(container.firstElementChild).toHaveClass('w-full')
    await user.click(screen.getByRole('button', { name: 'Wide' }))
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveClass('w-96', 'p-2')
    expect(panel).not.toHaveClass('w-72')
  })

  it('keeps the 18rem panel by default', async () => {
    const user = userEvent.setup()
    render(
      <Popover trigger={<Button>Default</Button>}>
        <p>Panel</p>
      </Popover>,
    )

    await user.click(screen.getByRole('button', { name: 'Default' }))
    expect(screen.getByRole('dialog')).toHaveClass('w-72', 'p-4')
  })

  it('wraps a non-element trigger in a real button', async () => {
    const user = userEvent.setup()
    render(
      <Popover trigger="Details">
        <p>Panel</p>
      </Popover>,
    )

    const trigger = screen.getByRole('button', { name: 'Details' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
