import { Alert, Badge, Card, CardBody, CardHeader, Empty, LinkButton } from '@/ds'
import { StandalonePageHeader } from '@/components/shells/StandaloneShell'
import { getMyTraining } from '@/app/actions/training-portal'
import { describeStaffDisplayState, formatTrainingDate, TRAINING_SUPERVISED_ONLY_BADGE } from '@/lib/training/labels'
import type { MyTrainingItem, MyTrainingView, MyTrainingWaitingReason } from '@/lib/training/types'

export const dynamic = 'force-dynamic'

const PAGE_TITLE = 'My Training'
const PAGE_SUBTITLE = 'Courses to do, and the ones you have done'

/** Why an item is waiting, in the person's own terms. */
const WAITING_WORDS: Record<MyTrainingWaitingReason, string> = {
  prerequisite: 'This opens when you finish the course that comes before it.',
  locked: 'A section is locked. Your manager will go through it with you and unlock it.',
  declined: 'You did not confirm this training. Your manager will talk it through with you.',
  practical: 'A manager will watch you do this at work and sign it off with you.',
  paused: 'Your training is paused for now. Your manager will tell you when it starts again.',
}

const ACTION_WORDS: Record<Exclude<MyTrainingItem['action'], 'none'>, string> = {
  start: 'Start',
  continue: 'Continue',
  confirm: 'Confirm',
}

function StateBadge({ item }: { item: MyTrainingItem }): React.JSX.Element {
  const described = describeStaffDisplayState(item.state, { dueOn: item.dueOn, expiresOn: item.expiresOn })
  return <Badge tone={described.tone}>{described.label}</Badge>
}

function ItemTitle({ item }: { item: MyTrainingItem }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-base font-semibold text-text-strong">{item.course.title}</p>
      {item.course.isEssentials ? <p className="text-sm text-text-muted">Essentials: do this one first</p> : null}
    </div>
  )
}

function DueItem({ item }: { item: MyTrainingItem }): React.JSX.Element {
  const details = [
    item.dueOn ? `Due by ${formatTrainingDate(item.dueOn)}` : 'No due date',
    item.sectionsTotal > 0 ? `${item.sectionsPassed} of ${item.sectionsTotal} sections passed` : null,
    item.course.estimatedMinutes ? `About ${item.course.estimatedMinutes} minutes` : null,
  ].filter((part): part is string => Boolean(part))

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 grow basis-48 space-y-1.5">
        <ItemTitle item={item} />
        {item.course.summary ? <p className="text-sm text-text">{item.course.summary}</p> : null}
        <p className="text-sm text-text-muted">{details.join('. ')}</p>
        <div className="flex flex-wrap gap-2">
          <StateBadge item={item} />
          {item.supervisedOnly ? <Badge tone={TRAINING_SUPERVISED_ONLY_BADGE.tone}>{TRAINING_SUPERVISED_ONLY_BADGE.label}</Badge> : null}
        </div>
      </div>
      {item.action === 'none' ? null : (
        <LinkButton href={`/portal/training/${item.assignmentId}`} variant="primary" size="lg" className="min-h-touch">
          {ACTION_WORDS[item.action]}
          <span className="sr-only">: {item.course.title}</span>
        </LinkButton>
      )}
    </li>
  )
}

function WaitingItem({ item }: { item: MyTrainingItem }): React.JSX.Element {
  // A practical sign-off has notes (the course's intro cards) to read before the manager
  // watches. They open read-only in the player; nothing is recorded by reading them.
  const hasNotes = item.course.kind === 'practical'
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 grow basis-48 space-y-1.5">
        <ItemTitle item={item} />
        <p className="text-sm text-text">{item.waitingReason ? WAITING_WORDS[item.waitingReason] : 'Waiting for your manager.'}</p>
        <div className="flex flex-wrap gap-2">
          <StateBadge item={item} />
          {item.supervisedOnly ? <Badge tone={TRAINING_SUPERVISED_ONLY_BADGE.tone}>{TRAINING_SUPERVISED_ONLY_BADGE.label}</Badge> : null}
        </div>
      </div>
      {hasNotes ? (
        <LinkButton href={`/portal/training/${item.assignmentId}`} variant="secondary" size="lg" className="min-h-touch">
          Read the notes
          <span className="sr-only">: {item.course.title}</span>
        </LinkButton>
      ) : null}
    </li>
  )
}

function DoneItem({ item }: { item: MyTrainingItem }): React.JSX.Element {
  const details = [
    item.completedOn ? `Passed on ${formatTrainingDate(item.completedOn)}` : null,
    item.expiresOn ? `Refresher due by ${formatTrainingDate(item.expiresOn)}` : 'No refresher needed',
  ].filter((part): part is string => Boolean(part))

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 grow basis-48 space-y-1.5">
        <ItemTitle item={item} />
        <p className="text-sm text-text-muted">{details.join('. ')}</p>
        <div className="flex flex-wrap gap-2">
          <StateBadge item={item} />
          {item.supervisedOnly ? <Badge tone={TRAINING_SUPERVISED_ONLY_BADGE.tone}>{TRAINING_SUPERVISED_ONLY_BADGE.label}</Badge> : null}
        </div>
      </div>
      {item.certificatePartyId ? (
        <LinkButton href={`/portal/documents/${item.certificatePartyId}`} variant="secondary" size="lg" className="min-h-touch">
          View certificate
          <span className="sr-only">: {item.course.title}</span>
        </LinkButton>
      ) : null}
    </li>
  )
}

/**
 * My Training: what is due (with dates, and Start or Continue), what is waiting for a manager,
 * and what is done (with the certificate). A load failure is said plainly and never shown as
 * "nothing to do".
 */
export default async function MyTrainingPage(): Promise<React.JSX.Element> {
  let view: MyTrainingView | null = null
  let loadError: string | null = null
  try {
    const result = await getMyTraining()
    if (result.data) view = result.data
    else loadError = result.error ?? 'Your training could not be loaded. Please try again in a moment.'
  } catch {
    loadError = 'Your training could not be loaded. Please try again in a moment.'
  }

  return (
    <>
      <StandalonePageHeader title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} />
      {loadError || !view ? (
        <Alert tone="danger">{loadError ?? 'Your training could not be loaded. Please try again in a moment.'}</Alert>
      ) : (
        <>
          <Alert tone="info" role="status">
            Training is paid working time. Do it on shift, or ask your manager for a training shift.
          </Alert>

          <Card>
            <CardHeader title="To Do" />
            <CardBody>
              {view.due.length === 0 ? (
                <Empty title="Nothing to do" description="You are up to date with your training." size="sm" />
              ) : (
                <ul className="divide-y divide-border">
                  {view.due.map((item) => (
                    <DueItem key={item.assignmentId} item={item} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {view.waiting.length > 0 ? (
            <Card>
              <CardHeader title="Waiting for a Manager" />
              <CardBody>
                <ul className="divide-y divide-border">
                  {view.waiting.map((item) => (
                    <WaitingItem key={item.assignmentId} item={item} />
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {view.done.length > 0 ? (
            <Card>
              <CardHeader title="Done" />
              <CardBody>
                <ul className="divide-y divide-border">
                  {view.done.map((item) => (
                    <DoneItem key={item.assignmentId} item={item} />
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </>
  )
}
