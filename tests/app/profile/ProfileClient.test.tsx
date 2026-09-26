import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const actions = vi.hoisted(() => ({
  loadProfile: vi.fn(),
  updateProfile: vi.fn(),
  toggleNotification: vi.fn(),
  exportProfileData: vi.fn(),
  requestAccountDeletion: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
}))
vi.mock('@/app/actions/profile', () => actions)

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/ds/primitives/Toast', () => ({ toast }))

import { ProfileClient } from '@/app/(authenticated)/profile/_components/ProfileClient'

const PROFILE = {
  id: 'user-1',
  email: 'sam@example.com',
  full_name: 'Sam Example',
  avatar_url: null,
  created_at: '2026-01-10T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  sms_notifications: true,
  email_notifications: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.loadProfile.mockResolvedValue({ profile: PROFILE })
  actions.uploadAvatar.mockResolvedValue({ success: true })
})

describe('ProfileClient', () => {
  it('shows the name as the avatar card heading', async () => {
    render(<ProfileClient />)
    expect(await screen.findByRole('heading', { level: 3, name: 'Sam Example' })).toBeInTheDocument()
  })

  it('opens the photo picker from the Change Photo button and uploads the chosen image', async () => {
    const { container } = render(<ProfileClient />)
    const change = await screen.findByRole('button', { name: 'Change Photo' })
    expect(change.tagName).toBe('BUTTON')

    // One hidden picker, images only, out of the tab order: the button is the control.
    const inputs = container.querySelectorAll('input[type="file"]')
    expect(inputs).toHaveLength(1)
    const input = inputs[0] as HTMLInputElement
    expect(input.getAttribute('accept')).toBe('image/*')
    expect(input.tabIndex).toBe(-1)

    // The button opens that picker.
    const openPicker = vi.spyOn(input, 'click')
    await userEvent.click(change)
    expect(openPicker).toHaveBeenCalledTimes(1)
    openPicker.mockRestore()

    const file = new File([new Uint8Array(8)], 'me.png', { type: 'image/png' })
    await userEvent.upload(input, file)

    await waitFor(() => expect(actions.uploadAvatar).toHaveBeenCalledTimes(1))
    const sent = actions.uploadAvatar.mock.calls[0][0] as FormData
    expect((sent.get('avatar') as File).name).toBe('me.png')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Avatar uploaded successfully'))
    // Cleared, so choosing the same photo again still fires.
    expect(input.value).toBe('')
  })

  it('reports a failed upload rather than claiming success', async () => {
    actions.uploadAvatar.mockResolvedValue({ error: 'That image is too large' })
    const { container } = render(<ProfileClient />)
    await screen.findByRole('button', { name: 'Change Photo' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await userEvent.upload(input, new File([new Uint8Array(8)], 'big.png', { type: 'image/png' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That image is too large'))
    expect(toast.success).not.toHaveBeenCalledWith('Avatar uploaded successfully')
  })
})
