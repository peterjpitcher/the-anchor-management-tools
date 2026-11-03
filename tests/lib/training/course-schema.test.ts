import { describe, expect, it } from 'vitest'
import {
  CourseContentSchema,
  DEFAULT_WINDOW_DAYS,
  defaultWindowDaysFor,
  describeCourseLocation,
  isSafeImageSrc,
  listCourseImageSrcs,
  maxRefresherWindowDays,
  objectiveDrawShares,
  validateCourse,
} from '@/lib/training/course-schema'
import { computeExpiresOn, computeWindowOpensOn } from '@/lib/training/dates'
import { shiftIsoDate } from '@/lib/dateUtils'
import type { CourseContentInput } from '@/lib/training/types'

// Built at run time so this file never holds the character itself.
const LONG_DASH = String.fromCharCode(0x2014)

type Json = Record<string, unknown>

function question(id: string, objective: string, critical = false): Json {
  return {
    id,
    objective,
    critical,
    prompt: `A customer asks about ${id}. What do you do?`,
    options: ['Tell them to wait', 'Help them straight away', 'Ignore it'],
    answer: 1,
    explanation: 'Help them straight away. It is quicker and safer.',
  }
}

/** A section with two objectives; each check draws 2 from each, so each needs 4 questions. */
function section(key: string, overrides: Json = {}): Json {
  return {
    key,
    title: `Section ${key}`,
    objectives: [
      { key: 'first-aim', text: 'Do the first thing well' },
      { key: 'second-aim', text: 'Do the second thing well' },
    ],
    cards: [
      { type: 'paragraph', text: 'One idea on this card.' },
      { type: 'bullets', title: 'Remember', items: ['One', 'Two'] },
    ],
    questions: [
      question(`${key}-01`, 'first-aim', true),
      question(`${key}-02`, 'first-aim', true),
      question(`${key}-03`, 'first-aim'),
      question(`${key}-04`, 'first-aim'),
      question(`${key}-05`, 'second-aim'),
      question(`${key}-06`, 'second-aim'),
      question(`${key}-07`, 'second-aim'),
      question(`${key}-08`, 'second-aim'),
    ],
    ...overrides,
  }
}

function onlineCourse(overrides: Json = {}): Json {
  return {
    schemaVersion: 1,
    slug: 'essentials',
    title: 'Essentials',
    summary: 'The things everyone needs on their first shift.',
    kind: 'online',
    audience: { groups: [], age: 'all' },
    essentials: true,
    deadline: { newStarterDays: 0, existingStaffDays: 14 },
    refresherMonths: 12,
    windowDays: 30,
    prerequisite: null,
    legalBasis: 'MHSWR 1999 reg 13; Fire Safety Order 2005 art 21.',
    estimatedMinutes: 25,
    intro: [{ type: 'callout', tone: 'info', title: 'Paid time', text: 'Do this on shift.' }],
    sections: [section('fire-and-emergencies'), section('allergens')],
    closing: [{ type: 'paragraph', text: 'Well done.' }],
    ...overrides,
  }
}

function practicalCourse(overrides: Json = {}): Json {
  return {
    schemaVersion: 1,
    slug: 'kegs',
    title: 'Changing a keg',
    summary: 'A manager watches you change a keg safely.',
    kind: 'practical',
    audience: { groups: ['bar'], age: 'all' },
    deadline: { newStarterDays: null, existingStaffDays: null },
    refresherMonths: 12,
    prerequisite: 'team-training',
    legalBasis: 'MHOR 1992; COSHH reg 12.',
    estimatedMinutes: 15,
    tasks: [
      { key: 'change-keg', text: 'Changes a keg safely: product off, dry route, trolley or team lift, test pour.' },
      { key: 'clean-coupler', text: 'Cleans the coupler before fitting it.' },
    ],
    supervisedOnlyUnder18: true,
    ...overrides,
  }
}

function sectionsOf(course: Json): Json[] {
  return course.sections as Json[]
}

