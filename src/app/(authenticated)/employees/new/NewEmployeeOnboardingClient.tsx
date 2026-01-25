'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Tabs } from '@/components/ui-v2/navigation/Tabs'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { RadioGroup } from '@/components/ui-v2/forms/Radio'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { addEmployee, addEmergencyContact, upsertRightToWork, updateOnboardingChecklist } from '@/app/actions/employeeActions'

type EmployeeStatus = 'Active' | 'Former' | 'Prospective'

type RightToWorkDocumentType = 'Passport' | 'Biometric Residence Permit' | 'Share Code' | 'Other' | 'List A' | 'List B'
type RightToWorkCheckMethod = 'manual' | 'online' | 'digital'

const DIGIT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine'
] as const

function digitsToWords(input: string) {
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''
  return digits
    .split('')
    .map((d) => DIGIT_WORDS[Number(d) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9])
    .join('-')
}

type EmployeeSetupState = {
  employee: {
    first_name: string
    last_name: string
    email_address: string
    job_title: string
    employment_start_date: string
    employment_end_date: string
    status: EmployeeStatus
    date_of_birth: string
    address: string
    post_code: string
    phone_number: string
    mobile_number: string
    first_shift_date: string
    uniform_preference: string
    keyholder_status: boolean
  }
  emergency_contacts: {
    primary: {
      name: string
      relationship: string
      phone_number: string
      mobile_number: string
    }
    secondary: {
      name: string
      relationship: string
      phone_number: string
      mobile_number: string
    }
  }
  financial: {
    ni_number: string
    bank_name: string
    bank_sort_code: string
    bank_account_number: string
    payee_name: string
    branch_address: string
  }
  health: {
    doctor_name: string
    doctor_address: string
    has_allergies: boolean
    allergies: string
    had_absence_over_2_weeks_last_3_years: boolean
    had_outpatient_treatment_over_3_months_last_3_years: boolean
    absence_or_treatment_details: string
    has_diabetes: boolean
    has_epilepsy: boolean
    has_skin_condition: boolean
    has_depressive_illness: boolean
    has_bowel_problems: boolean
    has_ear_problems: boolean
    is_registered_disabled: boolean
    disability_reg_number: string
    disability_reg_expiry_date: string
    disability_details: string
  }
  right_to_work: {
    enabled: boolean
    check_method: RightToWorkCheckMethod | ''
    document_type: RightToWorkDocumentType | ''
    document_reference: string
    document_details: string
    verification_date: string
    document_expiry_date: string
    follow_up_date: string
    document_photo: File | null
  }
  onboarding: {
    wheniwork_invite_sent: boolean
    private_whatsapp_added: boolean
    team_whatsapp_added: boolean
    till_system_setup: boolean
    training_flow_setup: boolean
    employment_agreement_drafted: boolean
    employee_agreement_accepted: boolean
  }
}

const DEFAULT_STATE: EmployeeSetupState = {
  employee: {
    first_name: '',
    last_name: '',
    email_address: '',
    job_title: '',
    employment_start_date: '',
    employment_end_date: '',
    status: 'Active',
    date_of_birth: '',
    address: '',
    post_code: '',
    phone_number: '',
    mobile_number: '',
    first_shift_date: '',
    uniform_preference: '',
    keyholder_status: false
  },
  emergency_contacts: {
    primary: { name: '', relationship: '', phone_number: '', mobile_number: '' },
    secondary: { name: '', relationship: '', phone_number: '', mobile_number: '' }
  },
  financial: {
    ni_number: '',
    bank_name: '',
    bank_sort_code: '',
    bank_account_number: '',
    payee_name: '',
    branch_address: ''
  },
  health: {
    doctor_name: '',
    doctor_address: '',
    has_allergies: false,
    allergies: '',
    had_absence_over_2_weeks_last_3_years: false,
    had_outpatient_treatment_over_3_months_last_3_years: false,
    absence_or_treatment_details: '',
    has_diabetes: false,
    has_epilepsy: false,
    has_skin_condition: false,
    has_depressive_illness: false,
    has_bowel_problems: false,
    has_ear_problems: false,
    is_registered_disabled: false,
    disability_reg_number: '',
    disability_reg_expiry_date: '',
    disability_details: ''
  },
  right_to_work: {
    enabled: false,
    check_method: '',
    document_type: '',
    document_reference: '',
    document_details: '',
    verification_date: '',
    document_expiry_date: '',
    follow_up_date: '',
    document_photo: null
  },
  onboarding: {
    wheniwork_invite_sent: false,
    private_whatsapp_added: false,
    team_whatsapp_added: false,
    till_system_setup: false,
    training_flow_setup: false,
    employment_agreement_drafted: false,
    employee_agreement_accepted: false
  }
}

