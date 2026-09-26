import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CancelLeaveRequestButton } from '@/app/(staff-portal)/portal/leave/CancelLeaveRequestButton'
import { cancelOwnLeaveRequest } from '@/app/actions/leave'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/app/actions/leave', () => ({
  cancelOwnLeaveRequest: vi.fn(),
}))

describe('staff portal A-044 controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces cancel failures inline', async () => {
    vi.mocked(cancelOwnLeaveRequest).mockResolvedValue({
      success: false,
      error: 'Only pending holiday requests can be cancelled',
    })

    render(<CancelLeaveRequestButton requestId="request-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Request' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel Request' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only pending holiday requests can be cancelled')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes after a successful cancellation', async () => {
    vi.mocked(cancelOwnLeaveRequest).mockResolvedValue({ success: true })

    render(<CancelLeaveRequestButton requestId="request-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Request' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel Request' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('asks before cancelling, in a danger dialog, and keeps the request when told to', async () => {
    vi.mocked(cancelOwnLeaveRequest).mockResolvedValue({ success: true })

    render(<CancelLeaveRequestButton requestId="request-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Request' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Cancel Request')
    expect(within(dialog).getByRole('button', { name: 'Cancel Request' })).toHaveClass('bg-danger')
    expect(cancelOwnLeaveRequest).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep Request' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(cancelOwnLeaveRequest).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps sign out wired into the portal layout', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/(staff-portal)/layout.tsx'), 'utf8')

    expect(source).toContain('auth.signOut')
    expect(source).toContain('Sign Out')
  })
})
