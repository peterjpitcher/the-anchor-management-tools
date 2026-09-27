import { act, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import TimeOffStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/TimeOffStep'

vi.mock('@/app/actions/employeeInvite', () => ({
  saveOnboardingTimeOff: vi.fn(),
}))

function renderStep() {
  return render(
    <TimeOffStep
      token="invite-token"
      initialAnswer={null}
      initialBlocks={[]}
      initialSubmissionVersion={0}
      onSuccess={vi.fn()}
    />,
  )
}

describe('onboarding time-off step', () => {
  it('heads each set of dates like the other step sections, as a named group', () => {
    renderStep()

    // The same sub-heading as "Primary Contact" or "GP Details", and the group a screen reader
    // announces with each of its fields.
    expect(screen.getByRole('heading', { level: 3, name: 'Dates 1' })).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Dates 1' })
    expect(group).toContainElement(screen.getByLabelText(/First day/))
  })

  it('switches the dates off, keeping what was typed, when nothing is booked', () => {
    renderStep()

    const firstDay = screen.getByLabelText(/First day/)
    fireEvent.change(firstDay, { target: { value: '2026-10-05' } })
    expect(firstDay).toBeEnabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'I have nothing booked' }))
    expect(screen.getByRole('group', { name: 'Dates 1' })).toBeDisabled()
    expect(firstDay).toBeDisabled()
    expect(firstDay).toHaveValue('2026-10-05')

    fireEvent.click(screen.getByRole('checkbox', { name: 'I have nothing booked' }))
    expect(firstDay).toBeEnabled()
    expect(firstDay).toHaveValue('2026-10-05')
  })

  it('gives the same field ids on every server render, so the page hydrates cleanly', async () => {
    const element = (
      <TimeOffStep
        token="invite-token"
        initialAnswer="has_dates"
        initialBlocks={[
          { startDate: '2026-10-05', endDate: '2026-10-09', leaveType: 'holiday', note: '' },
          { startDate: '2026-11-02', endDate: '2026-11-02', leaveType: 'unavailable', note: '' },
        ]}
        initialSubmissionVersion={0}
        onSuccess={vi.fn()}
      />
    )
    const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1])

    // Two requests render the same markup: a module-wide counter made the second one differ.
    const first = renderToString(element)
    const second = renderToString(element)
    expect(ids(second)).toEqual(ids(first))

    const container = document.createElement('div')
    container.innerHTML = first
    document.body.appendChild(container)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recoverable = vi.fn()
    await act(async () => {
      hydrateRoot(container, element, { onRecoverableError: recoverable })
    })

    expect(recoverable).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
    container.remove()
  })

  it('keeps every field id unique as rows are added, and each label on its own field', () => {
    const { container } = renderStep()

    fireEvent.click(screen.getByRole('button', { name: 'Add More Dates' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add More Dates' }))

    const firstDays = screen.getAllByLabelText(/First day/)
    expect(firstDays).toHaveLength(3)
    const allIds = Array.from(container.querySelectorAll('[id]')).map((node) => node.id)
    expect(allIds.length).toBeGreaterThanOrEqual(12)
    expect(allIds.filter((id, i) => allIds.indexOf(id) !== i)).toEqual([])

    fireEvent.change(firstDays[1], { target: { value: '2026-12-01' } })
    expect(screen.getByRole('group', { name: 'Dates 2' })).toContainElement(firstDays[1])
    expect(firstDays[0]).toHaveValue('')
    expect(firstDays[1]).toHaveValue('2026-12-01')
  })
})
