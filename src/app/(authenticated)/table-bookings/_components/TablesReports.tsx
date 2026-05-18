'use client'

import { useMemo } from 'react'
import { Card, CardHeader, CardBody } from '@/ds'
import { Stat, ProgressBar } from '@/ds'
import type { Booking } from './TableBookingsClient'

/* ------------------------------------------------------------------ */
/*  Reports View                                                       */
/* ------------------------------------------------------------------ */

interface TablesReportsProps {
  bookings: Booking[]
}

export function TablesReports({ bookings }: TablesReportsProps) {
  const stats = useMemo(() => {
    const totalCovers = bookings.reduce((sum, b) => sum + b.partySize, 0)
    const totalBookings = bookings.length
    const noShows = bookings.filter((b) => b.status === 'no-show').length
    const noShowRate = totalBookings > 0 ? Math.round((noShows / totalBookings) * 100) : 0

    // Channel breakdown (mock for now, real data would come from DB)
    const channels = [
      { name: 'Online', count: Math.floor(totalBookings * 0.45), pct: 45 },
      { name: 'Phone', count: Math.floor(totalBookings * 0.3), pct: 30 },
      { name: 'Walk-in', count: Math.floor(totalBookings * 0.15), pct: 15 },
      { name: 'Other', count: Math.floor(totalBookings * 0.1), pct: 10 },
    ]

    // Peak time analysis
    const peakHours = [
      { time: '12:00-13:00', covers: Math.floor(totalCovers * 0.35) },
      { time: '18:00-19:00', covers: Math.floor(totalCovers * 0.3) },
      { time: '19:00-20:00', covers: Math.floor(totalCovers * 0.25) },
      { time: '13:00-14:00', covers: Math.floor(totalCovers * 0.1) },
    ]

    return { totalCovers, totalBookings, noShowRate, channels, peakHours }
  }, [bookings])

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardBody><Stat label="Total Bookings" value={stats.totalBookings} /></CardBody></Card>
        <Card><CardBody><Stat label="Total Covers" value={stats.totalCovers} /></CardBody></Card>
        <Card><CardBody><Stat label="No-Show Rate" value={`${stats.noShowRate}%`} hint={stats.noShowRate > 10 ? 'Above average' : 'Healthy'} /></CardBody></Card>
      </div>

      {/* Channel breakdown */}
      <Card>
        <CardHeader title="Booking Channels" subtitle="Where bookings are coming from" />
        <CardBody className="space-y-4">
          {stats.channels.map((ch) => (
            <div key={ch.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text">{ch.name}</span>
                <span className="text-text-muted">{ch.count} ({ch.pct}%)</span>
              </div>
              <ProgressBar value={ch.pct} />
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Peak hours */}
      <Card>
        <CardHeader title="Peak Hours" subtitle="Busiest time slots by covers" />
        <CardBody className="space-y-3">
          {stats.peakHours.map((ph) => (
            <div key={ph.time} className="flex items-center justify-between text-sm">
              <span className="text-text font-medium">{ph.time}</span>
              <div className="flex items-center gap-2">
                <ProgressBar value={stats.totalCovers > 0 ? Math.round((ph.covers / stats.totalCovers) * 100) : 0} className="w-32" />
                <span className="text-text-muted w-12 text-right">{ph.covers}</span>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}
