'use client'

import { Accordion, Badge, Button, LinkButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import {
  TRAINING_ASSIGNMENT_STATUS_BADGE,
  TRAINING_ATTEMPT_RESULT_BADGE,
  TRAINING_CANCEL_REASON_BADGE,
  TRAINING_COURSE_KIND_BADGE,
  TRAINING_REASON_BADGE,
  TRAINING_REMINDER_STEP_BADGE,
  TRAINING_SUPERVISED_ONLY_BADGE,
  describeDisplayState,
  formatTrainingDate,
} from '@/lib/training/labels'
import type { AttemptSummary, EmployeeAssignmentItem } from '@/lib/training/types'
import { formatTrainingMinutes } from '../format'
import { confirmationStanding, itemActions, type ItemAction } from './item-actions'

interface AssignmentItemViewProps {
  item: EmployeeAssignmentItem
  /** History lists the stored status; current items show the display state with its dates. */
  variant: 'current' | 'history'
  /** London date the view was worked out for, to count days overdue. */
  today: string
  canManage: boolean
  busy: boolean
  onAction: (action: ItemAction, item: EmployeeAssignmentItem) => void
}

const ACTION_TEXT: Record<ItemAction, string> = {
  extend: 'Extend Due Date',
  waive: 'Waive',
  unlock: 'Unlock Section',
  prepare_again: 'Prepare Again',
  record_signoff: 'Record Sign-off',
  sign_in_person: 'Sign In Person Again',
  record_external: 'Record Qualification',
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days from one London date (YYYY-MM-DD) to a later one; both read as UTC midnights. */
function daysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso}T00:00:00Z`)
  const to = Date.parse(`${toIso}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / DAY_MS)
}

function attemptResult(attempt: AttemptSummary): keyof typeof TRAINING_ATTEMPT_RESULT_BADGE {
  if (attempt.passed === null || attempt.submittedAt === null) return 'open'
  return attempt.passed ? 'passed' : 'failed'
}

