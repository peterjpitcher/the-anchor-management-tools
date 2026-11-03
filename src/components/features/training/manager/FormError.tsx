'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from '@/ds'

/**
 * A dialog form's error. The DS Modal scrolls only its body and pins the footer, so a form that
 * has been scrolled down to its last field would show an error at the top of the body out of
 * view, and the footer's button would seem to do nothing. Each time an error is set (even the
 * same words again), it is brought into view.
 */
export interface FormErrorState {
  message: string | null
  /** Goes up by one each time an error is set, so the same message twice still reveals itself. */
  shown: number
}

const NO_ERROR: FormErrorState = { message: null, shown: 0 }

/** The error state for a dialog form and its setter. Setting null clears it. */
export function useFormError(): [FormErrorState, (message: string | null) => void] {
  const [state, setState] = useState<FormErrorState>(NO_ERROR)
  const setError = useCallback((message: string | null): void => {
    setState((current) =>
      message === null
        ? current.message === null
          ? current
          : { message: null, shown: current.shown }
        : { message, shown: current.shown + 1 },
    )
  }, [])
  return [state, setError]
}

interface FormErrorProps {
  error: FormErrorState
}

/** The red alert for a dialog form's error, scrolled into view whenever an error is set. */
export function FormError({ error }: FormErrorProps): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!error.message) return
    // Guarded: scrollIntoView is not everywhere (jsdom has none), and this is a help, never a
    // reason for the dialog to fail.
    const node = ref.current
    if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [error.shown, error.message])

  if (!error.message) return null
  return (
    <div ref={ref}>
      <Alert tone="danger">{error.message}</Alert>
    </div>
  )
}
