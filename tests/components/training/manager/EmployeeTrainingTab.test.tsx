import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { itemActions } from '@/components/features/training/manager/employee/item-actions'
import type { EmployeeAssignmentItem } from '@/lib/training/types'
import type { SigningDocumentStatus } from '@/lib/signing/types'
import { KEGS, employeeViewFixture, item } from './fixtures'

/**
 * The Training tab on an employee record loads itself, shows the person's groups, open items
 * and history, and offers the manager actions only to holders of training manage. A failed
 * load is an error with Try Again, never an empty record.
 */

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  getEmployeeTraining: vi.fn(),
  getSigningDocumentsForSubject: vi.fn(),
  startInPersonSigningAction: vi.fn(),
  setTrainingAdjustmentNote: vi.fn(),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    loading: false,
    hasPermission: (module: string, action: string) => mocks.permissions.has(`${module}:${action}`),
  }),
}))
vi.mock('@/app/actions/training', () => ({
  getEmployeeTraining: mocks.getEmployeeTraining,
  getTrainingMatrix: vi.fn(),
  assignCourse: vi.fn(),
  extendDueDate: vi.fn(),
  waiveAssignment: vi.fn(),
  unlockSection: vi.fn(),
  setTrainingGroups: vi.fn(),
  setTrainingAdjustmentNote: mocks.setTrainingAdjustmentNote,
  pauseTraining: vi.fn(),
  resumeTraining: vi.fn(),
  prepareConfirmationAgain: vi.fn(),
  recordPracticalSignoff: vi.fn(),
  recordExternalQualification: vi.fn(),
}))
vi.mock('@/app/actions/training-courses', () => ({ listTrainingCourses: vi.fn() }))
vi.mock('@/app/actions/signing', () => ({
  getSigningDocumentsForSubject: mocks.getSigningDocumentsForSubject,
  startInPersonSigningAction: mocks.startInPersonSigningAction,
}))

/** A practical sign-off waiting for the learner, on a document in the given state. */
function awaitingSignoff(documentStatus: SigningDocumentStatus): EmployeeAssignmentItem {
  return item({
    course: { id: KEGS.id, slug: KEGS.slug, title: KEGS.title, kind: 'practical', isEssentials: false },
    assignment: {
      id: 'assign-kegs',
      courseId: KEGS.id,
      status: 'awaiting_confirmation',
      signingDocumentId: 'doc-kegs',
      signedOffOn: '2026-11-09',
      signedOffByName: 'Morgan Manager',
    },
    state: 'awaiting_confirmation',
    sections: [],
    certificate: { documentId: 'doc-kegs', status: documentStatus },
    tasks: [{ key: 'change-keg', text: 'Changes a keg safely.' }],
  })
}

/** An online course finished and waiting for its certificate to be confirmed. */
function awaitingCertificate(documentStatus: SigningDocumentStatus): EmployeeAssignmentItem {
  return item({
    assignment: { status: 'awaiting_confirmation', signingDocumentId: 'doc-cert', completedOn: '2026-11-03' },
    state: 'awaiting_confirmation',
    certificate: { documentId: 'doc-cert', status: documentStatus },
  })
}

import { EmployeeTrainingTab } from '@/components/features/training/EmployeeTrainingTab'

