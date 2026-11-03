import type {
  EmployeeAssignmentItem,
  EmployeeTrainingView,
  MatrixCell,
  MatrixCourse,
  MatrixPerson,
  TrainingAssignment,
  TrainingMatrix,
} from '@/lib/training/types'

/** Test data for the manager training screens. No real people: names are invented. */

export const ESSENTIALS: MatrixCourse = {
  id: 'course-essentials',
  slug: 'essentials',
  title: 'Essentials',
  kind: 'online',
  isEssentials: true,
  displayOrder: 1,
  requiredCount: 3,
  completedCount: 1,
  completionRate: 1 / 3,
}

export const KEGS: MatrixCourse = {
  id: 'course-kegs',
  slug: 'kegs',
  title: 'Changing a keg',
  kind: 'practical',
  isEssentials: false,
  displayOrder: 20,
  requiredCount: 0,
  completedCount: 0,
  completionRate: null,
}

export function cell(courseId: string, patch: Partial<MatrixCell> = {}): MatrixCell {
  return {
    courseId,
    assignmentId: `a-${courseId}`,
    state: 'not_started',
    dueOn: null,
    daysOverdue: null,
    completedOn: null,
    expiresOn: null,
    supervisedOnly: false,
    ...patch,
  }
}

export function person(id: string, name: string, patch: Partial<MatrixPerson> = {}): MatrixPerson {
  return {
    employeeId: id,
    name,
    status: 'Active',
    jobTitle: 'Bar Staff',
    groups: ['bar'],
    suggestedGroups: ['bar'],
    groupsConfirmed: true,
    paused: false,
    flags: [],
    cells: {},
    ...patch,
  }
}

export function matrixFixture(): TrainingMatrix {
  return {
    today: '2026-11-10',
    courses: [ESSENTIALS, KEGS],
    people: [
      person('emp-1', 'Avery Test', {
        cells: {
          [ESSENTIALS.id]: cell(ESSENTIALS.id, { state: 'done', completedOn: '2026-11-02', expiresOn: '2027-11-02' }),
          [KEGS.id]: cell(KEGS.id, { state: 'awaiting_confirmation', supervisedOnly: true }),
        },
      }),
      person('emp-2', 'Blake Sample', {
        jobTitle: 'Cook',
        groupsConfirmed: false,
        flags: ['groups_not_confirmed', 'no_login', 'dob_missing'],
        cells: {
          [ESSENTIALS.id]: cell(ESSENTIALS.id, { state: 'overdue', dueOn: '2026-11-07', daysOverdue: 3 }),
          [KEGS.id]: cell(KEGS.id, { state: 'not_required', assignmentId: null }),
        },
      }),
      person('emp-3', 'Casey Example', {
        status: 'Started Separation',
        paused: true,
        cells: {
          [ESSENTIALS.id]: cell(ESSENTIALS.id, { state: 'locked', dueOn: '2026-11-20' }),
          // The kegs cell is left out on purpose: a missing cell reads as "Not required".
        },
      }),
    ],
  }
}

export function assignment(patch: Partial<TrainingAssignment> = {}): TrainingAssignment {
  return {
    id: 'assign-1',
    employeeId: 'emp-1',
    courseId: ESSENTIALS.id,
    cycle: 1,
    reason: 'new_starter',
    status: 'in_progress',
    assignedOn: '2026-11-01',
    dueOn: '2026-11-15',
    windowOpensOn: null,
    versionId: 'version-1',
    progress: { sections: {}, current: null, introSeen: true },
    startedAt: '2026-11-02T10:00:00.000Z',
    lastSectionPassedAt: null,
    completedOn: null,
    expiresOn: null,
    certificateNumber: null,
    signingDocumentId: null,
    confirmedAt: null,
    lockedAt: null,
    lockedSection: null,
    declinedAt: null,
    waivedAt: null,
    waivedBy: null,
    waivedByName: null,
    waiveReason: null,
    cancelledAt: null,
    cancelReason: null,
    externalIssuer: null,
    externalReference: null,
    externalIssuedOn: null,
    externalFilePath: null,
    signoffTasks: null,
    signedOffBy: null,
    signedOffByName: null,
    signedOffOn: null,
    supervisedOnly: false,
    dueChangeReason: null,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    ...patch,
  }
}

export function item(
  patch: Omit<Partial<EmployeeAssignmentItem>, 'assignment'> & { assignment?: Partial<TrainingAssignment> } = {},
): EmployeeAssignmentItem {
  const { assignment: assignmentPatch, ...rest } = patch
  return {
    assignment: assignment(assignmentPatch),
    course: { id: ESSENTIALS.id, slug: 'essentials', title: 'Essentials', kind: 'online', isEssentials: true },
    versionLabel: '1.0',
    state: 'in_progress',
    nextReminder: null,
    sections: [
      { key: 'fire', title: 'Fire, 999 and first aid', passed: true, passedAt: '2026-11-02T10:20:00.000Z', fails: 0, attempts: 1, firstAttemptPassed: true },
      { key: 'allergens', title: 'Allergens', passed: false, passedAt: null, fails: 1, attempts: 1, firstAttemptPassed: false },
    ],
    attempts: [],
    certificate: null,
    tasks: null,
    ...rest,
  }
}

export function employeeViewFixture(patch: Partial<EmployeeTrainingView> = {}): EmployeeTrainingView {
  return {
    today: '2026-11-10',
    employee: {
      employeeId: 'emp-1',
      name: 'Avery Test',
      status: 'Active',
      jobTitle: 'Bar Staff',
      startDate: '2026-11-01',
      hasLogin: true,
      dateOfBirthKnown: true,
      under18: false,
    },
    profile: null,
    suggestedGroups: ['bar'],
    groups: ['bar'],
    groupsConfirmed: false,
    pause: null,
    flags: ['groups_not_confirmed'],
    current: [item()],
    history: [],
    assignable: [{ id: KEGS.id, slug: KEGS.slug, title: KEGS.title }],
    ...patch,
  }
}
