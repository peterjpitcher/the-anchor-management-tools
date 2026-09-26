'use client'

import { Customer } from '@/types/database'
import { useState } from 'react'
import { Button, Card, CardBody, CardHeader, FormFooter, Input } from '@/ds'
import { formatPhoneForStorage } from '@/lib/utils'

interface CustomerFormProps {
  customer?: Customer
  onSubmit: (data: Omit<Customer, 'id' | 'created_at'>) => Promise<void>
  onCancel: () => void
  /**
   * A form page (the add and edit screens on /customers) frames the fields in a titled Card
   * with the footer below it. Left out, the form sits bare, as it does inside a Modal.
   */
  framed?: boolean
}

export function CustomerForm({ customer, onSubmit, onCancel, framed = false }: CustomerFormProps) {
  const [firstName, setFirstName] = useState(customer?.first_name ?? '')
  const [lastName, setLastName] = useState(customer?.last_name ?? '')
  const [email, setEmail] = useState(customer?.email ?? '')
  const [mobileNumber, setMobileNumber] = useState(customer?.mobile_number ?? '')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setPhoneError(null)
    setNameError(null)
    try {
      const trimmedFirstName = firstName.trim()
      const trimmedLastName = lastName.trim()
      const trimmedEmail = email.trim()

      if (!trimmedFirstName && !trimmedLastName) {
        setNameError('At least one of first name or last name is required')
        return
      }

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

  const fields = (
    <>
      <Input
        label="First Name"
        type="text"
        id="first_name"
        name="first_name"
        autoComplete="given-name"
        value={firstName}
        onChange={(e) => { setFirstName(e.target.value); setNameError(null) }}
        error={nameError ?? undefined}
      />

      <Input
        label="Last Name"
        type="text"
        id="last_name"
        name="last_name"
        autoComplete="family-name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
      />

      <Input
        label="Mobile Number"
        type="tel"
        id="mobile_number"
        name="mobile_number"
        value={mobileNumber}
        onChange={(e) => setMobileNumber(e.target.value)}
        placeholder="+1 415 555 2671 or 07700 900123"
        required
        autoComplete="tel"
        inputMode="tel"
        hint="Enter an international number (e.g. +1...) or a local number (defaults to +44)"
        error={phoneError ?? undefined}
      />

      <Input
        label="Email"
        type="email"
        id="email"
        name="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@example.com"
      />
    </>
  )

  const footer = (
    <FormFooter>
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" disabled={isSubmitting}>
        {isSubmitting
          ? 'Saving...'
          : customer
            ? 'Update Customer'
            : 'Create Customer'}
      </Button>
    </FormFooter>
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {framed ? (
        <Card>
          <CardHeader title="Customer Details" />
          <CardBody className="space-y-4">{fields}</CardBody>
        </Card>
      ) : (
        <div className="space-y-4">{fields}</div>
      )}
      {footer}
    </form>
  )
}
