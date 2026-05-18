'use client'

import { Card, CardHeader, CardBody, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/ds'
import { Badge, Stat, Dropdown, DropdownItem } from '@/ds'
import type { PayrollRun } from './RotaClient'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const statusTone: Record<string, BadgeTone> = {
  draft: 'neutral',
  pending: 'warning',
  paid: 'success',
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface RotaPayrollProps {
  runs: PayrollRun[]
}

export function RotaPayroll({ runs }: RotaPayrollProps) {
  const currentPeriod = runs.find((r) => r.status === 'draft') || runs[runs.length - 1]

  return (
    <div className="space-y-6">
      {/* Current period summary */}
      {currentPeriod && (
        <Card>
          <CardHeader title="Current Period" subtitle={currentPeriod.period} />
          <CardBody>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Status" value={currentPeriod.status} />
              <Stat label="Total Amount" value={formatCurrency(currentPeriod.totalAmount)} />
              <Stat label="Employees" value={currentPeriod.employeeCount} />
            </div>
          </CardBody>
        </Card>
      )}

      {/* Payroll runs table */}
      <Card>
        <CardHeader title="Payroll Runs" subtitle="History of payroll submissions" />
        <CardBody className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Employees</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">{run.period}</TableCell>
                  <TableCell><Badge tone={statusTone[run.status] || 'neutral'}>{run.status}</Badge></TableCell>
                  <TableCell className="text-right">{formatCurrency(run.totalAmount)}</TableCell>
                  <TableCell className="text-right">{run.employeeCount}</TableCell>
                  <TableCell>
                    <Dropdown trigger={<button type="button" className="text-xs text-text-muted hover:text-text">...</button>}>
                      <DropdownItem onClick={() => {}}>View</DropdownItem>
                      <DropdownItem onClick={() => {}}>Export</DropdownItem>
                      {run.status === 'draft' && <DropdownItem onClick={() => {}}>Submit</DropdownItem>}
                    </Dropdown>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  )
}
