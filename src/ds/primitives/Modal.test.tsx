import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Modal } from './Modal'

describe('Modal', () => {
  it('shows the description under the title and names it as the dialog description', () => {
    render(
      <Modal open onClose={() => undefined} title="Delete Role" description="Staff with this role lose its permissions.">
        <p>Body</p>
      </Modal>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Delete Role' })
    expect(dialog).toHaveAccessibleDescription('Staff with this role lose its permissions.')

    const description = screen.getByText('Staff with this role lose its permissions.')
    expect(description.tagName).toBe('P')
    expect(description).toHaveClass('text-sm', 'text-text-muted')
    // Under the title, in the header, not in the body.
    expect(description.previousElementSibling).toHaveTextContent('Delete Role')
  })

  it('puts a node description in a div, so it may hold its own blocks', () => {
    render(
      <Modal open onClose={() => undefined} title="Import" description={<span>Two steps</span>}>
        <p>Body</p>
      </Modal>,
    )

    expect(screen.getByText('Two steps').parentElement?.tagName).toBe('DIV')
    expect(screen.getByRole('dialog', { name: 'Import' })).toHaveAccessibleDescription('Two steps')
  })

  it('has no description when none is given', () => {
    render(
      <Modal open onClose={() => undefined} title="Edit Note">
        <p>Body</p>
      </Modal>,
    )

    expect(screen.getByRole('dialog', { name: 'Edit Note' })).not.toHaveAttribute('aria-describedby')
  })
})
