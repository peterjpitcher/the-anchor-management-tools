'use client'

import { useRef, useState, useTransition } from 'react'
import { Alert, Card, CardBody, CardHeader, ConfirmDialog, Switch, toast } from '@/ds'
import { previewTrainingAutoAssign, setTrainingAutoAssignEnabled } from '@/app/actions/training-courses'
import type { AutoAssignPreview } from '@/lib/training/types'
import { runTrainingAction } from './run-action'
import { useTrainingPermissions } from './use-training-permissions'

interface TrainingAutoAssignSwitchProps {
  /** The stored setting, or null when it could not be read. */
  enabled: boolean | null
  loadError: string | null
}

/** What switching on would give out, while the confirmation is open. */
type PreviewState = { status: 'loading' } | { status: 'ready'; preview: AutoAssignPreview } | { status: 'error'; message: string }

/** What the switch means while it is off. */
const AUTO_ASSIGN_OFF_TEXT =
  'Nobody is given a course unless a manager assigns it on their Training tab. New starters, newly published courses, yearly refreshers and redo requests wait until this is switched on.'

const SAVE_FAILED = 'The setting could not be saved. Try again.'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** The count in the confirmation, in words. */
function previewText(state: PreviewState): string {
  if (state.status === 'loading') return 'Counting what would be given out...'
  if (state.status === 'error') return `${state.message} Switch it on only if you are sure.`
  const { preview } = state
  if (preview.items === 0) return 'Nothing would be given out today. New starters, refreshers and redo requests are given out as they come up.'
  const parts = [
    preview.firstCourses ? plural(preview.firstCourses, 'first course', 'first courses') : null,
    preview.refreshers ? plural(preview.refreshers, 'refresher', 'refreshers') : null,
    preview.redos ? plural(preview.redos, 'redo', 'redos') : null,
    preview.released ? plural(preview.released, 'waiting item released', 'waiting items released') : null,
  ].filter((part): part is string => part !== null)
  return `Today that would give out ${plural(preview.items, 'item', 'items')} to ${plural(preview.people, 'person', 'people')}: ${parts.join(', ')}.`
}

/**
 * The switch for giving courses to staff automatically: new starters, newly published courses,
 * refreshers and redo requests. Off until it is turned on, and off when it cannot be read.
 * Anyone who can see the page sees where it stands; only holders of training publish can change
 * it. Switching on asks first, with a count of what would be given out, because switching off
 * again takes nothing back; switching off is one click.
 */
export function TrainingAutoAssignSwitch({ enabled: initial, loadError }: TrainingAutoAssignSwitchProps): React.JSX.Element {
  const { canPublish } = useTrainingPermissions()
  const [enabled, setEnabled] = useState<boolean | null>(initial)
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  // Only the latest count is shown if the confirmation is closed and opened again quickly.
  const previewRequest = useRef(0)

  const save = async (next: boolean): Promise<void> => {
    const result = await runTrainingAction(() => setTrainingAutoAssignEnabled({ enabled: next }), SAVE_FAILED)
    if (result.error || !result.data) {
      toast.error(result.error ?? SAVE_FAILED)
      return
    }
    setEnabled(result.data.enabled)
    toast.success(result.data.enabled ? 'Automatic assignment is on.' : 'Automatic assignment is off.')
  }

  const askToSwitchOn = (): void => {
    const request = previewRequest.current + 1
    previewRequest.current = request
    setPreview({ status: 'loading' })
    setConfirming(true)
    void runTrainingAction(() => previewTrainingAutoAssign(), 'What would be given out could not be counted.').then((result) => {
      if (previewRequest.current !== request) return
      setPreview(
        result.data
          ? { status: 'ready', preview: result.data }
          : { status: 'error', message: result.error ?? 'What would be given out could not be counted.' }
      )
    })
  }

  const change = (next: boolean): void => {
    if (next) {
      askToSwitchOn()
      return
    }
    startTransition(() => save(false))
  }

  return (
    <Card>
      <CardHeader
        title="Automatic Assignment"
        subtitle="Giving courses to staff without a manager choosing them"
      />
      <CardBody className="space-y-4">
        {loadError || enabled === null ? (
          <Alert tone="danger" title="The setting could not be read">
            {loadError ?? 'Try again in a moment.'} Until it can be read, it is treated as off.
          </Alert>
        ) : (
          <>
            <Switch
              label={enabled ? 'Automatic assignment is on' : 'Automatic assignment is off'}
              checked={enabled}
              disabled={!canPublish || pending || confirming}
              onChange={change}
            />
            <p className="text-sm text-text-muted">
              {enabled
                ? 'Everyone a course applies to is given it: new starters, newly published courses, yearly refreshers and redo requests, each with its due date.'
                : AUTO_ASSIGN_OFF_TEXT}
              {canPublish ? '' : ' Only someone who can publish courses can change this.'}
            </p>
          </>
        )}
      </CardBody>

      <ConfirmDialog
        open={confirming}
        onClose={() => {
          previewRequest.current += 1
          setConfirming(false)
        }}
        onConfirm={() => save(true)}
        title="Switch On Automatic Assignment"
        message={
          <div className="space-y-2">
            <p>
              At the next check, every live course is given to everyone it applies to, with its due date, along with any
              refreshers and redo requests owed. The next check is the daily run at 9am (10am in summer), or sooner: as soon
              as a manager opens someone&apos;s Training tab or a member of staff opens My Training.
            </p>
            <p>Each item shows in that person&apos;s My Training straight away.</p>
            <p>{previewText(preview)}</p>
            <p>Switching it off later stops anything new, but does not take back what has been given out.</p>
          </div>
        }
        confirmLabel="Switch On"
        cancelLabel="Leave Off"
        tone="danger"
      />
    </Card>
  )
}
