import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { attachSentBy, messageIdFromCommunicationId } from '@/lib/messages/sent-by'
import type { CustomerCommunication } from '@/types/communications'

const M1 = '11111111-1111-4111-8111-111111111111'
const M2 = '22222222-2222-4222-8222-222222222222'

function comm(id: string, direction: 'inbound' | 'outbound'): CustomerCommunication {
  return { id, direction } as CustomerCommunication
}

function client(tables: Record<string, { data: unknown; error: unknown }>) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.in = () => Promise.resolve(tables[table])
      return chain
    },
  }
}

describe('who sent a staff-typed text (BK-182)', () => {
  it('reads the messages id out of a timeline id', () => {
    expect(messageIdFromCommunicationId(`sms:${M1}`)).toBe(M1)
    expect(messageIdFromCommunicationId(`email:${M1}`)).toBeNull()
  })

  it('names the staff member on their texts only', async () => {
    const result = await attachSentBy(
      client({
        messages: { data: [{ id: M1, metadata: { sent_by_user_id: 'user-1' } }, { id: M2, metadata: { template_key: 'auto' } }], error: null },
        employees: { data: [{ auth_user_id: 'user-1', first_name: 'Amanda', last_name: 'Smith', preferred_name: 'Mandy' }], error: null },
      }) as never,
      [comm(`sms:${M1}`, 'outbound'), comm(`sms:${M2}`, 'outbound'), comm(`sms:${M1}`, 'inbound')]
    )
    expect(result[0].sent_by).toMatch(/Mandy/)
    expect(result[1].sent_by).toBeUndefined()
    expect(result[2].sent_by).toBeUndefined()
  })

  it('says a team member when the sender is not an employee', async () => {
    const result = await attachSentBy(
      client({
        messages: { data: [{ id: M1, metadata: { sent_by_user_id: 'user-9' } }], error: null },
        employees: { data: [], error: null },
      }) as never,
      [comm(`sms:${M1}`, 'outbound')]
    )
    expect(result[0].sent_by).toBe('a team member')
  })

  it('leaves the thread alone when the lookup fails', async () => {
    const input = [comm(`sms:${M1}`, 'outbound')]
    const result = await attachSentBy(client({ messages: { data: null, error: { message: 'timeout' } } }) as never, input)
    expect(result).toEqual(input)
  })
})
