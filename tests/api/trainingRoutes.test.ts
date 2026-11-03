import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The three training file routes (build contract 5.5). /api is public at the middleware level,
 * so each route checks the session and the training permissions itself; a portal worker may
 * see the images of a course they have a cycle on, and nothing else.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkUserPermission: vi.fn(),
  getPortalWorker: vi.fn(),
  employeeCanSeeVersion: vi.fn(),
  getVersion: vi.fn(),
  getAssignment: vi.fn(),
  listActivityForExport: vi.fn(),
  trainingObjectResponse: vi.fn(),
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/lib/portal/worker', () => ({ getPortalWorker: mocks.getPortalWorker }))
vi.mock('@/lib/training/storage', () => ({ trainingObjectResponse: mocks.trainingObjectResponse }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/services/training', () => ({
  TrainingService: {
    employeeCanSeeVersion: mocks.employeeCanSeeVersion,
    getVersion: mocks.getVersion,
    getAssignment: mocks.getAssignment,
    listActivityForExport: mocks.listActivityForExport,
  },
}))

import { GET as imageGet } from '@/app/api/training/images/[versionId]/[...src]/route'
import { GET as externalGet } from '@/app/api/training/external/[assignmentId]/route'
import { GET as exportGet } from '@/app/api/training/export/route'

const VERSION_ID = '11111111-1111-4111-8111-111111111111'
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222'
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333'

function signedIn(userId: string | null): void {
  mocks.getUser.mockResolvedValue({ data: { user: userId ? { id: userId } : null } })
}

function permissions(granted: Array<'view' | 'publish'>): void {
  mocks.checkUserPermission.mockImplementation(async (module: string, action: string) =>
    module === 'training' && (granted as string[]).includes(action))
}

function version(state: 'published' | 'draft') {
  return { id: VERSION_ID, state, images: [{ src: 'images/fridge.png', path: `courses/c1/${VERSION_ID}/images/fridge.png` }] }
}

