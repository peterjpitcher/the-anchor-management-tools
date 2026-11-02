import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { allSections, filledOnboardingValues } from '../fixtures/onboarding/values'

/**
 * What the onboarding page shows before the wizard starts. A snapshot that failed to load used to
 * open the wizard on empty forms, and saving an empty step wrote blanks over saved details.
 */

const validateInviteToken = vi.fn()
const getOnboardingSnapshot = vi.fn()
const signInToOnboarding = vi.fn()
const signOut = vi.fn()
const routerRefresh = vi.fn()

vi.mock('@/app/actions/employeeInvite', () => ({
  validateInviteToken: (...args: unknown[]) => validateInviteToken(...args),
  getOnboardingSnapshot: (...args: unknown[]) => getOnboardingSnapshot(...args),
  signInToOnboarding: (...args: unknown[]) => signInToOnboarding(...args),
  saveOnboardingSection: vi.fn(),
  saveOnboardingTimeOff: vi.fn(),
  acknowledgeRightToWorkNotice: vi.fn(),
  submitOnboardingProfile: vi.fn(),
  createEmployeeAccount: vi.fn(),
  checkPreferredNameAvailability: vi.fn(),
}))

vi.mock('@/app/actions/auth', () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: routerRefresh }),
}))

import OnboardingPage from '@/app/(employee-onboarding)/onboarding/[token]/page'
import OnboardingSuccessPage from '@/app/(employee-onboarding)/onboarding/success/page'

async function renderPage() {
  const ui = await OnboardingPage({ params: Promise.resolve({ token: 'invite-token' }) })
  return render(ui)
}

describe('onboarding page states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateInviteToken.mockResolvedValue({
      valid: true,
      employee_id: 'employee-1',
      email: 'starter@example.com',
      inviteType: 'onboarding',
      hasAuthUser: true,
    })
  })

  it('shows an error with a retry, not the wizard, when the saved details cannot be loaded', async () => {
    getOnboardingSnapshot.mockResolvedValue({ success: false, error: 'Failed to load your time off answers.' })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'We Could Not Load Your Details' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save & Continue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(routerRefresh).toHaveBeenCalled()
  })

  it('asks a starter with an account but no session to sign in to carry on', async () => {
    getOnboardingSnapshot.mockResolvedValue({
      success: false,
      code: 'sign_in_required',
      error: 'You have already set a password for this profile. Sign in to carry on.',
    })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Sign In to Carry On' })).toBeInTheDocument()
    expect(screen.getByText('starter@example.com')).toBeInTheDocument()

    signInToOnboarding.mockResolvedValue({ success: true })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In and Carry On' }))

    // Signed in: the page loads again, which now loads their saved details.
    await vi.waitFor(() => expect(routerRefresh).toHaveBeenCalled())
    expect(signInToOnboarding).toHaveBeenCalledWith('invite-token', 'a-long-password-1')
  })

  it('shows a wrong sign-in password under the field', async () => {
    getOnboardingSnapshot.mockResolvedValue({ success: false, code: 'sign_in_required', error: 'Sign in' })
    signInToOnboarding.mockResolvedValue({ success: false, error: 'That password is not right. Please try again, or reset it.' })

    await renderPage()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In and Carry On' }))

    expect(await screen.findByText('That password is not right. Please try again, or reset it.')).toBeInTheDocument()
    expect(routerRefresh).not.toHaveBeenCalled()
  })

  it('offers to sign out when the link is opened while signed in as someone else', async () => {
    getOnboardingSnapshot.mockResolvedValue({
      success: false,
      code: 'wrong_account',
      error: 'This onboarding link belongs to a different account. Please sign out and open the link again.',
    })
    signOut.mockResolvedValue({ success: true })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Signed In as Someone Else' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await vi.waitFor(() => expect(routerRefresh).toHaveBeenCalled())
    expect(signOut).toHaveBeenCalled()
  })

  it('opens the wizard on the saved details when they load', async () => {
    getOnboardingSnapshot.mockResolvedValue({
      success: true,
      data: { ...filledOnboardingValues(), completedSections: allSections(true) },
    })

    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Review & Submit' })).toBeInTheDocument()
  })
})

// Creating the password signs the browser in as the starter, often on a shared venue device.
describe('the finished page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lets the starter sign out on this device', async () => {
    signOut.mockResolvedValue({ success: true })
    render(await OnboardingSuccessPage({ searchParams: Promise.resolve({}) }))

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => expect(screen.getByText('You are signed out on this device.')).toBeInTheDocument())
    expect(screen.queryByText(/You are signed in on this device/)).not.toBeInTheDocument()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('offers no sign out after portal setup, which never signs the browser in', async () => {
    render(await OnboardingSuccessPage({ searchParams: Promise.resolve({ type: 'portal_access' }) }))

    expect(screen.getByText('Your staff portal account is ready to use.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument()
    expect(screen.queryByText(/You are signed in on this device/)).not.toBeInTheDocument()
  })

  it('says so when signing out fails', async () => {
    signOut.mockResolvedValue({ error: 'An error occurred during sign out' })
    render(await OnboardingSuccessPage({ searchParams: Promise.resolve({}) }))

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => expect(screen.getByText('We could not sign you out. Please try again.')).toBeInTheDocument())
  })
})
