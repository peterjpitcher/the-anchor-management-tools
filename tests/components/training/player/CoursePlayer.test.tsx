import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CheckResultView, CourseCard, PlayerCourseView } from '@/lib/training/types'

const portal = vi.hoisted(() => ({
  getMyTraining: vi.fn(),
  getMyAssignment: vi.fn(),
  saveTrainingProgress: vi.fn(),
  startTrainingCheck: vi.fn(),
  submitTrainingCheck: vi.fn(),
  prepareMyConfirmation: vi.fn(),
}))
const courses = vi.hoisted(() => ({
  previewDraw: vi.fn(),
  previewScore: vi.fn(),
}))

vi.mock('@/app/actions/training-portal', () => portal)
vi.mock('@/app/actions/training-courses', () => courses)

import { CoursePlayer, type CoursePlayerProgress } from '@/components/features/training/player/CoursePlayer'
import { CourseCardView } from '@/components/features/training/player/CourseCardView'

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const objectives = [
  { key: 'alarm', text: 'Raise the alarm' },
  { key: 'exit', text: 'Get out safely' },
]

function makeCourse(): PlayerCourseView {
  return {
    versionId: 'ver-1',
    versionLabel: '1.0',
    slug: 'essentials',
    title: 'Essentials',
    summary: 'The basics for every shift.',
    kind: 'online',
    estimatedMinutes: 20,
    intro: [{ type: 'paragraph', title: 'Welcome', text: 'Welcome to your training.' }],
    sections: [
      {
        key: 'fire',
        title: 'Fire safety',
        objectives,
        cards: [
          { type: 'paragraph', title: 'Fire first', text: 'Raise the alarm before anything else.' },
          { type: 'bullets', title: 'Alarm points', items: ['By the bar', 'By the kitchen'] },
          { type: 'callout', tone: 'warning', title: 'Never go back in', text: 'Once you are out, stay out.' },
        ],
        resitNote: 'Look again at where the alarm points are.',
        questionsPerAttempt: 2,
        maxWrong: 0,
      },
      {
        key: 'service',
        title: 'Service',
        objectives,
        cards: [
          { type: 'paragraph', title: 'Greeting', text: 'Say hello to every guest.' },
          { type: 'steps', title: 'Taking an order', steps: [{ title: 'Ask', text: 'Ask about allergies.' }, { title: 'Write', text: 'Write it down.' }] },
        ],
        resitNote: null,
        questionsPerAttempt: 2,
        maxWrong: 1,
      },
    ],
    closing: [{ type: 'paragraph', title: 'Well done', text: 'Thank you for doing your training.' }],
    imageBaseUrl: '/api/training/images/ver-1/',
  }
}

const QUESTIONS = [
  { id: 'fire-01', prompt: 'You see smoke in the bin store. What do you do first?', options: ['Fetch an extinguisher', 'Raise the alarm', 'Go and look'] },
  { id: 'fire-02', prompt: 'Where do you meet after leaving?', options: ['The car park', 'The cellar', 'The bar'] },
]

function liveProgress(overrides: Partial<CoursePlayerProgress> = {}): CoursePlayerProgress {
  return {
    progress: { sections: {}, current: 'fire', introSeen: true },
    sectionStates: { fire: 'open', service: 'not_open' },
    lockedSection: null,
    confirmation: { state: 'not_ready', confirmUrl: null },
    status: 'assigned',
    ...overrides,
  }
}

function result(overrides: Partial<CheckResultView> = {}): CheckResultView {
  return {
    passed: true,
    wrongCount: 0,
    criticalMissed: 0,
    maxWrong: 0,
    next: 'next_section',
    results: [
      {
        questionId: 'fire-01',
        prompt: QUESTIONS[0].prompt,
        options: QUESTIONS[0].options,
        chosen: 1,
        correctIndex: 1,
        correct: true,
        critical: true,
        explanation: 'Raise the alarm first, always.',
      },
      {
        questionId: 'fire-02',
        prompt: QUESTIONS[1].prompt,
        options: QUESTIONS[1].options,
        chosen: 0,
        correctIndex: 0,
        correct: true,
        critical: false,
        explanation: 'The meeting point is the car park.',
      },
    ],
    ...overrides,
  }
}

function heading(): HTMLElement {
  return screen.getByRole('heading', { level: 3 })
}

