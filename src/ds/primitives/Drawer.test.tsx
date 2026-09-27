import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Drawer } from './Drawer'

describe('Drawer', () => {
  it('shows the description under the title and names it as the drawer description', () => {
    const onClose = vi.fn()
    render(
      <Drawer open onClose={onClose} title="Edit Dish" description="Changes apply to every menu using it.">
        <p>Body</p>
      </Drawer>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Edit Dish' })
    expect(dialog).toHaveAccessibleDescription('Changes apply to every menu using it.')

    const description = screen.getByText('Changes apply to every menu using it.')
    expect(description).toHaveClass('text-sm', 'text-text-muted')
    expect(description.previousElementSibling).toHaveTextContent('Edit Dish')

    // The close button stays in the header.
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the single-line header when there is no description', () => {
    render(
      <Drawer open onClose={() => undefined} title="Edit Dish">
        <p>Body</p>
      </Drawer>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Edit Dish' })
    expect(dialog).not.toHaveAttribute('aria-describedby')
    const title = screen.getByText('Edit Dish')
    expect(title).toHaveClass('min-w-0', 'truncate')
    expect(title.nextElementSibling).toHaveAccessibleName('Close drawer')
  })
})
