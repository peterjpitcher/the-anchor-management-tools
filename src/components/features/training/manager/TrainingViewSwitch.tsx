'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Segmented } from '@/ds'
import { TRAINING_VIEW_OPTIONS, trainingViewHref, type TrainingView } from './views'

interface TrainingViewSwitchProps {
  view: TrainingView
}

/** Matrix, Courses, Activity or Pay Report: one page, four views of the training records. */
export function TrainingViewSwitch({ view }: TrainingViewSwitchProps): React.JSX.Element {
  const router = useRouter()
  const [, startTransition] = useTransition()

  return (
    <Segmented
      size="sm"
      aria-label="Training view"
      options={TRAINING_VIEW_OPTIONS}
      value={view}
      onChange={(id) => startTransition(() => router.push(trainingViewHref(id as TrainingView)))}
    />
  )
}
