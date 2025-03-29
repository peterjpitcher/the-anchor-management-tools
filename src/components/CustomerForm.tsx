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
      const formattedNumber = formatPhoneNumber(mobileNumber)
      await onSubmit({
        first_name: firstName,
        last_name: lastName,
        mobile_number: formattedNumber,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="first_name"
          className="block text-sm font-medium text-gray-700"
        >
          First Name
        </label>
        <input
          type="text"
          id="first_name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="last_name"
          className="block text-sm font-medium text-gray-700"
        >
          Last Name
        </label>
        <input
          type="text"
          id="last_name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="mobile_number"
          className="block text-sm font-medium text-gray-700"
        >
          Mobile Number
        </label>
        <div className="mt-1 relative rounded-md shadow-sm">
          <input
            type="tel"
            id="mobile_number"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            placeholder="07700 900000"
            required
            pattern="^(\+44|0)?[0-9]{10,11}$"
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <span className="text-gray-500 sm:text-sm">UK</span>
          </div>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Enter a UK mobile number (starting with 07 or +44)
        </p>
      </div>

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
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