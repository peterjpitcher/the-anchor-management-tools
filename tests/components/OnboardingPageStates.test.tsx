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
const signOutOnThisDevice = vi.fn()
const globalSignOut = vi.fn()
const routerRefresh = vi.fn()
// Who the success page finds signed in, read on the server.
const session = vi.hoisted(() => ({ user: null as { id: string } | null }))

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

vi.mock('@/app/actions/onboardingSignOut', () => ({
  signOutOnThisDevice: (...args: unknown[]) => signOutOnThisDevice(...args),
}))

// The staff app's sign-out ends every session the account has. The onboarding pages never use it.
vi.mock('@/app/actions/auth', () => ({
  signOut: (...args: unknown[]) => globalSignOut(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => (session.user
        ? { data: { user: session.user }, error: null }
        : { data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } }),
    },
  }),
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

  // That someone is often a manager: signing them out everywhere ended their phone session too.
  it('offers to sign out when the link is opened while signed in as someone else, on this device only', async () => {
    getOnboardingSnapshot.mockResolvedValue({
      success: false,
      code: 'wrong_account',
      error: 'This onboarding link belongs to a different account. Please sign out and open the link again.',
    })
    signOutOnThisDevice.mockResolvedValue({ success: true })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Signed In as Someone Else' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await vi.waitFor(() => expect(routerRefresh).toHaveBeenCalled())
    expect(signOutOnThisDevice).toHaveBeenCalledTimes(1)
    expect(globalSignOut).not.toHaveBeenCalled()
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
  beforeEach(() => {
    vi.clearAllMocks()
    session.user = { id: 'auth-starter' }
  })

  it('lets the starter sign out on this device, and only this device', async () => {
    signOutOnThisDevice.mockResolvedValue({ success: true })
    render(await OnboardingSuccessPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText(/You are signed in on this device/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => expect(screen.getByText('You are signed out on this device.')).toBeInTheDocument())
    expect(screen.queryByText(/You are signed in on this device/)).not.toBeInTheDocument()
    expect(signOutOnThisDevice).toHaveBeenCalledTimes(1)
    expect(globalSignOut).not.toHaveBeenCalled()
  })

  // The signed-in line lived in the button's own state, so a reload after Sign Out, or the page
  // opened again later, said "You are signed in" with nobody signed in.
  it('says nothing about being signed in, and offers no sign out, when there is no session', async () => {
    session.user = null
    render(await OnboardingSuccessPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('How to Sign In Next Time')).toBeInTheDocument()
    expect(screen.queryByText(/You are signed in on this device/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument()
  })

  it('offers no sign out after portal setup, which never signs the browser in', async () => {
    render(await OnboardingSuccessPage({ searchParams: Promise.resolve({ type: 'portal_access' }) }))

    expect(screen.getByText('Your staff portal account is ready to use.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument()
    expect(screen.queryByText(/You are signed in on this device/)).not.toBeInTheDocument()
  })

  it('says so when signing out fails', async () => {
    signOutOnThisDevice.mockResolvedValue({ error: 'We could not sign you out. Please try again.' })
    render(await OnboardingSuccessPage({ searchParams: Promise.resolve({}) }))

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => expect(screen.getByText('We could not sign you out. Please try again.')).toBeInTheDocument())
  })
})
