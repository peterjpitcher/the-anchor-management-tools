'use client'

import { useState, useMemo } from 'react'
import {
  Card, CardBody,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/ds'
import { Badge, SearchInput, Select, Empty, Dropdown, DropdownItem } from '@/ds'
import type { Booking } from './TableBookingsClient'

/* ------------------------------------------------------------------ */
/*  Status helpers                                                     */
/* ------------------------------------------------------------------ */

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const statusTone: Record<string, BadgeTone> = {
  confirmed: 'info',
  seated: 'success',
  completed: 'neutral',
  cancelled: 'danger',
  'no-show': 'warning',
  waitlist: 'info',
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface ListViewProps {
  bookings: Booking[]
}

export function ListView({ bookings }: ListViewProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const filtered = useMemo(() => {
    let result = bookings
    if (statusFilter !== 'all') result = result.filter((b) => b.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((b) =>
        b.guestName.toLowerCase().includes(q) ||
        b.tableName.toLowerCase().includes(q) ||
        (b.phone && b.phone.includes(q))
      )
    }
    return result.sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [bookings, search, statusFilter])

  return (
    <Card>
      <div className="p-4 border-b border-border flex items-center gap-3">
        <SearchInput placeholder="Search guests or tables" value={search} onChange={setSearch} className="w-64" />
        <Select
          options={[
            { value: 'all', label: 'All Statuses' },
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'seated', label: 'Seated' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'no-show', label: 'No Show' },
            { value: 'waitlist', label: 'Waitlist' },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
      </div>
      <CardBody className="p-0">
        {filtered.length === 0 ? (
          <Empty title="No bookings" description="No bookings match the current filters." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="whitespace-nowrap">{b.startTime} - {b.endTime}</TableCell>
                  <TableCell>{b.tableName}</TableCell>
                  <TableCell className="font-medium">{b.guestName}</TableCell>
                  <TableCell>{b.partySize}</TableCell>
                  <TableCell><Badge tone={statusTone[b.status] || 'neutral'}>{b.status}</Badge></TableCell>
                  <TableCell>{b.phone || '—'}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{b.notes || '—'}</TableCell>
                  <TableCell>
                    <Dropdown trigger={<button type="button" className="text-xs text-text-muted hover:text-text">...</button>}>
                      <DropdownItem onClick={() => {}}>Edit</DropdownItem>
                      <DropdownItem onClick={() => {}}>Cancel</DropdownItem>
                    </Dropdown>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardBody>
    </Card>
  )
}
