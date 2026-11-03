import { servedQuestion } from './draw'
import { TrainingError, type AttemptAnswers, type AttemptResult, type CheckResultItem, type CourseSection, type ServedQuestion } from './types'

/**
 * Marking a section check (build contract section 3, "Checks"). Scoring happens on the server
 * only; the browser never sees answers before it submits.
 */

/** What a marked check comes to. `answers` and `results` are stored on `training_attempts` as they are. */
export interface ScoreOutcome {
  passed: boolean
  wrongCount: number
  criticalMissed: number
  /** Question id to the ORIGINAL option index chosen (`training_attempts.answers`). */
  answers: AttemptAnswers
  /** In served order (`training_attempts.results`). */
  results: AttemptResult[]
}

/**
 * Marks a check. `answers` arrive as the DISPLAYED option index per question id and are mapped
 * back through each question's `optionOrder`. Pass = no critical question wrong and
 * `wrongCount <= section.check.maxWrong`. Throws a TrainingError 'invalid' when an answer is
 * missing, out of range, or for a question that was not served.
 */
export function scoreAttempt(input: {
  section: CourseSection
  served: readonly ServedQuestion[]
  answers: Readonly<Record<string, number>>
}): ScoreOutcome {
  const { section, served } = input
  const submitted = input.answers ?? {}
  const servedIds = new Set(served.map((item) => item.questionId))
  if (served.length === 0 || servedIds.size !== served.length) {
    throw new TrainingError('invalid', 'This check was not served properly. Start it again.')
  }
  for (const questionId of Object.keys(submitted)) {
    if (!servedIds.has(questionId)) {
      throw new TrainingError('invalid', `An answer was sent for a question that was not asked ("${questionId}")`)
    }
  }

  const answers: AttemptAnswers = {}
  const results: AttemptResult[] = served.map((item) => {
    const question = servedQuestion(section, item)
    const displayed = Object.prototype.hasOwnProperty.call(submitted, question.id) ? submitted[question.id] : undefined
    if (displayed === undefined || displayed === null) {
      throw new TrainingError('invalid', 'Answer every question before you submit.')
    }
    if (!Number.isInteger(displayed) || displayed < 0 || displayed >= item.optionOrder.length) {
      throw new TrainingError('invalid', `The answer to "${question.id}" is not one of its options`)
    }
    const chosen = item.optionOrder[displayed]
    answers[question.id] = chosen
    return { questionId: question.id, chosen, correct: chosen === question.answer, critical: question.critical }
  })

  const wrongCount = results.filter((result) => !result.correct).length
  const criticalMissed = results.filter((result) => !result.correct && result.critical).length
  return {
    passed: criticalMissed === 0 && wrongCount <= section.check.maxWrong,
    wrongCount,
    criticalMissed,
    answers,
    results,
  }
}

/**
 * The marked questions as the learner sees them after submitting: prompt, options and both
 * indexes in DISPLAYED order, right or wrong, critical, and the explanation. Served order.
 */
export function toCheckResultItems(
  section: CourseSection,
  served: readonly ServedQuestion[],
  outcome: Pick<ScoreOutcome, 'answers'>
): CheckResultItem[] {
  return served.map((item) => {
    const question = servedQuestion(section, item)
    const original = outcome.answers[question.id]
    const chosen = item.optionOrder.indexOf(original)
    if (original === undefined || chosen < 0) {
      throw new TrainingError('invalid', `No answer is recorded for "${question.id}"`)
    }
    const correctIndex = item.optionOrder.indexOf(question.answer)
    return {
      questionId: question.id,
      prompt: question.prompt,
      options: item.optionOrder.map((index) => question.options[index]),
      chosen,
      correctIndex,
      correct: chosen === correctIndex,
      critical: question.critical,
      explanation: question.explanation,
    }
  })
}