describe('validateCourse: a valid course', () => {
  it('accepts a complete online course and fills defaults', () => {
    const result = validateCourse(onlineCourse(), { mode: 'publish' })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.gaps).toEqual([])
    expect(result.course?.sections[0].check).toEqual({ questionsPerAttempt: 4, maxWrong: 1 })
    expect(result.course?.tasks).toEqual([])
    expect(result.course?.supervisedOnlyUnder18).toBe(false)
  })

  it('fills in every optional field when it is left out', () => {
    const course = onlineCourse()
    for (const field of ['essentials', 'windowDays', 'prerequisite', 'intro', 'closing']) delete course[field]
    const result = validateCourse(course, { mode: 'draft' })
    expect(result.ok).toBe(true)
    expect(result.course).toMatchObject({ essentials: false, windowDays: 30, prerequisite: null, intro: [], closing: [] })
  })

  it('accepts a practical course with tasks and no sections', () => {
    const result = validateCourse(practicalCourse(), { mode: 'publish' })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.course?.kind).toBe('practical')
    expect(result.course?.sections).toEqual([])
    expect(result.course?.supervisedOnlyUnder18).toBe(true)
  })

  it('accepts every card type', () => {
    const cards = [
      { type: 'paragraph', title: 'Title', text: 'Text.' },
      { type: 'bullets', items: ['One'] },
      { type: 'do_dont', title: 'Lifting', do: ['Bend your knees'], dont: ['Twist'] },
      { type: 'callout', tone: 'manager', title: 'Managers', text: 'You are the appointed person.' },
      { type: 'table', columns: ['Day', 'Time'], rows: [['Monday', 'Check today']] },
      { type: 'steps', steps: [{ title: 'Raise the alarm', text: 'Shout fire.' }, { title: 'Get out', text: 'Use the nearest exit.' }] },
      { type: 'image', src: 'images/exit-map.png', alt: 'The fire exits marked on a floor plan', caption: 'Our exits' },
      { type: 'check_yourself', prompt: 'Who calls 999?', options: ['Anyone', 'Only managers', 'Nobody'], answer: 0, explanation: 'Anyone can.' },
    ]
    const result = validateCourse(onlineCourse({ sections: [section('fire', { cards })] }), { mode: 'draft' })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('reads a course from its JSON text', () => {
    const result = validateCourse(JSON.stringify(onlineCourse()), { mode: 'draft' })
    expect(result.ok).toBe(true)
  })

  it('types a course file as written', () => {
    const input: CourseContentInput = CourseContentSchema.parse(onlineCourse())
    expect(input.slug).toBe('essentials')
  })
})

describe('validateCourse: structure errors', () => {
  it('rejects text that is not JSON', () => {
    const result = validateCourse('{ not json', { mode: 'draft' })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/^course\.json is not valid JSON/)
    expect(result.course).toBeUndefined()
  })

  it('names a missing required field', () => {
    const course = onlineCourse()
    delete course.legalBasis
    const result = validateCourse(course, { mode: 'draft' })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('LegalBasis: Required')
  })

  it('rejects a bad slug and an unknown schema version', () => {
    const result = validateCourse(onlineCourse({ slug: 'Essentials Course', schemaVersion: 2 }), { mode: 'draft' })
    expect(result.errors.some((error) => error.startsWith('Slug: Use 2 to 60 lower-case'))).toBe(true)
    expect(result.errors.some((error) => error.startsWith('SchemaVersion:'))).toBe(true)
  })

  it('rejects an unknown field so a typo is caught', () => {
    const result = validateCourse(onlineCourse({ summery: 'typo' }), { mode: 'draft' })
    expect(result.errors).toContain('Course: Unknown field "summery"')
  })

  it('rejects an unknown card type and says where it is', () => {
    const cards = [{ type: 'video', src: 'a.mp4' }, { type: 'paragraph', text: 'Fine.' }]
    const result = validateCourse(onlineCourse({ sections: [section('fire', { cards })] }), { mode: 'draft' })
    expect(result.errors.some((error) => error.startsWith('Section 1 (fire), card 1, type: Unknown card type'))).toBe(true)
  })

  it('rejects a question without exactly three options', () => {
    const fire = section('fire')
    const questions = fire.questions as Json[]
    questions[0] = { ...questions[0], options: ['A', 'B'] }
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.errors).toContain('Section 1 (fire), question 1 (fire-01), options: Needs exactly 3 options')
  })

  it('rejects an answer that is not 0, 1 or 2', () => {
    const fire = section('fire')
    const questions = fire.questions as Json[]
    questions[2] = { ...questions[2], answer: 3 }
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.errors.some((error) => error.startsWith('Section 1 (fire), question 3 (fire-03), answer: Must be 0, 1 or 2'))).toBe(true)
  })

  it('rejects a section with one objective or one card', () => {
    const fire = section('fire', {
      objectives: [{ key: 'only-aim', text: 'Only one' }],
      cards: [{ type: 'paragraph', text: 'Just one.' }],
    })
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.errors).toContain('Section 1 (fire), objectives: Needs 2 to 4 objectives')
    expect(result.errors).toContain('Section 1 (fire), cards: Needs 2 to 20 cards')
  })

  it('rejects an unsafe image path', () => {
    const cards = [{ type: 'image', src: '../secret.png', alt: 'x' }, { type: 'paragraph', text: 'Fine.' }]
    const result = validateCourse(onlineCourse({ sections: [section('fire', { cards })] }), { mode: 'draft' })
    expect(result.errors.some((error) => error.startsWith('Section 1 (fire), card 1, src: Must be a relative path'))).toBe(true)
  })
})

