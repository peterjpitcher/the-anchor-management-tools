import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MyAssignmentView, MyTrainingItem, MyTrainingView } from '@/lib/training/types'

const portal = vi.hoisted(() => ({
  getMyTraining: vi.fn(),
  getMyAssignment: vi.fn(),
  saveTrainingProgress: vi.fn(),
  startTrainingCheck: vi.fn(),
  submitTrainingCheck: vi.fn(),
  prepareMyConfirmation: vi.fn(),
}))
vi.mock('@/app/actions/training-portal', () => portal)
vi.mock('@/app/actions/training-courses', () => ({ previewDraw: vi.fn(), previewScore: vi.fn() }))

import MyTrainingPage from '@/app/(staff-portal)/portal/training/page'
import MyTrainingCoursePage, { maxDuration as coursePageMaxDuration } from '@/app/(staff-portal)/portal/training/[assignmentId]/page'
import { PORTAL_NAV } from '@/app/(staff-portal)/portal/_shared/nav'

function item(overrides: Partial<MyTrainingItem>): MyTrainingItem {
  return {
    assignmentId: 'asg-1',
    course: {
      id: 'course-1',
      slug: 'essentials',
      title: 'Essentials',
      kind: 'online',
      isEssentials: true,
      summary: 'The basics for every shift.',
      estimatedMinutes: 25,
    },
    state: 'not_started',
    dueOn: '2026-11-17',
    completedOn: null,
    expiresOn: null,
    sectionsPassed: 0,
    sectionsTotal: 5,
    action: 'start',
    waitingReason: null,
    supervisedOnly: false,
    certificatePartyId: null,
    ...overrides,
  }
}

function view(overrides: Partial<MyTrainingView> = {}): MyTrainingView {
  return { today: '2026-11-03', due: [], waiting: [], done: [], ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PORTAL_NAV', () => {
  it('has My Training, second so it shows on a phone without scrolling', () => {
    expect(PORTAL_NAV[1]).toEqual({ label: 'My Training', href: '/portal/training' })
  })
})

describe('My Training page', () => {
  it('lists what is due with its date and a Start button, what is waiting, and what is done', async () => {
    portal.getMyTraining.mockResolvedValue({
      success: true,
      data: view({
        due: [item({})],
        waiting: [
          item({
            assignmentId: 'asg-2',
            course: { id: 'c2', slug: 'kegs', title: 'Changing a keg', kind: 'practical', isEssentials: false, summary: null, estimatedMinutes: null },
            state: 'not_started',
            action: 'none',
            waitingReason: 'practical',
            supervisedOnly: true,
          }),
          item({
            assignmentId: 'asg-4',
            course: { id: 'c4', slug: 'team-training', title: 'Team training', kind: 'online', isEssentials: false, summary: null, estimatedMinutes: 40 },
            state: 'locked',
            action: 'none',
            waitingReason: 'locked',
          }),
        ],
        done: [
          item({
            assignmentId: 'asg-3',
            course: { id: 'c3', slug: 'team-training', title: 'Team training', kind: 'online', isEssentials: false, summary: null, estimatedMinutes: 40 },
            state: 'done',
            action: 'none',
            completedOn: '2026-10-01',
            expiresOn: '2027-10-01',
            certificatePartyId: 'party-7',
          }),
        ],
      }),
    })

    render(await MyTrainingPage())

    expect(screen.getByRole('heading', { level: 1, name: 'My Training' })).toBeInTheDocument()
    expect(screen.getByText('Training is paid working time. Do it on shift, or ask your manager for a training shift.')).toBeInTheDocument()
    expect(screen.getByText('Due by 17 Nov 2026. 0 of 5 sections passed. About 25 minutes')).toBeInTheDocument()
    expect(screen.getByText('Essentials: do this one first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Start/ })).toHaveAttribute('href', '/portal/training/asg-1')

    expect(screen.getByText('A manager will watch you do this at work and sign it off with you.')).toBeInTheDocument()
    expect(screen.getByText('Supervised only')).toBeInTheDocument()
    // A practical sign-off's notes open read-only in the player; a locked online course has no link.
    expect(screen.getByRole('link', { name: /^Read the notes.*Changing a keg/ })).toHaveAttribute('href', '/portal/training/asg-2')
    expect(screen.getAllByRole('link', { name: /^Read the notes/ })).toHaveLength(1)

    expect(screen.getByText('Passed on 1 Oct 2026. Refresher due by 1 Oct 2027')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^View certificate/ })).toHaveAttribute('href', '/portal/documents/party-7')
  })

  it('words a waiting item for staff, never as a prerequisite', async () => {
    portal.getMyTraining.mockResolvedValue({
      success: true,
      data: view({
        waiting: [
          item({
            assignmentId: 'asg-5',
            course: { id: 'c5', slug: 'cellar', title: 'Cellar sign-off', kind: 'practical', isEssentials: false, summary: null, estimatedMinutes: null },
            state: 'waiting',
            dueOn: null,
            action: 'none',
            waitingReason: 'prerequisite',
          }),
        ],
      }),
    })
    const { container } = render(await MyTrainingPage())
    expect(screen.getByText('Waiting for another course')).toBeInTheDocument()
    expect(container.textContent?.toLowerCase()).not.toContain('prerequisite')
  })

  it('says when there is nothing to do', async () => {
    portal.getMyTraining.mockResolvedValue({ success: true, data: view() })
    render(await MyTrainingPage())
    expect(screen.getByText('Nothing to do')).toBeInTheDocument()
  })

  it('never shows a load failure as nothing to do', async () => {
    portal.getMyTraining.mockResolvedValue({ error: 'Your training could not be loaded. Please try again in a moment.' })
    render(await MyTrainingPage())
    expect(screen.getByRole('alert')).toHaveTextContent('Your training could not be loaded')
    expect(screen.queryByText('Nothing to do')).toBeNull()
  })

  it('fails closed when the action throws', async () => {
    portal.getMyTraining.mockRejectedValue(new Error('database down'))
    render(await MyTrainingPage())
    expect(screen.getByRole('alert')).toHaveTextContent('Your training could not be loaded')
    expect(screen.queryByText('database down')).toBeNull()
  })
})

