'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { clockIn, clockOut } from '@/app/actions/timeclock'
import { Avatar } from '@/ds'
import type { TimeclockSession } from '@/app/actions/timeclock'

interface Employee {
  employee_id: string
  first_name: string | null
  last_name: string | null
}

interface TimeclockClientProps {
  employees: Employee[]
  openSessions: (TimeclockSession & { employee_name: string })[]
}

function empName(e: Employee): string {
  return [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Staff'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function TimeclockClient({ employees, openSessions: initialSessions }: TimeclockClientProps) {
  const router = useRouter()
  const [sessions, setSessions] = useState(initialSessions)
  const [isPending, startTransition] = useTransition()
  const [currentTime, setCurrentTime] = useState('')
  const [currentDate, setCurrentDate] = useState('')
  const [pinTarget, setPinTarget] = useState<Employee | null>(null)
  const [pin, setPin] = useState('')

  // Live clock
  useEffect(() => {
    function updateClock() {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setCurrentDate(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    }
    updateClock()
    const interval = setInterval(updateClock, 1000)
    return () => clearInterval(interval)
  }, [])

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const clockedInIds = new Set(sessions.map(s => s.employee_id))
  const activeCount = employees.length
  const clockedInCount = sessions.length

  const handleClock = (emp: Employee) => {
    if (!UUID_RE.test(emp.employee_id)) {
      toast.error('Invalid employee selection')
      return
    }

    setPinTarget(emp)
    setPin('')
  }

  const submitPin = () => {
    if (!pinTarget) return

    const normalizedPin = pin.replace(/\D/g, '')
    if (normalizedPin.length !== 4) {
      toast.error('Enter your 4-digit PIN')
      return
    }

    const isClockedIn = clockedInIds.has(pinTarget.employee_id)

    startTransition(async () => {
      try {
        if (isClockedIn) {
          const result = await clockOut(pinTarget.employee_id, normalizedPin)
          if (!result.success) { toast.error(result.error); return }
          toast.success(`See you later, ${empName(pinTarget)}!`)
          setSessions(prev => prev.filter(s => s.employee_id !== pinTarget.employee_id))
        } else {
          const result = await clockIn(pinTarget.employee_id, normalizedPin)
          if (!result.success) { toast.error(result.error); return }
          toast.success(`Welcome in, ${empName(pinTarget)}!`)
          setSessions(prev => [...prev, { ...result.data, employee_name: empName(pinTarget) }])
        }
        setPinTarget(null)
        setPin('')
        router.refresh()
      } catch {
        toast.error('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <div className="kiosk">
      <div className="kiosk__header">
        <div>
          <div className="kiosk__brand">The Anchor</div>
          <div className="kiosk__sub">Staff Timeclock</div>
        </div>
        <div className="kiosk__clock">
          <span className="kiosk__time">{currentTime}</span>
          <div className="kiosk__date">{currentDate}</div>
        </div>
      </div>

      <div className="kiosk__stats">
        <div className="kstat">
          <div className="kstat__label">Active Staff</div>
          <div className="kstat__value">{activeCount}</div>
        </div>
        <div className="kstat kstat--success">
          <div className="kstat__label">Clocked In</div>
          <div className="kstat__value">{clockedInCount}</div>
        </div>
        <div className="kstat">
          <div className="kstat__label">Not Clocked In</div>
          <div className="kstat__value">{activeCount - clockedInCount}</div>
        </div>
        <div className="kstat">
          <div className="kstat__label">On Leave</div>
          <div className="kstat__value">0</div>
        </div>
      </div>

      <h2 className="kiosk__title">Tap to Clock In/Out</h2>

      <div className="kiosk__grid">
        {employees.map((emp) => {
          const isClockedIn = clockedInIds.has(emp.employee_id)
          const session = sessions.find(s => s.employee_id === emp.employee_id)

          return (
            <button
              key={emp.employee_id}
              type="button"
              className={`kiosk__card ${isClockedIn ? 'kiosk__card--in' : 'kiosk__card--out'}`}
              onClick={() => handleClock(emp)}
              disabled={isPending}
            >
              <Avatar name={empName(emp)} size="lg" />
              <div className="kiosk__name">{empName(emp)}</div>
              <div className="kiosk__role">Staff</div>
              <div className="kiosk__state">
                <span className={`kiosk__dot ${isClockedIn ? 'kiosk__dot--in' : 'kiosk__dot--out'}`} />{' '}
                {isClockedIn ? `In since ${formatTime(session?.clock_in_at ?? '')}` : 'Not clocked in'}
              </div>
            </button>
          )
        })}
      </div>

      <div className="kiosk__footer">
        <span>The Anchor, Staines-upon-Thames</span>
      </div>

      {pinTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form
            className="w-full max-w-sm rounded-lg bg-white p-6 text-gray-900 shadow-xl"
            onSubmit={(event) => {
              event.preventDefault()
              submitPin()
            }}
          >
            <h3 className="text-lg font-semibold">{empName(pinTarget)}</h3>
            <p className="mt-1 text-sm text-gray-600">
              {clockedInIds.has(pinTarget.employee_id) ? 'Clock out' : 'Clock in'}
            </p>
            <label htmlFor="timeclock-pin" className="mt-5 block text-sm font-medium text-gray-700">
              PIN
            </label>
            <input
              id="timeclock-pin"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              className="mt-2 w-full rounded-md border border-gray-300 px-4 py-3 text-center text-2xl tracking-[0.4em] text-gray-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600"
              autoFocus
            />
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
                onClick={() => { setPinTarget(null); setPin('') }}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isPending}
              >
                {isPending ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
