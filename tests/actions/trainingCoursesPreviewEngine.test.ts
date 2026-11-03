// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The preview actions over the real draw and marking engine: a check is drawn and marked exactly
// as staff would get it, and nothing at all is written.
const mocks = vi.hoisted(() => ({
  service: {
    getVersion: vi.fn(),
    writeEvent: vi.fn(),
    createAttempt: vi.fn(),
    submitAttempt: vi.fn(),
    updateAssignment: vi.fn(),
    syncAssignments: vi.fn(),
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/signing/staff', () => ({ getSigningStaffUser: vi.fn() }))
vi.mock('@/app/actions/training-settings', () => ({ getTrainingEmailsSwitch: vi.fn(), setTrainingEmailsSwitch: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => { throw new Error('preview must not reach the database') }) }))
vi.mock('@/services/training', () => ({ TrainingService: mocks.service }))

import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { previewDraw, previewScore } from '@/app/actions/training-courses'
import { getSigningStaffUser } from '@/lib/signing/staff'
import { validateCourse } from '@/lib/training/course-schema'
import type { CourseContent } from '@/lib/training/types'

const VERSION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

function question(id: string, objective: string, critical = false) {
  return {
    id,
    objective,
    critical,
    prompt: `What do you do about ${id}?`,
    options: [`Wrong ${id} a`, `Right ${id}`, `Wrong ${id} b`],
    answer: 1,
    explanation: `Because ${id}.`,
  }
}

const COURSE = validateCourse(
  {
    schemaVersion: 1,
    slug: 'essentials',
    title: 'Essentials',
    summary: 'Everything for a first shift.',
    kind: 'online',
    audience: { groups: [], age: 'all' },
    essentials: true,
    deadline: { newStarterDays: 0, existingStaffDays: 14 },
    refresherMonths: 12,
    prerequisite: null,
    legalBasis: 'MHSWR 1999.',
    estimatedMinutes: 20,
    sections: ['fire', 'allergens'].map((key) => ({
      key,
      title: `Section ${key}`,
      objectives: [
        { key: 'first-aim', text: 'First' },
        { key: 'second-aim', text: 'Second' },
      ],
      cards: [
        { type: 'paragraph', text: 'One idea.' },
        { type: 'paragraph', text: 'Another idea.' },
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
    })),
  },
  { mode: 'draft' }
).course as CourseContent

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSigningStaffUser).mockResolvedValue({ id: '11111111-2222-4333-8444-555555555555', email: null, name: 'Mia', position: null })
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  mocks.service.getVersion.mockResolvedValue({ id: VERSION_ID, courseId: 'c', state: 'draft', major: null, minor: null, content: COURSE, images: [] })
})

describe('preview over the real engine', () => {
  it('draws without answers, marks the right answers as a pass, and the last section leads to confirm', async () => {
    expect(COURSE).toBeTruthy()
    const draw = await previewDraw({ versionId: VERSION_ID, sectionKey: 'allergens', previousQuestionIds: [] })
    expect(draw.error).toBeUndefined()
    const { served, questions } = draw.data!
    expect(served).toHaveLength(4)
    // The browser sees prompts and options only.
    expect(JSON.stringify(questions)).not.toMatch(/explanation|answer/)

    // Pick the right option by its words, wherever the shuffle put it.
    const answers = Object.fromEntries(questions.map((q) => [q.id, q.options.findIndex((option) => option.startsWith('Right'))]))
    const score = await previewScore({ versionId: VERSION_ID, sectionKey: 'allergens', served, answers })
    expect(score.data).toMatchObject({ passed: true, wrongCount: 0, criticalMissed: 0, next: 'confirm' })
    expect(score.data?.results.every((result) => result.correct && result.explanation.startsWith('Because'))).toBe(true)

    const wrong = Object.fromEntries(questions.map((q) => [q.id, q.options.findIndex((option) => option.startsWith('Wrong'))]))
    const failed = await previewScore({ versionId: VERSION_ID, sectionKey: 'allergens', served, answers: wrong })
    expect(failed.data).toMatchObject({ passed: false, wrongCount: 4, next: 'retry' })

    for (const write of [...Object.entries(mocks.service).filter(([name]) => name !== 'getVersion').map(([, fn]) => fn), logAuditEvent, revalidatePath]) {
      expect(write).not.toHaveBeenCalled()
    }
  })
})
