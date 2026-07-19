'use client'

import {
  Alert,
  Card,
  CardHeader,
  CardBody,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/ds'
import type { ProblemsData } from '@/app/actions/checklists-spotcheck'
import { DateRangeControl } from './DateRangeControl'

interface ProblemsClientProps {
  data?: ProblemsData
  error?: string
}

export function ProblemsClient({ data, error }: ProblemsClientProps) {
  if (error || !data) {
    return (
      <Alert tone="warning" title="Super admins only">
        {error ?? 'Problems are only available to super admins.'}
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <DateRangeControl from={data.from} to={data.to} />
      <p className="text-sm text-text-muted">
        Locked business days from {data.from} to {data.to}.
      </p>

      <Card>
        <CardHeader title="Missed, by closer" subtitle="Floating misses are shown against the venue." />
        <CardBody className="p-0">
          {data.missesByCloser.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Closer</TableHead>
                  <TableHead align="right">Misses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.missesByCloser.map((row) => (
                  <TableRow key={row.employeeName}>
                    <TableCell className="font-medium text-text">{row.employeeName}</TableCell>
                    <TableCell align="right">{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Value breaches" />
        <CardBody className="p-0">
          {data.breaches.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Reading</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Completed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.breaches.map((row, i) => (
                  <TableRow key={`${row.businessDate}-${row.taskTitle}-${i}`}>
                    <TableCell className="whitespace-normal font-medium text-text">
                      {row.taskTitle}
                    </TableCell>
                    <TableCell>
                      {row.value ?? '-'} {row.unit ?? ''}
                    </TableCell>
                    <TableCell>{row.businessDate}</TableCell>
                    <TableCell>{row.completedByName ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Hours mismatches" />
        <CardBody className="p-0">
          {data.mismatches.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead align="right">Minutes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.mismatches.map((row, i) => (
                  <TableRow key={`${row.businessDate}-${row.kind}-${i}`}>
                    <TableCell>{row.businessDate}</TableCell>
                    <TableCell>{row.kind}</TableCell>
                    <TableCell align="right">{row.minutes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Failed spot checks" />
        <CardBody className="p-0">
          {data.failedSpotChecks.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Checked person</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.failedSpotChecks.map((row, i) => (
                  <TableRow key={`${row.businessDate}-${row.taskTitle}-${i}`}>
                    <TableCell className="whitespace-normal font-medium text-text">
                      {row.taskTitle}
                    </TableCell>
                    <TableCell>{row.checkedEmployeeName}</TableCell>
                    <TableCell>{row.businessDate}</TableCell>
                    <TableCell className="whitespace-normal text-text-muted">
                      {row.note ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Drawn but unrecorded spot checks"
          subtitle="Drawn checks Billy never recorded a result for."
        />
        <CardBody className="p-0">
          {data.drawnUnrecorded.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.drawnUnrecorded.map((row, i) => (
                  <TableRow key={`${row.businessDate}-${row.taskTitle}-${i}`}>
                    <TableCell className="whitespace-normal font-medium text-text">
                      {row.taskTitle}
                    </TableCell>
                    <TableCell>{row.businessDate}</TableCell>
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

function Empty() {
  return <p className="px-[var(--spacing-pad-card)] py-4 text-sm text-text-muted">None</p>
}
