// @vitest-environment node
// The four policy drafts that staff training replaced (migration 20261103090300) can never be
// sent again, so the Policies page does not list them.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  canView: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/signing/staff', () => ({
  getSigningStaffUser: mocks.user,
  canSendSigningKind: vi.fn(),
  canViewSigningKind: mocks.canView,
}))
vi.mock('@/lib/signing/documents/worker-agreement', () => ({ loadWorkerAgreement: vi.fn() }))
vi.mock('@/lib/signing/documents/worker-agreement-slots', () => ({ applyWorkerAgreementSigningSlots: vi.fn() }))
vi.mock('@/lib/signing/prepare', () => ({ prepareSigningDocument: vi.fn() }))
vi.mock('@/lib/signing/send-template', () => ({ sendTemplateSigningRequest: vi.fn() }))
vi.mock('@/lib/signing/templates', () => ({ getSigningTemplateBySlug: vi.fn() }))

import { getPolicyTemplates } from '@/app/actions/signing-staff'

function policy(slug: string, title: string, isActive: boolean) {
  return { id: slug, slug, title, kind: 'policy_acknowledgement', version: 1, is_active: isActive }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ id: 'user-1', email: 'manager@example.test' })
  mocks.canView.mockResolvedValue(true)
  mocks.client = createFakeDb({
    signing_templates: [
      policy('health-and-safety', 'Health and safety', false),
      policy('allergens', 'Allergens', false),
      policy('challenge-25', 'Challenge 25', false),
      policy('data-protection', 'Data protection', false),
      policy('cash-handling', 'Cash handling', true),
      policy('uniform', 'Uniform', false),
    ],
  }).client
})

describe('the Policies page list', () => {
  it('leaves out the four policies staff training replaced', async () => {
    const result = await getPolicyTemplates()

    expect(result.error).toBeUndefined()
    expect(result.data?.map((row) => row.slug).sort()).toEqual(['cash-handling', 'uniform'])
  })

  it('still lists every other policy, switched on or off', async () => {
    const result = await getPolicyTemplates()

    expect(result.data).toEqual(
      expect.arrayContaining([
        { slug: 'cash-handling', title: 'Cash handling', version: 1, isActive: true },
        { slug: 'uniform', title: 'Uniform', version: 1, isActive: false },
      ])
    )
  })
})
