'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Select } from '@/components/ui-v2/forms/Select'
import { Card } from '@/components/ui-v2/layout/Card'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Calendar, Clock, Users, CheckCircle, XCircle } from 'lucide-react'
import { formatPhoneForDisplay } from '@/lib/validation'

type EventDetails = {
  id: string
  name: string
  date: string
  time: string
  capacity?: number | null
  hero_image_url?: string | null
  thumbnail_image_url?: string | null
}

type CustomerDetails = {
  id: string
  first_name: string
  last_name: string
} | null

export type PendingBookingWithEvent = {
  id: string
  token: string
  event_id: string
  mobile_number: string
  customer_id: string | null
  expires_at: string
  confirmed_at: string | null
  event: EventDetails
  customer: CustomerDetails
}

interface BookingConfirmationClientProps {
  token: string | null
  initialPendingBooking: PendingBookingWithEvent | null
  initialError: string | null
}

export default function BookingConfirmationClient({
  token,
  initialPendingBooking,
  initialError,
}: BookingConfirmationClientProps) {
  const router = useRouter()
  const [pendingBooking] = useState(initialPendingBooking)
  const [error] = useState(initialError)
  const [seats, setSeats] = useState(1)
  const [customerDetails, setCustomerDetails] = useState({
    first_name: '',
    last_name: '',
  })
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)

  const needsCustomerDetails = !pendingBooking?.customer_id
  const trimmedFirstName = customerDetails.first_name.trim()
  const trimmedLastName = customerDetails.last_name.trim()

  async function confirmBooking() {
    if (!token || !pendingBooking) return

    setConfirming(true)
    setConfirmationError(null)

    try {
      const requestBody: {
        token: string
        seats: number
        first_name?: string
        last_name?: string
      } = {
        token,
        seats,
      }

      if (needsCustomerDetails) {
        if (!trimmedFirstName || !trimmedLastName) {
          setConfirmationError('Please add your first and last name to confirm your booking.')
          setConfirming(false)
          return
        }

        requestBody.first_name = trimmedFirstName
        requestBody.last_name = trimmedLastName
      }

      const response = await fetch('/api/bookings/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to confirm booking')
      }

      setConfirmed(true)

      setTimeout(() => {
        router.push('https://www.the-anchor.pub')
      }, 3000)
    } catch (err) {
      console.error('Error confirming booking:', err)
      setConfirmationError(err instanceof Error ? err.message : 'Failed to confirm booking')
    } finally {
      setConfirming(false)
    }
  }

  if (!token) {
    return <ErrorLayout message="Invalid or expired booking link" />
  }

  if (confirming && !pendingBooking) {
    return <LoadingLayout />
  }

  if (error) {
    return <ErrorLayout message={error} />
  }

  if (!pendingBooking) {
    return <ErrorLayout message="Invalid or expired booking link" />
  }

  if (confirmed) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Booking Confirmed!</h1>
            <p className="text-gray-600 mb-4">
              Your booking for {pendingBooking.event.name} has been confirmed.
            </p>
            <p className="text-sm text-gray-500">
              Redirecting to your booking details...
            </p>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-2xl mx-auto p-4">
        <Card>
          <h1 className="text-2xl font-bold mb-6">
            {pendingBooking.customer ? `Welcome back, ${pendingBooking.customer.first_name}!` : 'Confirm Your Booking'}
          </h1>

          <div className="space-y-6">
            {pendingBooking.event.hero_image_url && (
              <div className="w-full aspect-square relative rounded-lg overflow-hidden">
                <img
                  src={pendingBooking.event.hero_image_url}
                  alt={pendingBooking.event.name}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h2 className="text-lg font-semibold">{pendingBooking.event.name}</h2>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-500" />
                  <span>
                    {new Date(pendingBooking.event.date).toLocaleDateString('en-GB', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  <span>{pendingBooking.event.time}</span>
                </div>
              </div>
            </div>

            {needsCustomerDetails && (
              <div className="space-y-4">
                <h3 className="font-semibold">Your Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormGroup label="First Name" required>
                    <Input
                      type="text"
                      id="first_name"
                      value={customerDetails.first_name}
                      onChange={(e) => setCustomerDetails((prev) => ({ ...prev, first_name: e.target.value }))}
                      required
                    />
                  </FormGroup>
                <FormGroup label="Last Name">
                  <Input
                    type="text"
                    id="last_name"
                    value={customerDetails.last_name}
                    onChange={(e) => setCustomerDetails((prev) => ({ ...prev, last_name: e.target.value }))}
                  />
                </FormGroup>
              </div>
                <p className="text-sm text-gray-600">
                  Phone Number: {formatPhoneForDisplay(pendingBooking.mobile_number)}
                </p>
              </div>
            )}

            {!needsCustomerDetails && pendingBooking.customer && (
              <Alert variant="info">
                <p className="text-sm">
                  Booking for: <span className="font-semibold">{[pendingBooking.customer.first_name, pendingBooking.customer.last_name ?? ''].filter(Boolean).join(' ')}</span>
                </p>
                <p className="text-sm mt-1">
                  Phone: {formatPhoneForDisplay(pendingBooking.mobile_number)}
                </p>
              </Alert>
            )}

            <FormGroup label="Number of Tickets">
              <div className="flex items-center gap-4">
                <Users className="h-5 w-5 text-gray-500" />
                <Select
                  id="seats"
                  value={seats.toString()}
                  onChange={(e) => setSeats(Number(e.target.value))}
                  options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => ({
                    value: num.toString(),
                    label: `${num} ${num === 1 ? 'ticket' : 'tickets'}`,
                  }))}
                />
              </div>
            </FormGroup>

            {confirmationError && <Alert variant="error">{confirmationError}</Alert>}

            <div className="flex gap-3 pt-4">
              <Button
                onClick={confirmBooking}
                disabled={
                  confirming ||
                  (needsCustomerDetails && (!trimmedFirstName || !trimmedLastName))
                }
                className="flex-1"
                loading={confirming}
              >
                Confirm Booking
              </Button>
              <Button variant="secondary" onClick={() => router.push('/')} disabled={confirming}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Header() {
  return (
    <div className="bg-sidebar p-4 mb-8">
      <div className="max-w-2xl mx-auto flex items-center justify-center">
        <Image
          src="/logo.png"
          alt="The Anchor"
          width={60}
          height={60}
          className="mr-3 h-auto w-auto"
        />
        <h1 className="text-2xl font-bold text-white">The Anchor</h1>
      </div>
    </div>
  )
}

function ErrorLayout({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Booking Error</h1>
          <p className="text-gray-600">{message}</p>
        </Card>
      </div>
    </div>
  )
}

function LoadingLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" />
      </div>
    </div>
  )
}
