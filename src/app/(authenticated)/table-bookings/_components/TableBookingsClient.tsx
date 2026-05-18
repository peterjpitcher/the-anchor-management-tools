'use client'

import { useState } from 'react'
import { PageHeader, SectionNav, Segmented } from '@/ds'
import { Button } from '@/ds'
import { TimelineView } from './TimelineView'
import { FloorPlanView } from './FloorPlanView'
import { ListView } from './ListView'
import { TablesFOH } from './TablesFOH'
import { TablesBOH } from './TablesBOH'
import { TablesReports } from './TablesReports'
import { TablesSettings } from './TablesSettings'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Booking {
  id: string
  guestName: string
  partySize: number
  tableId: string
  tableName: string
  startTime: string
  endTime: string
  status: 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no-show' | 'waitlist'
  phone?: string
  notes?: string
}

export interface TableInfo {
  id: string
  name: string
  capacity: number
  section: string
  x: number
  y: number
  shape: 'circle' | 'rectangle'
  status: 'available' | 'occupied' | 'reserved' | 'blocked'
  currentBooking?: Booking | null
}

/* ------------------------------------------------------------------ */
/*  Mock data for initial UI buildout                                  */
/* ------------------------------------------------------------------ */

const DEMO_TABLES: TableInfo[] = [
  { id: 't1', name: 'Table 1', capacity: 2, section: 'Main', x: 10, y: 15, shape: 'circle', status: 'available' },
  { id: 't2', name: 'Table 2', capacity: 4, section: 'Main', x: 30, y: 15, shape: 'rectangle', status: 'occupied' },
  { id: 't3', name: 'Table 3', capacity: 4, section: 'Main', x: 50, y: 15, shape: 'rectangle', status: 'reserved' },
  { id: 't4', name: 'Table 4', capacity: 6, section: 'Main', x: 70, y: 15, shape: 'rectangle', status: 'available' },
  { id: 't5', name: 'Table 5', capacity: 2, section: 'Window', x: 10, y: 45, shape: 'circle', status: 'available' },
  { id: 't6', name: 'Table 6', capacity: 4, section: 'Window', x: 30, y: 45, shape: 'rectangle', status: 'occupied' },
  { id: 't7', name: 'Table 7', capacity: 8, section: 'Garden', x: 50, y: 45, shape: 'rectangle', status: 'available' },
  { id: 't8', name: 'Table 8', capacity: 2, section: 'Garden', x: 70, y: 45, shape: 'circle', status: 'blocked' },
  { id: 't9', name: 'Table 9', capacity: 6, section: 'Private', x: 10, y: 75, shape: 'rectangle', status: 'reserved' },
  { id: 't10', name: 'Table 10', capacity: 4, section: 'Private', x: 30, y: 75, shape: 'rectangle', status: 'available' },
]

const DEMO_BOOKINGS: Booking[] = [
  { id: 'b1', guestName: 'Smith', partySize: 2, tableId: 't2', tableName: 'Table 2', startTime: '12:00', endTime: '13:30', status: 'seated', phone: '07700900001' },
  { id: 'b2', guestName: 'Johnson', partySize: 4, tableId: 't3', tableName: 'Table 3', startTime: '13:00', endTime: '14:30', status: 'confirmed', phone: '07700900002' },
  { id: 'b3', guestName: 'Williams', partySize: 4, tableId: 't6', tableName: 'Table 6', startTime: '12:30', endTime: '14:00', status: 'seated', phone: '07700900003' },
  { id: 'b4', guestName: 'Brown', partySize: 6, tableId: 't9', tableName: 'Table 9', startTime: '18:00', endTime: '20:00', status: 'confirmed', phone: '07700900004' },
  { id: 'b5', guestName: 'Taylor', partySize: 2, tableId: 't1', tableName: 'Table 1', startTime: '19:00', endTime: '20:30', status: 'confirmed', phone: '07700900005' },
  { id: 'b6', guestName: 'Wilson', partySize: 3, tableId: 't4', tableName: 'Table 4', startTime: '14:00', endTime: '15:30', status: 'confirmed' },
]

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TableBookingsClient() {
  const [activeSection, setActiveSection] = useState('schedule')
  const [scheduleView, setScheduleView] = useState('timeline')
  const [selectedDate, setSelectedDate] = useState(new Date())

  const sections = [
    { id: 'schedule', label: 'Schedule' },
    { id: 'foh', label: 'FOH' },
    { id: 'boh', label: 'BOH' },
    { id: 'reports', label: 'Reports' },
    { id: 'settings', label: 'Settings' },
  ]

  const totalCovers = DEMO_BOOKINGS.reduce((sum, b) => sum + b.partySize, 0)

  const navigateDate = (direction: -1 | 1) => {
    setSelectedDate((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() + direction)
      return d
    })
  }

  const goToToday = () => setSelectedDate(new Date())

  const dateLabel = selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Tables' }]}
        title="Tables"
        subtitle={`${dateLabel} - ${totalCovers} covers`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm">Walk-in</Button>
            <Button variant="secondary" size="sm">Waitlist</Button>
            <Button size="sm">New Booking</Button>
          </div>
        }
      />

      <SectionNav items={sections} activeId={activeSection} onSelect={setActiveSection} />

      {activeSection === 'schedule' && (
        <div className="space-y-4">
          {/* Date navigation + view toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigateDate(-1)}>Prev</Button>
              <span className="text-sm font-medium text-text-strong">{dateLabel}</span>
              <Button variant="ghost" size="sm" onClick={() => navigateDate(1)}>Next</Button>
              <Button variant="secondary" size="sm" onClick={goToToday}>Today</Button>
            </div>
            <Segmented
              options={[
                { id: 'timeline', label: 'Timeline' },
                { id: 'floorplan', label: 'Floor Plan' },
                { id: 'list', label: 'List' },
              ]}
              value={scheduleView}
              onChange={setScheduleView}
              size="sm"
            />
          </div>

          {scheduleView === 'timeline' && <TimelineView bookings={DEMO_BOOKINGS} tables={DEMO_TABLES} />}
          {scheduleView === 'floorplan' && <FloorPlanView tables={DEMO_TABLES} />}
          {scheduleView === 'list' && <ListView bookings={DEMO_BOOKINGS} />}
        </div>
      )}

      {activeSection === 'foh' && <TablesFOH tables={DEMO_TABLES} bookings={DEMO_BOOKINGS} />}
      {activeSection === 'boh' && <TablesBOH bookings={DEMO_BOOKINGS} />}
      {activeSection === 'reports' && <TablesReports bookings={DEMO_BOOKINGS} />}
      {activeSection === 'settings' && <TablesSettings tables={DEMO_TABLES} />}
    </div>
  )
}
