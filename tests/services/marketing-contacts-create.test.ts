import { beforeEach, describe, expect, it, vi } from 'vitest'

const insertResult = vi.fn()

// One chain serves both queries createContact makes: the do-not-contact lookup (maybeSingle)
// and the insert (single).
function chain() {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'insert']) builder[method] = () => builder
  builder.maybeSingle = async () => ({ data: null, error: null })
  builder.single = async () => insertResult()
  return builder
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => chain() }),
}))

import { createContact } from '@/services/marketing-contacts'

beforeEach(() => {
  insertResult.mockReset()
})

describe('createContact', () => {
  it('says plainly when the address is already a contact', async () => {
    insertResult.mockReturnValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "business_contacts_email_key"',
      },
    })

    await expect(createContact({ email: 'Jo@Acme.co.uk' }, 'user-1')).rejects.toThrow(
      'jo@acme.co.uk is already in your contacts',
    )
  })

  it('passes any other database failure through', async () => {
    insertResult.mockReturnValue({ data: null, error: { code: '42501', message: 'permission denied' } })

    await expect(createContact({ email: 'jo@acme.co.uk' }, 'user-1')).rejects.toThrow('permission denied')
  })
})
