'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button, Badge, Stat } from '@/ds'
import { Card, CardHeader, CardBody } from '@/ds'

interface Shift {
  id: string
  date: string
  startTime: string
  endTime: string
  role: string
}

interface PortalClientProps {
  employeeName: string
  isClockedIn: boolean
  clockedInSince?: string
  hoursThisWeek: number
  upcomingShiftsCount: number
  leaveBalance: number
  upcomingShifts: Shift[]
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function PortalClient({
  employeeName,
  isClockedIn,
  clockedInSince,
  hoursThisWeek,
  upcomingShiftsCount,
  leaveBalance,
  upcomingShifts,
}: PortalClientProps) {
  const [greeting, setGreeting] = useState('Hello')

  useEffect(() => {
    setGreeting(getGreeting())
  }, [])

  return (
    <div className="portal">
      <div className="portal__topbar">
        <span className="portal__brand">The Anchor - Staff</span>
        <Link href="/auth/login" className="text-xs text-text-muted hover:text-text">
          Sign out
        </Link>
      </div>

      <div className="portal__body">
        <h1 className="portal__greeting">{greeting}, {employeeName}</h1>
        <p className="portal__sub text-text-muted">Here is your overview for today.</p>

        <div className="portal__grid">
          {/* Clock-in card */}
          <Card>
            <CardHeader
              title="Clock Status"
              action={
                <Badge tone={isClockedIn ? 'success' : 'neutral'}>
                  {isClockedIn ? 'Clocked In' : 'Clocked Out'}
                </Badge>
              }
            />
            <CardBody>
              {isClockedIn && clockedInSince && (
                <p className="text-sm text-text-muted mb-3">Since {clockedInSince}</p>
              )}
              <Link href="/timeclock">
                <Button variant="primary" className="w-full" type="button">
                  {isClockedIn ? 'Clock Out' : 'Clock In'}
                </Button>
              </Link>
            </CardBody>
          </Card>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Hours This Week" value={String(hoursThisWeek)} />
            <Stat label="Upcoming Shifts" value={String(upcomingShiftsCount)} />
            <Stat label="Leave Balance" value={`${leaveBalance} days`} />
          </div>

          {/* Upcoming shifts */}
          <Card>
            <CardHeader
              title="Upcoming Shifts"
              action={
                <Link href="/portal/shifts">
                  <Button variant="ghost" size="sm" type="button">View all</Button>
                </Link>
              }
            />
            <CardBody>
              {upcomingShifts.length === 0 ? (
                <p className="text-sm text-text-muted">No upcoming shifts scheduled.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {upcomingShifts.map((shift) => (
                    <div
                      key={shift.id}
                      className="flex items-center justify-between py-2 border-b border-border last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-text">{shift.date}</p>
                        <p className="text-xs text-text-muted">{shift.startTime} - {shift.endTime}</p>
                      </div>
                      <Badge tone="info">{shift.role}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Leave section */}
          <Card>
            <CardHeader
              title="Leave"
              action={
                <Link href="/portal/leave/new">
                  <Button variant="primary" size="sm" type="button">Request Leave</Button>
                </Link>
              }
            />
            <CardBody>
              <p className="text-sm text-text-muted">
                You have <span className="font-semibold text-text">{leaveBalance} days</span> of leave remaining.
              </p>
              <Link href="/portal/leave" className="text-xs text-primary mt-2 inline-block">
                View leave history
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
