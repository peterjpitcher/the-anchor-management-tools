import { z } from 'zod'
import {
  CALLOUT_TONE_VALUES,
  COURSE_FILE_KINDS,
  TRAINING_AUDIENCE_AGES,
  TRAINING_GROUPS,
  type CourseValidationMode,
  type CourseValidationResult,
} from './types'

/**
 * The course file format (`course.json`, build contract section 1) and its validator.
 *
 * Course content is data: every card is rendered by design-system components and no HTML is
 * ever injected, so the schema only accepts plain strings. Course files hold the answers, so they
 * are never committed to this repository (it is public); they are uploaded on the Courses page.
 *
 * The Zod schema checks structure only. `validateCourse` adds the rules a schema cannot express
 * (unique keys, objectives that exist, enough questions for a resit, no long dash, no merge
 * braces, the `[[TO CONFIRM: ...]]` gaps) and words every problem for the person uploading.
 *
 * Pure and browser-safe: no server-only imports.
 */

/** Slugs, section keys, objective keys, question ids and task keys. */
export const COURSE_KEY_PATTERN = /^[a-z0-9-]{2,60}$/

/** Image types a course may use. SVG is left out on purpose: it can carry script. */
export const COURSE_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const

/** A card whose text is longer than this gets a warning: one idea per card. */
const MAX_CARD_TEXT_CHARS = 600

/** Defaults for a section check when the file leaves `check` out. */
const DEFAULT_CHECK_RULE = { questionsPerAttempt: 4, maxWrong: 1 } as const

/** The refresher window, in days before expiry, when a course file leaves `windowDays` out. */
export const DEFAULT_WINDOW_DAYS = 30

/** Every month has at least this many days, so N months always span at least 28 x N days. */
const MIN_DAYS_IN_A_MONTH = 28

/**
 * The longest refresher window a refresher period allows: one day less than the shortest that
 * many months can be (28 days a month). The window opens `windowDays` before expiry, and expiry
 * is at least 28 x `refresherMonths` days after a pass, so the window always opens after the day
 * of the pass and a pass never opens its own refresher straight away. `maxRefresherWindowDays(1)`
 * is 27; from 2 months up it is above the default of 30.
 */
export function maxRefresherWindowDays(refresherMonths: number): number {
  return refresherMonths * MIN_DAYS_IN_A_MONTH - 1
}

/**
 * The window for a course set up with no window of its own (an external qualification recorded on
 * the Courses page): the default, shortened to `maxRefresherWindowDays` for a short period.
 */
export function defaultWindowDaysFor(refresherMonths: number | null): number {
  if (refresherMonths === null) return DEFAULT_WINDOW_DAYS
  return Math.min(DEFAULT_WINDOW_DAYS, maxRefresherWindowDays(refresherMonths))
}

/** A hard ceiling on any one string, so a broken file cannot store a novel in one field. */
const MAX_STRING_CHARS = 4000

// The long dash is built at run time so this file never contains the character itself.
const LONG_DASH = String.fromCharCode(0x2014)
const DRAFT_MARKER = /\[\[[^\]]*\]\]/g
const IMAGE_SRC_PATTERN = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.([A-Za-z0-9]+)$/

const text = z.string().trim().min(1, 'Must not be empty').max(MAX_STRING_CHARS)
const optionalTitle = z.string().trim().min(1, 'Must not be empty').max(200).optional()
const key = z.string().regex(COURSE_KEY_PATTERN, 'Use 2 to 60 lower-case letters, numbers or hyphens')
const threeOptions = z.array(text).length(3, 'Needs exactly 3 options')
const answerIndex = z.number().int().min(0).max(2, 'Must be 0, 1 or 2 (the position of the right option)')
const dayCount = z.number().int().min(0).max(365).nullable()

/** True when `src` is a safe relative path inside the upload with an allowed image type. */
export function isSafeImageSrc(src: string): boolean {
  const match = IMAGE_SRC_PATTERN.exec(src)
  if (!match) return false
  if (src.split('/').some((segment) => segment === '.' || segment === '..' || segment.startsWith('..'))) return false
  return (COURSE_IMAGE_EXTENSIONS as readonly string[]).includes(match[1].toLowerCase())
}

