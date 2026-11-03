'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  Empty,
  PageLoading,
  toast,
} from '@/ds'
import { getSigningDocumentsForSubject, startInPersonSigningAction } from '@/app/actions/signing'
import { getEmployeeTraining, prepareConfirmationAgain, resumeTraining } from '@/app/actions/training'
import {
  TRAINING_PAUSE_REASON_BADGE,
  TRAINING_PERSON_FLAG_BADGE,
  formatTrainingDate,
  trainingGroupsText,
} from '@/lib/training/labels'
import type { EmployeeAssignmentItem, EmployeeTrainingView } from '@/lib/training/types'
import { AssignTrainingDialog } from './manager/AssignTrainingDialog'
import { AssignmentItemView } from './manager/employee/AssignmentItemView'
import { InPersonLinkModal } from './manager/employee/InPersonLinkModal'
import { ItemDialog, type ItemDialogKind } from './manager/employee/ItemDialogs'
import type { ItemAction } from './manager/employee/item-actions'
import { AdjustmentDialog, GroupsDialog, PauseDialog } from './manager/employee/PersonDialogs'
import { ExternalDialog, SignoffDialog } from './manager/employee/RecordDialogs'
import { runTrainingAction } from './manager/run-action'
import { useTrainingPermissions } from './manager/use-training-permissions'

interface EmployeeTrainingTabProps {
  employeeId: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: EmployeeTrainingView }

type OpenDialog =
  | { kind: 'groups' }
  | { kind: 'adjustment' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'assign' }
  | { kind: 'external'; item: EmployeeAssignmentItem | null }
  | { kind: 'signoff'; item: EmployeeAssignmentItem }
  | { kind: 'prepare'; item: EmployeeAssignmentItem }
  | { kind: ItemDialogKind; item: EmployeeAssignmentItem }

const LOAD_FAILED = 'The training record could not be loaded.'
const IN_PERSON_FAILED = 'A new confirmation link could not be made. Try again.'

function isItemDialog(dialog: OpenDialog | null): dialog is { kind: ItemDialogKind; item: EmployeeAssignmentItem } {
  return dialog !== null && (dialog.kind === 'extend' || dialog.kind === 'waive' || dialog.kind === 'unlock')
}

/**
 * The Training tab on an employee record. It loads itself (which also brings the person's
 * training up to date), so the record page does not wait for it. Everyone who can see the tab
 * sees the record; the buttons show only for holders of training manage, and every action
 * checks that again on the server.
 */
