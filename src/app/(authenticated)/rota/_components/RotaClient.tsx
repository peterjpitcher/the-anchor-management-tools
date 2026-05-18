'use client'

import { useState } from 'react'
import { PageHeader, SectionNav } from '@/ds'
import { Button } from '@/ds'
import { RotaSchedule } from './RotaSchedule'
import { RotaLeave } from './RotaLeave'
import { RotaTimeclock } from './RotaTimeclock'
import { RotaLabourCosts } from './RotaLabourCosts'
import { RotaPayroll } from './RotaPayroll'
import { RotaTemplates } from './RotaTemplates'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Employee {
  id: string
  name: string
  role: string
  avatar?: string
  hourlyRate: number
}

export interface Shift {
  id: string
  employeeId: string
  day: string
  startTime: string
  endTime: string
  role: string
  status: 'scheduled' | 'confirmed' | 'completed'
}

export interface LeaveRequest {
  id: string
  employeeId: string
  employeeName: string
  type: 'annual' | 'sick' | 'other'
  startDate: string
  endDate: string
  days: number
  status: 'pending' | 'approved' | 'rejected'
}

export interface TimeclockEntry {
  id: string
  employeeId: string
  employeeName: string
  date: string
  clockIn: string
  clockOut: string | null
  totalHours: number | null
  punctuality: 'on-time' | 'late' | 'early'
}

export interface PayrollRun {
  id: string
  period: string
  status: 'draft' | 'pending' | 'paid'
  totalAmount: number
  employeeCount: number
}

export interface RotaTemplate {
  id: string
  name: string
  description: string
  shiftCount: number
}

/* ------------------------------------------------------------------ */
/*  Demo data                                                          */
/* ------------------------------------------------------------------ */

const DEMO_EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Sarah Chen', role: 'Manager', hourlyRate: 15 },
  { id: 'e2', name: 'James Wilson', role: 'Bartender', hourlyRate: 11.50 },
  { id: 'e3', name: 'Emma Brown', role: 'Server', hourlyRate: 11 },
  { id: 'e4', name: 'Tom Davies', role: 'Chef', hourlyRate: 14 },
  { id: 'e5', name: 'Lucy Taylor', role: 'Server', hourlyRate: 11 },
  { id: 'e6', name: 'Mike Johnson', role: 'Barback', hourlyRate: 10.50 },
]

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const DEMO_SHIFTS: Shift[] = [
  { id: 's1', employeeId: 'e1', day: 'Mon', startTime: '09:00', endTime: '17:00', role: 'Manager', status: 'scheduled' },
  { id: 's2', employeeId: 'e1', day: 'Tue', startTime: '09:00', endTime: '17:00', role: 'Manager', status: 'scheduled' },
  { id: 's3', employeeId: 'e1', day: 'Wed', startTime: '09:00', endTime: '17:00', role: 'Manager', status: 'scheduled' },
  { id: 's4', employeeId: 'e2', day: 'Wed', startTime: '16:00', endTime: '00:00', role: 'Bartender', status: 'scheduled' },
  { id: 's5', employeeId: 'e2', day: 'Thu', startTime: '16:00', endTime: '00:00', role: 'Bartender', status: 'scheduled' },
  { id: 's6', employeeId: 'e2', day: 'Fri', startTime: '16:00', endTime: '00:00', role: 'Bartender', status: 'scheduled' },
  { id: 's7', employeeId: 'e2', day: 'Sat', startTime: '12:00', endTime: '00:00', role: 'Bartender', status: 'scheduled' },
  { id: 's8', employeeId: 'e3', day: 'Mon', startTime: '11:00', endTime: '15:00', role: 'Server', status: 'scheduled' },
  { id: 's9', employeeId: 'e3', day: 'Tue', startTime: '11:00', endTime: '15:00', role: 'Server', status: 'scheduled' },
  { id: 's10', employeeId: 'e3', day: 'Fri', startTime: '17:00', endTime: '23:00', role: 'Server', status: 'scheduled' },
  { id: 's11', employeeId: 'e3', day: 'Sat', startTime: '11:00', endTime: '17:00', role: 'Server', status: 'scheduled' },
  { id: 's12', employeeId: 'e4', day: 'Tue', startTime: '08:00', endTime: '16:00', role: 'Chef', status: 'scheduled' },
  { id: 's13', employeeId: 'e4', day: 'Wed', startTime: '08:00', endTime: '16:00', role: 'Chef', status: 'scheduled' },
  { id: 's14', employeeId: 'e4', day: 'Thu', startTime: '08:00', endTime: '16:00', role: 'Chef', status: 'scheduled' },
  { id: 's15', employeeId: 'e4', day: 'Fri', startTime: '08:00', endTime: '16:00', role: 'Chef', status: 'scheduled' },
  { id: 's16', employeeId: 'e4', day: 'Sat', startTime: '08:00', endTime: '16:00', role: 'Chef', status: 'scheduled' },
  { id: 's17', employeeId: 'e5', day: 'Thu', startTime: '17:00', endTime: '23:00', role: 'Server', status: 'scheduled' },
  { id: 's18', employeeId: 'e5', day: 'Fri', startTime: '17:00', endTime: '23:00', role: 'Server', status: 'scheduled' },
  { id: 's19', employeeId: 'e5', day: 'Sat', startTime: '11:00', endTime: '23:00', role: 'Server', status: 'scheduled' },
  { id: 's20', employeeId: 'e5', day: 'Sun', startTime: '11:00', endTime: '17:00', role: 'Server', status: 'scheduled' },
]