const imageSrc = z
  .string()
  .trim()
  .refine(isSafeImageSrc, 'Must be a relative path to a jpg, png, webp or gif in the upload, for example images/cover.jpg')

const ParagraphCardSchema = z.object({ type: z.literal('paragraph'), title: optionalTitle, text }).strict()

const BulletsCardSchema = z
  .object({ type: z.literal('bullets'), title: optionalTitle, items: z.array(text).min(1).max(12) })
  .strict()

const DoDontCardSchema = z
  .object({
    type: z.literal('do_dont'),
    title: optionalTitle,
    do: z.array(text).min(1).max(12),
    dont: z.array(text).min(1).max(12),
  })
  .strict()

const CalloutCardSchema = z
  .object({ type: z.literal('callout'), tone: z.enum(CALLOUT_TONE_VALUES), title: text, text })
  .strict()

const TableCardSchema = z
  .object({
    type: z.literal('table'),
    title: optionalTitle,
    columns: z.array(text).min(2).max(4),
    rows: z.array(z.array(text)).min(1).max(30),
  })
  .strict()

const StepsCardSchema = z
  .object({
    type: z.literal('steps'),
    title: optionalTitle,
    steps: z.array(z.object({ title: text, text }).strict()).min(2).max(9),
  })
  .strict()

const ImageCardSchema = z
  .object({ type: z.literal('image'), src: imageSrc, alt: text, caption: text.optional() })
  .strict()

const CheckYourselfCardSchema = z
  .object({ type: z.literal('check_yourself'), prompt: text, options: threeOptions, answer: answerIndex, explanation: text })
  .strict()

export const CourseCardSchema = z.discriminatedUnion('type', [
  ParagraphCardSchema,
  BulletsCardSchema,
  DoDontCardSchema,
  CalloutCardSchema,
  TableCardSchema,
  StepsCardSchema,
  ImageCardSchema,
  CheckYourselfCardSchema,
])

export const CourseObjectiveSchema = z.object({ key, text }).strict()

const CheckRuleSchema = z
  .object({
    questionsPerAttempt: z.number().int().min(1).max(12).default(DEFAULT_CHECK_RULE.questionsPerAttempt),
    maxWrong: z.number().int().min(0).max(11).default(DEFAULT_CHECK_RULE.maxWrong),
  })
  .strict()

export const CourseQuestionSchema = z
  .object({
    id: key,
    objective: key,
    critical: z.boolean().default(false),
    prompt: text,
    options: threeOptions,
    answer: answerIndex,
    explanation: text,
  })
  .strict()

export const CourseSectionSchema = z
  .object({
    key,
    title: z.string().trim().min(2).max(120),
    objectives: z.array(CourseObjectiveSchema).min(2, 'Needs 2 to 4 objectives').max(4, 'Needs 2 to 4 objectives'),
    cards: z.array(CourseCardSchema).min(2, 'Needs 2 to 20 cards').max(20, 'Needs 2 to 20 cards'),
    resitNote: text.optional(),
    check: CheckRuleSchema.default({}),
    questions: z.array(CourseQuestionSchema).min(1, 'Needs questions for the check'),
  })
  .strict()

export const PracticalTaskSchema = z.object({ key, text }).strict()

/** The whole `course.json`, structure only. `validateCourse` applies the remaining rules. */
export const CourseContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    slug: key,
    title: z.string().trim().min(2).max(120),
    summary: z.string().trim().min(1).max(400),
    kind: z.enum(COURSE_FILE_KINDS),
    audience: z
      .object({
        groups: z.array(z.enum(TRAINING_GROUPS)).max(TRAINING_GROUPS.length),
        age: z.enum(TRAINING_AUDIENCE_AGES).default('all'),
      })
      .strict(),
    essentials: z.boolean().default(false),
    deadline: z.object({ newStarterDays: dayCount, existingStaffDays: dayCount }).strict(),
    refresherMonths: z.number().int().min(1).max(120).nullable(),
    windowDays: z.number().int().min(0).max(180).default(DEFAULT_WINDOW_DAYS),
    prerequisite: key.nullable().default(null),
    legalBasis: z.string().trim().min(1).max(1000),
    estimatedMinutes: z.number().int().min(1).max(600),
    intro: z.array(CourseCardSchema).max(20).default([]),
    sections: z.array(CourseSectionSchema).max(12, 'An online course has 1 to 12 sections').default([]),
    tasks: z.array(PracticalTaskSchema).max(20, 'A practical course has 1 to 20 tasks').default([]),
    supervisedOnlyUnder18: z.boolean().default(false),
    closing: z.array(CourseCardSchema).max(20).default([]),
  })
  .strict()