describe('validateCourse: course rules', () => {
  it('refuses a refresher window as long as the refresher period, so a pass never opens its own refresher', () => {
    const tooLong = validateCourse(onlineCourse({ refresherMonths: 1, windowDays: 30 }), { mode: 'publish' })
    expect(tooLong.ok).toBe(false)
    expect(tooLong.errors).toContain(
      'WindowDays: must be 27 days or fewer for a 1-month refresher, or the refresher would open as soon as the course is passed'
    )
    // Left out, the window defaults to 30 days, which a 1-month refresher cannot take either.
    const defaulted = onlineCourse({ refresherMonths: 1 })
    delete defaulted.windowDays
    expect(validateCourse(defaulted, { mode: 'draft' }).ok).toBe(false)

    expect(validateCourse(onlineCourse({ refresherMonths: 1, windowDays: 27 }), { mode: 'publish' }).ok).toBe(true)
    expect(validateCourse(onlineCourse({ refresherMonths: 2, windowDays: 30 }), { mode: 'publish' }).ok).toBe(true)
    expect(validateCourse(onlineCourse({ refresherMonths: 12, windowDays: 180 }), { mode: 'publish' }).ok).toBe(true)
    expect(validateCourse(onlineCourse({ refresherMonths: null, windowDays: 180 }), { mode: 'publish' }).ok).toBe(true)
    expect(validateCourse(practicalCourse({ refresherMonths: 1, windowDays: 28 }), { mode: 'publish' }).ok).toBe(false)
  })

  it('keeps every allowed window opening after the day of the pass, for any pass date', () => {
    // Every day across a leap year and the years either side, for each short period.
    for (let months = 1; months <= 7; months += 1) {
      const windowDays = Math.min(180, maxRefresherWindowDays(months))
      for (let day = 0; day < 3 * 366; day += 1) {
        const passedOn = shiftIsoDate('2027-01-01', day) as string
        const expiresOn = computeExpiresOn(months, passedOn, null)
        const opensOn = computeWindowOpensOn(expiresOn, windowDays) as string
        expect(opensOn > passedOn, `${months} months, passed ${passedOn}, opens ${opensOn}`).toBe(true)
      }
    }
  })

  it('gives an external qualification the default window, shortened for a 1-month period', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(30)
    expect(defaultWindowDaysFor(null)).toBe(30)
    expect(defaultWindowDaysFor(1)).toBe(27)
    expect(defaultWindowDaysFor(2)).toBe(30)
    expect(defaultWindowDaysFor(36)).toBe(30)
  })

  it('rejects duplicate section keys, objective keys and question ids', () => {
    const one = section('fire')
    const two = section('fire')
    const objectives = one.objectives as Json[]
    objectives[1] = { key: 'first-aim', text: 'Again' }
    const result = validateCourse(onlineCourse({ sections: [one, two] }), { mode: 'draft' })
    expect(result.errors).toContain('Section 2 (fire), key: "fire" is used twice')
    expect(result.errors).toContain('Section 1 (fire), objective 2 (first-aim), key: "first-aim" is used twice in this section')
    expect(result.errors).toContain('Section 2 (fire), question 1 (fire-01), id: "fire-01" is used twice in the course')
  })

  it('rejects a question whose objective is not in its section', () => {
    const fire = section('fire')
    const questions = fire.questions as Json[]
    questions[0] = { ...questions[0], objective: 'missing-aim' }
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.errors).toContain('Section 1 (fire), question 1 (fire-01), objective: "missing-aim" is not an objective of this section')
  })

  it('needs twice the draw share of questions for every objective, so a resit can avoid repeats', () => {
    const fire = section('fire')
    fire.questions = (fire.questions as Json[]).filter((item) => item.id !== 'fire-08')
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Section 1 (fire), objective 2 (second-aim): needs at least 4 questions (each check asks 2, and a resit must not repeat them); it has 3'
    )
  })

  it('works the share out round-robin from the first objective', () => {
    const objectives = [
      { key: 'aim-one', text: 'One' },
      { key: 'aim-two', text: 'Two' },
      { key: 'aim-three', text: 'Three' },
    ]
    // Shares for 4 questions over 3 objectives are 2, 1, 1: so 4, 2 and 2 questions are enough.
    const questions = [
      question('q-01', 'aim-one'),
      question('q-02', 'aim-one'),
      question('q-03', 'aim-one'),
      question('q-04', 'aim-one'),
      question('q-05', 'aim-two'),
      question('q-06', 'aim-two'),
      question('q-07', 'aim-three'),
      question('q-08', 'aim-three'),
    ]
    const ok = validateCourse(onlineCourse({ sections: [section('fire', { objectives, questions })] }), { mode: 'draft' })
    expect(ok.errors).toEqual([])

    const short = validateCourse(
      onlineCourse({ sections: [section('fire', { objectives, questions: questions.filter((item) => item.id !== 'q-04') })] }),
      { mode: 'draft' }
    )
    expect(short.errors).toContain(
      'Section 1 (fire), objective 1 (aim-one): needs at least 4 questions (each check asks 2, and a resit must not repeat them); it has 3'
    )
  })

  it('needs at least two critical questions for an objective with any critical question', () => {
    const fire = section('fire')
    const questions = fire.questions as Json[]
    questions[1] = { ...questions[1], critical: false }
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.errors).toContain(
      'Section 1 (fire), objective 1 (first-aim): has 1 critical question; an objective with any critical question needs at least 2'
    )
  })

  it('keeps maxWrong below the number of questions and at least one question per objective', () => {
    const fire = section('fire', { check: { questionsPerAttempt: 1, maxWrong: 1 } })
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.errors).toContain('Section 1 (fire), check, maxWrong: must be less than questionsPerAttempt (1)')
    expect(result.errors).toContain('Section 1 (fire), check, questionsPerAttempt: a check must ask at least one question per objective (2)')
  })

  it('rejects two identical options', () => {
    const fire = section('fire')
    const questions = fire.questions as Json[]
    questions[0] = { ...questions[0], options: ['Same', 'Same', 'Different'] }
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.errors).toContain('Section 1 (fire), question 1 (fire-01), options: two options are the same')
  })

  it('rejects a table row with the wrong number of cells', () => {
    const cards = [
      { type: 'table', columns: ['Day', 'Time'], rows: [['Monday', 'Check today', 'Extra']] },
      { type: 'paragraph', text: 'Fine.' },
    ]
    const result = validateCourse(onlineCourse({ sections: [section('fire', { cards })] }), { mode: 'draft' })
    expect(result.errors).toContain('Section 1 (fire), card 1, row 1: has 3 cells but the table has 2 columns')
  })

  it('keeps online and practical courses apart', () => {
    const online = validateCourse(onlineCourse({ tasks: [{ key: 'task-one', text: 'Do it' }], supervisedOnlyUnder18: true }), {
      mode: 'draft',
    })
    expect(online.errors).toContain('Tasks: only a practical course has tasks')
    expect(online.errors).toContain('SupervisedOnlyUnder18: only a practical course can be supervised only for under-18s')

    const empty = validateCourse(onlineCourse({ sections: [] }), { mode: 'draft' })
    expect(empty.errors).toContain('Sections: an online course needs 1 to 12 sections')

    const practical = validateCourse(practicalCourse({ sections: [section('fire')], tasks: [] }), { mode: 'draft' })
    expect(practical.errors).toContain('Tasks: a practical course needs 1 to 20 tasks')
    expect(practical.errors).toContain('Sections: a practical course has tasks, not sections')
  })

  it('rejects duplicate task keys and a course that needs itself', () => {
    const result = validateCourse(
      practicalCourse({
        prerequisite: 'kegs',
        tasks: [
          { key: 'change-keg', text: 'One' },
          { key: 'change-keg', text: 'Two' },
        ],
      }),
      { mode: 'draft' }
    )
    expect(result.errors).toContain('Task 2 (change-keg), key: "change-keg" is used twice')
    expect(result.errors).toContain('Prerequisite: a course cannot need itself first')
  })

  it('rejects a group listed twice', () => {
    const result = validateCourse(onlineCourse({ audience: { groups: ['bar', 'bar'], age: 'adult' } }), { mode: 'draft' })
    expect(result.errors).toContain('Audience, groups: lists a group twice')
  })
})

