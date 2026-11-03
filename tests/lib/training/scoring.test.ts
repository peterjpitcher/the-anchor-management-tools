import { describe, expect, it } from 'vitest'
import { drawQuestions } from '@/lib/training/draw'
import { scoreAttempt, toCheckResultItems } from '@/lib/training/scoring'
import { TrainingError, type ServedQuestion } from '@/lib/training/types'
import { makeSection, seededRandom, standardSection } from './engine-fixtures'

// Every question's right answer is original option 1 (see engine-fixtures).
const IDENTITY = [0, 1, 2]
const served: ServedQuestion[] = [
  { questionId: 'alarm-01', optionOrder: IDENTITY }, // critical
  { questionId: 'alarm-03', optionOrder: IDENTITY },
  { questionId: 'aid-01', optionOrder: IDENTITY },
  { questionId: 'aid-02', optionOrder: IDENTITY },
]
const allRight = { 'alarm-01': 1, 'alarm-03': 1, 'aid-01': 1, 'aid-02': 1 }

function errorCode(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof TrainingError ? error.code : 'other'
  }
}

describe('scoreAttempt', () => {
  const section = standardSection()

  it('passes with every answer right', () => {
    const outcome = scoreAttempt({ section, served, answers: allRight })
    expect(outcome).toMatchObject({ passed: true, wrongCount: 0, criticalMissed: 0 })
    expect(outcome.answers).toEqual(allRight)
    expect(outcome.results).toEqual([
      { questionId: 'alarm-01', chosen: 1, correct: true, critical: true },
      { questionId: 'alarm-03', chosen: 1, correct: true, critical: false },
      { questionId: 'aid-01', chosen: 1, correct: true, critical: false },
      { questionId: 'aid-02', chosen: 1, correct: true, critical: false },
    ])
  })

  it('passes with one ordinary question wrong', () => {
    const outcome = scoreAttempt({ section, served, answers: { ...allRight, 'aid-01': 0 } })
    expect(outcome).toMatchObject({ passed: true, wrongCount: 1, criticalMissed: 0 })
  })

  it('fails with two questions wrong', () => {
    const outcome = scoreAttempt({ section, served, answers: { ...allRight, 'aid-01': 0, 'aid-02': 2 } })
    expect(outcome).toMatchObject({ passed: false, wrongCount: 2, criticalMissed: 0 })
  })

  it('fails with a critical question wrong, even when it is the only one wrong', () => {
    const outcome = scoreAttempt({ section, served, answers: { ...allRight, 'alarm-01': 2 } })
    expect(outcome).toMatchObject({ passed: false, wrongCount: 1, criticalMissed: 1 })
  })

  it('follows the section rule when it allows no wrong answers', () => {
    const strict = makeSection({
      objectives: ['one', 'two'],
      maxWrong: 0,
      questions: [
        { id: 'one-1', objective: 'one' },
        { id: 'one-2', objective: 'one' },
        { id: 'one-3', objective: 'one' },
        { id: 'one-4', objective: 'one' },
        { id: 'two-1', objective: 'two' },
        { id: 'two-2', objective: 'two' },
        { id: 'two-3', objective: 'two' },
        { id: 'two-4', objective: 'two' },
      ],
    })
    const strictServed = ['one-1', 'one-2', 'two-1', 'two-2'].map((questionId) => ({ questionId, optionOrder: IDENTITY }))
    const answers = { 'one-1': 1, 'one-2': 1, 'two-1': 1, 'two-2': 0 }
    expect(scoreAttempt({ section: strict, served: strictServed, answers }).passed).toBe(false)
  })

  it('maps each displayed answer back through the option order', () => {
    // Shown as [option 2, option 0, option 1]: the right answer (original 1) is displayed third.
    const shuffled: ServedQuestion[] = [{ questionId: 'aid-03', optionOrder: [2, 0, 1] }]
    const right = scoreAttempt({ section, served: shuffled, answers: { 'aid-03': 2 } })
    expect(right.answers).toEqual({ 'aid-03': 1 })
    expect(right.results[0]).toEqual({ questionId: 'aid-03', chosen: 1, correct: true, critical: false })

    const wrong = scoreAttempt({ section, served: shuffled, answers: { 'aid-03': 0 } })
    expect(wrong.answers).toEqual({ 'aid-03': 2 })
    expect(wrong.results[0].correct).toBe(false)
  })

  it('marks a real draw correctly whatever order the options were shown in', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const drawn = drawQuestions({ section, previousQuestionIds: [], random: seededRandom(seed) })
      const answers = Object.fromEntries(drawn.map((item) => [item.questionId, item.optionOrder.indexOf(1)]))
      expect(scoreAttempt({ section, served: drawn, answers })).toMatchObject({ passed: true, wrongCount: 0 })
    }
  })

  it('refuses a missing answer', () => {
    const { 'aid-02': _left, ...missing } = allRight
    expect(errorCode(() => scoreAttempt({ section, served, answers: missing }))).toBe('invalid')
  })

  it('refuses an answer that is not one of the options', () => {
    for (const bad of [3, -1, 1.5, Number.NaN]) {
      expect(errorCode(() => scoreAttempt({ section, served, answers: { ...allRight, 'aid-02': bad } }))).toBe('invalid')
    }
  })

  it('refuses an answer for a question that was not served', () => {
    expect(errorCode(() => scoreAttempt({ section, served, answers: { ...allRight, 'aid-04': 1 } }))).toBe('invalid')
  })

  it('refuses a served question that is not in the section, and an empty or doubled check', () => {
    const stray = [...served.slice(0, 3), { questionId: 'gone-01', optionOrder: IDENTITY }]
    expect(errorCode(() => scoreAttempt({ section, served: stray, answers: { ...allRight, 'gone-01': 1 } }))).toBe('invalid')
    expect(errorCode(() => scoreAttempt({ section, served: [], answers: {} }))).toBe('invalid')
    const doubled = [served[0], served[0]]
    expect(errorCode(() => scoreAttempt({ section, served: doubled, answers: { 'alarm-01': 1 } }))).toBe('invalid')
  })
})

