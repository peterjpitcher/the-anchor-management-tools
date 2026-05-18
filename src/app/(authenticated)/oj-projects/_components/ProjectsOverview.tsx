'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Stat,
  Card,
  CardHeader,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  ProgressBar,
  Empty,
} from '@/ds'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`
}

interface ProjectsOverviewProps {
  projects: any[]
  entries: any[]
}

export function ProjectsOverview({ projects, entries }: ProjectsOverviewProps): React.ReactElement {
  const router = useRouter()

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects],
  )

  const totalHours = useMemo(() => {
    let hours = 0
    for (const entry of entries) {
      if (entry.entry_type === 'time') {
        hours += Number(entry.duration_minutes_rounded || 0) / 60
      }
    }
    return Math.round(hours * 100) / 100
  }, [entries])

  const revenueThisMonth = useMemo(() => {
    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    let total = 0
    for (const entry of entries) {
      if (!entry.entry_date?.startsWith(monthKey)) continue
      if (entry.entry_type === 'time') {
        const hours = Number(entry.duration_minutes_rounded || 0) / 60
        const rate = Number(entry.hourly_rate_ex_vat_snapshot || 0)
        total += hours * rate
      } else if (entry.entry_type === 'mileage') {
        total += Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot || 0.42)
      } else if (entry.entry_type === 'one_off') {
        total += Number(entry.amount_ex_vat_snapshot || 0)
      }
    }
    return Math.round(total * 100) / 100
  }, [entries])

  const outstandingCount = useMemo(
    () => entries.filter((e) => e.status === 'unbilled').length,
    [entries],
  )

  const recentProjects = useMemo(
    () => projects.slice(0, 5),
    [projects],
  )

  const statusTone = (status: string): 'success' | 'warning' | 'info' | 'neutral' => {
    switch (status) {
      case 'active': return 'success'
      case 'paused': return 'warning'
      case 'completed': return 'info'
      default: return 'neutral'
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Active Projects" value={String(activeProjects.length)} icon="briefcase" />
        <Stat label="Total Hours" value={totalHours.toFixed(1)} icon="clock" />
        <Stat label="Revenue This Month" value={formatCurrency(revenueThisMonth)} icon="pound" />
        <Stat label="Unbilled Entries" value={String(outstandingCount)} icon="clock" />
      </div>

      {/* Recent Projects */}
      <Card>
        <CardHeader title="Recent Projects" />
        {recentProjects.length === 0 ? (
          <Empty title="No projects" description="Create your first project to get started." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>Hours Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentProjects.map((project) => {
                const budgetHours = Number(project.budget_hours || 0)
                const usedHours = Number(project.total_hours_used || 0)
                const budgetMoney = Number(project.budget_ex_vat || 0)
                const spentMoney = Number(project.total_spend_ex_vat || 0)
                const hasBudget = budgetHours > 0 || budgetMoney > 0
                const progress = budgetHours > 0
                  ? Math.min((usedHours / budgetHours) * 100, 100)
                  : budgetMoney > 0
                    ? Math.min((spentMoney / budgetMoney) * 100, 100)
                    : 0

                return (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/oj-projects/projects/${project.id}`)}
                  >
                    <TableCell className="font-medium">{project.project_name}</TableCell>
                    <TableCell>{project.vendor?.name || 'Unknown'}</TableCell>
                    <TableCell>
                      <Badge tone={statusTone(project.status)}>{project.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {hasBudget ? (
                        <div className="flex flex-col gap-1 min-w-[140px]">
                          <ProgressBar
                            value={progress}
                            tone={progress > 90 ? 'danger' : 'primary'}
                          />
                          <span className="text-xs text-text-muted">
                            {budgetHours > 0
                              ? `${usedHours.toFixed(1)}h / ${budgetHours.toFixed(1)}h`
                              : `${formatCurrency(spentMoney)} / ${formatCurrency(budgetMoney)}`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted italic">No budget</span>
                      )}
                    </TableCell>
                    <TableCell>{usedHours.toFixed(1)}h</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Recent Entries */}
      <Card>
        <CardHeader title="Recent Entries" />
        {entries.length === 0 ? (
          <Empty title="No entries" description="No time entries recorded yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Hours/Amount</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const typeTone = entry.entry_type === 'time' ? 'info' : entry.entry_type === 'mileage' ? 'warning' : 'neutral'
                let valueDisplay = ''
                if (entry.entry_type === 'time') {
                  valueDisplay = `${(Number(entry.duration_minutes_rounded || 0) / 60).toFixed(1)}h`
                } else if (entry.entry_type === 'mileage') {
                  valueDisplay = `${entry.miles} mi`
                } else {
                  valueDisplay = formatCurrency(Number(entry.amount_ex_vat_snapshot || 0))
                }

                return (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDateDdMmmmYyyy(entry.entry_date)}</TableCell>
                    <TableCell>{entry.project?.project_name || 'Unknown'}</TableCell>
                    <TableCell>
                      <Badge tone={typeTone}>{entry.entry_type}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{valueDisplay}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-text-muted">
                      {entry.description || '-'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
