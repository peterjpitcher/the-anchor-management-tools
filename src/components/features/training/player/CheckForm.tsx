'use client'

import { useState } from 'react'
import { Alert, Button } from '@/ds'
import type { CheckQuestionView } from '@/lib/training/types'
import { AnswerOptions } from './AnswerOptions'

/**
 * The scored check at the end of a section: every question with its options as labelled radios,
 * and one Submit button. Answers are sent as the DISPLAYED option index per question; the server
 * (or previewScore) maps them back and marks them. No timer.
 */

interface CheckFormProps {
  questions: readonly CheckQuestionView[]
  /** Question id to the displayed option index chosen. */
  answers: Readonly<Record<string, number>>
  onAnswer: (questionId: string, index: number) => void
  /** Called only once every question has an answer. */
  onSubmit: () => void
  submitting: boolean
  /** Why the last submit failed, shown above the button. */
  submitError: string | null
}

function stillToAnswer(questions: readonly CheckQuestionView[], answers: Readonly<Record<string, number>>): number {
  return questions.filter((question) => typeof answers[question.id] !== 'number').length
}

export function CheckForm({ questions, answers, onAnswer, onSubmit, submitting, submitError }: CheckFormProps): React.JSX.Element {
  const [missingWarning, setMissingWarning] = useState<string | null>(null)
  const missing = stillToAnswer(questions, answers)

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (missing > 0) {
          setMissingWarning(
            missing === 1
              ? 'Answer every question first. 1 question still needs an answer.'
              : `Answer every question first. ${missing} questions still need an answer.`,
          )
          return
        }
        setMissingWarning(null)
        onSubmit()
      }}
    >
      {questions.map((question, index) => (
        <fieldset key={question.id} className="min-w-0 space-y-3">
          <legend className="text-base text-text-strong">
            <span className="block text-sm font-medium text-text-muted">
              Question {index + 1} of {questions.length}
            </span>
            <span className="mt-1 block font-semibold">{question.prompt}</span>
          </legend>
          <AnswerOptions
            name={`check-${question.id}`}
            options={question.options}
            value={typeof answers[question.id] === 'number' ? answers[question.id] : null}
            disabled={submitting}
            onChange={(choice) => {
              onAnswer(question.id, choice)
              if (missingWarning) setMissingWarning(null)
            }}
          />
        </fieldset>
      ))}

      {missingWarning && missing > 0 ? <Alert tone="warning">{missingWarning}</Alert> : null}
      {submitError ? <Alert tone="danger">{submitError}</Alert> : null}

      <Button type="submit" variant="primary" size="lg" className="min-h-touch w-full sm:w-auto" loading={submitting}>
        Submit my answers
      </Button>
    </form>
  )
}
