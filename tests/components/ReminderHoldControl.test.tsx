import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const actions = vi.hoisted(() => ({
  holdInvoiceReminders: vi.fn(),
  resumeInvoiceReminders: vi.fn(),
}))

vi.mock('@/app/actions/invoice-reminders', () => actions)

import { ReminderHoldControl } from '@/app/(authenticated)/invoices/[id]/_components/ReminderHoldControl'

const INVOICE_ID = '7c1e4b2a-9d3f-4e6a-8b5c-1f2e3d4c5b6a'

function renderControl(overrides: Partial<Parameters<typeof ReminderHoldControl>[0]> = {}) {
  const onChanged = vi.fn()
  const view = render(
    <ReminderHoldControl
      invoiceId={INVOICE_ID}
      status="overdue"
      heldUntil={null}
      canEdit
      onChanged={onChanged}
      {...overrides}
    />
  )
  return { onChanged, ...view }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Tuesday 13 October 2026.
  vi.setSystemTime(new Date('2026-10-13T09:30:00.000Z'))
  actions.holdInvoiceReminders.mockResolvedValue({ success: true, heldUntil: '2026-10-20' })
  actions.resumeInvoiceReminders.mockResolvedValue({ success: true, heldUntil: null })
})

describe('ReminderHoldControl', () => {
  it.each(['draft', 'paid', 'void', 'written_off'] as const)('shows nothing for a %s invoice', (status) => {
    const { container } = renderControl({ status })

    expect(container).toBeEmptyDOMElement()
  })

  it('shows a reader the hold as plain text, with nothing to press', () => {
    renderControl({ canEdit: false, heldUntil: '2026-10-20' })

    expect(screen.getByRole('status')).toHaveTextContent('Held until Tuesday 20 October 2026.')
    expect(screen.queryByLabelText('Hold reminders until')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('treats a hold that has run out as no hold', () => {
    renderControl({ heldUntil: '2026-10-12' })

    expect(screen.getByRole('status')).toHaveTextContent('Not held.')
    expect(screen.queryByRole('button', { name: 'Resume reminders' })).not.toBeInTheDocument()
  })

  it('gives an editor a labelled date field that cannot go into the past', () => {
    renderControl()

    const date = screen.getByLabelText('Hold reminders until')
    expect(date).toHaveAttribute('type', 'date')
    expect(date).toHaveAttribute('min', '2026-10-13')
    expect(screen.getByLabelText('Reason (optional)')).toHaveAttribute('maxlength', '500')
    expect(screen.getByRole('button', { name: 'Hold reminders' })).toBeInTheDocument()
  })

  it('holds until the chosen date and tells the page', async () => {
    const { onChanged } = renderControl()

    fireEvent.change(screen.getByLabelText('Hold reminders until'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Transfer promised' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hold reminders' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('2026-10-20'))
    expect(actions.holdInvoiceReminders).toHaveBeenCalledWith({
      invoiceId: INVOICE_ID,
      heldUntil: '2026-10-20',
      reason: 'Transfer promised',
    })
  })

  it('announces a missing date and does not call the server', async () => {
    const { onChanged } = renderControl()

    fireEvent.click(screen.getByRole('button', { name: 'Hold reminders' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a date to hold reminders until')
    expect(screen.getByLabelText('Hold reminders until')).toHaveAttribute('aria-invalid', 'true')
    expect(actions.holdInvoiceReminders).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('announces the server refusal and leaves the page as it was', async () => {
    actions.holdInvoiceReminders.mockResolvedValue({ error: 'You do not have permission to edit invoices' })
    const { onChanged } = renderControl()

    fireEvent.change(screen.getByLabelText('Hold reminders until'), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hold reminders' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to edit invoices')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('resumes a held invoice', async () => {
    const { onChanged } = renderControl({ heldUntil: '2026-10-20' })

    expect(screen.getByLabelText('Hold reminders until')).toHaveValue('2026-10-20')
    fireEvent.click(screen.getByRole('button', { name: 'Resume reminders' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null))
    expect(actions.resumeInvoiceReminders).toHaveBeenCalledWith({ invoiceId: INVOICE_ID })
  })
})