const DEMO_LEAVE: LeaveRequest[] = [
  { id: 'l1', employeeId: 'e3', employeeName: 'Emma Brown', type: 'annual', startDate: '2026-06-01', endDate: '2026-06-05', days: 5, status: 'pending' },
  { id: 'l2', employeeId: 'e5', employeeName: 'Lucy Taylor', type: 'sick', startDate: '2026-05-15', endDate: '2026-05-16', days: 2, status: 'approved' },
  { id: 'l3', employeeId: 'e6', employeeName: 'Mike Johnson', type: 'annual', startDate: '2026-06-10', endDate: '2026-06-12', days: 3, status: 'pending' },
]

const DEMO_TIMECLOCK: TimeclockEntry[] = [
  { id: 'tc1', employeeId: 'e1', employeeName: 'Sarah Chen', date: '2026-05-18', clockIn: '08:55', clockOut: '17:05', totalHours: 8.17, punctuality: 'on-time' },
  { id: 'tc2', employeeId: 'e2', employeeName: 'James Wilson', date: '2026-05-18', clockIn: '16:10', clockOut: '00:05', totalHours: 7.92, punctuality: 'late' },
  { id: 'tc3', employeeId: 'e3', employeeName: 'Emma Brown', date: '2026-05-18', clockIn: '10:50', clockOut: '15:00', totalHours: 4.17, punctuality: 'early' },
  { id: 'tc4', employeeId: 'e4', employeeName: 'Tom Davies', date: '2026-05-18', clockIn: '07:58', clockOut: '16:00', totalHours: 8.03, punctuality: 'on-time' },
]

const DEMO_PAYROLL: PayrollRun[] = [
  { id: 'pr1', period: 'Week 20 (May 11 - May 17)', status: 'paid', totalAmount: 4250, employeeCount: 6 },
  { id: 'pr2', period: 'Week 21 (May 18 - May 24)', status: 'draft', totalAmount: 3980, employeeCount: 6 },
]

const DEMO_TEMPLATES: RotaTemplate[] = [
  { id: 'rt1', name: 'Standard Week', description: 'Normal weekday + weekend coverage', shiftCount: 24 },
  { id: 'rt2', name: 'Bank Holiday', description: 'Extended hours, all-day coverage', shiftCount: 18 },
  { id: 'rt3', name: 'Quiet Week', description: 'Reduced staffing for low season', shiftCount: 16 },
]

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function RotaClient() {
  const [activeSection, setActiveSection] = useState('schedule')
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff)
    return d
  })

  const sections = [
    { id: 'schedule', label: 'Schedule' },
    { id: 'leave', label: 'Leave' },
    { id: 'timeclock', label: 'Timeclock' },
    { id: 'labour-costs', label: 'Labour Costs' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'templates', label: 'Templates' },
  ]

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const weekLabel = `${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} - ${weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`

  const navigateWeek = (direction: -1 | 1) => {
    setWeekStart((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() + direction * 7)
      return d
    })
  }

  const goThisWeek = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diff)
    setWeekStart(d)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Rota' }]}
        title="Rota"
        subtitle={weekLabel}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm">Print</Button>
            <Button variant="secondary" size="sm">Auto-fill</Button>
            <Button size="sm">Publish</Button>
          </div>
        }
      />

      <SectionNav items={sections} activeId={activeSection} onSelect={setActiveSection} />

      {activeSection === 'schedule' && (
        <RotaSchedule
          employees={DEMO_EMPLOYEES}
          shifts={DEMO_SHIFTS}
          days={DAYS}
          weekLabel={weekLabel}
          onNavigateWeek={navigateWeek}
          onGoThisWeek={goThisWeek}
        />
      )}
      {activeSection === 'leave' && <RotaLeave requests={DEMO_LEAVE} />}
      {activeSection === 'timeclock' && <RotaTimeclock entries={DEMO_TIMECLOCK} />}
      {activeSection === 'labour-costs' && <RotaLabourCosts employees={DEMO_EMPLOYEES} shifts={DEMO_SHIFTS} />}
      {activeSection === 'payroll' && <RotaPayroll runs={DEMO_PAYROLL} />}
      {activeSection === 'templates' && <RotaTemplates templates={DEMO_TEMPLATES} />}
    </div>
  )
}