describe('toCheckResultItems', () => {
  const section = standardSection()

  it('shows every question in displayed order with the explanation', () => {
    const shuffled: ServedQuestion[] = [
      { questionId: 'alarm-02', optionOrder: [2, 0, 1] },
      { questionId: 'aid-04', optionOrder: [1, 2, 0] },
    ]
    const outcome = scoreAttempt({ section, served: shuffled, answers: { 'alarm-02': 0, 'aid-04': 0 } })
    expect(toCheckResultItems(section, shuffled, outcome)).toEqual([
      {
        questionId: 'alarm-02',
        prompt: 'Prompt for alarm-02?',
        options: ['alarm-02 option 2', 'alarm-02 option 0', 'alarm-02 option 1'],
        chosen: 0,
        correctIndex: 2,
        correct: false,
        critical: true,
        explanation: 'Explanation for alarm-02.',
      },
      {
        questionId: 'aid-04',
        prompt: 'Prompt for aid-04?',
        options: ['aid-04 option 1', 'aid-04 option 2', 'aid-04 option 0'],
        chosen: 0,
        correctIndex: 0,
        correct: true,
        critical: false,
        explanation: 'Explanation for aid-04.',
      },
    ])
  })

  it('works from the stored answers alone (original indexes)', () => {
    const shuffled: ServedQuestion[] = [{ questionId: 'aid-01', optionOrder: [2, 1, 0] }]
    const items = toCheckResultItems(section, shuffled, { answers: { 'aid-01': 1 } })
    expect(items[0]).toMatchObject({ chosen: 1, correctIndex: 1, correct: true })
  })

  it('refuses when an answer is missing from the record', () => {
    expect(errorCode(() => toCheckResultItems(section, served, { answers: {} }))).toBe('invalid')
  })
})
