// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * Switching a template on says "this wording may be sent to people to sign". So it has to be the
 * wording the person switching it on has read: a save that lands after they opened the page, or
 * in the moment between the check and the write, must stop the switch, not ride along with it.
 */

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  permission: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.permission }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/signing/staff', () => ({
  getSigningStaffUser: mocks.user,
  canSendSigningKind: vi.fn(async () => true),
  canViewSigningKind: vi.fn(async () => true),
  signingKindsForSubject: vi.fn(() => []),
}))

import { setSigningTemplateActive } from '@/app/actions/signing'

const TEMPLATE = '11111111-1111-4111-8111-111111111111'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'peter@example.test', name: 'Peter Pitcher', position: 'Director' }
const EARLIER_STAFF = '88888888-8888-4888-8888-888888888888'
const FINISHED_BODY = '## What this confirms\nYou have read the policy and you understand what it asks of you at work.'
const UNREAD_BODY = '## What this confirms\nYou agree to work any hours asked of you, with no notice, for no extra pay.'

let db: FakeDb

function templateRow(extra: Row = {}): Row {
  return {
    id: TEMPLATE,
    kind: 'policy_acknowledgement',
    slug: 'policy-phones',
    title: 'Phones at work',
    body: FINISHED_BODY,
    version: 3,
    is_active: false,
    activated_at: null,
    activated_by: null,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-10T09:00:00.000Z',
    updated_by: EARLIER_STAFF,
    ...extra,
  }
}

function seed(template: Row): void {
  db = createFakeDb({ signing_templates: [template] })
  mocks.client = db.client
}

function stored(): Row {
  return db.rows('signing_templates')[0]
}

/** Someone else saves new wording in the moment between this action reading the template and writing to it. */
function saveLandsMeanwhile(): void {
  let landed = false
  db.beforeUpdate((table, matched) => {
    if (table !== 'signing_templates' || landed) return
    landed = true
    for (const row of matched) Object.assign(row, { body: UNREAD_BODY, version: (row.version as number) + 1 })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue(STAFF)
  mocks.permission.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
  seed(templateRow())
})

describe('switching a template on', () => {
  it('switches on the wording that was on screen, and records who did it', async () => {
    const result = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })

    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ id: TEMPLATE, is_active: true, version: 3, body: FINISHED_BODY })
    expect(stored()).toMatchObject({ is_active: true, activated_by: STAFF.id, updated_by: STAFF.id, version: 3 })
    expect(stored().activated_at).toBeTruthy()
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: STAFF.id,
        operation_type: 'activate',
        resource_type: 'signing_template',
        resource_id: TEMPLATE,
        operation_status: 'success',
        old_values: { is_active: false },
        new_values: { is_active: true },
        additional_info: { slug: 'policy-phones', version: 3 },
      })
    )
  })

  it('refuses when the wording was changed after the page was opened, and switches nothing on', async () => {
    // The page shows version 3. Someone has since saved version 4.
    seed(templateRow({ version: 4, body: UNREAD_BODY }))

    const result = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })

    expect(result.success).toBeUndefined()
    expect(result.data).toBeUndefined()
    expect(result.error).toContain('changed after you opened it')
    expect(result.error).toContain('Reload')
    expect(stored()).toMatchObject({ is_active: false, activated_at: null, activated_by: null, version: 4 })
    expect(db.writes).toHaveLength(0)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('refuses a version that is ahead of the stored one too', async () => {
    const result = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 4 })

    expect(result.error).toContain('changed after you opened it')
    expect(stored().is_active).toBe(false)
  })

  it('refuses when a save lands between the check and the write, so wording nobody checked is never switched on', async () => {
    saveLandsMeanwhile()

    const result = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })

    expect(result.success).toBeUndefined()
    expect(result.data).toBeUndefined()
    expect(result.error).toContain('Someone else changed this template')
    expect(result.error).toContain('Reload')
    // The other save stands, and it is still switched off.
    expect(stored()).toMatchObject({ is_active: false, activated_at: null, activated_by: null, version: 4, body: UNREAD_BODY })
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('is still held to the stored version when the caller does not say which version it saw', async () => {
    const result = await setSigningTemplateActive({ id: TEMPLATE, active: true })
    expect(result.data).toMatchObject({ is_active: true, version: 3 })

    seed(templateRow())
    saveLandsMeanwhile()
    const raced = await setSigningTemplateActive({ id: TEMPLATE, active: true })
    expect(raced.error).toContain('Someone else changed this template')
    expect(stored()).toMatchObject({ is_active: false, version: 4 })
  })

  it('still refuses wording that has a gap to fill, however current the version', async () => {
    seed(templateRow({ body: `${FINISHED_BODY}\nNotice period: [[TO CONFIRM: how many weeks]]` }))

    const result = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })

    expect(result.error).toContain('[[TO CONFIRM: how many weeks]]')
    expect(stored().is_active).toBe(false)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('says the wording has changed, before anything about its gaps, when both are true', async () => {
    seed(templateRow({ version: 4, body: `${FINISHED_BODY}\n[[TO CONFIRM: a gap added since]]` }))

    const result = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })

    expect(result.error).toContain('changed after you opened it')
    expect(stored().is_active).toBe(false)
  })

  it('leaves a template that is already on as it is when switched on again with the right version', async () => {
    seed(templateRow({ is_active: true, activated_at: '2026-10-11T09:00:00.000Z', activated_by: EARLIER_STAFF }))

    const result = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })

    expect(result.data).toMatchObject({ is_active: true, version: 3 })
    expect(stored().is_active).toBe(true)
  })
})