/**
 * How many questions a check draws from each objective, in objective order: the
 * `questionsPerAttempt` spread round-robin from the first objective. The validator's pool rule
 * and `drawQuestions` (draw.ts) both use this, so what is checked is what is drawn.
 * `objectiveDrawShares(3, 4)` is `[2, 1, 1]`.
 */
export function objectiveDrawShares(objectiveCount: number, questionsPerAttempt: number): number[] {
  if (!Number.isInteger(objectiveCount) || objectiveCount <= 0) return []
  const base = Math.floor(questionsPerAttempt / objectiveCount)
  const extra = questionsPerAttempt % objectiveCount
  return Array.from({ length: objectiveCount }, (_, index) => base + (index < extra ? 1 : 0))
}

/** Every image `src` the course uses, once each, in the order they first appear. */
export function listCourseImageSrcs(course: z.infer<typeof CourseContentSchema>): string[] {
  const seen = new Set<string>()
  const cards = [...course.intro, ...course.sections.flatMap((section) => section.cards), ...course.closing]
  for (const card of cards) if (card.type === 'image') seen.add(card.src)
  return [...seen]
}

/** All the words on one card, for the length warning. */
function cardText(card: z.infer<typeof CourseCardSchema>): string {
  switch (card.type) {
    case 'paragraph':
      return [card.title, card.text].filter(Boolean).join(' ')
    case 'bullets':
      return [card.title, ...card.items].filter(Boolean).join(' ')
    case 'do_dont':
      return [card.title, ...card.do, ...card.dont].filter(Boolean).join(' ')
    case 'callout':
      return `${card.title} ${card.text}`
    case 'table':
      return [card.title, ...card.columns, ...card.rows.flat()].filter(Boolean).join(' ')
    case 'steps':
      return [card.title, ...card.steps.flatMap((step) => [step.title, step.text])].filter(Boolean).join(' ')
    case 'image':
      return [card.alt, card.caption].filter(Boolean).join(' ')
    case 'check_yourself':
      return [card.prompt, ...card.options, card.explanation].join(' ')
  }
}

type PathPart = string | number

const LIST_WORDS: Record<string, string> = {
  sections: 'Section',
  intro: 'Intro card',
  closing: 'Closing card',
  tasks: 'Task',
  cards: 'card',
  questions: 'question',
  objectives: 'objective',
  options: 'option',
  items: 'item',
  do: 'do item',
  dont: "don't item",
  columns: 'column',
  rows: 'row',
  steps: 'step',
  groups: 'group',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A place in the file in words: `Section 2 (fire-and-emergencies), question 3 (fire-03), explanation`.
 * Keys and ids are read from the raw file where they are present, so the author can find the spot.
 */
export function describeCourseLocation(path: readonly PathPart[], raw?: unknown): string {
  const words: string[] = []
  let node: unknown = raw
  for (let index = 0; index < path.length; index += 1) {
    const part = path[index]
    const next = path[index + 1]
    if (typeof part === 'string' && typeof next === 'number' && part in LIST_WORDS) {
      const list = isRecord(node) ? node[part] : undefined
      const item = Array.isArray(list) ? list[next] : undefined
      const id = isRecord(item) ? (typeof item.key === 'string' ? item.key : typeof item.id === 'string' ? item.id : null) : null
      const label = `${LIST_WORDS[part]} ${next + 1}`
      words.push(id ? `${label} (${id})` : label)
      node = item
      index += 1
      continue
    }
    if (typeof part === 'number') {
      words.push(`cell ${part + 1}`)
      node = Array.isArray(node) ? node[part] : undefined
      continue
    }
    words.push(part)
    node = isRecord(node) ? node[part] : undefined
  }
  if (words.length === 0) return 'Course'
  const [first, ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(', ')
}

/** Every string in the raw file with where it sits, so text rules apply even when structure fails. */
function walkStrings(value: unknown, path: PathPart[], visit: (text: string, path: PathPart[]) => void): void {
  if (typeof value === 'string') {
    visit(value, path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, [...path, index], visit))
    return
  }
  if (isRecord(value)) {
    for (const [name, item] of Object.entries(value)) walkStrings(item, [...path, name], visit)
  }
}

function zodMessage(issue: z.ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.received === 'undefined') return 'Required'
  if (issue.code === 'unrecognized_keys') return `Unknown field ${issue.keys.map((name) => `"${name}"`).join(', ')}`
  if (issue.code === 'invalid_union_discriminator') {
    return `Unknown card type. Use one of: ${issue.options.map(String).join(', ')}`
  }
  return issue.message
}

