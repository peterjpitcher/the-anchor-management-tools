'use client'

import { useMemo } from 'react'
import { Card, CardBody } from '@/ds'
import { Button, Avatar, Badge } from '@/ds'
import type { Employee, Shift } from './RotaClient'

/* ------------------------------------------------------------------ */
/*  Role colors                                                        */
/* ------------------------------------------------------------------ */

const roleColors: Record<string, string> = {
  Manager: 'bg-primary-soft text-primary-soft-fg',
  Bartender: 'bg-info-soft text-info-fg',
  Server: 'bg-success-soft text-success-fg',
  Chef: 'bg-warning-soft text-warning-fg',
  Barback: 'bg-surface-2 text-text-muted',
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let hours = eh - sh + (em - sm) / 60
  if (hours < 0) hours += 24 // overnight shift
  return hours
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface RotaScheduleProps {
  employees: Employee[]
  shifts: Shift[]
  days: string[]
  weekLabel: string
  onNavigateWeek: (direction: -1 | 1) => void
  onGoThisWeek: () => void
}

export function RotaSchedule({ employees, shifts, days, weekLabel, onNavigateWeek, onGoThisWeek }: RotaScheduleProps) {
  const shiftsByEmployeeDay = useMemo(() => {
    const map = new Map<string, Shift[]>()
    for (const s of shifts) {
      const key = `${s.employeeId}-${s.day}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return map
  }, [shifts])

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const day of days) {
      let total = 0
      for (const s of shifts) {
        if (s.day === day) total += shiftHours(s.startTime, s.endTime)
      }
      totals[day] = Math.round(total * 10) / 10
    }
    return totals
  }, [shifts, days])

  const employeeTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const e of employees) {
      let total = 0
      for (const s of shifts) {
        if (s.employeeId === e.id) total += shiftHours(s.startTime, s.endTime)
      }
      totals[e.id] = Math.round(total * 10) / 10
    }
    return totals
  }, [employees, shifts])

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => onNavigateWeek(-1)}>Prev</Button>
        <span className="text-sm font-medium text-text-strong">{weekLabel}</span>
        <Button variant="ghost" size="sm" onClick={() => onNavigateWeek(1)}>Next</Button>
        <Button variant="secondary" size="sm" onClick={onGoThisWeek}>This Week</Button>
      </div>

      {/* Weekly grid */}
      <Card>
        <CardBody className="p-0 overflow-x-auto">
          <div
            className="min-w-[900px]"
            style={{
              display: 'grid',
              gridTemplateColumns: `200px repeat(7, 1fr) 80px`,
            }}
          >
            {/* Header row */}
            <div className="sticky left-0 z-10 bg-surface-2 border-b border-r border-border px-3 py-2 text-xs font-medium text-text-muted">
              Employee
            </div>
            {days.map((day) => (
              <div key={day} className="border-b border-border px-2 py-2 text-xs font-medium text-text-muted text-center">
                {day}
              </div>
            ))}
            <div className="border-b border-border px-2 py-2 text-xs font-medium text-text-muted text-center">
              Total
            </div>

            {/* Employee rows */}
            {employees.map((emp) => (
              <div key={emp.id} className="contents">
                {/* Employee cell */}
                <div className="sticky left-0 z-10 bg-surface border-b border-r border-border px-3 py-2 flex items-center gap-2">
                  <Avatar name={emp.name} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-strong truncate">{emp.name}</p>
                    <p className="text-[10px] text-text-muted">{emp.role}</p>
                  </div>
                </div>

                {/* Day cells */}
                {days.map((day) => {
                  const dayShifts = shiftsByEmployeeDay.get(`${emp.id}-${day}`) || []
                  return (
                    <div
                      key={day}
                      className="border-b border-r border-border p-1 min-h-[52px] hover:bg-surface-hover transition-colors cursor-pointer"
                    >
                      {dayShifts.map((s) => (
                        <div
                          key={s.id}
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium mb-0.5 ${roleColors[s.role] || 'bg-surface-2 text-text'}`}
                        >
                          {s.startTime.replace(':00', '')}-{s.endTime.replace(':00', '')}
                        </div>
                      ))}
                    </div>
                  )
                })}

                {/* Total hours */}
                <div className="border-b border-border px-2 py-2 text-sm font-medium text-text text-center flex items-center justify-center">
                  {employeeTotals[emp.id] ?? 0}h
                </div>
              </div>
            ))}

            {/* Totals row */}
            <div className="sticky left-0 z-10 bg-surface-2 border-r border-border px-3 py-2 text-xs font-bold text-text-strong">
              Daily Total
            </div>
            {days.map((day) => (
              <div key={day} className="border-r border-border px-2 py-2 text-sm font-bold text-text text-center bg-surface-2">
                {dayTotals[day]}h
              </div>
            ))}
            <div className="bg-surface-2 px-2 py-2 text-sm font-bold text-text text-center">
              {Object.values(dayTotals).reduce((a, b) => a + b, 0)}h
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