describe('switching a template off', () => {
  beforeEach(() => {
    seed(templateRow({ version: 5, is_active: true, activated_at: '2026-10-11T09:00:00.000Z', activated_by: EARLIER_STAFF }))
  })

  it('switches off, keeping the record of who switched it on and when', async () => {
    const result = await setSigningTemplateActive({ id: TEMPLATE, active: false, version: 5 })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ is_active: false, version: 5 })
    expect(stored()).toMatchObject({
      is_active: false,
      activated_at: '2026-10-11T09:00:00.000Z',
      activated_by: EARLIER_STAFF,
      updated_by: STAFF.id,
    })
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'deactivate', old_values: { is_active: true }, new_values: { is_active: false } })
    )
  })

  it('is not held up by an out of date version on screen: stopping a template being sent is always allowed', async () => {
    for (const version of [3, 4, 6, undefined]) {
      seed(templateRow({ version: 5, is_active: true, activated_at: '2026-10-11T09:00:00.000Z', activated_by: EARLIER_STAFF }))

      const result = await setSigningTemplateActive({ id: TEMPLATE, active: false, version })

      expect(result.error, String(version)).toBeUndefined()
      expect(stored().is_active, String(version)).toBe(false)
    }
  })

  it('switches off wording that still has gaps, which could never have been switched on', async () => {
    seed(templateRow({ is_active: true, body: `${FINISHED_BODY}\n[[TO CONFIRM: something]]` }))

    const result = await setSigningTemplateActive({ id: TEMPLATE, active: false })

    expect(result.error).toBeUndefined()
    expect(stored().is_active).toBe(false)
  })
})

describe('who may switch a template, and which', () => {
  it('turns away someone who is not signed in', async () => {
    mocks.user.mockResolvedValue(null)

    expect(await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })).toEqual({ error: 'Unauthorized' })
    expect(stored().is_active).toBe(false)
    expect(mocks.permission).not.toHaveBeenCalled()
  })

  it('turns away someone who may not manage settings', async () => {
    mocks.permission.mockResolvedValue(false)

    expect(await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })).toEqual({ error: 'Insufficient permissions' })
    expect(mocks.permission).toHaveBeenCalledWith('settings', 'manage', STAFF.id)
    expect(stored().is_active).toBe(false)
  })

  it('refuses an id that is not an id, and a template that is not there', async () => {
    expect(await setSigningTemplateActive({ id: 'not-an-id', active: true, version: 3 })).toEqual({ error: 'Unknown template.' })
    expect(await setSigningTemplateActive({ id: '22222222-2222-4222-8222-222222222222', active: true, version: 3 })).toEqual({
      error: 'Template not found.',
    })
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('reports a failure, and switches nothing, when the template cannot be read or written', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      db.failNext({ table: 'signing_templates', operation: 'select', message: 'connection reset', times: 1 })
      const unread = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })
      expect(unread.error).toBeTruthy()
      expect(unread.success).toBeUndefined()

      db.failNext({ table: 'signing_templates', operation: 'update', message: 'connection reset', times: 1 })
      const unwritten = await setSigningTemplateActive({ id: TEMPLATE, active: true, version: 3 })
      expect(unwritten.error).toBeTruthy()
      expect(unwritten.success).toBeUndefined()

      expect(stored().is_active).toBe(false)
      expect(mocks.audit).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
