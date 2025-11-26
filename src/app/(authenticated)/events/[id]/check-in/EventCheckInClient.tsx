'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { formatDate } from '@/lib/dateUtils'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Badge } from '@/components/ui-v2/display/Badge'
import { CheckCircleIcon, ArrowLeftIcon, MagnifyingGlassIcon, UserIcon, UserPlusIcon } from '@heroicons/react/24/outline'
import { lookupEventGuest, registerKnownGuest, registerNewGuest } from '@/app/actions/event-check-in'
import { formatPhoneForDisplay } from '@/lib/validation'

interface EventRecord {
  id: string
  name: string
  date: string
  time: string
  category?: {
    name: string
    color: string
  } | null
}

interface EventCheckInClientProps {
  event: EventRecord
  reviewLink: string
}

type FlowStep = 'lookup' | 'match' | 'new_guest' | 'success'

type MatchedGuest = {
  customer: {
    id: string
    first_name: string
    last_name: string | null
    mobile_number: string
    email?: string | null
  }
  booking?: {
    id: string
    seats: number | null
  }
  alreadyCheckedIn: boolean
}

export default function EventCheckInClient({ event, reviewLink }: EventCheckInClientProps) {
  const [step, setStep] = useState<FlowStep>('lookup')
  const [queryInput, setQueryInput] = useState('')
  const [matches, setMatches] = useState<MatchedGuest[]>([])
  const [selectedGuest, setSelectedGuest] = useState<MatchedGuest | null>(null)
  const [newGuestDetails, setNewGuestDetails] = useState({ firstName: '', lastName: '', email: '' })
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const eventDate = useMemo(() => {
    try {
      return formatDate(new Date(event.date))
    } catch {
      return event.date
    }
  }, [event.date])

  useEffect(() => {
    if (step === 'lookup' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [step])

  // Auto-reset success screen
  useEffect(() => {
    if (step === 'success') {
      const timer = setTimeout(() => {
        resetFlow()
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [step])

  const resetFlow = () => {
    setStep('lookup')
    setQueryInput('')
    setMatches([])
    setSelectedGuest(null)
    setStatusMessage(null)
    setError(null)
    setNewGuestDetails({ firstName: '', lastName: '', email: '' })
  }

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setStatusMessage(null)

    if (!queryInput.trim()) return

    startTransition(async () => {
      const result = await lookupEventGuest({ eventId: event.id, query: queryInput })

      if (!result.success) {
        setError(result.error ?? 'An unknown error occurred')
        return
      }

      setMatches(result.matches || [])
      setStep('match')
    })
  }

  const handleSelectGuest = (guest: MatchedGuest) => {
    setSelectedGuest(guest)
    handleKnownCheckIn(guest)
  }

  const handleKnownCheckIn = (guest: MatchedGuest) => {
    setError(null)
    setStatusMessage(null)

    startTransition(async () => {
      // We use the mobile number from the customer record for registration
      // If strict strict formatting is needed by backend, the action handles it, 
      // but here we pass what we have.
      const result = await registerKnownGuest({
        eventId: event.id,
        phone: guest.customer.mobile_number, // Use stored number
        customerId: guest.customer.id,
      })

      if (!result.success) {
        setError(result.error || 'Failed to check in')
        return
      }

      const firstName = guest.customer.first_name
      const seats = guest.booking?.seats ?? 1
      
      if (guest.alreadyCheckedIn) {
         setStatusMessage(`Welcome back, ${firstName}! You are already checked in.`)
      } else {
         setStatusMessage(
            guest.booking 
              ? `Welcome, ${firstName}! We've checked in ${seats} guest${seats > 1 ? 's' : ''}.`
              : `Welcome, ${firstName}! You're checked in.`
         )
      }
      setStep('success')
    })
  }

  const handleNewGuestCheckIn = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setStatusMessage(null)

    // If query was a phone number, use it as default
    const potentialPhone = /^\+?[\d\s\-]+$/.test(queryInput) ? queryInput : ''

    startTransition(async () => {
      const result = await registerNewGuest({
        eventId: event.id,
        phone: potentialPhone || '00000000000', // Fallback if name search, ideally UI asks for phone
        firstName: newGuestDetails.firstName,
        lastName: newGuestDetails.lastName,
        email: newGuestDetails.email || undefined,
      })

      if (!result.success) {
        setError(result.error || 'Failed to check in')
        return
      }

      setStatusMessage(`Welcome, ${newGuestDetails.firstName}! You're on the list.`)
      setStep('success')
    })
  }
  
  // Improved New Guest Flow if search was name-based or no match
  const startNewGuestFlow = () => {
    setStep('new_guest')
  }

  const renderLookupForm = () => (
    <form onSubmit={handleLookup} className="space-y-6 max-w-xl mx-auto text-center">
      <div className="space-y-4">
        <label htmlFor="query" className="block text-2xl font-bold text-gray-900">
          What is your mobile number?
        </label>
        <p className="text-gray-500">Or enter your name to search</p>
        <div className="relative">
            <Input
            id="query"
            ref={inputRef}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="e.g. 07700 900123"
            className="text-2xl py-4 text-center tracking-wide"
            autoComplete="off"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                <MagnifyingGlassIcon className="h-6 w-6" />
            </div>
        </div>
      </div>
      <Button 
        type="submit" 
        variant="primary" 
        disabled={isPending || !queryInput.trim()} 
        className="w-full sm:w-auto text-lg px-12 py-4"
      >
        {isPending ? 'Searching...' : 'Find Booking'}
      </Button>
    </form>
  )

  const renderMatchList = () => (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">Is this you?</h2>
        <p className="text-gray-500">Tap your name to check in</p>
      </div>

      <div className="grid gap-4">
        {matches.map((guest) => (
          <button
            key={guest.customer.id}
            onClick={() => handleSelectGuest(guest)}
            disabled={isPending}
            className="w-full text-left group relative flex items-center gap-4 p-4 rounded-xl border-2 border-gray-100 bg-white hover:border-blue-500 hover:shadow-md transition-all"
          >
            <div className="h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <UserIcon className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  {guest.customer.first_name} {guest.customer.last_name}
                </h3>
                {guest.alreadyCheckedIn && (
                    <Badge variant="success" size="sm">Checked In</Badge>
                )}
              </div>
              <p className="text-gray-500">
                {formatPhoneForDisplay(guest.customer.mobile_number)}
              </p>
            </div>
            <div className="text-right">
              {guest.booking ? (
                <div className="inline-flex flex-col items-end">
                    <span className="text-lg font-bold text-gray-900">{guest.booking.seats} Ticket{guest.booking.seats !== 1 ? 's' : ''}</span>
                    <span className="text-xs text-gray-500">Confirmed Booking</span>
                </div>
              ) : (
                <span className="text-sm text-gray-500 italic">No booking found</span>
              )}
            </div>
          </button>
        ))}
        
        <button
            onClick={startNewGuestFlow}
            className="w-full text-left flex items-center gap-4 p-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-all"
        >
            <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                <UserPlusIcon className="h-6 w-6" />
            </div>
            <span className="text-lg font-medium">Not on the list? Check in as new guest</span>
        </button>
      </div>

      <div className="text-center pt-4">
        <Button variant="secondary" onClick={() => setStep('lookup')}>
          Search Again
        </Button>
      </div>
    </div>
  )

  const renderNewGuestForm = () => (
    <form onSubmit={handleNewGuestCheckIn} className="space-y-6 max-w-lg mx-auto">
        <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold text-gray-900">Welcome! Let&apos;s get you checked in.</h2>
            <p className="text-gray-500">We&apos;ll just need a few details.</p>
        </div>

        <div className="space-y-4 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">First Name</label>
                    <Input 
                        id="firstName"
                        value={newGuestDetails.firstName}
                        onChange={e => setNewGuestDetails(prev => ({ ...prev, firstName: e.target.value }))}
                        required
                        placeholder="Jane"
                    />
                </div>
                <div className="space-y-2">
                    <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">Last Name</label>
                    <Input 
                        id="lastName"
                        value={newGuestDetails.lastName}
                        onChange={e => setNewGuestDetails(prev => ({ ...prev, lastName: e.target.value }))}
                        required
                        placeholder="Doe"
                    />
                </div>
            </div>
            
            <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email (Optional)</label>
                <Input 
                    id="email"
                    type="email"
                    value={newGuestDetails.email}
                    onChange={e => setNewGuestDetails(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="jane@example.com"
                />
            </div>
        </div>

        <div className="flex gap-3 justify-center">
            <Button type="button" variant="secondary" onClick={() => setStep('match')}>
                Back
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
                {isPending ? 'Checking In...' : 'Check In'}
            </Button>
        </div>
    </form>
  )

  const renderSuccess = () => (
    <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center animate-in fade-in zoom-in duration-300">
      <div className="h-24 w-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
        <CheckCircleIcon className="h-12 w-12" />
      </div>
      <h2 className="text-3xl font-bold text-gray-900">You&apos;re all set!</h2>
      <p className="text-xl text-gray-600 max-w-md mx-auto">{statusMessage}</p>
      
      <div className="pt-8">
          <Button onClick={resetFlow} variant="secondary">Check in next guest</Button>
      </div>
      
      <p className="text-sm text-gray-400 pt-4">Screen will reset automatically in 5s</p>
    </div>
  )

  return (
    <PageLayout 
        title={event.name} 
        subtitle={formatDate(event.date)}
        backButton={{ label: 'Exit Kiosk', href: `/events/${event.id}` }}
        className="bg-gray-50/50 min-h-screen"
    >
      <div className="max-w-4xl mx-auto px-4 py-8">
        {error && (
            <div className="mb-6">
                <Alert variant="error" title="Something went wrong" description={error} />
            </div>
        )}

        {step === 'lookup' && renderLookupForm()}
        {step === 'match' && renderMatchList()}
        {step === 'new_guest' && renderNewGuestForm()}
        {step === 'success' && renderSuccess()}
      </div>
    </PageLayout>
  )
}
