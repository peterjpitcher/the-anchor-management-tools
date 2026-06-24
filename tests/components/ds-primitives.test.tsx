import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Checkbox, ConfirmDialog, Field, Radio } from '@/ds/primitives'
import { DataTable } from '@/ds/composites/DataTable'
import { SectionNav } from '@/ds/composites/SectionNav'
import { Tabs } from '@/ds/composites/Tabs'

describe('DS primitives', () => {
  it('checkbox uses a real labelled input and emits checked state', () => {
    const onChange = vi.fn()

    render(<Checkbox label="Medical condition" onChange={onChange} />)

    const checkbox = screen.getByRole('checkbox', { name: 'Medical condition' })
    fireEvent.click(screen.getByText('Medical condition'))

    expect(checkbox).toBeChecked()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('radio uses a real labelled input and emits selected value', () => {
    const onChange = vi.fn()

    render(<Radio label="Hourly" name="pay-type" value="hourly" onChange={onChange} />)

    const radio = screen.getByRole('radio', { name: 'Hourly' })
    fireEvent.click(screen.getByText('Hourly'))

    expect(radio).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith('hourly')
  })

  it('field associates labels, hints, and errors with its control', () => {
    render(
      <Field label="Email address" hint="Use the staff email." error="Email is required">
        <input />
      </Field>,
    )

    const input = screen.getByRole('textbox', { name: 'Email address' })
    const describedBy = input.getAttribute('aria-describedby') ?? ''

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(describedBy).toContain(screen.getByText('Use the staff email.').id)
    expect(describedBy).toContain(screen.getByText('Email is required').id)
  })

  it('confirm dialog waits for async confirmation before closing', async () => {
    const onClose = vi.fn()
    let resolveConfirm: () => void = () => undefined
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve
        }),
    )

    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete record"
        message="This cannot be undone."
        confirmLabel="Delete"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    resolveConfirm()

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('tabs support arrow-key navigation', () => {
    const onChange = vi.fn()

    render(
      <Tabs
        items={[
          { key: 'details', label: 'Details', content: <div>Details content</div> },
          { key: 'pay', label: 'Pay', content: <div>Pay content</div> },
        ]}
        activeKey="details"
        onChange={onChange}
      />,
    )

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Details' }), { key: 'ArrowRight' })

    expect(onChange).toHaveBeenCalledWith('pay')
  })

  it('section nav exposes tab semantics and arrow-key selection for in-page tabs', () => {
    const onSelect = vi.fn()

    render(
      <SectionNav
        activeId="details"
        onSelect={onSelect}
        items={[
          { id: 'details', label: 'Details' },
          { id: 'pay', label: 'Pay' },
        ]}
      />,
    )

    expect(screen.getByRole('tablist', { name: 'Section navigation' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Details' }), { key: 'ArrowRight' })

    expect(onSelect).toHaveBeenCalledWith('pay')
    expect(screen.getByRole('tab', { name: 'Pay' })).toHaveFocus()
  })

  it('sortable table headers expose aria-sort and sort from a button', () => {
    render(
      <DataTable
        data={[
          { id: '2', name: 'Beta' },
          { id: '1', name: 'Alpha' },
        ]}
        getRowKey={(row) => row.id}
        columns={[
          {
            key: 'name',
            header: 'Name',
            sortable: true,
            cell: (row) => row.name,
          },
        ]}
      />,
    )

    const nameHeader = screen.getByRole('columnheader', { name: 'Name' })
    expect(nameHeader).toHaveAttribute('aria-sort', 'none')

    fireEvent.click(within(nameHeader).getByRole('button', { name: 'Name' }))

    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Alpha', 'Beta'])
  })
})
