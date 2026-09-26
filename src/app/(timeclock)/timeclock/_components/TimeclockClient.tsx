'use client'

import { useState, useTransition, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { clockIn, clockOut } from '@/app/actions/timeclock'
import { Avatar, Button, Input, Modal, Section, Stat, StatGrid, toast } from '@/ds'
import { KioskShell } from '@/components/shells/KioskShell'
import { disambiguatedNames } from '@/lib/employees/display-name'
import { cn } from '@/lib/utils'
import { KIOSK_DOT_CLASSES, KIOSK_TILE_CLASSES } from './status-ui'

interface Employee {
  employee_id: string
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
}

// /timeclock is a public route, so every prop on this component is serialised
// into the RSC payload that any anonymous visitor receives. A full
// TimeclockSession carries manager_note, rate_override, premium_reason and the
// rest of the review/pay columns, so the kiosk takes only the three fields it
// actually renders. Widen this type only with something safe to publish.
export interface KioskSession {
  employee_id: string
  clock_in_at: string
  employee_name: string
}

interface TimeclockClientProps {
  employees: Employee[]
  openSessions: KioskSession[]
}

// The kiosk is a shared screen, so staff need to spot themselves at a glance:
// the preferred name is what they answer to. 'Staff' stays as the last-resort
// fallback so a card is never blank.
//
// Names are resolved across the whole list rather than per card, so two people
// who would otherwise read identically (two Jacobs with no preferred name set)
// each gain a surname. Tapping the wrong card on a shared kiosk clocks the
// wrong person in, so an ambiguous card is not acceptable here.
function buildNameMap(employees: Employee[]): Map<string, string> {
  return new Map(
    disambiguatedNames(employees, 'Staff').map(({ employee, name }) => [employee.employee_id, name]),
  )
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
  // The dialog keeps showing its person while it animates closed, so `pinOpen` shuts it and
  // `pinTarget` is only replaced when the next tile is tapped.
  const [pinTarget, setPinTarget] = useState<Employee | null>(null)
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPin] = useState('')

  const nameById = useMemo(() => buildNameMap(employees), [employees])
  const empName = useCallback(
    (e: Employee) => nameById.get(e.employee_id) ?? 'Staff',
    [nameById],
  )

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
    setPinOpen(true)
    setPin('')
  }

  const closePin = () => {
    if (isPending) return
    setPinOpen(false)
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
          // Narrowed rather than spread: clockIn returns the whole row, and the
          // kiosk must not hold pay or review columns in client state.
          setSessions(prev => [...prev, {
            employee_id: result.data.employee_id,
            clock_in_at: result.data.clock_in_at,
            employee_name: empName(pinTarget),
          }])
        }
        setPinOpen(false)
        setPin('')
        router.refresh()
      } catch {
        toast.error('Something went wrong. Please try again.')
      }
    })
  }

  const pinTargetClockedIn = pinTarget ? clockedInIds.has(pinTarget.employee_id) : false

  return (
    <KioskShell
      title="Staff Timeclock"
      aside={
        <div>
          <p className="font-mono text-4xl font-bold leading-none tracking-tight shell:text-6xl">{currentTime}</p>
          <p className="mt-2 text-sm text-on-dark-muted">{currentDate}</p>
        </div>
      }
      footer="The Anchor, Staines-upon-Thames"
    >
      <StatGrid columns={4}>
        <Stat label="Active Staff" value={activeCount} />
        {/* Who is on shift is the good news the kiosk leads with, as it always has. */}
        <Stat label="Clocked In" value={clockedInCount} tone="success" />
        <Stat label="Not Clocked In" value={activeCount - clockedInCount} />
        <Stat label="On Leave" value={0} />
      </StatGrid>

      <Section title="Tap to Clock In/Out">
        <div className="grid grid-cols-2 gap-3 shell:grid-cols-4 shell:gap-4">
          {employees.map((emp) => {
            const isClockedIn = clockedInIds.has(emp.employee_id)
            const session = sessions.find(s => s.employee_id === emp.employee_id)
            const state = isClockedIn ? 'in' : 'out'

            return (
              // A raw button, not the DS Button: each tile is a large grid cell holding an
              // avatar and three lines of text, which the fixed-height DS Button cannot hold.
              <button
                key={emp.employee_id}
                type="button"
                className={cn(
                  'flex min-h-touch flex-col items-center gap-2 rounded-lg border-2 px-4 py-6 text-center shadow-sm',
                  'transition-[background,border-color,transform] duration-[120ms] hover:-translate-y-0.5',
                  'focus-visible:outline-hidden focus-visible:shadow-ring disabled:opacity-50',
                  KIOSK_TILE_CLASSES[state],
                )}
                onClick={() => handleClock(emp)}
                disabled={isPending}
              >
                <Avatar name={empName(emp)} size="lg" />
                <span className="mt-1.5 text-sm font-semibold text-text-strong">{empName(emp)}</span>
                <span className="text-meta text-text-muted">Staff</span>
                <span className="mt-2 inline-flex items-center gap-1.5 text-meta text-text-muted">
                  <span className={cn('inline-block h-2 w-2 rounded-full', KIOSK_DOT_CLASSES[state])} aria-hidden="true" />
                  {isClockedIn ? `In since ${formatTime(session?.clock_in_at ?? '')}` : 'Not clocked in'}
                </span>
              </button>
            )
          })}
        </div>
      </Section>

      <Modal
        open={pinOpen}
        onClose={closePin}
        title={pinTarget ? empName(pinTarget) : undefined}
        description={pinTargetClockedIn ? 'Enter your PIN to clock out' : 'Enter your PIN to clock in'}
        width="sm"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="min-h-touch sm:flex-1"
              onClick={closePin}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="timeclock-pin-form"
              variant="primary"
              size="lg"
              className="min-h-touch sm:flex-1"
              disabled={isPending}
            >
              {isPending ? 'Saving...' : 'Confirm'}
            </Button>
          </>
        }
      >
        <form
          id="timeclock-pin-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitPin()
          }}
        >
          {/* autoFocus raises the iPad keyboard as the dialog opens: React focuses the field in
              the same commit as the tap, and the dialog keeps focus where it already is. */}
          <Input
            id="timeclock-pin"
            label="PIN"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={4}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
            className="h-14 text-center text-2xl tracking-[0.4em]"
            autoFocus
          />
        </form>
      </Modal>
    </KioskShell>
  )
}