async function answerBoth(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByLabelText('Raise the alarm'))
  await user.click(screen.getByLabelText('The car park'))
}

beforeEach(() => {
  vi.clearAllMocks()
  portal.saveTrainingProgress.mockResolvedValue({ success: true })
  portal.startTrainingCheck.mockResolvedValue({ success: true, data: { attemptId: 'att-1', attemptNo: 1, questions: QUESTIONS } })
  portal.submitTrainingCheck.mockResolvedValue({ success: true, data: result() })
  portal.prepareMyConfirmation.mockResolvedValue({ success: true, data: { confirmUrl: '/portal/documents/party-9' } })
  courses.previewDraw.mockResolvedValue({
    success: true,
    data: {
      served: [
        { questionId: 'fire-01', optionOrder: [0, 1, 2] },
        { questionId: 'fire-02', optionOrder: [0, 1, 2] },
      ],
      questions: QUESTIONS,
    },
  })
  courses.previewScore.mockResolvedValue({ success: true, data: result() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------

describe('CourseCardView: every card type', () => {
  const base = '/api/training/images/ver-1/'

  it('renders a paragraph, keeping its text', () => {
    render(<CourseCardView card={{ type: 'paragraph', text: 'Raise the alarm first.' }} imageBaseUrl={base} />)
    expect(screen.getByText('Raise the alarm first.')).toBeInTheDocument()
  })

  it('renders bullets as a list', () => {
    render(<CourseCardView card={{ type: 'bullets', items: ['One', 'Two', 'Three'] }} imageBaseUrl={base} />)
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(3)
  })

  it('renders do and do not lists', () => {
    render(<CourseCardView card={{ type: 'do_dont', do: ['Smile'], dont: ['Shout'] }} imageBaseUrl={base} />)
    expect(screen.getByText('Do')).toBeInTheDocument()
    expect(screen.getByText("Don't")).toBeInTheDocument()
    expect(screen.getByText('Smile')).toBeInTheDocument()
    expect(screen.getByText('Shout')).toBeInTheDocument()
  })

  it.each([
    ['info', 'Good to know'],
    ['warning', 'Important'],
    ['manager', 'Ask a manager'],
  ] as const)('renders a %s callout as a note, not an alert', (tone, label) => {
    render(<CourseCardView card={{ type: 'callout', tone, title: 'Title', text: 'Callout text' }} imageBaseUrl={base} />)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(label)
    expect(note).toHaveTextContent('Callout text')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders a table with column headers', () => {
    render(
      <CourseCardView
        card={{ type: 'table', columns: ['Day', 'Hours'], rows: [['Monday', 'Closed'], ['Tuesday', '12 to 11']] }}
        imageBaseUrl={base}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'Day' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '12 to 11' })).toBeInTheDocument()
    // The table is for wide screens only: below the shell breakpoint a table is at least 560px
    // wide (globals.css), wider than a phone's card.
    expect(screen.getByRole('table').closest('div.hidden')).toHaveClass('shell:block')
  })

  it('shows a table card on a phone as one block per row, every cell under its column name', () => {
    const columns = ['Voucher', 'What you say']
    const rows = [
      ['Paper voucher', 'Thank you. I will check the date and take it off the bill for you.'],
      ['Gift card', 'I can take that. Let me check the balance first.'],
    ]
    render(<CourseCardView card={{ type: 'table', columns, rows }} imageBaseUrl={base} />)

    const phone = screen.getByRole('list')
    // Hidden from the shell breakpoint up, where the table takes over, so it is read only once.
    expect(phone).toHaveClass('shell:hidden')
    expect(phone).not.toContainElement(screen.getByRole('table'))
    const blocks = within(phone).getAllByRole('listitem')
    expect(blocks).toHaveLength(rows.length)
    blocks.forEach((block, rowIndex) => {
      const names = within(block).getAllByRole('term').map((term) => term.textContent)
      const cells = within(block).getAllByRole('definition').map((cell) => cell.textContent)
      expect(names).toEqual(columns)
      expect(cells).toEqual(rows[rowIndex])
    })
    expect(within(phone).getAllByRole('definition')[0]).toHaveClass('text-base')
  })

  it('renders numbered steps', () => {
    render(
      <CourseCardView
        card={{ type: 'steps', steps: [{ title: 'Stop', text: 'Turn it off.' }, { title: 'Tell', text: 'Tell a manager.' }] }}
        imageBaseUrl={base}
      />,
    )
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Stop')
    expect(items[1]).toHaveTextContent('Tell a manager.')
  })

  it('renders an image from the version image route, with its alt text and caption', () => {
    render(<CourseCardView card={{ type: 'image', src: 'images/exit.jpg', alt: 'The fire exit', caption: 'Keep it clear' }} imageBaseUrl={base} />)
    expect(screen.getByRole('img', { name: 'The fire exit' })).toHaveAttribute('src', '/api/training/images/ver-1/images/exit.jpg')
    expect(screen.getByText('Keep it clear')).toBeInTheDocument()
  })

  it('lets the learner check themselves without recording anything', async () => {
    const user = userEvent.setup()
    const card: CourseCard = {
      type: 'check_yourself',
      prompt: 'What do you do first?',
      options: ['Look', 'Raise the alarm', 'Run'],
      answer: 1,
      explanation: 'The alarm comes first.',
    }
    render(<CourseCardView card={card} imageBaseUrl={base} />)

    await user.click(screen.getByRole('button', { name: 'Check my answer' }))
    expect(screen.getByText('Choose an answer first.')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Look'))
    await user.click(screen.getByRole('button', { name: 'Check my answer' }))
    expect(screen.getByText('Not quite. The answer is: Raise the alarm')).toBeInTheDocument()
    expect(screen.getByText('The alarm comes first.')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Raise the alarm'))
    await user.click(screen.getByRole('button', { name: 'Check my answer' }))
    expect(screen.getByText('Yes, that is right.')).toBeInTheDocument()
    expect(portal.saveTrainingProgress).not.toHaveBeenCalled()
    expect(courses.previewScore).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------------------------

describe('CoursePlayer: live mode', () => {
  it('shows the sections and resumes where the learner stopped', async () => {
    const user = userEvent.setup()
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={makeCourse()}
        progress={liveProgress({ progress: { sections: { fire: { card: 1, fails: 0, passedAt: null, lastAttemptQuestionIds: [] } }, current: 'fire', introSeen: true } })}
      />,
    )
    expect(heading()).toHaveTextContent('Your sections')
    expect(screen.getByText('0 of 2 sections passed. About 20 minutes in all.')).toBeInTheDocument()
    expect(screen.getByText('Not open yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(heading()).toHaveTextContent('Alarm points')
    expect(screen.getByText('Card 2 of 3')).toBeInTheDocument()
  })

  it('shows the intro first, and records it as seen when it is finished', async () => {
    const user = userEvent.setup()
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={makeCourse()}
        progress={liveProgress({ progress: { sections: {}, current: null, introSeen: false } })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(heading()).toHaveTextContent('Welcome')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(portal.saveTrainingProgress).toHaveBeenCalledWith({ assignmentId: 'asg-1', sectionKey: '_intro', card: 0 })
    expect(heading()).toHaveTextContent('Fire first')
  })

  it('saves progress on every Next and moves focus to the new heading', async () => {
    const user = userEvent.setup()
    render(<CoursePlayer mode="live" assignmentId="asg-1" course={makeCourse()} progress={liveProgress()} />)
    // The intro is already seen, so the learner has started: Continue, not Start.
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(heading()).toHaveTextContent('Fire first')
    // Focus moves in an effect after the screen changes, which can trail it on a busy machine.
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Fire first'))

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(portal.saveTrainingProgress).toHaveBeenCalledWith({ assignmentId: 'asg-1', sectionKey: 'fire', card: 1 })
    expect(heading()).toHaveTextContent('Alarm points')
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Alarm points'))

    // Back saves nothing and keeps the place.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(heading()).toHaveTextContent('Fire first')
    expect(portal.saveTrainingProgress).toHaveBeenCalledTimes(1)
  })

  it('stays on the card and says so when progress cannot be saved', async () => {
    const user = userEvent.setup()
    portal.saveTrainingProgress.mockResolvedValueOnce({ error: 'Your place could not be saved. Please try again.' })
    render(<CoursePlayer mode="live" assignmentId="asg-1" course={makeCourse()} progress={liveProgress()} />)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Your place could not be saved. Please try again.')
    expect(heading()).toHaveTextContent('Fire first')
    expect(screen.getByText('Card 1 of 3')).toBeInTheDocument()
  })

  it('runs the check: questions, every answer needed, submit, results with every explanation', async () => {
    const user = userEvent.setup()
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={makeCourse()}
        progress={liveProgress({ progress: { sections: { fire: { card: 2, fails: 0, passedAt: null, lastAttemptQuestionIds: [] } }, current: 'fire', introSeen: true } })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Go to the check' }))
    expect(portal.startTrainingCheck).toHaveBeenCalledWith({ assignmentId: 'asg-1', sectionKey: 'fire' })
    expect(heading()).toHaveTextContent('Check: Fire safety')

    // Every option is a labelled radio, grouped by question.
    expect(await screen.findByRole('group', { name: /Question 1 of 2/ })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(6)

    await user.click(screen.getByLabelText('Raise the alarm'))
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
    expect(screen.getByText('Answer every question first. 1 question still needs an answer.')).toBeInTheDocument()
    expect(portal.submitTrainingCheck).not.toHaveBeenCalled()

    await user.click(screen.getByLabelText('The car park'))
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
    expect(portal.submitTrainingCheck).toHaveBeenCalledWith({ attemptId: 'att-1', answers: { 'fire-01': 1, 'fire-02': 0 } })

    expect(await screen.findByText('You passed this section. You got 2 of 2 right.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('You passed this section.')
    expect(screen.getByText('Raise the alarm first, always.')).toBeInTheDocument()
    expect(screen.getByText('The meeting point is the car park.')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Your results'))

    await user.click(screen.getByRole('button', { name: 'Go to the next section' }))
    expect(heading()).toHaveTextContent('Greeting')
    expect(screen.getByText('Section 2 of 2: Service')).toBeInTheDocument()
  })

  it('keeps the answers and says so when the check cannot be sent', async () => {
    const user = userEvent.setup()
    portal.submitTrainingCheck.mockResolvedValueOnce({ error: 'Your answers were not saved. Please try again.' })
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={makeCourse()}
        progress={liveProgress({ progress: { sections: { fire: { card: 2, fails: 0, passedAt: null, lastAttemptQuestionIds: [] } }, current: 'fire', introSeen: true } })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Go to the check' }))
    await answerBoth(user)
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
    expect(await screen.findByText('Your answers were not saved. Please try again.')).toBeInTheDocument()
    expect(screen.getByLabelText('Raise the alarm')).toBeChecked()
    expect(heading()).toHaveTextContent('Check: Fire safety')
  })

  it('sends the learner back through the section with the resit note after a fail', async () => {
    const user = userEvent.setup()
    portal.submitTrainingCheck.mockResolvedValueOnce({
      success: true,
      data: result({ passed: false, wrongCount: 1, criticalMissed: 1, next: 'retry' }),
    })
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={makeCourse()}
        progress={liveProgress({ progress: { sections: { fire: { card: 2, fails: 0, passedAt: null, lastAttemptQuestionIds: [] } }, current: 'fire', introSeen: true } })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Go to the check' }))
    await answerBoth(user)
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
    expect(await screen.findByText(/You missed a must-know question/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go back through the section' }))
    expect(heading()).toHaveTextContent('Fire first')
    expect(screen.getByText('Look again at where the alarm points are.')).toBeInTheDocument()
  })

  it('shows the locked screen on the third fail', async () => {
    const user = userEvent.setup()
    portal.submitTrainingCheck.mockResolvedValueOnce({
      success: true,
      data: result({ passed: false, wrongCount: 2, criticalMissed: 1, next: 'locked' }),
    })
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={makeCourse()}
        progress={liveProgress({ progress: { sections: { fire: { card: 2, fails: 2, passedAt: null, lastAttemptQuestionIds: [] } }, current: 'fire', introSeen: true } })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Go to the check' }))
    await answerBoth(user)
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
    await user.click(await screen.findByRole('button', { name: 'What happens now' }))
    expect(heading()).toHaveTextContent('This section is locked')
    expect(screen.getByRole('link', { name: 'Back to My Training' })).toHaveAttribute('href', '/portal/training')
  })

  it('opens on the locked message when a section is already locked', () => {
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={makeCourse()}
        progress={liveProgress({ sectionStates: { fire: 'locked', service: 'not_open' }, lockedSection: 'fire', status: 'locked' })}
      />,
    )
    expect(screen.getByText('A section is locked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('finishes with the closing cards and "Confirm your training" linking to the confirmation', async () => {
    const user = userEvent.setup()
    portal.submitTrainingCheck.mockResolvedValueOnce({
      success: true,
      data: result({ next: 'confirm', confirmUrl: '/portal/documents/party-1' }),
    })
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={makeCourse()}
        progress={liveProgress({
          progress: {
            sections: {
              fire: { card: 2, fails: 0, passedAt: '2026-11-03T10:00:00.000Z', lastAttemptQuestionIds: [] },
              service: { card: 1, fails: 0, passedAt: null, lastAttemptQuestionIds: [] },
            },
            current: 'service',
            introSeen: true,
          },
          sectionStates: { fire: 'passed', service: 'open' },
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Go to the check' }))
    expect(portal.startTrainingCheck).toHaveBeenCalledWith({ assignmentId: 'asg-1', sectionKey: 'service' })
    await answerBoth(user)
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
    await user.click(await screen.findByRole('button', { name: 'Finish' }))
    expect(heading()).toHaveTextContent('Well done')
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(heading()).toHaveTextContent('Last step: confirm your training')
    expect(screen.getByRole('link', { name: 'Confirm your training' })).toHaveAttribute('href', '/portal/documents/party-1')
  })

  it('offers a retry when the confirmation could not be prepared', async () => {
    const user = userEvent.setup()
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-1"
        course={{ ...makeCourse(), closing: [] }}
        progress={liveProgress({
          progress: {
            sections: {
              fire: { card: 2, fails: 0, passedAt: '2026-11-03T10:00:00.000Z', lastAttemptQuestionIds: [] },
              service: { card: 1, fails: 0, passedAt: '2026-11-03T10:20:00.000Z', lastAttemptQuestionIds: [] },
            },
            current: 'service',
            introSeen: true,
          },
          sectionStates: { fire: 'passed', service: 'passed' },
          confirmation: { state: 'retry', confirmUrl: null },
          status: 'awaiting_confirmation',
        })}
      />,
    )
    expect(heading()).toHaveTextContent('Every section passed')
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText('We could not get your confirmation ready. Please try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(portal.prepareMyConfirmation).toHaveBeenCalledWith({ assignmentId: 'asg-1' })
    expect(await screen.findByRole('link', { name: 'Confirm your training' })).toHaveAttribute('href', '/portal/documents/party-9')
  })

  it('explains a practical sign-off instead of offering cards', () => {
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-2"
        course={{ ...makeCourse(), kind: 'practical', intro: [], sections: [], closing: [] }}
        progress={liveProgress({ sectionStates: {} })}
      />,
    )
    expect(heading()).toHaveTextContent('How this is signed off')
    expect(screen.getByText(/A manager will watch you do each task at work/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    // No intro cards, so no notes to offer.
    expect(screen.queryByRole('button', { name: 'Read the notes' })).toBeNull()
  })

  it.each([
    ['live', 'assigned'],
    ['live', 'waiting'],
    ['preview', 'assigned'],
  ] as const)('opens a practical course notes in %s mode (%s) and goes back without saving anything', async (mode, status) => {
    const user = userEvent.setup()
    const practical: PlayerCourseView = {
      ...makeCourse(),
      slug: 'gas',
      title: 'Gas cylinders',
      kind: 'practical',
      intro: [
        { type: 'paragraph', title: 'What this is', text: 'How to change a gas cylinder safely.' },
        { type: 'callout', tone: 'warning', title: 'If someone collapses', text: 'Do not go in. Call 999.' },
      ],
      sections: [],
      closing: [],
    }
    render(
      <CoursePlayer
        mode={mode}
        assignmentId={mode === 'live' ? 'asg-2' : undefined}
        course={practical}
        progress={mode === 'live' ? liveProgress({ sectionStates: {}, progress: { sections: {}, current: null, introSeen: false }, status }) : undefined}
      />,
    )
    expect(heading()).toHaveTextContent('How this is signed off')
    if (status === 'waiting') {
      expect(screen.getByText(/The sign-off opens once you have finished the course that comes before it. You can read the notes now./)).toBeInTheDocument()
    }

    await user.click(screen.getByRole('button', { name: 'Read the notes' }))
    expect(heading()).toHaveTextContent('What this is')
    expect(screen.getByText('Before your sign-off')).toBeInTheDocument()
    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(heading()).toHaveTextContent('If someone collapses')
    expect(screen.getByText('Do not go in. Call 999.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(heading()).toHaveTextContent('How this is signed off')
    expect(screen.getByRole('button', { name: 'Read the notes' })).toBeInTheDocument()

    // Reading notes is never recorded: the server refuses progress on a practical course.
    expect(portal.saveTrainingProgress).not.toHaveBeenCalled()
    expect(portal.startTrainingCheck).not.toHaveBeenCalled()
    expect(courses.previewDraw).not.toHaveBeenCalled()
  })

  it('does not open a course still waiting for the one before it', () => {
    render(
      <CoursePlayer
        mode="live"
        assignmentId="asg-3"
        course={makeCourse()}
        progress={liveProgress({ status: 'waiting', sectionStates: { fire: 'not_open', service: 'not_open' } })}
      />,
    )
    expect(screen.getByText('This training opens once you have finished the course that comes before it.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start|Continue/ })).toBeNull()
  })

  it('refuses to run without an assignment', () => {
    render(<CoursePlayer mode="live" course={makeCourse()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This training could not be opened')
  })
})

// ---------------------------------------------------------------------------------------------
// Preview mode
// ---------------------------------------------------------------------------------------------

describe('CoursePlayer: preview mode', () => {
  function expectNoLiveCalls(): void {
    expect(portal.saveTrainingProgress).not.toHaveBeenCalled()
    expect(portal.startTrainingCheck).not.toHaveBeenCalled()
    expect(portal.submitTrainingCheck).not.toHaveBeenCalled()
    expect(portal.prepareMyConfirmation).not.toHaveBeenCalled()
    expect(portal.getMyAssignment).not.toHaveBeenCalled()
    expect(portal.getMyTraining).not.toHaveBeenCalled()
  }

  it('goes through a whole course with the preview actions and never a live one', async () => {
    const user = userEvent.setup()
    courses.previewScore
      .mockResolvedValueOnce({ success: true, data: result({ passed: false, wrongCount: 1, criticalMissed: 1, next: 'retry' }) })
      .mockResolvedValue({ success: true, data: result({ next: 'retry' }) })
    render(<CoursePlayer mode="preview" versionId="ver-draft" course={makeCourse()} />)

    expect(screen.getByText(/Nothing you do here is recorded/)).toBeInTheDocument()
    expect(screen.queryByText(/paid working time/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(heading()).toHaveTextContent('Welcome')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Go to the check' }))
    expect(courses.previewDraw).toHaveBeenCalledWith({ versionId: 'ver-draft', sectionKey: 'fire', previousQuestionIds: [] })

    await answerBoth(user)
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
    expect(courses.previewScore).toHaveBeenCalledWith({
      versionId: 'ver-draft',
      sectionKey: 'fire',
      served: [
        { questionId: 'fire-01', optionOrder: [0, 1, 2] },
        { questionId: 'fire-02', optionOrder: [0, 1, 2] },
      ],
      answers: { 'fire-01': 1, 'fire-02': 0 },
    })
    await user.click(await screen.findByRole('button', { name: 'Go back through the section' }))

    // The resit draw avoids the questions just served, as staff would get.
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Go to the check' }))
    expect(courses.previewDraw).toHaveBeenLastCalledWith({
      versionId: 'ver-draft',
      sectionKey: 'fire',
      previousQuestionIds: ['fire-01', 'fire-02'],
    })
    await answerBoth(user)
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))

    // A pass: the player decides what comes next itself in preview (previewScore cannot know).
    await user.click(await screen.findByRole('button', { name: 'Go to the next section' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Go to the check' }))
    await answerBoth(user)
    await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
    await user.click(await screen.findByRole('button', { name: 'Finish' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(heading()).toHaveTextContent('Preview finished')
    expect(screen.queryByRole('link', { name: 'Confirm your training' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to the course' })).toHaveAttribute('href', '/employees/training/courses/essentials')

    expectNoLiveCalls()
  })

  it('never locks a section in preview, however many fails, and can start again', async () => {
    const user = userEvent.setup()
    courses.previewScore.mockResolvedValue({ success: true, data: result({ passed: false, wrongCount: 2, criticalMissed: 1, next: 'retry' }) })
    render(<CoursePlayer mode="preview" course={makeCourse()} />)

    // Preview opens any section directly, so a manager can look at any part.
    await user.click(screen.getByRole('button', { name: /^Open.*Fire safety$/ }))
    for (let attempt = 1; attempt <= 4; attempt++) {
      while (!screen.queryByRole('button', { name: 'Go to the check' })) {
        await user.click(screen.getByRole('button', { name: 'Next' }))
      }
      await user.click(screen.getByRole('button', { name: 'Go to the check' }))
      await answerBoth(user)
      await user.click(screen.getByRole('button', { name: 'Submit my answers' }))
      expect(await screen.findByRole('button', { name: 'Go back through the section' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'What happens now' })).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Go back through the section' }))
    }
    expect(courses.previewDraw).toHaveBeenCalledTimes(4)
    expect(courses.previewDraw).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'ver-1' }))

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Start the preview again' }))
    expect(heading()).toHaveTextContent('Your sections')
    expect(screen.getByText('0 of 2 sections passed. About 20 minutes in all.')).toBeInTheDocument()
    expectNoLiveCalls()
  })
})

// ---------------------------------------------------------------------------------------------
// Read aloud
// ---------------------------------------------------------------------------------------------

describe('CoursePlayer: read aloud', () => {
  it('is not drawn where the device cannot speak', async () => {
    const user = userEvent.setup()
    render(<CoursePlayer mode="preview" course={makeCourse()} />)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.queryByRole('button', { name: /Read aloud/ })).toBeNull()
  })

  it('reads the card in British English where the device can speak', async () => {
    const user = userEvent.setup()
    const speak = vi.fn()
    const cancel = vi.fn()
    class Utterance {
      text: string
      lang = ''
      voice: unknown = null
      rate = 1
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    const british = { lang: 'en-GB', localService: true, name: 'Daniel' }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    vi.stubGlobal('speechSynthesis', {
      speak,
      cancel,
      getVoices: () => [{ lang: 'en-US', localService: true, name: 'Alex' }, british],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })

    render(<CoursePlayer mode="preview" course={makeCourse()} />)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.click(await screen.findByRole('button', { name: /Read aloud/ }))
    expect(speak).toHaveBeenCalledTimes(1)
    const utterance = speak.mock.calls[0][0] as Utterance
    expect(utterance.lang).toBe('en-GB')
    expect(utterance.voice).toBe(british)
    expect(utterance.text).toBe('Welcome. Welcome to your training.')
    expect(screen.getByRole('button', { name: 'Stop reading' })).toBeInTheDocument()

    // Moving on stops the reading.
    const cancelsBefore = cancel.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(cancel.mock.calls.length).toBeGreaterThan(cancelsBefore))
    expect(screen.getByRole('button', { name: /Read aloud/ })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
// Card state between screens
// ---------------------------------------------------------------------------------------------

describe('CoursePlayer: each card starts fresh', () => {
  it('does not carry a check-yourself answer onto the next check-yourself card', async () => {
    const user = userEvent.setup()
    const options = ['Look', 'Raise the alarm', 'Run']
    const course: PlayerCourseView = {
      ...makeCourse(),
      intro: [],
      sections: [
        {
          ...makeCourse().sections[0],
          cards: [
            { type: 'check_yourself', prompt: 'What do you do first?', options, answer: 1, explanation: 'The alarm comes first.' },
            { type: 'check_yourself', prompt: 'What do you do if it is blocked?', options, answer: 2, explanation: 'Get out another way.' },
            { type: 'paragraph', title: 'Fire first', text: 'Raise the alarm before anything else.' },
          ],
        },
        makeCourse().sections[1],
      ],
    }
    render(<CoursePlayer mode="preview" course={course} />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(heading()).toHaveTextContent('Check yourself')
    expect(screen.getByText('What do you do first?')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Raise the alarm'))
    await user.click(screen.getByRole('button', { name: 'Check my answer' }))
    expect(screen.getByText('Yes, that is right.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Card 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('What do you do if it is blocked?')).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked()
    expect(screen.queryByText('Yes, that is right.')).toBeNull()
    expect(screen.queryByText(/Not quite/)).toBeNull()
    expect(screen.queryByText('Get out another way.')).toBeNull()
  })
})
