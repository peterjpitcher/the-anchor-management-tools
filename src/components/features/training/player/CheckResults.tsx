'use client'

import { Badge, Icon } from '@/ds'
import { cn } from '@/lib/utils'
import type { CheckResultView } from '@/lib/training/types'

/**
 * A marked check: whether the section was passed, then every question with the answer chosen,
 * the right answer when it was wrong, and the explanation. Indexes in the result are DISPLAYED
 * indexes, so they read straight off `options`.
 */

/** One plain sentence saying how the check went, also read aloud and announced. */
export function resultSummary(result: CheckResultView): string {
  const total = result.results.length
  const right = total - result.wrongCount
  const score = `You got ${right} of ${total} right.`
  if (result.passed) return `You passed this section. ${score}`
  if (result.criticalMissed > 0) {
    return `Not passed this time. ${score} You missed a must-know question, and you need all of those right.`
  }
  const allowed = result.maxWrong === 0 ? 'You need every answer right.' : `You can get ${result.maxWrong} wrong at most.`
  return `Not passed this time. ${score} ${allowed}`
}

export function CheckResults({ result }: { result: CheckResultView }): React.JSX.Element {
  return (
    <div className="space-y-4">
      {/* Announced as soon as the marks arrive, without moving the reader. */}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'rounded-default border p-4',
          result.passed ? 'border-success-border bg-success-soft text-success-fg' : 'border-warning-border bg-warning-soft text-warning-fg',
        )}
      >
        <p className="flex items-start gap-2 text-base font-semibold">
          <Icon name={result.passed ? 'checkCircle' : 'alertCircle'} size={20} className="mt-0.5 shrink-0" />
          <span>{resultSummary(result)}</span>
        </p>
      </div>

      <ol className="space-y-4">
        {result.results.map((item, index) => (
          <li key={item.questionId} className="rounded-default border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text-muted">Question {index + 1}</span>
              {item.critical ? <Badge tone="warning">Must know</Badge> : null}
            </div>
            <p className="mt-1 text-base font-semibold text-text-strong">{item.prompt}</p>
            <p className={cn('mt-2 flex items-start gap-1.5 text-base', item.correct ? 'text-success-fg' : 'text-danger-fg')}>
              <Icon name={item.correct ? 'check' : 'x'} size={18} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-semibold">{item.correct ? 'Right. ' : 'Not right. '}</span>
                Your answer: {item.options[item.chosen] ?? 'No answer'}
              </span>
            </p>
            {item.correct ? null : (
              <p className="mt-1 text-base text-text">
                <span className="font-semibold">The right answer: </span>
                {item.options[item.correctIndex] ?? ''}
              </p>
            )}
            <p className="mt-2 whitespace-pre-line text-base text-text">{item.explanation}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
