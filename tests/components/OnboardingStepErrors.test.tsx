import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateAccountStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/CreateAccountStep'
import PersonalStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/PersonalStep'
import ReviewStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/ReviewStep'

const createEmployeeAccount = vi.fn()
const saveOnboardingSection = vi.fn()
const submitOnboardingProfile = vi.fn()
const checkPreferredNameAvailability = vi.fn()
const routerPush = vi.fn()

vi.mock('@/app/actions/employeeInvite', () => ({
  createEmployeeAccount: (...args: unknown[]) => createEmployeeAccount(...args),
  saveOnboardingSection: (...args: unknown[]) => saveOnboardingSection(...args),
  submitOnboardingProfile: (...args: unknown[]) => submitOnboardingProfile(...args),
  checkPreferredNameAvailability: (...args: unknown[]) => checkPreferredNameAvailability(...args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

describe('onboarding step errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkPreferredNameAvailability.mockResolvedValue({ available: true })
  })

  it('warns about a taken preferred name as soon as the field is left', async () => {
    // The uniqueness rule is a partial index covering only Active staff, so an onboarding record
    // can hold a duplicate right up until submission flips its status. Without this warning the
    // starter only finds out on the final screen, which has no name field to correct.
    checkPreferredNameAvailability.mockResolvedValue({
      available: false,
      message: 'Someone here already goes by "Peter". Please pick something else, for example add your first initial.',
    })

    render(<PersonalStep token="invite-token" onSuccess={vi.fn()} />)

    const field = screen.getByLabelText('Preferred Name')
    fireEvent.change(field, { target: { value: 'Peter' } })
    fireEvent.blur(field)

    expect(await screen.findByText(/already goes by "Peter"/)).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })

  it('clears the preferred name warning once the starter edits it again', async () => {
    checkPreferredNameAvailability.mockResolvedValue({
      available: false,
      message: 'Someone here already goes by "Peter".',
    })

    render(<PersonalStep token="invite-token" onSuccess={vi.fn()} />)

    const field = screen.getByLabelText('Preferred Name')
    fireEvent.change(field, { target: { value: 'Peter' } })
    fireEvent.blur(field)
    expect(await screen.findByText(/already goes by "Peter"/)).toBeInTheDocument()

    fireEvent.change(field, { target: { value: 'Peter H' } })
    await waitFor(() => {
      expect(screen.queryByText(/already goes by "Peter"/)).not.toBeInTheDocument()
    })
  })

  it('does not block typing when the availability check itself fails', async () => {
    checkPreferredNameAvailability.mockRejectedValue(new Error('network'))

    render(<PersonalStep token="invite-token" onSuccess={vi.fn()} />)

    const field = screen.getByLabelText('Preferred Name')
    fireEvent.change(field, { target: { value: 'Peter' } })
    fireEvent.blur(field)

    await waitFor(() => {
      expect(field).not.toHaveAttribute('aria-invalid')
    })
  })

  it('surfaces thrown account creation errors', async () => {
    createEmployeeAccount.mockRejectedValue(new Error('Account service unavailable'))
    const onSuccess = vi.fn()

    render(<CreateAccountStep token="invite-token" email="staff@example.com" onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account & Continue' }))

    expect(await screen.findByText('Account service unavailable')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('surfaces thrown section save errors', async () => {
    saveOnboardingSection.mockRejectedValue(new Error('Section save failed'))
    const onSuccess = vi.fn()

    render(<PersonalStep token="invite-token" onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Smith' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }))

    await waitFor(() => expect(saveOnboardingSection).toHaveBeenCalled())
    expect(await screen.findByText('Section save failed')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('surfaces thrown final submit errors', async () => {
    submitOnboardingProfile.mockRejectedValue(new Error('Final submit failed'))

    render(
      <ReviewStep
        token="invite-token"
        savedSections={{
          personal: true,
          time_off: true,
          emergency_contacts: true,
          financial: true,
          health: true,
          right_to_work_notice: true,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete Profile' }))

    expect(await screen.findByText('Final submit failed')).toBeInTheDocument()
    expect(routerPush).not.toHaveBeenCalled()
  })
})