describe('My Training course page', () => {
  const assignment: MyAssignmentView = {
    assignmentId: 'asg-1',
    courseId: 'course-1',
    status: 'assigned',
    state: 'not_started',
    dueOn: '2026-11-17',
    course: {
      versionId: 'ver-1',
      versionLabel: '1.0',
      slug: 'essentials',
      title: 'Essentials',
      summary: 'The basics for every shift.',
      kind: 'online',
      estimatedMinutes: 25,
      intro: [],
      sections: [
        {
          key: 'fire',
          title: 'Fire safety',
          objectives: [],
          cards: [
            { type: 'paragraph', text: 'One' },
            { type: 'paragraph', text: 'Two' },
          ],
          resitNote: null,
          questionsPerAttempt: 4,
          maxWrong: 1,
        },
      ],
      closing: [],
      imageBaseUrl: '/api/training/images/ver-1/',
    },
    progress: { sections: {}, current: null, introSeen: false },
    sectionStates: { fire: 'open' },
    lockedSection: null,
    confirmation: { state: 'not_ready', confirmUrl: null },
  }

  it('opens the player for my own assignment', async () => {
    portal.getMyAssignment.mockResolvedValue({ success: true, data: assignment })
    render(await MyTrainingCoursePage({ params: Promise.resolve({ assignmentId: 'asg-1' }) }))
    expect(portal.getMyAssignment).toHaveBeenCalledWith('asg-1')
    expect(screen.getByRole('heading', { level: 1, name: 'Essentials' })).toBeInTheDocument()
    expect(screen.getByText('Version 1.0. About 25 minutes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to My Training' })).toHaveAttribute('href', '/portal/training')
  })

  it('opens a practical sign-off read-only, with its notes and nothing to start', async () => {
    portal.getMyAssignment.mockResolvedValue({
      success: true,
      data: {
        ...assignment,
        assignmentId: 'asg-2',
        course: {
          ...assignment.course,
          slug: 'kegs',
          title: 'Changing a keg',
          kind: 'practical',
          intro: [{ type: 'paragraph', title: 'What this is', text: 'How to change a keg safely.' }],
          sections: [],
        },
        sectionStates: {},
      },
    })
    render(await MyTrainingCoursePage({ params: Promise.resolve({ assignmentId: 'asg-2' }) }))
    expect(screen.getByRole('heading', { level: 1, name: 'Changing a keg' })).toBeInTheDocument()
    expect(screen.getByText('Practical sign-off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read the notes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('says plainly when the assignment cannot be opened (unknown or not mine)', async () => {
    portal.getMyAssignment.mockResolvedValue({ error: 'This training was not found.' })
    render(await MyTrainingCoursePage({ params: Promise.resolve({ assignmentId: 'someone-elses' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('This training was not found.')
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('gives the player 120 seconds, because passing the last section makes the certificate with Chromium', () => {
    // Server actions run under the calling page's time limit: submitTrainingCheck and
    // prepareMyConfirmation are called from this page, and a cold Chromium start needs the room.
    expect(coursePageMaxDuration).toBe(120)
  })
})
