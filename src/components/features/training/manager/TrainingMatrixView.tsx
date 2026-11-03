import Link from 'next/link'
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Empty,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import {
  TRAINING_DISPLAY_STATE_BADGE,
  TRAINING_PERSON_FLAG_BADGE,
  TRAINING_SUPERVISED_ONLY_BADGE,
  describeDisplayState,
} from '@/lib/training/labels'
import type { MatrixCell, MatrixCourse, MatrixPerson, TrainingMatrix } from '@/lib/training/types'
import { employeeTrainingHref } from './views'

interface TrainingMatrixViewProps {
  matrix: TrainingMatrix | null
  /** Set when the matrix could not be loaded: shown as an error, never as an empty matrix. */
  error: string | null
}

const NOT_REQUIRED_CELL: Omit<MatrixCell, 'courseId'> = {
  assignmentId: null,
  state: 'not_required',
  dueOn: null,
  daysOverdue: null,
  completedOn: null,
  expiresOn: null,
  supervisedOnly: false,
}

function cellFor(person: MatrixPerson, course: MatrixCourse): MatrixCell {
  return person.cells[course.id] ?? { ...NOT_REQUIRED_CELL, courseId: course.id }
}

function completionText(course: MatrixCourse): string {
  if (course.completionRate === null || course.requiredCount === 0) return 'Nobody needs this yet'
  const percent = Math.round(course.completionRate * 100)
  return `${course.completedCount} of ${course.requiredCount} done (${percent}%)`
}

function completionTone(course: MatrixCourse): 'primary' | 'success' | 'warning' {
  if (course.completionRate === null) return 'primary'
  if (course.completionRate >= 1) return 'success'
  return course.completionRate >= 0.5 ? 'primary' : 'warning'
}

/** One cell: the state's badge, with its dates underneath ("due 4 Nov 2026", "3 days"). */
function CellState({ cell }: { cell: MatrixCell }): React.JSX.Element {
  const described = describeDisplayState(cell.state, {
    dueOn: cell.dueOn,
    daysOverdue: cell.daysOverdue,
    expiresOn: cell.expiresOn,
  })
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={described.tone} title={described.text}>
        {described.label}
      </Badge>
      {described.detail ? <span className="text-xs text-text-muted">{described.detail}</span> : null}
      {cell.supervisedOnly ? <Badge tone={TRAINING_SUPERVISED_ONLY_BADGE.tone}>{TRAINING_SUPERVISED_ONLY_BADGE.label}</Badge> : null}
    </div>
  )
}

/** The person's name (to their Training tab), role and the flags that need a manager. */
function PersonSummary({ person }: { person: MatrixPerson }): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1">
      <Link href={employeeTrainingHref(person.employeeId)} className="font-semibold text-primary hover:underline">
        {person.name}
      </Link>
      <div className="text-xs text-text-muted">
        {person.jobTitle || 'No role'}
        {person.status === 'Started Separation' ? ' · Leaving' : ''}
      </div>
      {person.paused || person.flags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {person.paused ? (
            <Badge tone={TRAINING_DISPLAY_STATE_BADGE.paused.tone}>{TRAINING_DISPLAY_STATE_BADGE.paused.label}</Badge>
          ) : null}
          {person.flags.map((flag) => (
            <Badge key={flag} tone={TRAINING_PERSON_FLAG_BADGE[flag].tone}>
              {TRAINING_PERSON_FLAG_BADGE[flag].label}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The training matrix: Active and Started Separation staff down the side, live courses across,
 * each cell worded and coloured from the shared training labels. Phones get one card per person
 * instead of the grid, listing only the courses that apply to them.
 */
export function TrainingMatrixView({ matrix, error }: TrainingMatrixViewProps): React.JSX.Element {
  if (error || !matrix) {
    return (
      <Alert tone="danger" title="The training matrix could not be loaded">
        {error ?? 'Try again in a moment.'}
      </Alert>
    )
  }

  if (matrix.courses.length === 0) {
    return (
      <Card>
        <Empty
          size="sm"
          title="No live courses yet"
          description="Courses appear here once they are published on the Courses view."
        />
      </Card>
    )
  }

  if (matrix.people.length === 0) {
    return (
      <Card>
        <Empty size="sm" title="No active staff" description="Staff appear here once their record is Active." />
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader title="Completion by Course" subtitle="Valid completions against the people who need each course, paused staff left out" />
        <CardBody>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {matrix.courses.map((course) => (
              <li key={course.id} className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text-strong">{course.title}</span>
                  {course.isEssentials ? <Badge tone="primary">Essentials</Badge> : null}
                </div>
                <ProgressBar
                  value={course.completionRate === null ? 0 : Math.round(course.completionRate * 100)}
                  tone={completionTone(course)}
                  label={`${course.title}: ${completionText(course)}`}
                />
                <p className="text-xs text-text-muted">{completionText(course)}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* Phones: one entry per person, listing the courses that apply to them */}
      <Card padding="none" className="shell:hidden">
        <ul className="divide-y divide-border" aria-label="Training by person">
          {matrix.people.map((person) => {
            const applying = matrix.courses
              .map((course) => ({ course, cell: cellFor(person, course) }))
              .filter(({ cell }) => cell.state !== 'not_required')
            return (
              <li key={person.employeeId} className="space-y-3 px-pad-card py-3">
                <PersonSummary person={person} />
                {applying.length === 0 ? (
                  <p className="text-xs text-text-muted">No courses apply to them yet.</p>
                ) : (
                  <dl className="space-y-2">
                    {applying.map(({ course, cell }) => (
                      <div key={course.id} className="flex items-start justify-between gap-3">
                        <dt className="min-w-0 text-sm text-text">{course.title}</dt>
                        <dd className="shrink-0">
                          <CellState cell={cell} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      {/* Desktop: the grid */}
      <Card padding="none" className="hidden shell:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Staff</TableHead>
              {matrix.courses.map((course) => (
                <TableHead key={course.id}>{course.title}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.people.map((person) => (
              <TableRow key={person.employeeId}>
                <TableCell className="whitespace-normal align-top">
                  <PersonSummary person={person} />
                </TableCell>
                {matrix.courses.map((course) => (
                  <TableCell key={course.id} className="align-top">
                    <CellState cell={cellFor(person, course)} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}
