'use client'

import { useState, useTransition } from 'react'
import { Alert, Card, CardBody, CardHeader, Switch, toast } from '@/ds'
import { setTrainingEmailsEnabled } from '@/app/actions/training-courses'
import { runTrainingAction } from './run-action'
import { useTrainingPermissions } from './use-training-permissions'

interface TrainingEmailsSwitchProps {
  /** The stored setting, or null when it could not be read. */
  enabled: boolean | null
  loadError: string | null
}

/**
 * The one switch for training emails: staff reminders and the manager's daily training email.
 * Off until the owner turns it on. Anyone who can see the page sees where it stands; only
 * holders of training publish can change it.
 */
export function TrainingEmailsSwitch({ enabled: initial, loadError }: TrainingEmailsSwitchProps): React.JSX.Element {
  const { canPublish } = useTrainingPermissions()
  const [enabled, setEnabled] = useState<boolean | null>(initial)
  const [pending, startTransition] = useTransition()

  const change = (next: boolean): void => {
    startTransition(async () => {
      const result = await runTrainingAction(
        () => setTrainingEmailsEnabled({ enabled: next }),
        'The setting could not be saved. Try again.',
      )
      if (result.error || !result.data) {
        toast.error(result.error ?? 'The setting could not be saved. Try again.')
        return
      }
      setEnabled(result.data.enabled)
      toast.success(result.data.enabled ? 'Training emails are on.' : 'Training emails are off.')
    })
  }

  return (
    <Card>
      <CardHeader
        title="Training Emails"
        subtitle="Reminders to staff and the manager's daily training email"
      />
      <CardBody className="space-y-4">
        {loadError || enabled === null ? (
          <Alert tone="danger" title="The setting could not be read">
            {loadError ?? 'Try again in a moment.'}
          </Alert>
        ) : (
          <>
            <Switch
              label={enabled ? 'Training emails are on' : 'Training emails are off'}
              checked={enabled}
              disabled={!canPublish || pending}
              onChange={change}
            />
            <p className="text-sm text-text-muted">
              {enabled
                ? 'Staff are reminded about training that is due, and the manager is emailed about new problems.'
                : 'No training reminders or manager training emails are sent. Certificates and signed copies are still emailed when someone confirms, and staff still see their training in the staff portal.'}
              {canPublish ? '' : ' Only someone who can publish courses can change this.'}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  )
}
