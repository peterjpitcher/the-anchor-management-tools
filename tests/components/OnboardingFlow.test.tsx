import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingClient from '@/app/(employee-onboarding)/onboarding/[token]/_components/OnboardingClient'
import ReviewStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/ReviewStep'
import type { OnboardingSnapshot } from '@/app/actions/employeeInvite'
import { allSections, emptyOnboardingValues, filledOnboardingValues } from '../fixtures/onboarding/values'

/**
 * The wizard as a whole, not one step at a time. The steps unmount when the starter moves on, so
 * anything that only works because a step kept its own state is invisible to single-step tests.
 */

const saveOnboardingSection = vi.fn()
const saveOnboardingTimeOff = vi.fn()
const acknowledgeRightToWorkNotice = vi.fn()
const submitOnboardingProfile = vi.fn()
const createEmployeeAccount = vi.fn()
const checkPreferredNameAvailability = vi.fn()
const signInToOnboarding = vi.fn()
const routerPush = vi.fn()
const routerRefresh = vi.fn()

vi.mock('@/app/actions/employeeInvite', () => ({
  saveOnboardingSection: (...args: unknown[]) => saveOnboardingSection(...args),
  saveOnboardingTimeOff: (...args: unknown[]) => saveOnboardingTimeOff(...args),
  acknowledgeRightToWorkNotice: (...args: unknown[]) => acknowledgeRightToWorkNotice(...args),
  submitOnboardingProfile: (...args: unknown[]) => submitOnboardingProfile(...args),
  createEmployeeAccount: (...args: unknown[]) => createEmployeeAccount(...args),
  checkPreferredNameAvailability: (...args: unknown[]) => checkPreferredNameAvailability(...args),
  signInToOnboarding: (...args: unknown[]) => signInToOnboarding(...args),
}))

vi.mock('@/app/actions/auth', () => ({ signOut: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}))

function snapshot(
  values: ReturnType<typeof emptyOnboardingValues>,
  completed: Partial<OnboardingSnapshot['completedSections']>,
): OnboardingSnapshot {
  return { ...values, completedSections: { ...allSections(false), ...completed } }
}

function renderFlow(data: OnboardingSnapshot, hasAuthUser = true) {
  return render(
    <OnboardingClient
      token="invite-token"
      email="starter@example.com"
      inviteType="onboarding"
      hasAuthUser={hasAuthUser}
      initialData={data}
    />,
  )
}

function stepHeading(name: string) {
  return screen.findByRole('heading', { level: 1, name })
}

const saveButton = () => screen.getByRole('button', { name: 'Save & Continue' })
const backButton = () => screen.getByRole('button', { name: 'Back' })

