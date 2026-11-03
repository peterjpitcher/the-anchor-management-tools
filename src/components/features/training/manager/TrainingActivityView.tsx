'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Empty,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
} from '@/ds'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import { TRAINING_EVENT_BADGE } from '@/lib/training/labels'
import type { ActivityItem, ActivityPage } from '@/lib/training/types'
import { employeeTrainingHref, trainingViewHref } from './views'

interface TrainingActivityViewProps {
  activity: ActivityPage | null
  error: string | null
}

function when(item: ActivityItem): string {
  return formatDateTimeInLondon(item.createdAt, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

function EventBadge({ item }: { item: ActivityItem }): React.JSX.Element {
  const badge = TRAINING_EVENT_BADGE[item.eventType]
  return <Badge tone={badge.tone}>{badge.label}</Badge>
}

function Person({ item }: { item: ActivityItem }): React.JSX.Element {
  if (!item.employeeId) return <span className="text-text-muted">Everyone</span>
  return (
    <Link href={employeeTrainingHref(item.employeeId)} className="text-primary hover:underline">
      {item.employeeName ?? 'Unknown person'}
    </Link>
  )
}

/** The training log, newest first, a page at a time. Nothing in it can be changed. */
export function TrainingActivityView({ activity, error }: TrainingActivityViewProps): React.JSX.Element {
  const router = useRouter()

  if (error || !activity) {
    return (
      <Alert tone="danger" title="The training log could not be loaded">
        {error ?? 'Try again in a moment.'}
      </Alert>
    )
  }

  const totalPages = Math.max(1, Math.ceil(activity.total / Math.max(1, activity.pageSize)))

  return (
    <Card padding="none">
      <CardHeader title="Activity" subtitle="Every training change, newest first" />
      {activity.items.length === 0 ? (
        <Empty
          size="sm"
          title="No training activity yet"
          description="Uploads, assignments, checks and sign-offs are listed here as they happen."
        />
      ) : (
        <>
          <ul className="divide-y divide-border shell:hidden" aria-label="Training activity">
            {activity.items.map((item) => (
              <li key={item.id} className="space-y-1 px-pad-card py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <EventBadge item={item} />
                  <span className="text-xs text-text-muted">{when(item)}</span>
                </div>
                <div className="text-sm">
                  <Person item={item} />
                  {item.courseTitle ? <span className="text-text-muted"> · {item.courseTitle}</span> : null}
                </div>
                {item.note ? <p className="break-words text-xs text-text">{item.note}</p> : null}
                {item.actorName ? <p className="text-xs text-text-muted">By {item.actorName}</p> : null}
              </li>
            ))}
          </ul>

          <div className="hidden shell:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-text-muted">{when(item)}</TableCell>
                    <TableCell>
                      <EventBadge item={item} />
                    </TableCell>
                    <TableCell>
                      <Person item={item} />
                    </TableCell>
                    <TableCell>{item.courseTitle ?? ''}</TableCell>
                    <TableCell className="text-text-muted">{item.actorName ?? ''}</TableCell>
                    <TableCell className="max-w-sm whitespace-normal break-words">{item.note ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 ? (
            <TablePagination
              page={activity.page}
              totalPages={totalPages}
              pageSize={activity.pageSize}
              totalItems={activity.total}
              onPageChange={(page) => router.push(trainingViewHref('activity', { page: page > 1 ? page : null }))}
            />
          ) : null}
        </>
      )}
    </Card>
  )
}
