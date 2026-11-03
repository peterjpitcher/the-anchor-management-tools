import { CourseSectionSchema } from '@/lib/training/course-schema'
import type { CourseSection } from '@/lib/training/types'

/**
 * Fixtures shared by the engine tests (dates, draw, scoring, states, sync, reminders). Nothing
 * here touches a database or the clock.
 */

/** A seeded source of numbers in [0, 1) (mulberry32), so a draw can be repeated exactly. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface QuestionSpec {
  id: string
  objective: string
  critical?: boolean
  /** Index of the right option (default 1). */
  answer?: number
}

/**
 * A section in its validated shape (defaults filled by the real schema). Each question's options
 * are `<id> option 0..2` so a test can see which original option ended up where.
 */
export function makeSection(input: {
  key?: string
  objectives: string[]
  questions: QuestionSpec[]
  questionsPerAttempt?: number
  maxWrong?: number
}): CourseSection {
  return CourseSectionSchema.parse({
    key: input.key ?? 'fire-and-emergencies',
    title: 'Fire, 999 and first aid',
    objectives: input.objectives.map((key) => ({ key, text: `Objective ${key}` })),
    cards: [
      { type: 'paragraph', text: 'One idea on this card.' },
      { type: 'bullets', items: ['One', 'Two'] },
    ],
    check: {
      ...(input.questionsPerAttempt !== undefined ? { questionsPerAttempt: input.questionsPerAttempt } : {}),
      ...(input.maxWrong !== undefined ? { maxWrong: input.maxWrong } : {}),
    },
    questions: input.questions.map((question) => ({
      id: question.id,
      objective: question.objective,
      critical: question.critical ?? false,
      prompt: `Prompt for ${question.id}?`,
      options: [`${question.id} option 0`, `${question.id} option 1`, `${question.id} option 2`],
      answer: question.answer ?? 1,
      explanation: `Explanation for ${question.id}.`,
    })),
  })
}

/** Two objectives with four questions each; the first objective has two critical questions. */
export function standardSection(): CourseSection {
  return makeSection({
    objectives: ['raise-alarm', 'first-aid'],
    questions: [
      { id: 'alarm-01', objective: 'raise-alarm', critical: true },
      { id: 'alarm-02', objective: 'raise-alarm', critical: true },
      { id: 'alarm-03', objective: 'raise-alarm' },
      { id: 'alarm-04', objective: 'raise-alarm' },
      { id: 'aid-01', objective: 'first-aid' },
      { id: 'aid-02', objective: 'first-aid' },
      { id: 'aid-03', objective: 'first-aid' },
      { id: 'aid-04', objective: 'first-aid' },
    ],
  })
}
