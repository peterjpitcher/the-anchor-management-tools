import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateAccountStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/CreateAccountStep'
import PersonalStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/PersonalStep'
import EmergencyContactsStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/EmergencyContactsStep'
import FinancialStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/FinancialStep'
import HealthStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/HealthStep'

/** Each step checks what the server checks, shows each problem under its own field, and helps the browser fill it in. */

const createEmployeeAccount = vi.fn()
const saveOnboardingSection = vi.fn()
const checkPreferredNameAvailability = vi.fn()

vi.mock('@/app/actions/employeeInvite', () => ({
  createEmployeeAccount: (...args: unknown[]) => createEmployeeAccount(...args),
  saveOnboardingSection: (...args: unknown[]) => saveOnboardingSection(...args),
  checkPreferredNameAvailability: (...args: unknown[]) => checkPreferredNameAvailability(...args),
}))

const saveButton = () => screen.getByRole('button', { name: 'Save & Continue' })

describe('create account step', () => {
  beforeEach(() => vi.clearAllMocks())

  it('needs 12 characters, says so under the field, and does not call the server', async () => {
    render(<CreateAccountStep token="invite-token" email="starter@example.com" onSuccess={vi.fn()} />)

    const password = screen.getByLabelText(/^Password/)
    fireEvent.change(password, { target: { value: 'elevenchars' } })
    fireEvent.change(screen.getByLabelText(/^Confirm Password/), { target: { value: 'elevenchars' } })
    fireEvent.submit(password.closest('form')!)

    expect(await screen.findByText('Your password must be at least 12 characters.')).toBeInTheDocument()
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(createEmployeeAccount).not.toHaveBeenCalled()
  })

  it('lets a password manager save the new password against the starter email', () => {
    const { container } = render(<CreateAccountStep token="invite-token" email="starter@example.com" onSuccess={vi.fn()} />)

    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText(/^Confirm Password/)).toHaveAttribute('autocomplete', 'new-password')
    const username = container.querySelector('input[name="username"]')
    expect(username).toHaveAttribute('autocomplete', 'username')
    expect(username).toHaveValue('starter@example.com')
  })

  it('passes on whether the browser was signed in', async () => {
    createEmployeeAccount.mockResolvedValue({ success: true, signedIn: false })
    const onSuccess = vi.fn()
    render(<CreateAccountStep token="invite-token" email="starter@example.com" onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-password-1' } })
    fireEvent.change(screen.getByLabelText(/^Confirm Password/), { target: { value: 'a-long-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account & Continue' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(false))
  })

  it('moves on to sign in when the account already exists', async () => {
    createEmployeeAccount.mockResolvedValue({
      success: false,
      error: 'You have already set a password for this profile. Sign in to carry on.',
      code: 'sign_in_required',
    })
    const onSuccess = vi.fn()
    render(<CreateAccountStep token="invite-token" email="starter@example.com" onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-password-1' } })
    fireEvent.change(screen.getByLabelText(/^Confirm Password/), { target: { value: 'a-long-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account & Continue' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(false))
  })
})

describe('personal details step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkPreferredNameAvailability.mockResolvedValue({ available: true })
  })

  it('needs a date of birth, shown under the field', async () => {
    render(<PersonalStep token="invite-token" onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Reed' } })
    fireEvent.submit(screen.getByLabelText(/First Name/).closest('form')!)

    expect(await screen.findByText('Date of birth is required')).toBeInTheDocument()
    expect(screen.getByLabelText(/Date of Birth/)).toHaveAttribute('aria-invalid', 'true')
    expect(saveOnboardingSection).not.toHaveBeenCalled()
  })

  it('shows a server problem under the field it belongs to', async () => {
    saveOnboardingSection.mockResolvedValue({
      success: false,
      error: 'Please enter a valid phone number.',
      fieldErrors: { mobile_number: 'Please enter a valid phone number.' },
    })
    render(<PersonalStep token="invite-token" onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Reed' } })
    fireEvent.change(screen.getByLabelText(/Date of Birth/), { target: { value: '1990-05-01' } })
    fireEvent.change(screen.getByLabelText(/Mobile Number/), { target: { value: '12' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText('Please enter a valid phone number.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Mobile Number/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Please check the fields marked below.')).toBeInTheDocument()
  })

  it('tells the browser what each field is', () => {
    render(<PersonalStep token="invite-token" onSuccess={vi.fn()} />)

    expect(screen.getByLabelText(/First Name/)).toHaveAttribute('autocomplete', 'given-name')
    expect(screen.getByLabelText(/Last Name/)).toHaveAttribute('autocomplete', 'family-name')
    expect(screen.getByLabelText(/Date of Birth/)).toHaveAttribute('autocomplete', 'bday')
    expect(screen.getByLabelText(/Post Code/)).toHaveAttribute('autocomplete', 'postal-code')
    expect(screen.getByLabelText(/^Phone Number/)).toHaveAttribute('type', 'tel')
    expect(screen.getByLabelText(/Mobile Number/)).toHaveAttribute('type', 'tel')
  })
})

describe('emergency contacts step', () => {
  beforeEach(() => vi.clearAllMocks())

  it('needs a phone or mobile number for the main contact', async () => {
    const { container } = render(<EmergencyContactsStep token="invite-token" onSuccess={vi.fn()} />)

    fireEvent.change(container.querySelector('#primary-name')!, { target: { value: 'Jo Reed' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText('Add a phone or mobile number for your main contact.')).toBeInTheDocument()
    expect(container.querySelector('#primary-phone_number')).toHaveAttribute('aria-invalid', 'true')
    expect(saveOnboardingSection).not.toHaveBeenCalled()
  })

  it('uses phone keyboards and capitalised labels, and keeps the starter details out of the fields', () => {
    const { container } = render(<EmergencyContactsStep token="invite-token" onSuccess={vi.fn()} />)

    for (const id of ['primary-phone_number', 'primary-mobile_number', 'secondary-phone_number', 'secondary-mobile_number']) {
      expect(container.querySelector(`#${id}`)).toHaveAttribute('type', 'tel')
      expect(container.querySelector(`#${id}`)).toHaveAttribute('autocomplete', 'off')
    }
    expect(screen.getAllByText('Phone Number').length).toBe(2)
    expect(screen.queryByText('phone number')).not.toBeInTheDocument()
  })
})

describe('financial details step', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checks the sort code format before saving', async () => {
    render(<FinancialStep token="invite-token" onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Sort Code'), { target: { value: '12345' } })
    fireEvent.change(screen.getByLabelText('Confirm Sort Code'), { target: { value: '12345' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText('Sort code must be 6 digits')).toBeInTheDocument()
    expect(saveOnboardingSection).not.toHaveBeenCalled()
  })

  it('refuses a half-edited mask rather than saving it', async () => {
    render(
      <FinancialStep
        token="invite-token"
        initialData={{ bank_sort_code: '11-22-33', bank_account_number: '••••5678' }}
        saved
        onSuccess={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Account Number'), { target: { value: '••••56789' } })
    fireEvent.change(screen.getByLabelText('Confirm Account Number'), { target: { value: '••••56789' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText(/Clear the field and type the full value/)).toBeInTheDocument()
    expect(saveOnboardingSection).not.toHaveBeenCalled()
  })

  it('lets the starter save what they have and says the bank details are needed before submitting', async () => {
    saveOnboardingSection.mockResolvedValue({
      success: true,
      saved: { ni_number: '', bank_sort_code: '', bank_account_number: '' },
    })
    const onSuccess = vi.fn()
    render(<FinancialStep token="invite-token" onSuccess={onSuccess} />)

    expect(screen.getByText(/We need your sort code and account number before you can submit/)).toBeInTheDocument()
    expect(screen.getByText(/If you do not have it to hand, leave this blank/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Bank Name'), { target: { value: 'Test Bank' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(saveOnboardingSection).toHaveBeenCalledWith('invite-token', 'financial', expect.objectContaining({
      bank_name: 'Test Bank',
      bank_sort_code: null,
    }))
  })

  it('shows a plain message when the save fails on our side', async () => {
    saveOnboardingSection.mockResolvedValue({
      success: false,
      error: 'We could not save your details just now. Please try again in a moment.',
    })
    render(<FinancialStep token="invite-token" onSuccess={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Bank Name'), { target: { value: 'Test Bank' } })
    fireEvent.click(saveButton())

    expect(await screen.findByText('We could not save your details just now. Please try again in a moment.')).toBeInTheDocument()
  })
})

describe('health step', () => {
  it('says who can see the answers and that none of them are required', () => {
    render(<HealthStep token="invite-token" onSuccess={vi.fn()} />)

    expect(screen.getByText(/Only managers who can edit staff records can see these answers/)).toBeInTheDocument()
    expect(screen.getByText('You do not have to answer any of these questions.')).toBeInTheDocument()
    // One statement for the whole step, not "(optional)" on some fields and not others.
    expect(screen.queryByText(/\(optional\)/i)).not.toBeInTheDocument()
  })
})
