import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfirmDialog, resolveConfirmDialogTone, type ConfirmDialogProps } from './ConfirmDialog'

function renderConfirm(props: Partial<ConfirmDialogProps>) {
  return render(
    <ConfirmDialog
      open
      onClose={() => undefined}
      onConfirm={() => undefined}
      title="Please Confirm"
      confirmLabel="Go"
      {...props}
    />,
  )
}

describe('ConfirmDialog message', () => {
  it('renders a string message as a paragraph', () => {
    renderConfirm({ message: 'This cannot be undone.' })

    expect(screen.getByText('This cannot be undone.').tagName).toBe('P')
  })

  it('renders a node message in a div, never a block inside a <p>', () => {
    renderConfirm({
      message: (
        <>
          <p>The booking is cancelled.</p>
          <ul>
            <li>The guest gets a text.</li>
          </ul>
        </>
      ),
    })

    const paragraph = screen.getByText('The booking is cancelled.')
    expect(paragraph.parentElement?.tagName).toBe('DIV')
    expect(paragraph.parentElement).toHaveClass('text-sm', 'text-text-muted')
    expect(paragraph.parentElement?.closest('p')).toBeNull()
  })

  it('still reads the deprecated description prop', () => {
    renderConfirm({ description: 'Old callers pass this.' })

    expect(screen.getByText('Old callers pass this.').tagName).toBe('P')
  })
})

describe('ConfirmDialog tone', () => {
  it.each<[string, Parameters<typeof resolveConfirmDialogTone>[0], 'primary' | 'danger']>([
    ['nothing set (every unmarked confirm has been red)', {}, 'danger'],
    ['tone danger', { tone: 'danger' }, 'danger'],
    ['tone primary', { tone: 'primary' }, 'primary'],
    ['tone warning, the deprecated alias', { tone: 'warning' }, 'primary'],
    ['confirmVariant primary (customer labels "Apply and Tidy Labels")', { confirmVariant: 'primary' }, 'primary'],
    ['type warning with confirmVariant danger (cancel booking, revoke key)', { type: 'warning', confirmVariant: 'danger' }, 'danger'],
    ['type danger with destructive', { type: 'danger', destructive: true }, 'danger'],
    ['destructive false', { destructive: false }, 'primary'],
    ['type warning', { type: 'warning' }, 'primary'],
    ['type info', { type: 'info' }, 'primary'],
    ['type danger', { type: 'danger' }, 'danger'],
    ['tone beats every deprecated prop', { tone: 'primary', confirmVariant: 'danger', destructive: true }, 'primary'],
  ])('%s', (_label, props, expected) => {
    expect(resolveConfirmDialogTone(props)).toBe(expected)
  })

  it('draws a primary confirm button for tone="primary"', () => {
    renderConfirm({ tone: 'primary' })

    const confirm = screen.getByRole('button', { name: 'Go' })
    expect(confirm).toHaveClass('bg-primary')
    expect(confirm).not.toHaveClass('bg-danger')
  })

  it('draws a danger confirm button for tone="danger"', () => {
    renderConfirm({ tone: 'danger' })

    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('bg-danger')
  })

  it('draws the customer-labels "Apply Retroactively" confirm in primary, not red', () => {
    renderConfirm({ confirmText: 'Apply and Tidy Labels', confirmLabel: undefined, confirmVariant: 'primary' })

    const confirm = screen.getByRole('button', { name: 'Apply and Tidy Labels' })
    expect(confirm).toHaveClass('bg-primary')
    expect(confirm).not.toHaveClass('bg-danger')
  })

  it('keeps ignoring the deprecated variant prop (the FOH clock-out confirm stays red)', () => {
    renderConfirm({ variant: 'primary' })

    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass('bg-danger')
  })
})
