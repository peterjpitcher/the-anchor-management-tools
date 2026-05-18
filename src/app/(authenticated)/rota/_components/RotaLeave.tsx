'use client'

import { useState, useMemo } from 'react'
import { Card, CardBody, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Tabs } from '@/ds'
import { Badge, Avatar, Dropdown, DropdownItem, Empty } from '@/ds'
import type { LeaveRequest } from './RotaClient'

/* ------------------------------------------------------------------ */
/*  Badge tones                                                        */
/* ------------------------------------------------------------------ */

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const typeTone: Record<string, BadgeTone> = { annual: 'info', sick: 'warning', other: 'neutral' }
const statusTone: Record<string, BadgeTone> = { pending: 'warning', approved: 'success', rejected: 'danger' }

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface RotaLeaveProps {
  requests: LeaveRequest[]
}

export function RotaLeave({ requests }: RotaLeaveProps) {
  const [tab, setTab] = useState('pending')

  const filtered = useMemo(() => {
    if (tab === 'all') return requests
    return requests.filter((r) => r.status === tab)
  }, [requests, tab])

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { id: 'pending', label: 'Pending' },
          { id: 'approved', label: 'Approved' },
          { id: 'all', label: 'All' },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      <Card>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <Empty title="No leave requests" description={`No ${tab === 'all' ? '' : tab + ' '}leave requests found.`} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar name={r.employeeName} size="sm" />
                        <span className="font-medium">{r.employeeName}</span>
                      </div>
                    </TableCell>
                    <TableCell><Badge tone={typeTone[r.type] || 'neutral'}>{r.type}</Badge></TableCell>
                    <TableCell>{r.startDate}</TableCell>
                    <TableCell>{r.endDate}</TableCell>
                    <TableCell>{r.days}</TableCell>
                    <TableCell><Badge tone={statusTone[r.status] || 'neutral'}>{r.status}</Badge></TableCell>
                    <TableCell>
                      <Dropdown trigger={<button type="button" className="text-xs text-text-muted hover:text-text">...</button>}>
                        <DropdownItem onClick={() => {}}>Approve</DropdownItem>
                        <DropdownItem onClick={() => {}}>Reject</DropdownItem>
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