describe('validateCourse: text rules', () => {
  it('rejects a long dash anywhere, says where, and never repeats the dash', () => {
    const fire = section('fire')
    const questions = fire.questions as Json[]
    questions[4] = { ...questions[4], explanation: `Raise the alarm ${LONG_DASH} always.` }
    const result = validateCourse(onlineCourse({ title: `Essentials ${LONG_DASH} 2026`, sections: [fire] }), { mode: 'draft' })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Title: contains a long dash. Use a comma, colon, brackets or a new sentence instead')
    expect(result.errors).toContain(
      'Section 1 (fire), question 5 (fire-05), explanation: contains a long dash. Use a comma, colon, brackets or a new sentence instead'
    )
    for (const error of result.errors) expect(error).not.toContain(LONG_DASH)
  })

  it('reports a long dash even when the structure is also wrong', () => {
    const course = onlineCourse({ summary: `Short ${LONG_DASH} sweet` })
    delete course.title
    const result = validateCourse(course, { mode: 'draft' })
    expect(result.errors).toContain('Summary: contains a long dash. Use a comma, colon, brackets or a new sentence instead')
    expect(result.errors).toContain('Title: Required')
  })

  it('rejects merge braces', () => {
    const result = validateCourse(onlineCourse({ summary: 'Hello {{first_name}}' }), { mode: 'draft' })
    expect(result.errors).toContain('Summary: contains {{ or }}. Courses have no merge fields; write the words out')
  })

  it('lists TO CONFIRM gaps in a draft without blocking it', () => {
    const fire = section('fire', {
      cards: [
        { type: 'paragraph', text: 'Meet at [[TO CONFIRM: the assembly point]].' },
        { type: 'bullets', items: ['Call [[TO CONFIRM: the duty manager number]]'] },
      ],
    })
    const result = validateCourse(onlineCourse({ sections: [fire] }), { mode: 'draft' })
    expect(result.ok).toBe(true)
    expect(result.course).toBeDefined()
    expect(result.gaps).toEqual([
      'Section 1 (fire), card 1, text: [[TO CONFIRM: the assembly point]]',
      'Section 1 (fire), card 2, item 1: [[TO CONFIRM: the duty manager number]]',
    ])
  })

  it('refuses to publish while a gap remains', () => {
    const result = validateCourse(onlineCourse({ summary: 'Due by [[TO CONFIRM: date]].' }), { mode: 'publish' })
    expect(result.ok).toBe(false)
    expect(result.course).toBeUndefined()
    expect(result.gaps).toEqual([])
    expect(result.errors).toContain('Summary: fill in [[TO CONFIRM: date]] before publishing')
  })

  it('warns about a card over 600 characters without blocking', () => {
    const cards = [{ type: 'paragraph', text: 'word '.repeat(130).trim() }, { type: 'paragraph', text: 'Short.' }]
    const result = validateCourse(onlineCourse({ sections: [section('fire', { cards })] }), { mode: 'publish' })
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual(['Section 1 (fire), card 1: has 649 characters; keep a card under 600 (one idea per card)'])
  })
})

