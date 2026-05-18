'use client'

import { useState, useMemo } from 'react'
import { Card, CardBody, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ds'
import { Badge, Avatar, SearchInput, Input, Empty, Dropdown, DropdownItem } from '@/ds'
import type { TimeclockEntry } from './RotaClient'

/* ------------------------------------------------------------------ */
/*  Badge tones                                                        */
/* ------------------------------------------------------------------ */

type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral'

const punctualityTone: Record<string, BadgeTone> = {
  'on-time': 'success',
  late: 'danger',
  early: 'warning',
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface RotaTimeclockProps {
  entries: TimeclockEntry[]
}

export function RotaTimeclock({ entries }: RotaTimeclockProps) {
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')

  const filtered = useMemo(() => {
    let result = entries
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((e) => e.employeeName.toLowerCase().includes(q))
    }
    if (dateFilter) {
      result = result.filter((e) => e.date === dateFilter)
    }
    return result
  }, [entries, search, dateFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SearchInput placeholder="Search employees" value={search} onChange={setSearch} className="w-64" />
        <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-40" />
      </div>

      <Card>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <Empty title="No records" description="No timeclock records found for the current filters." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Total Hours</TableHead>
                  <TableHead>Punctuality</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar name={entry.employeeName} size="sm" />
                        <span className="font-medium">{entry.employeeName}</span>
                      </div>
                    </TableCell>
                    <TableCell>{entry.date}</TableCell>
                    <TableCell>{entry.clockIn}</TableCell>
                    <TableCell>{entry.clockOut || '—'}</TableCell>
                    <TableCell>{entry.totalHours !== null ? `${entry.totalHours.toFixed(1)}h` : '—'}</TableCell>
                    <TableCell>
                      <Badge tone={punctualityTone[entry.punctuality] || 'neutral'}>
                        {entry.punctuality.replace('-', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Dropdown trigger={<button type="button" className="text-xs text-text-muted hover:text-text">...</button>}>
                        <DropdownItem onClick={() => {}}>Edit</DropdownItem>
                        <DropdownItem onClick={() => {}}>Delete</DropdownItem>
                      </Dropdown>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
