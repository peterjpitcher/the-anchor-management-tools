'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { lookupEventGuest, registerKnownGuest, undoEventCheckIn } from '@/app/actions/event-check-in'
import { CheckInShell } from './CheckInShell'
import { WalkInForm } from './WalkInForm'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { MagnifyingGlassIcon, CheckIcon, UserIcon, ArrowUturnLeftIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline'

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

type MatchedGuest = {
  matchType?: 'exact' | 'fuzzy'
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
  checkInId?: string
}

export default function EventCheckInClient({ event }: EventCheckInClientProps) {
  const router = useRouter()
  const [mobileNumber, setMobileNumber] = useState('')
  const [isPending, startTransition] = useTransition()

  // State machine
  // fuzzy-confirm: Show "Did you mean [Name]?"
  type FlowState = 'input' | 'fuzzy-confirm' | 'success' | 'walk-in'
  const [step, setStep] = useState<FlowState>('input')

  const [foundGuest, setFoundGuest] = useState<MatchedGuest | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === 'input' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [step])

  // Cleanup success message after delay
  useEffect(() => {
    if (step === 'success') {
      const timer = setTimeout(() => {
        resetFlow()
      }, 4000) // 4s to read Thank You
      return () => clearTimeout(timer)
    }
  }, [step])

  const resetFlow = () => {
    setMobileNumber('')
    setFoundGuest(null)
    setStep('input')
  }

  const performCheckIn = async (guest: MatchedGuest) => {
    const result = await registerKnownGuest({
      eventId: event.id,
      customerId: guest.customer.id,
      phone: guest.customer.mobile_number
    })

    if (result.success) {
      setFoundGuest({
        ...guest,
        alreadyCheckedIn: true,
        checkInId: result.data?.checkInId
      })
      setStep('success')
    } else {
      toast.error(result.error || 'Check-in failed')
      setStep('input')
    }
  }

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mobileNumber.trim()) return

    startTransition(async () => {
      const result = await lookupEventGuest({
        eventId: event.id,
        query: mobileNumber
      })

      if (!result.success || !result.matches?.length) {
        setStep('walk-in')
      } else {
        const guest = result.matches[0] as MatchedGuest
        setFoundGuest(guest)

        if (guest.matchType === 'fuzzy') {
          // Fuzzy Match -> Ask for confirmation
          setStep('fuzzy-confirm')
        } else {
          // Exact Match -> Auto Check-in
          await performCheckIn(guest)
        }
      }
    })
  }

  const handleUndo = async () => {
    if (!foundGuest?.checkInId) return

    startTransition(async () => {
      const result = await undoEventCheckIn(foundGuest.checkInId!)
      if (result.success) {
        toast.success('Check-in undone')
        resetFlow()
      } else {
        toast.error(result.error || 'Undo failed')
      }
    })
  }

  return (
    <CheckInShell
      title={event.name}
      subtitle="Guest Check-in"
      backHref={`/events/${event.id}`}
    >
      <div className="max-w-md mx-auto p-6 md:pt-12">

        {/* INPUT STEP */}
        {step === 'input' && (
          <form onSubmit={handleLookup} className="space-y-6">
            <div className="text-center space-y-2 mb-8">
              <h2 className="text-2xl font-bold text-gray-900">Welcome!</h2>
              <p className="text-gray-500">Enter your mobile number to check in.</p>
            </div>

            <div className="relative">
              <Input
                ref={inputRef}
                value={mobileNumber}
                onChange={e => setMobileNumber(e.target.value)}
                placeholder="07700 900123"
                className="text-center text-2xl py-6 tracking-wider"
                type="tel"
                autoComplete="tel"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                <MagnifyingGlassIcon className={`h-6 w-6 ${isPending ? 'animate-pulse text-blue-500' : ''}`} />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full py-6 text-lg"
              disabled={isPending || !mobileNumber.trim()}
            >
              {isPending ? 'Searching...' : 'Check In'}
            </Button>
          </form>
        )}

        {/* FUZZY CONFIRM STEP (Did you mean...?) */}
        {step === 'fuzzy-confirm' && foundGuest && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="text-center">
              <div className="h-20 w-20 bg-yellow-100 text-yellow-600 rounded-full mx-auto flex items-center justify-center mb-4">
                <QuestionMarkCircleIcon className="h-10 w-10" />
              </div>
              <h2 className="text-xl text-gray-600 mb-2">Did you mean?</h2>
              <h3 className="text-3xl font-bold text-gray-900 mb-1">
                {foundGuest.customer.first_name} {foundGuest.customer.last_name}
              </h3>
              <p className="text-sm text-gray-400">
                {foundGuest.customer.mobile_number}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button variant="secondary" onClick={() => setStep('walk-in')} className="h-14 text-lg">
                No, that&apos;s not me
              </Button>
              <Button
                onClick={() => performCheckIn(foundGuest)}
                className="h-14 text-lg bg-green-600 hover:bg-green-700 text-white"
                disabled={isPending}
              >
                Yes, Check In
              </Button>
            </div>
          </div>
        )}

        {/* SUCCESS STEP */}
        {step === 'success' && foundGuest && (
          <div className="text-center space-y-6 animate-in zoom-in duration-300">
            <div className="h-24 w-24 bg-green-100 text-green-600 rounded-full mx-auto flex items-center justify-center">
              <CheckIcon className="h-12 w-12 stroke-[3]" />
            </div>

            <div className="space-y-2">
              <h2 className="text-4xl font-bold text-gray-900">Thank You!</h2>
              <h3 className="text-2xl text-blue-600 font-medium">
                {foundGuest.customer.first_name}
              </h3>
            </div>

            <p className="text-gray-500 text-lg">You are checked in.</p>

            <div className="pt-8 space-y-3">
              <Button onClick={handleUndo} variant="secondary" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50">
                <ArrowUturnLeftIcon className="h-4 w-4 mr-2" />
                Undo Check-in
              </Button>
              <p className="text-xs text-gray-400">Screen resets shortly...</p>
            </div>
          </div>
        )}

        {/* WALK-IN FORM */}
        <WalkInForm
          eventId={event.id}
          isOpen={step === 'walk-in'}
          onClose={resetFlow}
          onSuccess={() => {
            // Optional: Transition to Success step instead of Reset?
            // For now, WalkInForm's toast is handled there, but we could improve this.
            toast.success("Welcome! You've been added.")
            resetFlow()
          }}
          initialPhone={mobileNumber}
        />

      </div>
    </CheckInShell>
  )
}