describe('EmployeeTrainingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permissions = new Set(['training:view'])
    mocks.getEmployeeTraining.mockResolvedValue({ success: true, data: employeeViewFixture() })
  })

  it('loads the record for its employee and shows groups and open items', async () => {
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    expect(await screen.findByText('Current Training')).toBeInTheDocument()
    expect(mocks.getEmployeeTraining).toHaveBeenCalledWith('emp-1')
    expect(screen.getByText('Groups not confirmed')).toBeInTheDocument()
    expect(screen.getByText('Bar (suggested, not confirmed)')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Passed 2 Nov 2026, first try')).toBeInTheDocument()
    expect(screen.getByText('Not passed yet, 1 fail')).toBeInTheDocument()
    expect(screen.getByText('No training history yet')).toBeInTheDocument()
  })

  it('hides every manager action from someone who can only view', async () => {
    render(<EmployeeTrainingTab employeeId="emp-1" />)
    await screen.findByText('Current Training')

    for (const name of ['Assign Training', 'Confirm Groups', 'Set Adjustment', 'Pause Training', 'Record External Qualification']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /Waive/ })).not.toBeInTheDocument()
  })

  it('gives holders of training manage the person and item actions', async () => {
    mocks.permissions = new Set(['training:view', 'training:manage'])
    render(<EmployeeTrainingTab employeeId="emp-1" />)
    await screen.findByText('Current Training')

    expect(screen.getByRole('button', { name: 'Assign Training' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Groups' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause Training' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extend Due Date: Essentials' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Waive: Essentials' })).toBeInTheDocument()
  })

  // Training is only set up for current staff: a starter still onboarding must get no training
  // rows, or they could never be deleted, and someone who has left is read only.
  it.each([
    ['Onboarding', 'Training is set up once Avery Test is Active.'],
    ['Former', 'Avery Test has left, so their training is read only.'],
  ] as const)('offers no person actions for someone %s, and says why', async (status, reason) => {
    mocks.permissions = new Set(['training:view', 'training:manage'])
    const fixture = employeeViewFixture({ current: [] })
    mocks.getEmployeeTraining.mockResolvedValue({ success: true, data: { ...fixture, employee: { ...fixture.employee, status } } })
    render(<EmployeeTrainingTab employeeId="emp-1" />)
    await screen.findByText('Current Training')

    expect(screen.getByRole('status')).toHaveTextContent(reason)
    for (const name of ['Assign Training', 'Confirm Groups', 'Set Adjustment', 'Pause Training', 'Record External Qualification']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('keeps the person actions for someone working their notice', async () => {
    mocks.permissions = new Set(['training:view', 'training:manage'])
    const fixture = employeeViewFixture()
    mocks.getEmployeeTraining.mockResolvedValue({ success: true, data: { ...fixture, employee: { ...fixture.employee, status: 'Started Separation' } } })
    render(<EmployeeTrainingTab employeeId="emp-1" />)
    await screen.findByText('Current Training')

    expect(screen.getByRole('button', { name: 'Assign Training' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm Groups' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('records an adjustment, trimmed, and reloads the record', async () => {
    const user = userEvent.setup()
    mocks.permissions = new Set(['training:view', 'training:manage'])
    mocks.setTrainingAdjustmentNote.mockResolvedValue({ success: true })
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    await user.click(await screen.findByRole('button', { name: 'Set Adjustment' }))
    const dialog = await screen.findByRole('dialog', { name: 'Training Adjustment' })
    await user.type(within(dialog).getByLabelText('Adjustment'), '  Read aloud offered  ')
    await user.click(within(dialog).getByRole('button', { name: 'Save Adjustment' }))

    await waitFor(() => expect(mocks.setTrainingAdjustmentNote).toHaveBeenCalledWith({ employeeId: 'emp-1', note: 'Read aloud offered' }))
    await waitFor(() => expect(mocks.getEmployeeTraining).toHaveBeenCalledTimes(2))
  })

  it('offers to change an adjustment already recorded, and clears it when emptied', async () => {
    const user = userEvent.setup()
    mocks.permissions = new Set(['training:view', 'training:manage'])
    mocks.setTrainingAdjustmentNote.mockResolvedValue({ success: true })
    mocks.getEmployeeTraining.mockResolvedValue({
      success: true,
      data: employeeViewFixture({
        profile: {
          employeeId: 'emp-1',
          groups: [],
          groupsConfirmedAt: null,
          groupsConfirmedBy: null,
          groupsConfirmedByName: null,
          pausedFrom: null,
          pausedUntil: null,
          pauseReason: null,
          adjustmentNote: 'Read aloud offered',
          createdAt: '2026-11-01T09:00:00.000Z',
          updatedAt: '2026-11-01T09:00:00.000Z',
        },
      }),
    })
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    expect(await screen.findByText('Read aloud offered')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change Adjustment' }))
    const dialog = await screen.findByRole('dialog', { name: 'Training Adjustment' })
    await user.clear(within(dialog).getByLabelText('Adjustment'))
    await user.click(within(dialog).getByRole('button', { name: 'Save Adjustment' }))

    await waitFor(() => expect(mocks.setTrainingAdjustmentNote).toHaveBeenCalledWith({ employeeId: 'emp-1', note: null }))
  })

  it('shows Resume Training instead of Pause while a pause is in force', async () => {
    mocks.permissions = new Set(['training:view', 'training:manage'])
    mocks.getEmployeeTraining.mockResolvedValue({
      success: true,
      data: employeeViewFixture({ pause: { from: '2026-11-05', until: null, reason: 'parental_leave' } }),
    })
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    expect(await screen.findByRole('button', { name: 'Resume Training' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause Training' })).not.toBeInTheDocument()
    expect(screen.getByText('Paused from 5 Nov 2026 until resumed (Parental leave)')).toBeInTheDocument()
  })

  it('shows a failed load as an error with Try Again, and tries again', async () => {
    mocks.getEmployeeTraining.mockResolvedValueOnce({ error: 'The training records could not be read.' })
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The training records could not be read.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing open')).not.toBeInTheDocument()

    await userEvent.click(within(alert).getByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(screen.getByText('Current Training')).toBeInTheDocument())
    expect(mocks.getEmployeeTraining).toHaveBeenCalledTimes(2)
  })

  it('makes a new in-person link for a sign-off still waiting for them, and shows it to scan', async () => {
    const user = userEvent.setup()
    mocks.permissions = new Set(['training:view', 'training:manage'])
    mocks.getEmployeeTraining.mockResolvedValue({ success: true, data: employeeViewFixture({ current: [awaitingSignoff('part_signed')] }) })
    mocks.getSigningDocumentsForSubject.mockResolvedValue({
      success: true,
      data: [
        { id: 'doc-other', parties: [{ id: 'party-other', role: 'worker', status: 'pending' }] },
        { id: 'doc-kegs', parties: [{ id: 'party-kegs', role: 'worker', status: 'pending' }] },
      ],
    })
    mocks.startInPersonSigningAction.mockResolvedValue({ success: true, data: { url: '/sign/in-person-token' } })
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    const again = await screen.findByRole('button', { name: `Sign In Person Again: ${KEGS.title}` })
    expect(screen.queryByRole('button', { name: `Record Sign-off: ${KEGS.title}` })).not.toBeInTheDocument()
    await user.click(again)

    await waitFor(() => expect(mocks.startInPersonSigningAction).toHaveBeenCalledWith('party-kegs'))
    expect(mocks.getSigningDocumentsForSubject).toHaveBeenCalledWith('employee', 'emp-1')
    const dialog = await screen.findByRole('dialog', { name: 'Confirm In Person' })
    expect((within(dialog).getByLabelText('Or type this address into the other device') as HTMLInputElement).value).toMatch(
      /\/sign\/in-person-token$/,
    )
  })

  it('does not open a link when the learner has already acted on the sign-off, and reloads the record', async () => {
    const user = userEvent.setup()
    mocks.permissions = new Set(['training:view', 'training:manage'])
    mocks.getEmployeeTraining.mockResolvedValue({ success: true, data: employeeViewFixture({ current: [awaitingSignoff('sent')] }) })
    mocks.getSigningDocumentsForSubject.mockResolvedValue({
      success: true,
      data: [{ id: 'doc-kegs', parties: [{ id: 'party-kegs', role: 'worker', status: 'signed' }] }],
    })
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    await user.click(await screen.findByRole('button', { name: `Sign In Person Again: ${KEGS.title}` }))

    await waitFor(() => expect(mocks.getEmployeeTraining).toHaveBeenCalledTimes(2))
    expect(mocks.startInPersonSigningAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Confirm In Person' })).not.toBeInTheDocument()
  })

  it('offers Record Sign-off again, and says why, once the sign-off document ran out', async () => {
    mocks.permissions = new Set(['training:view', 'training:manage'])
    mocks.getEmployeeTraining.mockResolvedValue({ success: true, data: employeeViewFixture({ current: [awaitingSignoff('expired')] }) })
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    expect(await screen.findByRole('button', { name: `Record Sign-off: ${KEGS.title}` })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Sign In Person Again: ${KEGS.title}` })).not.toBeInTheDocument()
    expect(
      screen.getByText('Their confirmation ran out before they confirmed it. Record the sign-off again with them.'),
    ).toBeInTheDocument()
  })

  it('offers Prepare Again, and says why, once a certificate was withdrawn', async () => {
    mocks.permissions = new Set(['training:view', 'training:manage'])
    mocks.getEmployeeTraining.mockResolvedValue({ success: true, data: employeeViewFixture({ current: [awaitingCertificate('voided')] }) })
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    expect(await screen.findByRole('button', { name: 'Prepare Again: Essentials' })).toBeInTheDocument()
    expect(screen.getByText('Their confirmation was withdrawn before they confirmed it. Prepare it again for them.')).toBeInTheDocument()
  })

  it('turns a thrown permission failure into a plain message', async () => {
    mocks.getEmployeeTraining.mockRejectedValueOnce(new Error('Insufficient permissions'))
    render(<EmployeeTrainingTab employeeId="emp-1" />)

    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument()
  })
})

describe('itemActions', () => {
  it('offers unlock on a locked online item, and nothing on a closed one', () => {
    expect(itemActions(item({ assignment: { status: 'locked', lockedSection: 'allergens' } }))).toEqual(['unlock', 'extend', 'waive'])
    expect(itemActions(item({ assignment: { status: 'completed' } }))).toEqual([])
    expect(itemActions(item({ assignment: { status: 'waived' } }))).toEqual([])
  })

  it('offers Prepare Again after a decline, or when no confirmation document was made', () => {
    expect(itemActions(item({ assignment: { status: 'declined' } }))).toContain('prepare_again')
    expect(itemActions(item({ assignment: { status: 'awaiting_confirmation', signingDocumentId: null } }))).toEqual([
      'prepare_again',
      'waive',
    ])
    expect(itemActions(item({ assignment: { status: 'awaiting_confirmation', signingDocumentId: 'doc-1' } }))).toEqual(['waive'])
  })

  it('offers a sign-off on practical items and a record on external ones', () => {
    const practical = item({ course: { id: 'c', slug: 'kegs', title: 'Kegs', kind: 'practical', isEssentials: false }, assignment: { status: 'assigned' } })
    expect(itemActions(practical)).toEqual(['record_signoff', 'extend', 'waive'])
    const external = item({ course: { id: 'x', slug: 'food-hygiene', title: 'Food hygiene', kind: 'external', isEssentials: false }, assignment: { status: 'assigned' } })
    expect(itemActions(external)).toEqual(['record_external', 'extend', 'waive'])
  })

  it('lets a practical sign-off be recorded again once its document ran out or was withdrawn', () => {
    expect(itemActions(awaitingSignoff('expired'))).toEqual(['record_signoff', 'waive'])
    expect(itemActions(awaitingSignoff('voided'))).toEqual(['record_signoff', 'waive'])
  })

  it('offers a new in-person link, not a new sign-off, while the sign-off document is still open', () => {
    expect(itemActions(awaitingSignoff('sent'))).toEqual(['sign_in_person', 'waive'])
    expect(itemActions(awaitingSignoff('part_signed'))).toEqual(['sign_in_person', 'waive'])
    // Signed (the hook is finishing it) or declined (the hook moves it to declined): neither.
    expect(itemActions(awaitingSignoff('completed'))).toEqual(['waive'])
    expect(itemActions(awaitingSignoff('declined'))).toEqual(['waive'])
  })

  it('offers Prepare Again on an online item whose certificate ran out or was withdrawn, not one still open', () => {
    expect(itemActions(awaitingCertificate('expired'))).toEqual(['prepare_again', 'waive'])
    expect(itemActions(awaitingCertificate('voided'))).toEqual(['prepare_again', 'waive'])
    expect(itemActions(awaitingCertificate('sent'))).toEqual(['waive'])
    expect(itemActions(awaitingCertificate('completed'))).toEqual(['waive'])
  })

  it('does not move a due date while waiting for a prerequisite', () => {
    expect(itemActions(item({ assignment: { status: 'waiting', dueOn: null } }))).toEqual(['waive'])
  })
})