function when(instant: string): string {
  return formatDateTimeInLondon(instant, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** Lines of plain detail under the item's title, only the ones that apply. */
function detailLines(item: EmployeeAssignmentItem): string[] {
  const a = item.assignment
  const lines: string[] = []
  const meta = [`Cycle ${a.cycle}`, TRAINING_REASON_BADGE[a.reason].label]
  if (item.versionLabel) meta.push(`Version ${item.versionLabel}`)
  meta.push(`Assigned ${formatTrainingDate(a.assignedOn)}`)
  lines.push(meta.join(' · '))

  if (a.dueOn) lines.push(`Due ${formatTrainingDate(a.dueOn)}${a.dueChangeReason ? ` (moved: ${a.dueChangeReason})` : ''}`)
  if (a.lockedAt) {
    const section = item.sections.find((entry) => entry.key === a.lockedSection)
    lines.push(`Locked on ${section ? `"${section.title}"` : 'a section'} since ${formatTrainingDate(a.lockedAt)}`)
  }
  if (a.completedOn) {
    lines.push(
      `Completed ${formatTrainingDate(a.completedOn)}${a.expiresOn ? `, refresher due by ${formatTrainingDate(a.expiresOn)}` : ', no refresher'}`,
    )
  }
  if (a.certificateNumber) lines.push(`Certificate ${a.certificateNumber}`)
  if (a.confirmedAt) lines.push(`Confirmed ${when(a.confirmedAt)}`)
  if (a.declinedAt) lines.push(`Confirmation declined ${formatTrainingDate(a.declinedAt)}`)
  if (confirmationStanding(item) === 'lapsed') {
    const what = item.certificate?.status === 'voided' ? 'was withdrawn' : 'ran out'
    const next = item.course.kind === 'practical' ? 'Record the sign-off again with them.' : 'Prepare it again for them.'
    lines.push(`Their confirmation ${what} before they confirmed it. ${next}`)
  }
  if (a.externalIssuer) {
    const parts = [`Issued by ${a.externalIssuer}`]
    if (a.externalReference) parts.push(`reference ${a.externalReference}`)
    if (a.externalIssuedOn) parts.push(`on ${formatTrainingDate(a.externalIssuedOn)}`)
    lines.push(parts.join(', '))
  }
  if (a.signedOffOn) {
    const tasks = Array.isArray(a.signoffTasks) ? a.signoffTasks.length : 0
    lines.push(
      `Signed off ${formatTrainingDate(a.signedOffOn)}${a.signedOffByName ? ` by ${a.signedOffByName}` : ''}${tasks > 0 ? ` (${tasks} ${tasks === 1 ? 'task' : 'tasks'})` : ''}`,
    )
  }
  if (a.trainedInPerson) {
    lines.push(`Trained in person, recorded by ${a.inPersonRecordedByName ?? 'a manager'} (no signature)`)
  }
  if (a.waivedAt) lines.push(`Waived ${formatTrainingDate(a.waivedAt)}${a.waivedByName ? ` by ${a.waivedByName}` : ''}${a.waiveReason ? `: ${a.waiveReason}` : ''}`)
  if (a.cancelledAt) {
    lines.push(`Cancelled ${formatTrainingDate(a.cancelledAt)}${a.cancelReason ? `: ${TRAINING_CANCEL_REASON_BADGE[a.cancelReason].label}` : ''}`)
  }
  if (item.nextReminder) {
    lines.push(`Next reminder: ${TRAINING_REMINDER_STEP_BADGE[item.nextReminder.step].label}, ${formatTrainingDate(item.nextReminder.onDate)}`)
  }
  return lines
}

function SectionList({ item }: { item: EmployeeAssignmentItem }): React.JSX.Element | null {
  if (item.sections.length === 0) return null
  return (
    <ul className="space-y-1 text-xs" aria-label={`Sections of ${item.course.title}`}>
      {item.sections.map((section) => (
        <li key={section.key} className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-text">{section.title}</span>
          <span className="text-text-muted">
            {section.passed && section.passedAt
              ? `Passed ${formatTrainingDate(section.passedAt)}${section.attempts > 1 ? ` after ${section.attempts} tries` : ', first try'}`
              : section.attempts > 0
                ? `Not passed yet, ${section.fails} ${section.fails === 1 ? 'fail' : 'fails'}`
                : 'Not started'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function AttemptsTable({ attempts }: { attempts: AttemptSummary[] }): React.JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Section</TableHead>
          <TableHead align="right">Try</TableHead>
          <TableHead>Result</TableHead>
          <TableHead align="right">Wrong</TableHead>
          <TableHead align="right">Time</TableHead>
          <TableHead>Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {attempts.map((attempt) => {
          const result = TRAINING_ATTEMPT_RESULT_BADGE[attemptResult(attempt)]
          return (
            <TableRow key={attempt.id}>
              <TableCell className="whitespace-normal">{attempt.sectionTitle}</TableCell>
              <TableCell align="right">{attempt.attemptNo}</TableCell>
              <TableCell>
                <Badge tone={result.tone}>{result.label}</Badge>
              </TableCell>
              <TableCell align="right">{attempt.wrongCount ?? ''}</TableCell>
              <TableCell align="right">{attempt.minutes === null ? '' : formatTrainingMinutes(attempt.minutes)}</TableCell>
              <TableCell className="text-text-muted">{when(attempt.startedAt)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** One training item on the employee record, with the manager actions that fit it. */
export function AssignmentItemView({ item, variant, today, canManage, busy, onAction }: AssignmentItemViewProps): React.JSX.Element {
  const a = item.assignment
  const overdueDays = item.state === 'overdue' && a.dueOn ? daysBetween(a.dueOn, today) : null
  const kind = TRAINING_COURSE_KIND_BADGE[item.course.kind]
  const stateBadge =
    variant === 'current'
      ? describeDisplayState(item.state, { dueOn: a.dueOn, daysOverdue: overdueDays, expiresOn: a.expiresOn })
      : { ...TRAINING_ASSIGNMENT_STATUS_BADGE[a.status], text: TRAINING_ASSIGNMENT_STATUS_BADGE[a.status].label }
  const actions = canManage && variant === 'current' ? itemActions(item) : []
  const certificateHref = item.certificate ? `/api/signing/documents/${encodeURIComponent(item.certificate.documentId)}/pdf` : null

  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-text-strong">{item.course.title}</p>
          <div className="flex flex-wrap gap-1">
            <Badge tone={kind.tone}>{kind.label}</Badge>
            {item.course.isEssentials ? <Badge tone="primary">Essentials</Badge> : null}
            {a.supervisedOnly ? <Badge tone={TRAINING_SUPERVISED_ONLY_BADGE.tone}>{TRAINING_SUPERVISED_ONLY_BADGE.label}</Badge> : null}
          </div>
        </div>
        <Badge tone={stateBadge.tone} title={stateBadge.text}>
          {stateBadge.label}
        </Badge>
      </div>

      <ul className="space-y-0.5 text-xs text-text-muted">
        {detailLines(item).map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
      </ul>

      <SectionList item={item} />

      {item.attempts.length > 0 ? (
        <Accordion
          variant="bordered"
          size="sm"
          items={[
            {
              key: 'attempts',
              title: item.attempts.length === 1 ? '1 check taken' : `${item.attempts.length} checks taken`,
              content: <AttemptsTable attempts={item.attempts} />,
            },
          ]}
        />
      ) : null}

      {certificateHref || a.externalFilePath || actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {certificateHref ? (
            <LinkButton href={certificateHref} size="sm" variant="secondary" download>
              Download PDF
            </LinkButton>
          ) : null}
          {a.externalFilePath ? (
            <LinkButton href={`/api/training/external/${encodeURIComponent(a.id)}`} size="sm" variant="secondary" download>
              Download Certificate
            </LinkButton>
          ) : null}
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={
                action === 'record_signoff' || action === 'sign_in_person' || action === 'record_external' || action === 'unlock'
                  ? 'primary'
                  : 'secondary'
              }
              disabled={busy}
              onClick={() => onAction(action, item)}
              aria-label={`${ACTION_TEXT[action]}: ${item.course.title}`}
            >
              {ACTION_TEXT[action]}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  )
}
