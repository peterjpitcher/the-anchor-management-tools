'use client'

import { useMemo } from 'react'
import { Card, CardHeader, CardBody, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ds'
import { Stat, ProgressBar } from '@/ds'
import type { Employee, Shift } from './RotaClient'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let hours = eh - sh + (em - sm) / 60
  if (hours < 0) hours += 24
  return hours
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface RotaLabourCostsProps {
  employees: Employee[]
  shifts: Shift[]
}

export function RotaLabourCosts({ employees, shifts }: RotaLabourCostsProps) {
  const data = useMemo(() => {
    let totalHours = 0
    let totalCost = 0

    const empData = employees.map((emp) => {
      const empShifts = shifts.filter((s) => s.employeeId === emp.id)
      const scheduled = empShifts.reduce((sum, s) => sum + shiftHours(s.startTime, s.endTime), 0)
      const actual = scheduled * (0.9 + Math.random() * 0.2) // simulated actual
      const variance = actual - scheduled
      const cost = actual * emp.hourlyRate

      totalHours += actual
      totalCost += cost

      return {
        id: emp.id,
        name: emp.name,
        scheduledHours: Math.round(scheduled * 10) / 10,
        actualHours: Math.round(actual * 10) / 10,
        variance: Math.round(variance * 10) / 10,
        cost: Math.round(cost * 100) / 100,
        hourlyRate: emp.hourlyRate,
      }
    })

    const avgHourly = totalHours > 0 ? totalCost / totalHours : 0
    const costPct = 28.5 // simulated cost vs revenue percentage

    return { empData, totalHours: Math.round(totalHours * 10) / 10, totalCost: Math.round(totalCost * 100) / 100, avgHourly: Math.round(avgHourly * 100) / 100, costPct }
  }, [employees, shifts])

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardBody><Stat label="Total Hours" value={`${data.totalHours}h`} /></CardBody></Card>
        <Card><CardBody><Stat label="Labour Cost" value={formatCurrency(data.totalCost)} /></CardBody></Card>
        <Card><CardBody><Stat label="Avg Hourly" value={formatCurrency(data.avgHourly)} /></CardBody></Card>
        <Card><CardBody><Stat label="Cost vs Revenue" value={`${data.costPct}%`} hint={data.costPct > 30 ? 'Above target' : 'On track'} /></CardBody></Card>
      </div>

      {/* Employee breakdown */}
      <Card>
        <CardHeader title="Employee Breakdown" subtitle="Scheduled vs actual hours and cost" />
        <CardBody className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Scheduled</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.empData.map((emp) => (
                <TableRow key={emp.id}>
                  <TableCell className="font-medium">{emp.name}</TableCell>
                  <TableCell className="text-right">{emp.scheduledHours}h</TableCell>
                  <TableCell className="text-right">{emp.actualHours}h</TableCell>
                  <TableCell className={`text-right ${emp.variance > 0 ? 'text-danger' : emp.variance < -0.5 ? 'text-success-fg' : ''}`}>
                    {emp.variance > 0 ? '+' : ''}{emp.variance}h
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(emp.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* Weekly cost comparison */}
      <Card>
        <CardHeader title="Weekly Cost Comparison" />
        <CardBody className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text">This Week</span>
              <span className="text-text-muted">{formatCurrency(data.totalCost)}</span>
            </div>
            <ProgressBar value={Math.min(100, (data.totalCost / 5000) * 100)} tone="primary" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text">Budget</span>
              <span className="text-text-muted">{formatCurrency(5000)}</span>
            </div>
            <ProgressBar value={100} tone="success" />
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