describe('onboarding wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
    checkPreferredNameAvailability.mockResolvedValue({ available: true })
  })

  it('keeps saved financial details when the starter goes Back, masked, and does not save them again', async () => {
    // The first three sections are done, so the wizard opens on Financial Details.
    const values = filledOnboardingValues()
    values.financial = emptyOnboardingValues().financial
    renderFlow(snapshot(values, {
      personal: true, time_off: true, emergency_contacts: true,
    }))
    await stepHeading('Financial Details')

    saveOnboardingSection.mockResolvedValue({
      success: true,
      saved: { ni_number: '••••••56C', bank_sort_code: '11-22-33', bank_account_number: '••••5678' },
    })

    fireEvent.change(screen.getByLabelText('National Insurance Number'), { target: { value: 'QQ123456C' } })
    fireEvent.change(screen.getByLabelText('Bank Name'), { target: { value: 'Test Bank' } })
    fireEvent.change(screen.getByLabelText('Sort Code'), { target: { value: '112233' } })
    fireEvent.change(screen.getByLabelText('Confirm Sort Code'), { target: { value: '112233' } })
    fireEvent.change(screen.getByLabelText('Account Number'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('Confirm Account Number'), { target: { value: '12345678' } })
    fireEvent.click(saveButton())

    await stepHeading('Health Information')
    expect(saveOnboardingSection).toHaveBeenCalledTimes(1)

    fireEvent.click(backButton())
    await stepHeading('Financial Details')

    // What was saved, as a reload would show it: never blanks, never the full numbers.
    expect(screen.getByLabelText('National Insurance Number')).toHaveValue('••••••56C')
    expect(screen.getByLabelText('Bank Name')).toHaveValue('Test Bank')
    expect(screen.getByLabelText('Sort Code')).toHaveValue('11-22-33')
    expect(screen.getByLabelText('Confirm Sort Code')).toHaveValue('11-22-33')
    expect(screen.getByLabelText('Account Number')).toHaveValue('••••5678')
    expect(screen.getByLabelText('Confirm Account Number')).toHaveValue('••••5678')

    // Unchanged: moves on without writing anything.
    fireEvent.click(saveButton())
    await stepHeading('Health Information')
    expect(saveOnboardingSection).toHaveBeenCalledTimes(1)

    // Changed: the masks go back as masks (meaning "unchanged"), never as nulls.
    fireEvent.click(backButton())
    await stepHeading('Financial Details')
    fireEvent.change(screen.getByLabelText('Bank Name'), { target: { value: 'Other Bank' } })
    fireEvent.click(saveButton())
    await stepHeading('Health Information')

    expect(saveOnboardingSection).toHaveBeenCalledTimes(2)
    expect(saveOnboardingSection.mock.calls[1]).toEqual(['invite-token', 'financial', expect.objectContaining({
      bank_name: 'Other Bank',
      ni_number: '••••••56C',
      bank_sort_code: '11-22-33',
      bank_account_number: '••••5678',
    })])
  })

  it('keeps saved personal details when the starter goes Back from a later step', async () => {
    renderFlow(snapshot(emptyOnboardingValues(), {}))
    await stepHeading('Personal Details')

    saveOnboardingSection.mockResolvedValue({ success: true })
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Reed' } })
    fireEvent.change(screen.getByLabelText(/Date of Birth/), { target: { value: '1990-05-01' } })
    fireEvent.click(saveButton())

    await stepHeading('Time Off Booked')
    fireEvent.click(backButton())
    await stepHeading('Personal Details')

    expect(screen.getByLabelText(/First Name/)).toHaveValue('Sam')
    expect(screen.getByLabelText(/Date of Birth/)).toHaveValue('1990-05-01')
  })

  it('sends one more than the stored time off version on every save in the same visit', async () => {
    // Each save used to send the page-load version plus one, so the second change in a visit sent
    // the same number again and the database threw it away as a repeat.
    renderFlow(snapshot(filledOnboardingValues(), { personal: true }))
    await stepHeading('Time Off Booked')
    saveOnboardingTimeOff.mockResolvedValue({ success: true, requestsCreated: 0 })

    // The fixture already holds version 1.
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have nothing booked' }))
    fireEvent.click(saveButton())
    await stepHeading('Emergency Contacts')

    fireEvent.click(backButton())
    await stepHeading('Time Off Booked')
    expect(screen.getByRole('checkbox', { name: 'I have nothing booked' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have nothing booked' }))
    fireEvent.change(screen.getByLabelText(/First day/), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText(/Last day/), { target: { value: '2026-12-05' } })
    fireEvent.click(saveButton())
    await stepHeading('Emergency Contacts')

    fireEvent.click(backButton())
    await stepHeading('Time Off Booked')
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have nothing booked' }))
    fireEvent.click(saveButton())
    await stepHeading('Emergency Contacts')

    expect(saveOnboardingTimeOff.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ['none', 2],
      ['has_dates', 3],
      ['none', 4],
    ])

    // Unchanged: no save, so no version is spent.
    fireEvent.click(backButton())
    await stepHeading('Time Off Booked')
    fireEvent.click(saveButton())
    await stepHeading('Emergency Contacts')
    expect(saveOnboardingTimeOff).toHaveBeenCalledTimes(3)
  })

  it('moves focus to the new step heading and scrolls to the top on every step change', async () => {
    renderFlow(snapshot(filledOnboardingValues(), allSections(true)))
    await stepHeading('Review & Submit')
    // Not on first load: that would steal focus from wherever the browser put it.
    expect(window.scrollTo).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Health Information' }))
    const heading = await stepHeading('Health Information')

    await waitFor(() => expect(heading).toHaveFocus())
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it('shows a read-only summary on the review screen, and Edit comes straight back to it', async () => {
    renderFlow(snapshot(filledOnboardingValues(), allSections(true)))
    await stepHeading('Review & Submit')

    const personal = screen.getByRole('heading', { level: 3, name: 'Personal Details' }).closest('li')!
    expect(within(personal).getByText('Sam Reed')).toBeInTheDocument()
    expect(within(personal).getByText('1 May 1990')).toBeInTheDocument()
    expect(screen.getByText('Jo Reed (Partner), +447700900456')).toBeInTheDocument()
    expect(screen.getByText('••••5678')).toBeInTheDocument()
    expect(screen.getByText('••••••56C')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Financial Details' }))
    await stepHeading('Financial Details')
    fireEvent.click(saveButton())

    await stepHeading('Review & Submit')
    expect(saveOnboardingSection).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Complete Profile' })).toBeEnabled()
  })

  it('goes on step by step after Back from a step opened with Edit, not straight back to the review', async () => {
    saveOnboardingSection.mockResolvedValue({ success: true })
    renderFlow(snapshot(filledOnboardingValues(), allSections(true)))
    await stepHeading('Review & Submit')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Financial Details' }))
    await stepHeading('Financial Details')
    fireEvent.click(backButton())
    await stepHeading('Emergency Contacts')
    fireEvent.click(saveButton())

    // The step they meant to change opens next.
    await stepHeading('Financial Details')
  })

  it('tells the starter what is missing on the review screen, and will not submit', () => {
    const values = filledOnboardingValues()
    values.financial.bank_sort_code = ''
    render(
      <ReviewStep
        token="invite-token"
        values={values}
        savedSections={{ ...allSections(true), financial: false }}
        onEdit={vi.fn()}
      />,
    )

    const financial = screen.getByRole('heading', { level: 3, name: 'Financial Details' }).closest('li')!
    expect(within(financial).getByText('Incomplete')).toBeInTheDocument()
    expect(within(financial).getByText(/Add your bank sort code and account number/)).toBeInTheDocument()
    expect(within(financial).getByText('Not given')).toBeInTheDocument()
    expect(screen.getByText(/Some sections still need something before you can submit/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Profile' })).toBeDisabled()
  })

  it('reopens a section the server says is incomplete when the starter submits', async () => {
    renderFlow(snapshot(filledOnboardingValues(), allSections(true)))
    await stepHeading('Review & Submit')
    submitOnboardingProfile.mockResolvedValue({
      success: false,
      error: 'Add your bank sort code and account number in Financial Details, so we can pay you.',
      section: 'financial',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Complete Profile' }))

    // Once in the error, once under the section it now marks incomplete.
    await waitFor(() => expect(screen.getAllByText(/^Add your bank sort code and account number/)).toHaveLength(2))
    const financial = screen.getByRole('heading', { level: 3, name: 'Financial Details' }).closest('li')!
    expect(within(financial).getByText('Incomplete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Profile' })).toBeDisabled()
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('asks the starter to sign in when the account is made but the browser is not signed in', async () => {
    renderFlow(snapshot(emptyOnboardingValues(), {}), false)
    await stepHeading('Create Account')
    createEmployeeAccount.mockResolvedValue({ success: true, signedIn: false })

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-password-1' } })
    fireEvent.change(screen.getByLabelText(/^Confirm Password/), { target: { value: 'a-long-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account & Continue' }))

    await stepHeading('Sign In to Carry On')
    signInToOnboarding.mockResolvedValue({ success: true })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In and Carry On' }))

    await stepHeading('Personal Details')
    expect(signInToOnboarding).toHaveBeenCalledWith('invite-token', 'a-long-password-1')
  })

  it('keeps what was typed while the starter signs in again, then saves it', async () => {
    renderFlow(snapshot(emptyOnboardingValues(), {}))
    await stepHeading('Personal Details')

    saveOnboardingSection.mockResolvedValueOnce({
      success: false,
      code: 'sign_in_required',
      error: 'You have already set a password for this profile. Sign in to carry on.',
    })
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Reed' } })
    fireEvent.change(screen.getByLabelText(/Date of Birth/), { target: { value: '1990-05-01' } })
    fireEvent.click(saveButton())

    await stepHeading('Sign In to Carry On')
    signInToOnboarding.mockResolvedValue({ success: true })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In and Carry On' }))

    await stepHeading('Personal Details')
    expect(screen.getByLabelText(/First Name/)).toHaveValue('Sam')

    saveOnboardingSection.mockResolvedValueOnce({ success: true })
    fireEvent.click(saveButton())
    await stepHeading('Time Off Booked')
    expect(saveOnboardingSection).toHaveBeenCalledTimes(2)
  })
})
