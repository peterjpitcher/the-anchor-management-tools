'use client'

import { Alert } from '@/ds'
import type { FohScheduleResponse } from '../types'

type LoadWarning = NonNullable<NonNullable<FohScheduleResponse['data']>['load_warnings']>[number]

// Private hires keep their own banner above this one, so they are not repeated here.
const WARNING_LABELS: Partial<Record<LoadWarning, string>> = {
  communal_event_seats: 'event seats on shared tables',
  standing_event_guests: 'standing event guests',
  event_names: 'event names on bookings',
  table_areas: 'table area names',
}

/**
 * Says which parts of the floor failed to load, because each one is otherwise drawn as if the
 * tables were free (BK-179). The schedule polls, so the banner clears itself once a load works.
 */
export function FohLoadWarningsBanner({ warnings }: { warnings?: LoadWarning[] }): React.ReactElement | null {
  const labels = Array.from(new Set(warnings ?? []))
    .map((warning) => WARNING_LABELS[warning])
    .filter((label): label is string => Boolean(label))
  if (labels.length === 0) return null

  return (
    <Alert tone="danger" title="Part of tonight's floor could not be loaded">
      These could not be loaded: {labels.join(', ')}. Tables may look free when they are not. Check before
      seating; the screen tries again on its next refresh.
    </Alert>
  )
}