describe('validateCourse: images', () => {
  const cards = [
    { type: 'image', src: 'images/exit-map.png', alt: 'Floor plan' },
    { type: 'image', src: 'images/extinguisher.jpg', alt: 'An extinguisher' },
  ]

  it('needs every image a card uses to be in the upload', () => {
    const result = validateCourse(onlineCourse({ sections: [section('fire', { cards })] }), {
      mode: 'draft',
      availableImages: ['images/exit-map.png'],
    })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(['Image "images/extinguisher.jpg" is used by a card but is not in the upload'])
  })

  it('does not check images when the upload list is not given', () => {
    expect(validateCourse(onlineCourse({ sections: [section('fire', { cards })] }), { mode: 'draft' }).ok).toBe(true)
  })

  it('lists each image once, in order', () => {
    const course = CourseContentSchema.parse(
      onlineCourse({
        intro: [{ type: 'image', src: 'images/cover.jpg', alt: 'Cover' }],
        sections: [section('fire', { cards: [...cards, cards[0]] })],
      })
    )
    expect(listCourseImageSrcs(course)).toEqual(['images/cover.jpg', 'images/exit-map.png', 'images/extinguisher.jpg'])
  })

  it('accepts only safe relative image paths', () => {
    expect(isSafeImageSrc('images/cover.jpg')).toBe(true)
    expect(isSafeImageSrc('cover.JPEG')).toBe(true)
    expect(isSafeImageSrc('a/b/c-1_2.webp')).toBe(true)
    expect(isSafeImageSrc('/images/cover.jpg')).toBe(false)
    expect(isSafeImageSrc('../cover.jpg')).toBe(false)
    expect(isSafeImageSrc('images/../cover.jpg')).toBe(false)
    expect(isSafeImageSrc('images/cover.svg')).toBe(false)
    expect(isSafeImageSrc('https://example.com/a.png')).toBe(false)
    expect(isSafeImageSrc('images/cover')).toBe(false)
  })
})