export function EmployeeTrainingTab({ employeeId }: EmployeeTrainingTabProps): React.JSX.Element {
  const { canManage } = useTrainingPermissions()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [inPersonUrl, setInPersonUrl] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const load = useCallback(async (): Promise<void> => {
    const result = await runTrainingAction(() => getEmployeeTraining(employeeId), LOAD_FAILED)
    if (result.error || !result.data) {
      setState({ status: 'error', message: result.error ?? LOAD_FAILED })
      return
    }
    setState({ status: 'ready', view: result.data })
  }, [employeeId])

  useEffect(() => {
    void load()
  }, [load])

  const retry = (): void => {
    setState({ status: 'loading' })
    void load()
  }

  const finished = (): void => {
    setDialog(null)
    void load()
  }

  const onItemAction = (action: ItemAction, item: EmployeeAssignmentItem): void => {
    switch (action) {
      case 'extend':
      case 'waive':
      case 'unlock':
        setDialog({ kind: action, item })
        return
      case 'prepare_again':
        setDialog({ kind: 'prepare', item })
        return
      case 'record_signoff':
        setDialog({ kind: 'signoff', item })
        return
      case 'sign_in_person':
        signInPersonAgain(item)
        return
      case 'record_external':
        setDialog({ kind: 'external', item })
        return
    }
  }

  const resume = (): void => {
    setDialog(null)
    startTransition(async () => {
      const result = await runTrainingAction(() => resumeTraining({ employeeId }), 'Training could not be resumed. Try again.')
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Training resumed.')
      await load()
    })
  }

  const prepareAgain = (item: EmployeeAssignmentItem): void => {
    setDialog(null)
    startTransition(async () => {
      const result = await runTrainingAction(
        () => prepareConfirmationAgain({ assignmentId: item.assignment.id }),
        'The confirmation could not be prepared. Try again.',
      )
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('A new confirmation is ready for them in the staff portal.')
      await load()
    })
  }

  /**
   * A practical sign-off still waiting for the learner: their 30-minute in-person link may have
   * lapsed (they were called away). This makes a new one through the signing feature, for the
   * learner on the item's own document, and shows it as a code to scan, as after recording it.
   */
  const signInPersonAgain = (item: EmployeeAssignmentItem): void => {
    const documentId = item.certificate?.documentId
    if (!documentId) return
    startTransition(async () => {
      const documents = await runTrainingAction(() => getSigningDocumentsForSubject('employee', employeeId), IN_PERSON_FAILED)
      if (documents.error || !documents.data) {
        toast.error(documents.error ?? IN_PERSON_FAILED)
        return
      }
      const learner = documents.data
        .find((document) => document.id === documentId)
        ?.parties.find((party) => party.role === 'worker' && party.status === 'pending')
      if (!learner) {
        toast.error('This sign-off is no longer waiting for them to confirm it. The record has been refreshed.')
        await load()
        return
      }
      const started = await runTrainingAction(() => startInPersonSigningAction(learner.id), IN_PERSON_FAILED)
      if (started.error || !started.data) {
        toast.error(started.error ?? IN_PERSON_FAILED)
        return
      }
      setInPersonUrl(started.data.url)
    })
  }

  if (state.status === 'loading') {
    return (
      <Card>
        <CardBody>
          <PageLoading inline />
        </CardBody>
      </Card>
    )
  }

  if (state.status === 'error') {
    return (
      <Alert
        tone="danger"
        title="The training record could not be loaded"
        actions={
          <Button type="button" size="sm" variant="secondary" onClick={retry}>
            Try Again
          </Button>
        }
      >
        {state.message}
      </Alert>
    )
  }

  const { view } = state
  const name = view.employee.name
  const profile = view.profile

  const groupsValue = view.groupsConfirmed
    ? `${trainingGroupsText(view.groups)}${profile?.groupsConfirmedAt ? `, confirmed ${formatTrainingDate(profile.groupsConfirmedAt)}${profile.groupsConfirmedByName ? ` by ${profile.groupsConfirmedByName}` : ''}` : ''}`
    : `${view.suggestedGroups.length > 0 ? trainingGroupsText(view.suggestedGroups) : 'None suggested'} (suggested, not confirmed)`

  const about = [
    { key: 'groups', label: 'Training Groups', value: groupsValue },
    ...(view.groupsConfirmed
      ? [{ key: 'suggested', label: 'Suggested', value: view.suggestedGroups.length > 0 ? trainingGroupsText(view.suggestedGroups) : 'None' }]
      : []),
    {
      key: 'pause',
      label: 'Pause',
      value: view.pause
        ? `Paused from ${formatTrainingDate(view.pause.from)}${view.pause.until ? ` until ${formatTrainingDate(view.pause.until)}` : ' until resumed'} (${TRAINING_PAUSE_REASON_BADGE[view.pause.reason].label})`
        : 'Not paused',
    },
    ...(profile?.adjustmentNote ? [{ key: 'adjustment', label: 'Adjustment', value: profile.adjustmentNote }] : []),
  ]

  const externalCourse = dialog?.kind === 'external' && dialog.item ? dialog.item.course : null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Training"
          subtitle="Groups, what is due and everything done before"
          action={
            canManage ? (
              <Button type="button" size="sm" variant="primary" onClick={() => setDialog({ kind: 'assign' })}>
                Assign Training
              </Button>
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          {view.flags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {view.flags.map((flag) => (
                <Badge key={flag} tone={TRAINING_PERSON_FLAG_BADGE[flag].tone}>
                  {TRAINING_PERSON_FLAG_BADGE[flag].label}
                </Badge>
              ))}
            </div>
          ) : null}
          {view.flags.includes('no_login') ? (
            <Alert tone="warning">
              {name} has no staff portal login, so they cannot take online training until they have one.
            </Alert>
          ) : null}
          <DescriptionList items={about} columns={2} />
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'groups' })}>
                {view.groupsConfirmed ? 'Change Groups' : 'Confirm Groups'}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'adjustment' })}>
                {profile?.adjustmentNote ? 'Change Adjustment' : 'Set Adjustment'}
              </Button>
              {view.pause ? (
                <Button type="button" size="sm" variant="secondary" loading={pending} onClick={() => setDialog({ kind: 'resume' })}>
                  Resume Training
                </Button>
              ) : (
                <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'pause' })}>
                  Pause Training
                </Button>
              )}
              <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'external', item: null })}>
                Record External Qualification
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Current Training" subtitle="Open items, essentials first" />
        <CardBody>
          {view.current.length === 0 ? (
            <Empty size="sm" title="Nothing open" description="Every course that applies to them is done or not due yet." />
          ) : (
            <ul className="divide-y divide-border">
              {view.current.map((item) => (
                <AssignmentItemView
                  key={item.assignment.id}
                  item={item}
                  variant="current"
                  today={view.today}
                  canManage={canManage}
                  busy={pending}
                  onAction={onItemAction}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Training History" subtitle="Completed, waived and cancelled items, newest first" />
        <CardBody>
          {view.history.length === 0 ? (
            <Empty size="sm" title="No training history yet" description="Completed courses, sign-offs and qualifications appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {view.history.map((item) => (
                <AssignmentItemView
                  key={item.assignment.id}
                  item={item}
                  variant="history"
                  today={view.today}
                  canManage={canManage}
                  busy={pending}
                  onAction={onItemAction}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <>
          <AssignTrainingDialog
            open={dialog?.kind === 'assign'}
            onClose={() => setDialog(null)}
            courses={view.assignable}
            fixedEmployee={{ employeeId, name }}
            onAssigned={() => void load()}
          />
          <GroupsDialog
            open={dialog?.kind === 'groups'}
            employeeId={employeeId}
            employeeName={name}
            current={view.groups}
            suggested={view.suggestedGroups}
            onClose={() => setDialog(null)}
            onDone={finished}
          />
          <AdjustmentDialog
            open={dialog?.kind === 'adjustment'}
            employeeId={employeeId}
            employeeName={name}
            current={profile?.adjustmentNote ?? null}
            onClose={() => setDialog(null)}
            onDone={finished}
          />
          <PauseDialog
            open={dialog?.kind === 'pause'}
            employeeId={employeeId}
            employeeName={name}
            today={view.today}
            onClose={() => setDialog(null)}
            onDone={finished}
          />
          <ItemDialog
            kind={isItemDialog(dialog) ? dialog.kind : null}
            item={isItemDialog(dialog) ? dialog.item : null}
            onClose={() => setDialog(null)}
            onDone={finished}
          />
          <SignoffDialog
            item={dialog?.kind === 'signoff' ? dialog.item : null}
            employeeId={employeeId}
            employeeName={name}
            today={view.today}
            under18={view.employee.under18}
            onClose={() => setDialog(null)}
            onRecorded={(url) => {
              setDialog(null)
              setInPersonUrl(url)
              void load()
            }}
          />
          <ExternalDialog
            open={dialog?.kind === 'external'}
            employeeId={employeeId}
            employeeName={name}
            course={externalCourse}
            today={view.today}
            onClose={() => setDialog(null)}
            onDone={finished}
          />
          <ConfirmDialog
            open={dialog?.kind === 'resume'}
            onClose={() => setDialog(null)}
            onConfirm={resume}
            title="Resume Training"
            message={`Chasing starts again for ${name}. Each due date becomes the later of itself and 14 days from today.`}
            confirmLabel="Resume Training"
          />
          <ConfirmDialog
            open={dialog?.kind === 'prepare'}
            onClose={() => setDialog(null)}
            onConfirm={() => {
              if (dialog?.kind === 'prepare') prepareAgain(dialog.item)
            }}
            title="Prepare Confirmation Again"
            message={
              dialog?.kind === 'prepare'
                ? `A new confirmation for "${dialog.item.course.title}" is made for ${name} to confirm in the staff portal. Anything they declined stays on record.`
                : undefined
            }
            confirmLabel="Prepare Again"
          />
        </>
      ) : null}

      <InPersonLinkModal url={inPersonUrl} employeeName={name} onClose={() => setInPersonUrl(null)} />
    </div>
  )
}
