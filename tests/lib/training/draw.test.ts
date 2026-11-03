import { describe, expect, it } from 'vitest'
import { cryptoRandom, drawQuestions, toCheckQuestionViews } from '@/lib/training/draw'
import type { CourseSection, ServedQuestion } from '@/lib/training/types'
import { TrainingError } from '@/lib/training/types'
import { makeSection, seededRandom, standardSection } from './engine-fixtures'

const SEEDS = Array.from({ length: 200 }, (_, index) => index + 1)

function objectiveOf(section: CourseSection, questionId: string): string {
  return section.questions.find((question) => question.id === questionId)!.objective
}

function isCritical(section: CourseSection, questionId: string): boolean {
  return section.questions.find((question) => question.id === questionId)!.critical
}

function ids(served: ServedQuestion[]): string[] {
  return served.map((item) => item.questionId)
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {})
}

describe('cryptoRandom', () => {
  it('gives numbers in [0, 1)', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = cryptoRandom()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('drawQuestions', () => {
  it('draws questionsPerAttempt different questions spread evenly across two objectives', () => {
    const section = standardSection()
    for (const seed of SEEDS) {
      const served = drawQuestions({ section, previousQuestionIds: [], random: seededRandom(seed) })
      expect(served).toHaveLength(4)
      expect(new Set(ids(served)).size).toBe(4)
      expect(countBy(ids(served).map((id) => objectiveOf(section, id)))).toEqual({ 'raise-alarm': 2, 'first-aid': 2 })
    }
  })

  it('spreads round-robin from the first objective when the draw does not divide evenly', () => {
    const section = makeSection({
      objectives: ['one', 'two', 'three'],
      questions: [
        ...['a', 'b', 'c', 'd'].map((suffix) => ({ id: `one-${suffix}`, objective: 'one' })),
        ...['a', 'b'].map((suffix) => ({ id: `two-${suffix}`, objective: 'two' })),
        ...['a', 'b'].map((suffix) => ({ id: `three-${suffix}`, objective: 'three' })),
      ],
    })
    for (const seed of SEEDS.slice(0, 50)) {
      const served = drawQuestions({ section, previousQuestionIds: [], random: seededRandom(seed) })
      expect(countBy(ids(served).map((id) => objectiveOf(section, id)))).toEqual({ one: 2, two: 1, three: 1 })
    }
  })

  it('always includes a critical question from an objective that has them', () => {
    const section = standardSection()
    for (const seed of SEEDS) {
      const served = drawQuestions({ section, previousQuestionIds: [], random: seededRandom(seed) })
      const fromAlarm = ids(served).filter((id) => objectiveOf(section, id) === 'raise-alarm')
      expect(fromAlarm.some((id) => isCritical(section, id))).toBe(true)
    }
  })

  it('spends one critical question per objective when ordinary ones can fill the rest', () => {
    const section = standardSection()
    for (const seed of SEEDS) {
      const served = drawQuestions({ section, previousQuestionIds: [], random: seededRandom(seed) })
      expect(ids(served).filter((id) => isCritical(section, id))).toHaveLength(1)
    }
  })

  it('uses critical questions to fill a share when an objective has no ordinary ones left', () => {
    const section = makeSection({
      objectives: ['allergens', 'records'],
      questions: [
        { id: 'allergy-1', objective: 'allergens', critical: true },
        { id: 'allergy-2', objective: 'allergens', critical: true },
        { id: 'allergy-3', objective: 'allergens', critical: true },
        { id: 'allergy-4', objective: 'allergens', critical: true },
        { id: 'records-1', objective: 'records' },
        { id: 'records-2', objective: 'records' },
        { id: 'records-3', objective: 'records' },
        { id: 'records-4', objective: 'records' },
      ],
    })
    for (const seed of SEEDS.slice(0, 50)) {
      const random = seededRandom(seed)
      const first = ids(drawQuestions({ section, previousQuestionIds: [], random }))
      const second = ids(drawQuestions({ section, previousQuestionIds: first, random }))
      expect(first.filter((id) => id.startsWith('allergy'))).toHaveLength(2)
      expect(second.filter((id) => first.includes(id))).toEqual([])
    }
  })

  it('never repeats a question from the previous attempt when the pool can avoid it', () => {
    const section = standardSection()
    for (const seed of SEEDS) {
      const random = seededRandom(seed)
      const first = drawQuestions({ section, previousQuestionIds: [], random })
      const second = drawQuestions({ section, previousQuestionIds: ids(first), random })
      expect(ids(second).filter((id) => ids(first).includes(id))).toEqual([])
      // The resit still has a critical question for the objective that has them.
      expect(ids(second).some((id) => isCritical(section, id))).toBe(true)
    }
  })

  it('serves a critical question again rather than drop critical coverage', () => {
    const section = standardSection()
    const previous = ['alarm-01', 'alarm-02', 'aid-01', 'aid-02']
    for (const seed of SEEDS.slice(0, 50)) {
      const served = ids(drawQuestions({ section, previousQuestionIds: previous, random: seededRandom(seed) }))
      const repeats = served.filter((id) => previous.includes(id))
      expect(repeats).toHaveLength(1)
      expect(['alarm-01', 'alarm-02']).toContain(repeats[0])
      expect(served).toHaveLength(4)
    }
  })

  it('borrows fresh questions from another objective before repeating one (small pool)', () => {
    const section = makeSection({
      objectives: ['big', 'small'],
      questions: [
        ...['1', '2', '3', '4', '5', '6'].map((n) => ({ id: `big-${n}`, objective: 'big' })),
        { id: 'small-1', objective: 'small' },
        { id: 'small-2', objective: 'small' },
      ],
    })
    const previous = ['big-1', 'big-2', 'small-1', 'small-2']
    for (const seed of SEEDS.slice(0, 50)) {
      const served = ids(drawQuestions({ section, previousQuestionIds: previous, random: seededRandom(seed) }))
      expect(served.sort()).toEqual(['big-3', 'big-4', 'big-5', 'big-6'])
    }
  })

  it('repeats questions only as far as needed when the pool cannot fill the draw fresh', () => {
    const section = makeSection({
      objectives: ['one', 'two'],
      questions: [
        { id: 'one-1', objective: 'one' },
        { id: 'one-2', objective: 'one' },
        { id: 'one-3', objective: 'one' },
        { id: 'two-1', objective: 'two' },
        { id: 'two-2', objective: 'two' },
      ],
    })
    const previous = ['one-1', 'one-2', 'two-1', 'two-2']
    for (const seed of SEEDS.slice(0, 50)) {
      const served = ids(drawQuestions({ section, previousQuestionIds: previous, random: seededRandom(seed) }))
      expect(served).toHaveLength(4)
      expect(new Set(served).size).toBe(4)
      expect(served).toContain('one-3')
      // Repeats still keep each objective to its share.
      expect(countBy(served.map((id) => objectiveOf(section, id)))).toEqual({ one: 2, two: 2 })
    }
  })

  it('serves every question it has when the pool is smaller than the draw', () => {
    const section = makeSection({
      objectives: ['one', 'two'],
      questions: [
        { id: 'one-1', objective: 'one', critical: true },
        { id: 'one-2', objective: 'one', critical: true },
        { id: 'two-1', objective: 'two' },
      ],
    })
    const served = ids(drawQuestions({ section, previousQuestionIds: ['one-1'], random: seededRandom(7) }))
    expect(served.sort()).toEqual(['one-1', 'one-2', 'two-1'])
  })

  it('draws a smaller check when the section asks for one', () => {
    const section = makeSection({
      objectives: ['one', 'two'],
      questionsPerAttempt: 2,
      questions: [
        { id: 'one-1', objective: 'one', critical: true },
        { id: 'one-2', objective: 'one', critical: true },
        { id: 'two-1', objective: 'two' },
        { id: 'two-2', objective: 'two' },
      ],
    })
    const served = ids(drawQuestions({ section, previousQuestionIds: [], random: seededRandom(3) }))
    expect(served).toHaveLength(2)
    expect(countBy(served.map((id) => objectiveOf(section, id)))).toEqual({ one: 1, two: 1 })
    expect(served.some((id) => isCritical(section, id))).toBe(true)
  })

  it('ignores previous ids that are not in the section (an older version)', () => {
    const section = standardSection()
    const withJunk = drawQuestions({ section, previousQuestionIds: ['gone-01', 'gone-02'], random: seededRandom(11) })
    const plain = drawQuestions({ section, previousQuestionIds: [], random: seededRandom(11) })
    expect(withJunk).toEqual(plain)
  })

  it('is deterministic for a given random source', () => {
    const section = standardSection()
    const a = drawQuestions({ section, previousQuestionIds: ['aid-01'], random: seededRandom(42) })
    const b = drawQuestions({ section, previousQuestionIds: ['aid-01'], random: seededRandom(42) })
    expect(a).toEqual(b)
    const others = SEEDS.slice(0, 20).map((seed) => JSON.stringify(drawQuestions({ section, previousQuestionIds: [], random: seededRandom(seed) })))
    expect(new Set(others).size).toBeGreaterThan(1)
  })

  it('shuffles each question options into a full permutation, and the answer lands everywhere', () => {
    const section = standardSection()
    const answerPositions = new Set<number>()
    const firstObjectives = new Set<string>()
    for (const seed of SEEDS) {
      const served = drawQuestions({ section, previousQuestionIds: [], random: seededRandom(seed) })
      for (const item of served) {
        expect([...item.optionOrder].sort()).toEqual([0, 1, 2])
        answerPositions.add(item.optionOrder.indexOf(1))
      }
      firstObjectives.add(objectiveOf(section, served[0].questionId))
    }
    expect(answerPositions).toEqual(new Set([0, 1, 2]))
    // The order shown is shuffled too, so critical questions are not always first.
    expect(firstObjectives).toEqual(new Set(['raise-alarm', 'first-aid']))
  })

  it('copes with a random source at the very edge of its range', () => {
    const section = standardSection()
    for (const edge of [() => 0, () => 0.9999999999, () => 1]) {
      const served = drawQuestions({ section, previousQuestionIds: [], random: edge })
      expect(new Set(ids(served)).size).toBe(4)
    }
  })

  it('uses crypto randomness when no source is given', () => {
    const served = drawQuestions({ section: standardSection(), previousQuestionIds: [] })
    expect(new Set(ids(served)).size).toBe(4)
  })
})

describe('toCheckQuestionViews', () => {
  it('shows prompts and options in displayed order with no answer or explanation', () => {
    const section = standardSection()
    const views = toCheckQuestionViews(section, [{ questionId: 'alarm-01', optionOrder: [2, 0, 1] }])
    expect(views).toEqual([
      { id: 'alarm-01', prompt: 'Prompt for alarm-01?', options: ['alarm-01 option 2', 'alarm-01 option 0', 'alarm-01 option 1'] },
    ])
    expect(Object.keys(views[0]).sort()).toEqual(['id', 'options', 'prompt'])
  })

  it('refuses a question that is not in the section', () => {
    const run = () => toCheckQuestionViews(standardSection(), [{ questionId: 'nope-01', optionOrder: [0, 1, 2] }])
    expect(run).toThrow(TrainingError)
    try {
      run()
    } catch (error) {
      expect((error as TrainingError).code).toBe('invalid')
    }
  })

  it('refuses an option order that does not fit the question', () => {
    const section = standardSection()
    expect(() => toCheckQuestionViews(section, [{ questionId: 'alarm-01', optionOrder: [0, 0, 1] }])).toThrow(TrainingError)
    expect(() => toCheckQuestionViews(section, [{ questionId: 'alarm-01', optionOrder: [0, 1] }])).toThrow(TrainingError)
    expect(() => toCheckQuestionViews(section, [{ questionId: 'alarm-01', optionOrder: [0, 1, 3] }])).toThrow(TrainingError)
  })
})
