import { objectiveDrawShares } from './course-schema'
import { TrainingError, type CheckQuestionView, type CourseQuestion, type CourseSection, type ServedQuestion } from './types'

/**
 * Drawing a section check (build contract section 3, "Checks"). Pure apart from the random
 * source, which tests inject so every draw can be repeated exactly.
 */

/** A source of numbers in [0, 1). Tests inject a seeded one; production uses `cryptoRandom`. */
export type RandomSource = () => number

const UINT32_RANGE = 2 ** 32

/** A uniform number in [0, 1) from `crypto.getRandomValues`. */
export function cryptoRandom(): number {
  const values = new Uint32Array(1)
  globalThis.crypto.getRandomValues(values)
  return values[0] / UINT32_RANGE
}

/** A whole number in [0, size), safe against a source that returns 1 or a little outside the range. */
function randomIndex(random: RandomSource, size: number): number {
  const value = random()
  const index = Math.floor((Number.isFinite(value) ? value : 0) * size)
  return Math.min(Math.max(index, 0), size - 1)
}

/** A shuffled copy (Fisher-Yates). */
function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomIndex(random, i + 1)
    const held = copy[i]
    copy[i] = copy[j]
    copy[j] = held
  }
  return copy
}

/**
 * Draws one check for `section`:
 * - `section.check.questionsPerAttempt` questions, spread across the section's objectives with
 *   `objectiveDrawShares` from course-schema.ts (round-robin from the first objective), so the
 *   validator's pool rule and the draw agree;
 * - an objective with any critical question contributes at least one critical question;
 * - never a question in `previousQuestionIds` (the previous attempt of this section) unless the
 *   pool cannot fill the draw without it;
 * - each question's options shuffled; `optionOrder[displayedIndex]` is the original index.
 * Returns the questions in the order shown (shuffled, so objectives and critical questions are
 * not always in the same places).
 *
 * Beyond its one critical question, an objective's other picks come from its ordinary questions
 * while it has them, so each check spends one critical question per objective and a resit can
 * always serve a different one (which is why the validator asks for at least two).
 *
 * How a short pool is filled, in order: an objective short of fresh questions borrows fresh ones
 * from the other objectives (round-robin from the first), and only then repeats a question from
 * the previous attempt. Critical coverage comes before avoiding repeats: when every critical
 * question of an objective was in the previous attempt, one of them is served again (with its
 * options in a new order). A pool smaller than `questionsPerAttempt` serves every question it has;
 * the validator stops such a course being saved, so that only happens with bad data.
 */
export function drawQuestions(input: {
  section: CourseSection
  previousQuestionIds: readonly string[]
  random?: RandomSource
}): ServedQuestion[] {
  const { section } = input
  const random = input.random ?? cryptoRandom
  const previous = new Set(input.previousQuestionIds)
  const wanted = Math.min(section.check.questionsPerAttempt, section.questions.length)
  const shares = objectiveDrawShares(section.objectives.length, section.check.questionsPerAttempt)

  // Each objective's pool, shuffled once so every later pick is random but repeatable.
  const pools = section.objectives.map((objective) =>
    shuffled(
      section.questions.filter((question) => question.objective === objective.key),
      random
    )
  )
  const chosen = new Set<string>()
  const picked: CourseQuestion[] = []
  const take = (question: CourseQuestion | undefined): boolean => {
    if (!question || chosen.has(question.id) || picked.length >= wanted) return false
    chosen.add(question.id)
    picked.push(question)
    return true
  }
  const isFresh = (question: CourseQuestion) => !previous.has(question.id)
  // Ordinary questions before critical ones (each group keeps its shuffled order), so a check
  // spends one critical question per objective where it can and leaves the other fresh for a resit.
  const available = (pool: CourseQuestion[], fresh: boolean) => {
    const open = pool.filter((question) => !chosen.has(question.id) && isFresh(question) === fresh)
    return [...open.filter((question) => !question.critical), ...open.filter((question) => question.critical)]
  }

  // 1. Critical coverage: one critical question from each objective that has any.
  pools.forEach((pool, index) => {
    if ((shares[index] ?? 0) === 0) return
    const critical = pool.filter((question) => question.critical)
    if (critical.length === 0) return
    take(critical.find(isFresh) ?? critical[0])
  })

  // 2. Fresh questions first: each objective's share from its own, then any objective's,
  //    round-robin from the first. 3. Only then repeats, the same way.
  for (const fresh of [true, false]) {
    pools.forEach((pool, index) => {
      const share = shares[index] ?? 0
      let have = pool.filter((question) => chosen.has(question.id)).length
      for (const question of available(pool, fresh)) {
        if (have >= share) break
        if (take(question)) have += 1
      }
    })
    const queues = pools.map((pool) => available(pool, fresh))
    while (picked.length < wanted && queues.some((queue) => queue.length > 0)) {
      for (const queue of queues) {
        if (picked.length >= wanted) break
        take(queue.shift())
      }
    }
  }

  // Questions from a section objective that does not exist cannot be drawn by objective; the
  // validator refuses them, but serve them rather than come up short if one ever slips through.
  if (picked.length < wanted) {
    for (const question of shuffled(section.questions, random)) {
      if (picked.length >= wanted) break
      if (isFresh(question)) take(question)
    }
    for (const question of shuffled(section.questions, random)) {
      if (picked.length >= wanted) break
      take(question)
    }
  }

  return shuffled(picked, random).map((question) => ({
    questionId: question.id,
    optionOrder: shuffled(
      question.options.map((_, index) => index),
      random
    ),
  }))
}

/** The section's question for a served id, checked against what was served. */
export function servedQuestion(section: CourseSection, served: ServedQuestion): CourseQuestion {
  const question = section.questions.find((candidate) => candidate.id === served.questionId)
  if (!question) {
    throw new TrainingError('invalid', `Question "${served.questionId}" is not in section "${section.key}"`)
  }
  const order = served.optionOrder
  const isPermutation =
    Array.isArray(order) &&
    order.length === question.options.length &&
    order.every((value) => Number.isInteger(value) && value >= 0 && value < question.options.length) &&
    new Set(order).size === order.length
  if (!isPermutation) {
    throw new TrainingError('invalid', `Question "${served.questionId}" was served with an option order that does not fit it`)
  }
  return question
}

/**
 * The served questions as the learner sees them: prompt and options in displayed order, no
 * answer, no explanation. Throws a TrainingError 'invalid' when a served id is not in the section.
 */
export function toCheckQuestionViews(section: CourseSection, served: readonly ServedQuestion[]): CheckQuestionView[] {
  return served.map((item) => {
    const question = servedQuestion(section, item)
    return {
      id: question.id,
      prompt: question.prompt,
      options: item.optionOrder.map((original) => question.options[original]),
    }
  })
}
