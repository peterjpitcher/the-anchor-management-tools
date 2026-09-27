// ChristmasCourseFields has two looks: the DS look on the booking detail page, and the pre-branch
// look for the FOH kiosk's party-size dialog, which the owner keeps exactly as it is. Both must
// still load the seats, name every select and report the counts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChristmasCourseFields } from '@/components/features/table-bookings/ChristmasCourseFields'

function installFetch(response: { ok: boolean; counts?: number[] }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.ok ? 200 : 500,
    json: async () => ({ course_counts: response.counts ?? [] }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChristmasCourseFields', () => {
  it('shows the DS look by default: a Fieldset legend and a labelled select per guest', async () => {
    installFetch({ ok: true, counts: [2, 3] })
    const onChange = vi.fn()
    render(<ChristmasCourseFields bookingId="b1" partySize={2} onChange={onChange} />)

    const group = await screen.findByRole('group', { name: 'Christmas courses for each guest' })
    expect(group).toBeInTheDocument()
    expect(screen.getByLabelText('Guest 1')).toHaveValue('2')
    expect(screen.getByLabelText('Guest 2')).toHaveValue('3')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([2, 3]))
  })

  it('keeps the old compact rows for the FOH kiosk, each select still named by its guest', async () => {
    installFetch({ ok: true, counts: [1] })
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ChristmasCourseFields bookingId="b1" partySize={1} onChange={onChange} appearance="foh" />)

    const group = await screen.findByRole('group', { name: 'Christmas courses for each guest' })
    // The FOH legend is the plain pre-branch heading, not the uppercase Field label style.
    expect(group.querySelector('legend')).toHaveClass('text-sm', 'font-medium')
    expect(group.querySelector('legend')).not.toHaveClass('uppercase')

    const select = screen.getByRole('combobox', { name: 'Guest 1' })
    expect(select).toHaveValue('1')
    await user.selectOptions(select, '3')
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([3]))
  })

  it('says the courses could not be loaded in either look', async () => {
    installFetch({ ok: false })
    const { unmount } = render(<ChristmasCourseFields bookingId="b1" partySize={2} onChange={vi.fn()} />)
    expect(await screen.findByText(/Course choices could not be loaded/)).toBeInTheDocument()
    unmount()

    installFetch({ ok: false })
    render(<ChristmasCourseFields bookingId="b1" partySize={2} onChange={vi.fn()} appearance="foh" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Course choices could not be loaded/)
  })
})
