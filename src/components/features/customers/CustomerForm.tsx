'use client'

import { Customer } from '@/types/database'
import { useState } from 'react'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { formatPhoneForStorage } from '@/lib/utils'

interface CustomerFormProps {
  customer?: Customer
  onSubmit: (data: Omit<Customer, 'id' | 'created_at'>) => Promise<void>
  onCancel: () => void
}

export function CustomerForm({ customer, onSubmit, onCancel }: CustomerFormProps) {
  const [firstName, setFirstName] = useState(customer?.first_name ?? '')
  const [lastName, setLastName] = useState(customer?.last_name ?? '')
  const [email, setEmail] = useState(customer?.email ?? '')
  const [mobileNumber, setMobileNumber] = useState(customer?.mobile_number ?? '')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setPhoneError(null)
    try {
      const trimmedFirstName = firstName.trim()
      const trimmedLastName = lastName.trim()
      const trimmedEmail = email.trim()
      let formattedNumber: string
      try {
        formattedNumber = formatPhoneForStorage(mobileNumber, {
          defaultCountryCode: '44'
        })
      } catch {
        setPhoneError('Please enter a valid phone number')
        return
      }
      await onSubmit({
        first_name: trimmedFirstName,
        last_name: trimmedLastName === '' ? null : trimmedLastName,
        email: trimmedEmail === '' ? null : trimmedEmail.toLowerCase(),
        mobile_number: formattedNumber,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        <div>
          <label
            htmlFor="first_name"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            First Name
          </label>
          <Input
            type="text"
            id="first_name"
            name="first_name"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>

        <div>
          <label
            htmlFor="last_name"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Last Name
          </label>
          <Input
            type="text"
            id="last_name"
            name="last_name"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="mobile_number"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Mobile Number
          </label>
          <Input
            type="tel"
            id="mobile_number"
            name="mobile_number"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            placeholder="+1 415 555 2671 or 07700 900123"
            required
            autoComplete="tel"
            inputMode="tel"
          />
          <p className="mt-2 text-sm text-gray-500">
            Enter an international number (e.g. +1...) or a local number (defaults to +44)
          </p>
          {phoneError && (
            <p className="mt-2 text-sm text-red-600">{phoneError}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Email
          </label>
          <Input
            type="email"
            id="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end mt-8">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full sm:w-auto"
        >
          {isSubmitting
            ? 'Saving...'
            : customer
              ? 'Update Customer'
              : 'Create Customer'}
        </Button>
      </div>
    </form>
  )
} 