function imageRequest(src: string[]) {
  return imageGet(new NextRequest(`https://management.example/api/training/images/${VERSION_ID}/${src.join('/')}`), {
    params: Promise.resolve({ versionId: VERSION_ID, src }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.trainingObjectResponse.mockResolvedValue(new Response('bytes', { status: 200 }))
  mocks.getPortalWorker.mockResolvedValue(null)
  mocks.employeeCanSeeVersion.mockResolvedValue(false)
})

describe('/api/training/images/[versionId]/[...src]', () => {
  it('refuses without a session', async () => {
    signedIn(null)
    const response = await imageRequest(['images', 'fridge.png'])
    expect(response.status).toBe(401)
    expect(mocks.trainingObjectResponse).not.toHaveBeenCalled()
  })

  it('refuses a signed-in user with no permission and no cycle on the course', async () => {
    signedIn('user-1')
    permissions([])
    mocks.getPortalWorker.mockResolvedValue({ userId: 'user-1', employeeId: EMPLOYEE_ID })
    mocks.employeeCanSeeVersion.mockResolvedValue(false)

    const response = await imageRequest(['images', 'fridge.png'])
    expect(response.status).toBe(403)
    expect(mocks.getVersion).not.toHaveBeenCalled()
  })

  it('serves a published image to a portal worker with a cycle on the course', async () => {
    signedIn('user-1')
    permissions([])
    mocks.getPortalWorker.mockResolvedValue({ userId: 'user-1', employeeId: EMPLOYEE_ID })
    mocks.employeeCanSeeVersion.mockResolvedValue(true)
    mocks.getVersion.mockResolvedValue(version('published'))

    const response = await imageRequest(['images', 'fridge.png'])
    expect(response.status).toBe(200)
    expect(mocks.employeeCanSeeVersion).toHaveBeenCalledWith(EMPLOYEE_ID, VERSION_ID)
    expect(mocks.trainingObjectResponse).toHaveBeenCalledWith(`courses/c1/${VERSION_ID}/images/fridge.png`, expect.objectContaining({ disposition: 'inline', cache: 'private' }))
  })

  it('does not show a draft to someone who can only view', async () => {
    signedIn('user-1')
    permissions(['view'])
    mocks.getVersion.mockResolvedValue(version('draft'))

    const response = await imageRequest(['images', 'fridge.png'])
    expect(response.status).toBe(404)
  })

  it('shows a draft to someone who can publish, for the preview', async () => {
    signedIn('user-1')
    permissions(['view', 'publish'])
    mocks.getVersion.mockResolvedValue(version('draft'))

    const response = await imageRequest(['images', 'fridge.png'])
    expect(response.status).toBe(200)
  })

  it('serves only an image listed on the version, by its exact path', async () => {
    signedIn('user-1')
    permissions(['view', 'publish'])
    mocks.getVersion.mockResolvedValue(version('published'))

    expect((await imageRequest(['images', 'other.png'])).status).toBe(404)
    expect((await imageRequest(['images', '..', 'answers.json'])).status).toBe(404)
    expect(mocks.trainingObjectResponse).not.toHaveBeenCalled()
  })

  it('answers 404 for a version id that is not a uuid, before reading anything', async () => {
    const response = await imageGet(new NextRequest('https://management.example/api/training/images/x/a.png'), {
      params: Promise.resolve({ versionId: 'not-a-uuid', src: ['a.png'] }),
    })
    expect(response.status).toBe(404)
    expect(mocks.getUser).not.toHaveBeenCalled()
  })

  it('answers 500, not a denial, when the database fails', async () => {
    signedIn('user-1')
    permissions(['view'])
    mocks.getVersion.mockRejectedValue(new Error('connection reset'))

    const response = await imageRequest(['images', 'fridge.png'])
    expect(response.status).toBe(500)
  })
})

describe('/api/training/external/[assignmentId]', () => {
  function externalRequest(id = ASSIGNMENT_ID) {
    return externalGet(new NextRequest(`https://management.example/api/training/external/${id}`), {
      params: Promise.resolve({ assignmentId: id }),
    })
  }

  it('refuses without a session', async () => {
    signedIn(null)
    expect((await externalRequest()).status).toBe(401)
  })

  it('refuses without training:view, even for a portal worker', async () => {
    signedIn('user-1')
    permissions([])
    mocks.getPortalWorker.mockResolvedValue({ userId: 'user-1', employeeId: EMPLOYEE_ID })
    expect((await externalRequest()).status).toBe(403)
    expect(mocks.getAssignment).not.toHaveBeenCalled()
  })

  it('downloads the stored certificate for a manager, never cached', async () => {
    signedIn('user-1')
    permissions(['view'])
    mocks.getAssignment.mockResolvedValue({ id: ASSIGNMENT_ID, externalFilePath: `external/${ASSIGNMENT_ID}/cert.PDF` })

    const response = await externalRequest()
    expect(response.status).toBe(200)
    expect(mocks.trainingObjectResponse).toHaveBeenCalledWith(`external/${ASSIGNMENT_ID}/cert.PDF`, {
      disposition: 'attachment',
      cache: 'no-store',
      fileName: 'certificate.pdf',
    })
  })

  it('answers 404 when there is no certificate stored', async () => {
    signedIn('user-1')
    permissions(['view'])
    mocks.getAssignment.mockResolvedValue({ id: ASSIGNMENT_ID, externalFilePath: null })
    expect((await externalRequest()).status).toBe(404)
  })
})

describe('/api/training/export', () => {
  function exportRequest(query = '') {
    return exportGet(new NextRequest(`https://management.example/api/training/export${query}`))
  }

  it('refuses without a session', async () => {
    signedIn(null)
    expect((await exportRequest()).status).toBe(401)
    expect(mocks.listActivityForExport).not.toHaveBeenCalled()
  })

  it('refuses without training:view', async () => {
    signedIn('user-1')
    permissions([])
    expect((await exportRequest()).status).toBe(403)
    expect(mocks.listActivityForExport).not.toHaveBeenCalled()
  })

  it('refuses an employee id that is not a uuid', async () => {
    expect((await exportRequest('?employeeId=1%20or%201')).status).toBe(400)
  })

  it('downloads the log as a CSV, audited, with formula-looking text made safe', async () => {
    signedIn('user-1')
    permissions(['view'])
    mocks.listActivityForExport.mockResolvedValue([
      {
        id: 'ev1',
        createdAt: '2026-11-02T09:05:00.000Z',
        eventType: 'reminder_sent',
        employeeId: EMPLOYEE_ID,
        employeeName: 'Sam Taylor',
        courseId: 'c1',
        courseTitle: 'Food Safety',
        assignmentId: ASSIGNMENT_ID,
        actorName: 'System',
        noteCode: 'assigned',
        note: '=HYPERLINK("x")',
        meta: { step: 'assigned', dueOn: '2026-11-16' },
      },
    ])

    const response = await exportRequest(`?employeeId=${EMPLOYEE_ID}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="training-log-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const text = await response.text()
    expect(text).toContain('Staff training log: Sam Taylor')
    expect(text).toContain('As at ')
    expect(text).toContain('2026-11-02')
    expect(text).toContain('09:05')
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m)
    expect(text).not.toMatch(/undefined|Invalid Date|NaN/)
    expect(mocks.listActivityForExport).toHaveBeenCalledWith({ employeeId: EMPLOYEE_ID })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      operation_type: 'export',
      resource_type: 'training_log',
      resource_id: EMPLOYEE_ID,
    }))
  })

  it('answers 500 with a plain message when the read fails', async () => {
    signedIn('user-1')
    permissions(['view'])
    mocks.listActivityForExport.mockRejectedValue(new Error('timeout'))
    const response = await exportRequest()
    expect(response.status).toBe(500)
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })
})
