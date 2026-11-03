import type { CheckQuestionView, CheckResultItem, CourseCard } from '@/lib/training/types'

/**
 * Plain words for the course player: the heading each card shows, and what the read-aloud
 * button says. Pure, so it is tested on its own. Course text is data and is only ever rendered
 * as text, never as HTML.
 */

/** The card's own title, or null when the card has none (the screen then shows the section title). */
export function cardTitle(card: CourseCard): string | null {
  switch (card.type) {
    case 'paragraph':
    case 'bullets':
    case 'do_dont':
    case 'table':
    case 'steps':
      return card.title ?? null
    case 'callout':
      return card.title
    case 'check_yourself':
      return 'Check yourself'
    case 'image':
      return null
  }
}

/** Ends a spoken phrase with a full stop when it has no punctuation, so the voice pauses. */
function sentence(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return ''
  return /[.!?:;]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function joinSpoken(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map(sentence)
    .join(' ')
}

/** What a card says when read aloud, after its heading. Never the answer to a check-yourself card. */
export function cardBodySpeech(card: CourseCard): string {
  switch (card.type) {
    case 'paragraph':
      return joinSpoken([card.text])
    case 'callout':
      return joinSpoken([card.text])
    case 'bullets':
      return joinSpoken(card.items)
    case 'do_dont':
      return joinSpoken(['Do', ...card.do, "Don't", ...card.dont])
    case 'table':
      return joinSpoken(
        card.rows.map((row) =>
          row.map((cell, index) => (card.columns[index] ? `${card.columns[index]}: ${cell}` : cell)).join(', '),
        ),
      )
    case 'steps':
      return joinSpoken(card.steps.map((step, index) => `Step ${index + 1}, ${sentence(step.title)} ${step.text}`))
    case 'image':
      return joinSpoken([card.alt, card.caption])
    case 'check_yourself':
      return joinSpoken([card.prompt, ...card.options.map((option, index) => `Option ${index + 1}: ${option}`)])
  }
}

/** The whole of one card screen, heading first. */
export function cardScreenSpeech(heading: string, card: CourseCard): string {
  return joinSpoken([heading, cardBodySpeech(card)])
}

/** A whole check, read aloud: each question and its options, never the answers. */
export function checkSpeech(questions: readonly CheckQuestionView[]): string {
  return joinSpoken(
    questions.flatMap((question, index) => [
      `Question ${index + 1}: ${question.prompt}`,
      ...question.options.map((option, optionIndex) => `Option ${optionIndex + 1}: ${option}`),
    ]),
  )
}

/** The marked check, read aloud: the outcome, then each question with the right answer and why. */
export function resultsSpeech(summary: string, results: readonly CheckResultItem[]): string {
  return joinSpoken([
    summary,
    ...results.flatMap((item, index) => [
      `Question ${index + 1}: ${item.prompt}`,
      item.correct ? 'You got this right' : `You chose: ${item.options[item.chosen] ?? 'no answer'}`,
      item.correct ? null : `The right answer is: ${item.options[item.correctIndex] ?? ''}`,
      item.explanation,
    ]),
  ])
}
