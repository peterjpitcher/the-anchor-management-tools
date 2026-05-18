'use client'

import { useState } from 'react'
import { Card, CardHeader, CardBody, CardFooter, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ds'
import { Button, Input, Select, Badge } from '@/ds'
import type { TableInfo } from './TableBookingsClient'

/* ------------------------------------------------------------------ */
/*  Settings View                                                      */
/* ------------------------------------------------------------------ */

interface TablesSettingsProps {
  tables: TableInfo[]
}

export function TablesSettings({ tables }: TablesSettingsProps) {
  const [serviceStart, setServiceStart] = useState('11:00')
  const [serviceEnd, setServiceEnd] = useState('23:00')
  const [maxPartySize, setMaxPartySize] = useState('12')
  const [leadTime, setLeadTime] = useState('60')

  return (
    <div className="space-y-6">
      {/* Service windows */}
      <Card>
        <CardHeader title="Service Windows" subtitle="When tables are available for booking" />
        <CardBody>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <Input label="Open" type="time" value={serviceStart} onChange={(e) => setServiceStart(e.target.value)} />
            <Input label="Close" type="time" value={serviceEnd} onChange={(e) => setServiceEnd(e.target.value)} />
          </div>
        </CardBody>
        <CardFooter>
          <Button size="sm">Save Changes</Button>
        </CardFooter>
      </Card>

      {/* Table configuration */}
      <Card>
        <CardHeader title="Tables" subtitle="Configure table names, capacity, and sections" />
        <CardBody className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.capacity} pax</TableCell>
                  <TableCell>{t.section}</TableCell>
                  <TableCell><Badge tone={t.status === 'available' ? 'success' : t.status === 'blocked' ? 'danger' : 'neutral'}>{t.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* Online booking settings */}
      <Card>
        <CardHeader title="Online Booking Settings" subtitle="Control guest-facing booking behaviour" />
        <CardBody>
          <div className="grid grid-cols-2 gap-4 max-w-lg">
            <Input label="Lead time (minutes)" type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} hint="Minimum advance booking time" />
            <Input label="Max party size" type="number" min="1" value={maxPartySize} onChange={(e) => setMaxPartySize(e.target.value)} hint="Largest online booking allowed" />
          </div>
        </CardBody>
        <CardFooter>
          <Button size="sm">Save Changes</Button>
        </CardFooter>
      </Card>
    </div>
  )
}