describe('objectiveDrawShares', () => {
  it('spreads the questions round-robin from the first objective', () => {
    expect(objectiveDrawShares(2, 4)).toEqual([2, 2])
    expect(objectiveDrawShares(3, 4)).toEqual([2, 1, 1])
    expect(objectiveDrawShares(4, 4)).toEqual([1, 1, 1, 1])
    expect(objectiveDrawShares(3, 5)).toEqual([2, 2, 1])
    expect(objectiveDrawShares(0, 4)).toEqual([])
  })
})

describe('describeCourseLocation', () => {
  it('words a path with keys and ids from the file', () => {
    const raw = onlineCourse()
    expect(describeCourseLocation(['sections', 1, 'questions', 2, 'prompt'], raw)).toBe(
      'Section 2 (allergens), question 3 (allergens-03), prompt'
    )
    expect(describeCourseLocation(['intro', 0, 'title'], raw)).toBe('Intro card 1, title')
    expect(describeCourseLocation([], raw)).toBe('Course')
    expect(describeCourseLocation(['sections', 0, 'cards', 0, 'rows', 1, 2])).toBe('Section 1, card 1, row 2, cell 3')
  })

  it('still reads when the file has no ids there', () => {
    expect(sectionsOf(onlineCourse()).length).toBe(2)
    expect(describeCourseLocation(['tasks', 0, 'text'], {})).toBe('Task 1, text')
  })
})