function hasAnyEmergencyContact(contact: EmployeeSetupState['emergency_contacts']['primary']) {
  return Boolean(contact.name || contact.relationship || contact.phone_number || contact.mobile_number)
}

export default function NewEmployeeOnboardingClient() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('employee')
  const [state, setState] = useState<EmployeeSetupState>(DEFAULT_STATE)
  const [isPending, startTransition] = useTransition()

  const sortCodeInWords = useMemo(() => digitsToWords(state.financial.bank_sort_code), [state.financial.bank_sort_code])
  const accountNumberInWords = useMemo(() => digitsToWords(state.financial.bank_account_number), [state.financial.bank_account_number])

  const updateEmployee = <K extends keyof EmployeeSetupState['employee']>(key: K, value: EmployeeSetupState['employee'][K]) => {
    setState((prev) => ({ ...prev, employee: { ...prev.employee, [key]: value } }))
  }

  const updateFinancial = <K extends keyof EmployeeSetupState['financial']>(key: K, value: EmployeeSetupState['financial'][K]) => {
    setState((prev) => ({ ...prev, financial: { ...prev.financial, [key]: value } }))
  }

  const updateHealth = <K extends keyof EmployeeSetupState['health']>(key: K, value: EmployeeSetupState['health'][K]) => {
    setState((prev) => ({ ...prev, health: { ...prev.health, [key]: value } }))
  }

  const updateContact = (
    which: keyof EmployeeSetupState['emergency_contacts'],
    key: keyof EmployeeSetupState['emergency_contacts']['primary'],
    value: string
  ) => {
    setState((prev) => ({
      ...prev,
      emergency_contacts: {
        ...prev.emergency_contacts,
        [which]: {
          ...prev.emergency_contacts[which],
          [key]: value
        }
      }
    }))
  }

  const updateRightToWork = <K extends keyof EmployeeSetupState['right_to_work']>(
    key: K,
    value: EmployeeSetupState['right_to_work'][K]
  ) => {
    setState((prev) => ({ ...prev, right_to_work: { ...prev.right_to_work, [key]: value } }))
  }

  const updateOnboarding = <K extends keyof EmployeeSetupState['onboarding']>(
    key: K,
    value: EmployeeSetupState['onboarding'][K]
  ) => {
    setState((prev) => ({ ...prev, onboarding: { ...prev.onboarding, [key]: value } }))
  }

  const validateRequiredFields = () => {
    const missing: string[] = []
    if (!state.employee.first_name.trim()) missing.push('First name')
    if (!state.employee.last_name.trim()) missing.push('Last name')
    if (!state.employee.email_address.trim()) missing.push('Email address')
    if (!state.employee.job_title.trim()) missing.push('Job title')
    if (!state.employee.employment_start_date) missing.push('Employment start date')
    return missing
  }

  const handleCreateEmployee = () => {
    const missing = validateRequiredFields()
    if (missing.length > 0) {
      toast.error(`Missing required fields: ${missing.join(', ')}`)
      setActiveTab('employee')
      return
    }

    startTransition(async () => {
      try {
        const employeeFormData = new FormData()

        // Employee (Section 1 + office fields)
        employeeFormData.append('first_name', state.employee.first_name.trim())
        employeeFormData.append('last_name', state.employee.last_name.trim())
        employeeFormData.append('email_address', state.employee.email_address.trim())
        employeeFormData.append('job_title', state.employee.job_title.trim())
        employeeFormData.append('employment_start_date', state.employee.employment_start_date)
        employeeFormData.append('status', state.employee.status)

        if (state.employee.employment_end_date) employeeFormData.append('employment_end_date', state.employee.employment_end_date)
        if (state.employee.date_of_birth) employeeFormData.append('date_of_birth', state.employee.date_of_birth)
        if (state.employee.address) employeeFormData.append('address', state.employee.address)
        if (state.employee.post_code) employeeFormData.append('post_code', state.employee.post_code)
        if (state.employee.phone_number) employeeFormData.append('phone_number', state.employee.phone_number)
        if (state.employee.mobile_number) employeeFormData.append('mobile_number', state.employee.mobile_number)
        if (state.employee.first_shift_date) employeeFormData.append('first_shift_date', state.employee.first_shift_date)
        if (state.employee.uniform_preference) employeeFormData.append('uniform_preference', state.employee.uniform_preference)
        employeeFormData.append('keyholder_status', String(state.employee.keyholder_status))

        // Financial (Section 2)
        if (state.financial.ni_number) employeeFormData.append('ni_number', state.financial.ni_number)
        if (state.financial.bank_name) employeeFormData.append('bank_name', state.financial.bank_name)
        if (state.financial.bank_sort_code) employeeFormData.append('bank_sort_code', state.financial.bank_sort_code)
        if (state.financial.bank_account_number) employeeFormData.append('bank_account_number', state.financial.bank_account_number)
        if (state.financial.payee_name) employeeFormData.append('payee_name', state.financial.payee_name)
        if (state.financial.branch_address) employeeFormData.append('branch_address', state.financial.branch_address)

        // Health (Section 3)
        if (state.health.doctor_name) employeeFormData.append('doctor_name', state.health.doctor_name)
        if (state.health.doctor_address) employeeFormData.append('doctor_address', state.health.doctor_address)
        employeeFormData.append('has_allergies', String(state.health.has_allergies))
        if (state.health.has_allergies && state.health.allergies) employeeFormData.append('allergies', state.health.allergies)
        employeeFormData.append(
          'had_absence_over_2_weeks_last_3_years',
          String(state.health.had_absence_over_2_weeks_last_3_years)
        )
        employeeFormData.append(
          'had_outpatient_treatment_over_3_months_last_3_years',
          String(state.health.had_outpatient_treatment_over_3_months_last_3_years)
        )
        if (
          (state.health.had_absence_over_2_weeks_last_3_years || state.health.had_outpatient_treatment_over_3_months_last_3_years) &&
          state.health.absence_or_treatment_details
        ) {
          employeeFormData.append('absence_or_treatment_details', state.health.absence_or_treatment_details)
        }

        employeeFormData.append('has_diabetes', String(state.health.has_diabetes))
        employeeFormData.append('has_epilepsy', String(state.health.has_epilepsy))
        employeeFormData.append('has_skin_condition', String(state.health.has_skin_condition))
        employeeFormData.append('has_depressive_illness', String(state.health.has_depressive_illness))
        employeeFormData.append('has_bowel_problems', String(state.health.has_bowel_problems))
        employeeFormData.append('has_ear_problems', String(state.health.has_ear_problems))

        employeeFormData.append('is_registered_disabled', String(state.health.is_registered_disabled))
        if (state.health.is_registered_disabled) {
          if (state.health.disability_reg_number) employeeFormData.append('disability_reg_number', state.health.disability_reg_number)
          if (state.health.disability_reg_expiry_date) {
            employeeFormData.append('disability_reg_expiry_date', state.health.disability_reg_expiry_date)
          }
          if (state.health.disability_details) employeeFormData.append('disability_details', state.health.disability_details)
        }

        const createResult = await addEmployee(null as any, employeeFormData)
        if (!createResult || createResult.type !== 'success' || !createResult.employeeId) {
          throw new Error(createResult?.message || 'Failed to create employee')
        }

        const employeeId = createResult.employeeId
        const followUpErrors: string[] = []

        // Emergency contacts (Section 1)
        const primary = state.emergency_contacts.primary
        const secondary = state.emergency_contacts.secondary

        if (hasAnyEmergencyContact(primary)) {
          if (!primary.name.trim()) {
            followUpErrors.push('Primary emergency contact name is missing.')
          } else {
            const contactForm = new FormData()
            contactForm.append('employee_id', employeeId)
            contactForm.append('name', primary.name.trim())
            contactForm.append('priority', 'Primary')
            if (primary.relationship) contactForm.append('relationship', primary.relationship)
            if (primary.phone_number) contactForm.append('phone_number', primary.phone_number)
            if (primary.mobile_number) contactForm.append('mobile_number', primary.mobile_number)

            const res = await addEmergencyContact(null, contactForm)
            if (res?.type === 'error') {
              followUpErrors.push(res.message || 'Failed to save primary emergency contact.')
            }
          }
        }

        if (hasAnyEmergencyContact(secondary)) {
          if (!secondary.name.trim()) {
            followUpErrors.push('Secondary emergency contact name is missing.')
          } else {
            const contactForm = new FormData()
            contactForm.append('employee_id', employeeId)
            contactForm.append('name', secondary.name.trim())
            contactForm.append('priority', 'Secondary')
            if (secondary.relationship) contactForm.append('relationship', secondary.relationship)
            if (secondary.phone_number) contactForm.append('phone_number', secondary.phone_number)
            if (secondary.mobile_number) contactForm.append('mobile_number', secondary.mobile_number)

            const res = await addEmergencyContact(null, contactForm)
            if (res?.type === 'error') {
              followUpErrors.push(res.message || 'Failed to save secondary emergency contact.')
            }
          }
        }

        // Right to work (Section 4)
        if (state.right_to_work.enabled) {
          if (!state.right_to_work.document_type || !state.right_to_work.verification_date) {
            followUpErrors.push('Right to Work is enabled but document type or verification date is missing.')
          } else {
            const rtwForm = new FormData()
            rtwForm.append('employee_id', employeeId)
            rtwForm.append('document_type', state.right_to_work.document_type)
            if (state.right_to_work.check_method) rtwForm.append('check_method', state.right_to_work.check_method)
            if (state.right_to_work.document_reference) rtwForm.append('document_reference', state.right_to_work.document_reference)
            rtwForm.append('verification_date', state.right_to_work.verification_date)
            if (state.right_to_work.document_expiry_date) rtwForm.append('document_expiry_date', state.right_to_work.document_expiry_date)
            if (state.right_to_work.follow_up_date) rtwForm.append('follow_up_date', state.right_to_work.follow_up_date)
            if (state.right_to_work.document_details) rtwForm.append('document_details', state.right_to_work.document_details)
            if (state.right_to_work.document_photo) rtwForm.append('document_photo', state.right_to_work.document_photo)

            const rtwResult = await upsertRightToWork(null, rtwForm)
            if (rtwResult?.type === 'error') {
              followUpErrors.push(rtwResult.message || 'Failed to save right to work information.')
            }
          }
        }

        // Office checklist (Section 7 - for office use)
        const checklistFields = Object.entries(state.onboarding) as Array<[keyof EmployeeSetupState['onboarding'], boolean]>
        for (const [field, checked] of checklistFields) {
          if (!checked) continue
          const result = await updateOnboardingChecklist(employeeId, field, true)
          if (!result.success) {
            followUpErrors.push(result.error || `Failed to update onboarding checklist: ${field}`)
          }
        }

        if (followUpErrors.length > 0) {
          console.warn('[NewEmployeeOnboarding] Follow-up errors:', followUpErrors)
          toast.error('Employee created, but some sections could not be saved. Please review the employee profile.')
        } else {
          toast.success('Employee created successfully!')
        }

        router.push(`/employees/${employeeId}`)
      } catch (error) {
        console.error('[NewEmployeeOnboarding] Create failed', error)
        toast.error('Failed to create employee. Please check the form and try again.')
      }
    })
  }

  const tabs = [
    {
      key: 'employee',
      label: 'Employee Details',
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <FormGroup label="First Name" required>
              <Input value={state.employee.first_name} onChange={(e) => updateEmployee('first_name', e.target.value)} />
            </FormGroup>
            <FormGroup label="Last Name" required>
              <Input value={state.employee.last_name} onChange={(e) => updateEmployee('last_name', e.target.value)} />
            </FormGroup>
            <FormGroup label="Email Address" required>
              <Input
                type="email"
                value={state.employee.email_address}
                onChange={(e) => updateEmployee('email_address', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Job Title" required>
              <Input value={state.employee.job_title} onChange={(e) => updateEmployee('job_title', e.target.value)} />
            </FormGroup>

            <FormGroup label="Employment Start Date" required>
              <Input
                type="date"
                value={state.employee.employment_start_date}
                onChange={(e) => updateEmployee('employment_start_date', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Status" required>
              <Select
                value={state.employee.status}
                onChange={(e) => updateEmployee('status', e.target.value as EmployeeStatus)}
                options={[
                  { value: 'Active', label: 'Active' },
                  { value: 'Prospective', label: 'Prospective' },
                  { value: 'Former', label: 'Former' }
                ]}
              />
            </FormGroup>

            <FormGroup label="Employment End Date">
              <Input
                type="date"
                value={state.employee.employment_end_date}
                onChange={(e) => updateEmployee('employment_end_date', e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Date of Birth">
              <Input type="date" value={state.employee.date_of_birth} onChange={(e) => updateEmployee('date_of_birth', e.target.value)} />
            </FormGroup>

            <FormGroup label="Telephone">
              <Input value={state.employee.phone_number} onChange={(e) => updateEmployee('phone_number', e.target.value)} placeholder="e.g. 01372..." />
            </FormGroup>
            <FormGroup label="Mobile">
              <Input value={state.employee.mobile_number} onChange={(e) => updateEmployee('mobile_number', e.target.value)} placeholder="e.g. 07..." />
            </FormGroup>

            <FormGroup label="Post Code">
              <Input value={state.employee.post_code} onChange={(e) => updateEmployee('post_code', e.target.value)} placeholder="e.g. KT..." />
            </FormGroup>
            <FormGroup label="First Shift Date" help="For office use (can be set later).">
              <Input type="date" value={state.employee.first_shift_date} onChange={(e) => updateEmployee('first_shift_date', e.target.value)} />
            </FormGroup>

            <FormGroup label="Address" className="sm:col-span-2">
              <Textarea value={state.employee.address} onChange={(e) => updateEmployee('address', e.target.value)} rows={3} />
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <FormGroup label="Uniform Preference" help="Optional (e.g. branded t-shirt, own clothes).">
              <Input value={state.employee.uniform_preference} onChange={(e) => updateEmployee('uniform_preference', e.target.value)} />
            </FormGroup>
            <FormGroup label="Keyholder Status" help="Mark if keys have been issued.">
              <Checkbox
                checked={state.employee.keyholder_status}
                onChange={(e) => updateEmployee('keyholder_status', e.target.checked)}
                label="Employee is a keyholder"
              />
            </FormGroup>
          </div>
        </div>
      )
    },
    {
      key: 'contacts',
      label: 'Emergency Contacts',
      content: (
        <div className="space-y-8">
          <Alert variant="info">
            Add at least one contact who can be reached quickly in an emergency.
          </Alert>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              <h3 className="text-base font-medium text-gray-900">Primary Contact</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormGroup label="Name">
                  <Input value={state.emergency_contacts.primary.name} onChange={(e) => updateContact('primary', 'name', e.target.value)} />
                </FormGroup>
                <FormGroup label="Relationship">
                  <Input
                    value={state.emergency_contacts.primary.relationship}
                    onChange={(e) => updateContact('primary', 'relationship', e.target.value)}
                  />
                </FormGroup>
                <FormGroup label="Telephone">
                  <Input
                    value={state.emergency_contacts.primary.phone_number}
                    onChange={(e) => updateContact('primary', 'phone_number', e.target.value)}
                  />
                </FormGroup>
                <FormGroup label="Mobile">
                  <Input
                    value={state.emergency_contacts.primary.mobile_number}
                    onChange={(e) => updateContact('primary', 'mobile_number', e.target.value)}
                  />
                </FormGroup>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-medium text-gray-900">Secondary Contact</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormGroup label="Name">
                  <Input
                    value={state.emergency_contacts.secondary.name}
                    onChange={(e) => updateContact('secondary', 'name', e.target.value)}
                  />
                </FormGroup>
                <FormGroup label="Relationship">
                  <Input
                    value={state.emergency_contacts.secondary.relationship}
                    onChange={(e) => updateContact('secondary', 'relationship', e.target.value)}
                  />
                </FormGroup>
                <FormGroup label="Telephone">
                  <Input
                    value={state.emergency_contacts.secondary.phone_number}
                    onChange={(e) => updateContact('secondary', 'phone_number', e.target.value)}
                  />
                </FormGroup>
                <FormGroup label="Mobile">
                  <Input
                    value={state.emergency_contacts.secondary.mobile_number}
                    onChange={(e) => updateContact('secondary', 'mobile_number', e.target.value)}
                  />
                </FormGroup>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      key: 'bank',
      label: 'Bank Details',
      content: (
        <div className="space-y-6">
          <Alert variant="info">
            We authorise salary to be paid by direct credit transfer to the account below.
          </Alert>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <FormGroup label="NI Number" help="Format: AA123456A">
              <Input value={state.financial.ni_number} onChange={(e) => updateFinancial('ni_number', e.target.value.toUpperCase())} />
            </FormGroup>
            <FormGroup label="Bank / Building Society">
              <Input value={state.financial.bank_name} onChange={(e) => updateFinancial('bank_name', e.target.value)} />
            </FormGroup>

            <FormGroup
              label="Sort Code"
              help={sortCodeInWords ? `In words: ${sortCodeInWords}` : 'e.g. 00-00-00'}
            >
              <Input
                value={state.financial.bank_sort_code}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
                  const formatted = digits.match(/.{1,2}/g)?.join('-') ?? digits
                  updateFinancial('bank_sort_code', formatted)
                }}
                placeholder="00-00-00"
              />
            </FormGroup>

            <FormGroup
              label="Account Number"
              help={accountNumberInWords ? `In words: ${accountNumberInWords}` : '8 digits'}
            >
              <Input
                value={state.financial.bank_account_number}
                onChange={(e) => updateFinancial('bank_account_number', e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="8 digits"
              />
            </FormGroup>

            <FormGroup label="Account Name(s)">
              <Input value={state.financial.payee_name} onChange={(e) => updateFinancial('payee_name', e.target.value)} />
            </FormGroup>

            <FormGroup label="Branch Address" className="sm:col-span-2">
              <Textarea value={state.financial.branch_address} onChange={(e) => updateFinancial('branch_address', e.target.value)} rows={2} />
            </FormGroup>
          </div>
        </div>
      )
    },
    {
      key: 'health',
      label: 'Health Information',
      content: (
        <div className="space-y-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <FormGroup label="Doctor's Name">
              <Input value={state.health.doctor_name} onChange={(e) => updateHealth('doctor_name', e.target.value)} />
            </FormGroup>
            <FormGroup label="Doctor's Address" className="sm:col-span-2">
              <Textarea value={state.health.doctor_address} onChange={(e) => updateHealth('doctor_address', e.target.value)} rows={2} />
            </FormGroup>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-medium text-gray-900">Health Questionnaire</h3>

            <FormGroup label="Do you have any allergies?">
              <RadioGroup
                name="has_allergies"
                variant="card"
                value={state.health.has_allergies ? 'yes' : 'no'}
                onChange={(value) => updateHealth('has_allergies', value === 'yes')}
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' }
                ]}
              />
            </FormGroup>

            {state.health.has_allergies && (
              <FormGroup label="If yes, please specify">
                <Textarea value={state.health.allergies} onChange={(e) => updateHealth('allergies', e.target.value)} rows={2} />
              </FormGroup>
            )}

            <div className="space-y-3 pt-2">
              <Checkbox
                checked={state.health.had_absence_over_2_weeks_last_3_years}
                onChange={(e) => updateHealth('had_absence_over_2_weeks_last_3_years', e.target.checked)}
                label="In the past 3 years, been off work for 2+ weeks due to illness/accident?"
              />
              <Checkbox
                checked={state.health.had_outpatient_treatment_over_3_months_last_3_years}
                onChange={(e) => updateHealth('had_outpatient_treatment_over_3_months_last_3_years', e.target.checked)}
                label="In the past 3 years, attended outpatient treatment for 3+ months?"
              />
            </div>

            {(state.health.had_absence_over_2_weeks_last_3_years || state.health.had_outpatient_treatment_over_3_months_last_3_years) && (
              <FormGroup label="If yes to either, please provide details">
                <Textarea
                  value={state.health.absence_or_treatment_details}
                  onChange={(e) => updateHealth('absence_or_treatment_details', e.target.value)}
                  rows={3}
                />
              </FormGroup>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-medium text-gray-900">Medical Conditions (tick if applicable)</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Checkbox checked={state.health.has_diabetes} onChange={(e) => updateHealth('has_diabetes', e.target.checked)} label="Diabetes" />
              <Checkbox checked={state.health.has_epilepsy} onChange={(e) => updateHealth('has_epilepsy', e.target.checked)} label="Epilepsy / Fits / Blackouts" />
              <Checkbox checked={state.health.has_skin_condition} onChange={(e) => updateHealth('has_skin_condition', e.target.checked)} label="Eczema / Dermatitis / Skin Disease" />
              <Checkbox checked={state.health.has_depressive_illness} onChange={(e) => updateHealth('has_depressive_illness', e.target.checked)} label="Depressive Illness" />
              <Checkbox checked={state.health.has_bowel_problems} onChange={(e) => updateHealth('has_bowel_problems', e.target.checked)} label="Bowel Problems" />
              <Checkbox checked={state.health.has_ear_problems} onChange={(e) => updateHealth('has_ear_problems', e.target.checked)} label="Ear Problems" />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-medium text-gray-900">Disability</h3>
            <Checkbox
              checked={state.health.is_registered_disabled}
              onChange={(e) => updateHealth('is_registered_disabled', e.target.checked)}
              label="Registered disabled?"
            />

            {state.health.is_registered_disabled && (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <FormGroup label="Registration number">
                  <Input value={state.health.disability_reg_number} onChange={(e) => updateHealth('disability_reg_number', e.target.value)} />
                </FormGroup>
                <FormGroup label="Expiry">
                  <Input
                    type="date"
                    value={state.health.disability_reg_expiry_date}
                    onChange={(e) => updateHealth('disability_reg_expiry_date', e.target.value)}
                  />
                </FormGroup>
                <FormGroup label="Details" className="sm:col-span-2">
                  <Textarea value={state.health.disability_details} onChange={(e) => updateHealth('disability_details', e.target.value)} rows={3} />
                </FormGroup>
              </div>
            )}
          </div>
        </div>
      )
    },
    {
      key: 'rtw',
      label: 'Right to Work',
      content: (
        <div className="space-y-6">
          <Alert variant="info">
            To comply with UK law, employees must provide evidence of their legal right to work. You can add this now or later.
          </Alert>

          <Checkbox
            checked={state.right_to_work.enabled}
            onChange={(e) => updateRightToWork('enabled', e.target.checked)}
            label="Right to Work check completed now"
          />

          {state.right_to_work.enabled && (
            <div className="space-y-6">
              <FormGroup label="Check method">
                <Select
                  value={state.right_to_work.check_method}
                  onChange={(e) => updateRightToWork('check_method', e.target.value as RightToWorkCheckMethod)}
                  options={[
                    { value: '', label: 'Select method…' },
                    { value: 'manual', label: 'Manual check (original documents)' },
                    { value: 'online', label: 'Online Home Office check (eVisa)' },
                    { value: 'digital', label: 'Digital check (IDSP)' }
                  ]}
                />
              </FormGroup>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <FormGroup label="Document type" required>
                  <Select
                    value={state.right_to_work.document_type}
                    onChange={(e) => updateRightToWork('document_type', e.target.value as RightToWorkDocumentType)}
                    options={[
                      { value: '', label: 'Select type…' },
                      { value: 'Passport', label: 'Passport' },
                      { value: 'Biometric Residence Permit', label: 'Biometric Residence Permit' },
                      { value: 'Share Code', label: 'Share Code' },
                      { value: 'List A', label: 'List A (permanent)' },
                      { value: 'List B', label: 'List B (temporary)' },
                      { value: 'Other', label: 'Other' }
                    ]}
                  />
                </FormGroup>

                <FormGroup label="Reference (passport no / share code)">
                  <Input value={state.right_to_work.document_reference} onChange={(e) => updateRightToWork('document_reference', e.target.value)} />
                </FormGroup>

                <FormGroup label="Verification date" required>
                  <Input
                    type="date"
                    value={state.right_to_work.verification_date}
                    onChange={(e) => updateRightToWork('verification_date', e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Document expiry date">
                  <Input
                    type="date"
                    value={state.right_to_work.document_expiry_date}
                    onChange={(e) => updateRightToWork('document_expiry_date', e.target.value)}
                  />
                </FormGroup>

                <FormGroup label="Follow-up date">
                  <Input type="date" value={state.right_to_work.follow_up_date} onChange={(e) => updateRightToWork('follow_up_date', e.target.value)} />
                </FormGroup>

                <FormGroup label="Document photo / scan (PDF/JPG/PNG)" className="sm:col-span-2">
                  <Input
                    type="file"
                    onChange={(e) => updateRightToWork('document_photo', e.target.files?.[0] ?? null)}
                    accept=".pdf,.jpg,.jpeg,.png"
                  />
                </FormGroup>

                <FormGroup label="Additional details" className="sm:col-span-2">
                  <Textarea value={state.right_to_work.document_details} onChange={(e) => updateRightToWork('document_details', e.target.value)} rows={3} />
                </FormGroup>
              </div>
            </div>
          )}
        </div>
      )
    },
    {
      key: 'agreement',
      label: 'Agreement & Setup',
      content: (
        <div className="space-y-8">
          <Alert variant="info">
            Use this section to confirm the employee has received the handbook and to record office setup tasks.
          </Alert>

          <div className="space-y-4">
            <h3 className="text-base font-medium text-gray-900">Key Points (Quick Reference)</h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-900 mb-2">Zero Tolerance</p>
                <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                  <li>Theft (immediate dismissal)</li>
                  <li>Drugs/alcohol on duty (immediate dismissal)</li>
                  <li>Giving/taking drinks without charging/paying (immediate dismissal)</li>
                  <li>Free pouring drinks (immediate dismissal)</li>
                  <li>No ID, no sale (under 25 check)</li>
                </ul>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-900 mb-2">Daily Essentials</p>
                <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                  <li>Arrive 15 minutes early</li>
                  <li>Clock in/out every shift</li>
                  <li>Complete daily checklist</li>
                  <li>Phones off during shifts (except breaks)</li>
                  <li>Report cash errors immediately</li>
                </ul>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-900 mb-2">Critical Procedures</p>
                <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                  <li>No discounts/refunds/tabs without approval</li>
                  <li>Use correct measures (no free-pouring)</li>
                  <li>Complete closing before clocking out</li>
                  <li>Report incidents immediately</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-medium text-gray-900">Employee Agreement</h3>
            <Checkbox
              checked={state.onboarding.employee_agreement_accepted}
              onChange={(e) => updateOnboarding('employee_agreement_accepted', e.target.checked)}
              label="Employee has read, understood, and agreed to the staff handbook and rules"
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-base font-medium text-gray-900">Office Use Checklist</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Checkbox
                checked={state.onboarding.wheniwork_invite_sent}
                onChange={(e) => updateOnboarding('wheniwork_invite_sent', e.target.checked)}
                label="WhenIWork invite sent"
              />
              <Checkbox
                checked={state.onboarding.private_whatsapp_added}
                onChange={(e) => updateOnboarding('private_whatsapp_added', e.target.checked)}
                label="Added to private WhatsApp"
              />
              <Checkbox
                checked={state.onboarding.team_whatsapp_added}
                onChange={(e) => updateOnboarding('team_whatsapp_added', e.target.checked)}
                label="Added to team WhatsApp"
              />
              <Checkbox
                checked={state.onboarding.till_system_setup}
                onChange={(e) => updateOnboarding('till_system_setup', e.target.checked)}
                label="Setup on till system"
              />
              <Checkbox
                checked={state.onboarding.training_flow_setup}
                onChange={(e) => updateOnboarding('training_flow_setup', e.target.checked)}
                label="Training setup in Flow"
              />
              <Checkbox
                checked={state.onboarding.employment_agreement_drafted}
                onChange={(e) => updateOnboarding('employment_agreement_drafted', e.target.checked)}
                label="Employment agreement drafted"
              />
            </div>
          </div>
        </div>
      )
    }
  ]

  return (
    <PageLayout
      title="New Employee Setup"
      subtitle="Follow the onboarding document flow to capture all required details in one place."
      backButton={{ label: 'Back to Employees', href: '/employees' }}
      headerActions={
        <Button onClick={handleCreateEmployee} disabled={isPending} variant="primary">
          {isPending ? (
            <>
              <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
              Saving…
            </>
          ) : (
            <>
              <Save className="-ml-1 mr-2 h-4 w-4" />
              Create Employee
            </>
          )}
        </Button>
      }
    >
      <Card>
        <Tabs items={tabs} activeKey={activeTab} onChange={setActiveTab} />
      </Card>

      <div className="pt-4">
        <Alert variant="info">
          You can move between tabs without losing your progress. Clicking “Create Employee” will create the employee and then save any
          contacts, right-to-work info, and checklist items provided.
        </Alert>
      </div>
    </PageLayout>
  )
}

