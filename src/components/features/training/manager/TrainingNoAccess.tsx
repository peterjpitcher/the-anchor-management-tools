import { Alert } from '@/ds'

/** What a page shows to someone whose role cannot see staff training. */
export function TrainingNoAccess(): React.JSX.Element {
  return (
    <Alert tone="warning" title="No Access to Training">
      Your role cannot see staff training records. Ask the owner if you need to.
    </Alert>
  )
}
