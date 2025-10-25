'use client'

import { Customer } from '@/types/database'
import { useState } from 'react'

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
  const [isSubmitting, setIsSubmitting] = useState(false)

  const formatPhoneNumber = (number: string): string => {
    // Remove all non-numeric characters
    const cleaned = number.replace(/\D/g, '')
    
    // Check if it starts with a UK country code
    if (cleaned.startsWith('44')) {
      return '+44' + cleaned.slice(2)
    }
    
    // Check if it starts with a 0
    if (cleaned.startsWith('0')) {
      return '+44' + cleaned.slice(1)
    }
    
    // If no country code and no leading 0, add +44
    if (cleaned.length > 0) {
      return '+44' + cleaned
    }
    
    return cleaned
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const trimmedFirstName = firstName.trim()
      const trimmedLastName = lastName.trim()
      const trimmedEmail = email.trim()
      const formattedNumber = formatPhoneNumber(mobileNumber)
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
          <div className="mt-1">
            <input
              type="text"
              id="first_name"
              name="first_name"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="last_name"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Last Name
          </label>
          <div className="mt-1">
            <input
              type="text"
              id="last_name"
              name="last_name"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="mobile_number"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Mobile Number
          </label>
          <div className="mt-1 relative rounded-lg shadow-sm">
            <input
              type="tel"
              id="mobile_number"
              name="mobile_number"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              placeholder="07700 900000"
              required
              pattern="^(\+?44|0)?[0-9]{10,11}$"
              autoComplete="tel"
              inputMode="tel"
              className="block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 pr-16 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">UK</span>
            </div>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Enter a UK mobile number (starting with 07 or +44)
          </p>
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Email
          </label>
          <div className="mt-1">
            <input
              type="email"
              id="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
              placeholder="name@example.com"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end mt-8">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex justify-center items-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center items-center rounded-lg border border-transparent bg-green-600 px-6 py-3 text-base font-medium text-white shadow-sm hover:bg-green-700 active:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting
            ? 'Saving...'
            : customer
            ? 'Update Customer'
            : 'Create Customer'}
        </button>
      </div>
    </form>
  )
} 