/**
 * Checks an uploaded course file. `json` is the parsed file or its text.
 *
 * - `mode: 'draft'`: a `[[TO CONFIRM: ...]]` gap is allowed and listed in `gaps`.
 * - `mode: 'publish'`: every gap is an error; publishing is refused until each is filled.
 * - `availableImages`: the image paths present in the upload. When given, an image card whose
 *   `src` is not among them is an error. The upload action passes it; a re-check of stored
 *   content can leave it out.
 *
 * `ok` is true when there are no errors; only then is `course` (the parsed file, defaults
 * filled in) returned. Warnings never block. Rules that need the database (the prerequisite
 * course exists and is live, the slug belongs to this course) are checked by the actions.
 */
export function validateCourse(
  json: unknown,
  options: { mode: CourseValidationMode; availableImages?: readonly string[] }
): CourseValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const gaps: string[] = []

  let raw = json
  if (typeof json === 'string') {
    try {
      raw = JSON.parse(json)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unreadable'
      return { ok: false, errors: [`course.json is not valid JSON (${reason})`], warnings, gaps }
    }
  }

  // Text rules run on the raw file so they are reported even when the structure is wrong.
  walkStrings(raw, [], (value, path) => {
    const where = describeCourseLocation(path, raw)
    if (value.includes(LONG_DASH)) {
      errors.push(`${where}: contains a long dash. Use a comma, colon, brackets or a new sentence instead`)
    }
    if (value.includes('{{') || value.includes('}}')) {
      errors.push(`${where}: contains {{ or }}. Courses have no merge fields; write the words out`)
    }
    for (const marker of value.match(DRAFT_MARKER) ?? []) {
      if (options.mode === 'publish') errors.push(`${where}: fill in ${marker} before publishing`)
      else gaps.push(`${where}: ${marker}`)
    }
  })

  const parsed = CourseContentSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${describeCourseLocation(issue.path, raw)}: ${zodMessage(issue)}`)
    }
    return { ok: false, errors, warnings, gaps }
  }

  const course = parsed.data
  const at = (path: PathPart[]) => describeCourseLocation(path, raw)

  if (course.prerequisite === course.slug) errors.push(`${at(['prerequisite'])}: a course cannot need itself first`)
  if (course.refresherMonths !== null && course.windowDays > maxRefresherWindowDays(course.refresherMonths)) {
    errors.push(
      `${at(['windowDays'])}: must be ${maxRefresherWindowDays(course.refresherMonths)} days or fewer for a ${course.refresherMonths}-month refresher, or the refresher would open as soon as the course is passed`
    )
  }
  if (new Set(course.audience.groups).size !== course.audience.groups.length) {
    errors.push(`${at(['audience', 'groups'])}: lists a group twice`)
  }

  if (course.kind === 'online') {
    if (course.sections.length === 0) errors.push(`${at(['sections'])}: an online course needs 1 to 12 sections`)
    if (course.tasks.length > 0) errors.push(`${at(['tasks'])}: only a practical course has tasks`)
    if (course.supervisedOnlyUnder18) {
      errors.push(`${at(['supervisedOnlyUnder18'])}: only a practical course can be supervised only for under-18s`)
    }
  } else {
    if (course.tasks.length === 0) errors.push(`${at(['tasks'])}: a practical course needs 1 to 20 tasks`)
    if (course.sections.length > 0) errors.push(`${at(['sections'])}: a practical course has tasks, not sections`)
  }

  const taskKeys = new Set<string>()
  course.tasks.forEach((task, index) => {
    if (taskKeys.has(task.key)) errors.push(`${at(['tasks', index, 'key'])}: "${task.key}" is used twice`)
    taskKeys.add(task.key)
  })

  const sectionKeys = new Set<string>()
  const questionIds = new Set<string>()
  course.sections.forEach((section, sectionIndex) => {
    const here = (path: PathPart[]) => at(['sections', sectionIndex, ...path])
    if (sectionKeys.has(section.key)) errors.push(`${here(['key'])}: "${section.key}" is used twice`)
    sectionKeys.add(section.key)

    const objectiveKeys = section.objectives.map((objective) => objective.key)
    section.objectives.forEach((objective, index) => {
      if (objectiveKeys.indexOf(objective.key) !== index) {
        errors.push(`${here(['objectives', index, 'key'])}: "${objective.key}" is used twice in this section`)
      }
    })

    const { questionsPerAttempt, maxWrong } = section.check
    if (maxWrong >= questionsPerAttempt) {
      errors.push(`${here(['check', 'maxWrong'])}: must be less than questionsPerAttempt (${questionsPerAttempt})`)
    }
    if (questionsPerAttempt < section.objectives.length) {
      errors.push(
        `${here(['check', 'questionsPerAttempt'])}: a check must ask at least one question per objective (${section.objectives.length})`
      )
    }

    section.questions.forEach((question, index) => {
      if (questionIds.has(question.id)) errors.push(`${here(['questions', index, 'id'])}: "${question.id}" is used twice in the course`)
      questionIds.add(question.id)
      if (!objectiveKeys.includes(question.objective)) {
        errors.push(`${here(['questions', index, 'objective'])}: "${question.objective}" is not an objective of this section`)
      }
      if (new Set(question.options).size !== question.options.length) {
        errors.push(`${here(['questions', index, 'options'])}: two options are the same`)
      }
    })

    // Enough questions per objective that a resit can be drawn without repeating the last check.
    const shares = objectiveDrawShares(section.objectives.length, questionsPerAttempt)
    section.objectives.forEach((objective, index) => {
      const pool = section.questions.filter((question) => question.objective === objective.key)
      const needed = 2 * (shares[index] ?? 0)
      if (pool.length < needed) {
        errors.push(
          `${here(['objectives', index])}: needs at least ${needed} questions (each check asks ${shares[index]}, and a resit must not repeat them); it has ${pool.length}`
        )
      }
      const critical = pool.filter((question) => question.critical).length
      if (critical > 0 && critical < 2) {
        errors.push(`${here(['objectives', index])}: has 1 critical question; an objective with any critical question needs at least 2`)
      }
    })

    section.cards.forEach((card, index) => checkCard(card, ['sections', sectionIndex, 'cards', index]))
  })

  course.intro.forEach((card, index) => checkCard(card, ['intro', index]))
  course.closing.forEach((card, index) => checkCard(card, ['closing', index]))

  if (options.availableImages) {
    const available = new Set(options.availableImages)
    for (const src of listCourseImageSrcs(course)) {
      if (!available.has(src)) errors.push(`Image "${src}" is used by a card but is not in the upload`)
    }
  }

  function checkCard(card: z.infer<typeof CourseCardSchema>, path: PathPart[]): void {
    if (card.type === 'table') {
      card.rows.forEach((row, index) => {
        if (row.length !== card.columns.length) {
          errors.push(`${at([...path, 'rows', index])}: has ${row.length} cells but the table has ${card.columns.length} columns`)
        }
      })
    }
    if (card.type === 'check_yourself' && new Set(card.options).size !== card.options.length) {
      errors.push(`${at([...path, 'options'])}: two options are the same`)
    }
    const length = cardText(card).length
    if (length > MAX_CARD_TEXT_CHARS) {
      warnings.push(`${at(path)}: has ${length} characters; keep a card under ${MAX_CARD_TEXT_CHARS} (one idea per card)`)
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings, gaps }
  return { ok: true, course, errors, warnings, gaps }
}
