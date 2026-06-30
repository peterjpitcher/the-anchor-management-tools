import { describe, it, expect, vi } from 'vitest'
import { addRecruitmentCandidateNote, getRecruitmentCandidateTrail, decideRecruitmentApplication } from '../recruitment'

// Minimal Supabase query-builder mock: chain methods return the same builder,
// the builder is thenable (resolves to an empty result), `.single()` resolves a
// row, and `.insert()` payloads are captured.
function makeClient() {
  const inserts: unknown[] = []
  const tables: string[] = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'insert', 'eq', 'in', 'or', 'order', 'limit']) {
    builder[method] = vi.fn((arg?: unknown) => {
      if (method === 'insert') inserts.push(arg)
      return builder
    })
  }
  builder.single = vi.fn(() => Promise.resolve({ data: { id: 'n1' }, error: null }))
  ;(builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: [], error: null })
  const client = { from: vi.fn((table: string) => { tables.push(table); return builder }) }
  return { client, inserts, tables }
}

describe('recruitment candidate notes + trail', () => {
  it('inserts a note with candidate, content and author', async () => {
    const { client, inserts } = makeClient()

    await addRecruitmentCandidateNote(
      { candidateId: 'c1', applicationId: 'a1', content: 'Spoke to them', kind: 'note', userId: 'u1', userEmail: 'pete@x' },
      client as never
    )

    expect(inserts[0]).toMatchObject({
      candidate_id: 'c1',
      application_id: 'a1',
      content: 'Spoke to them',
      kind: 'note',
      created_by: 'u1',
      created_by_email: 'pete@x',
    })
  })

  it('builds a trail of notes plus audit_logs changes for the candidate', async () => {
    const { client, tables } = makeClient()

    const out = await getRecruitmentCandidateTrail('c1', client as never)

    expect(tables).toContain('recruitment_candidate_notes')
    expect(tables).toContain('audit_logs')
    expect(out).toHaveProperty('notes')
    expect(out).toHaveProperty('systemChanges')
  })
})

describe('decideRecruitmentApplication', () => {
  it('reject: transitions to rejected, writes a reason note, sets rejection_reason and retention', async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
    const inserts: unknown[] = []
    const updates: unknown[] = []
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'insert', 'update', 'eq', 'order', 'limit']) {
      builder[method] = vi.fn((arg?: unknown) => {
        if (method === 'insert') inserts.push(arg)
        if (method === 'update') updates.push(arg)
        return builder
      })
    }
    builder.single = vi.fn(() => Promise.resolve({ data: { id: 'a1', candidate_id: 'c1', retention_until: null }, error: null }))
    ;(builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) => resolve({ data: null, error: null })
    const client = {
      from: vi.fn(() => builder),
      rpc: vi.fn((name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args })
        return Promise.resolve({ data: {}, error: null })
      }),
    }

    await decideRecruitmentApplication(
      { applicationId: 'a1', decision: 'reject', reason: 'Not enough bar experience', user: { id: 'u1', email: 'pete@x' } },
      client as never
    )

    expect(rpcCalls.some(call => call.args?.p_to_status === 'rejected')).toBe(true)
    const insertRows = inserts as Array<Record<string, unknown>>
    expect(insertRows.some(row => row?.kind === 'reject' && row?.content === 'Not enough bar experience')).toBe(true)
    const updateRows = updates as Array<Record<string, unknown>>
    expect(updateRows.some(row => row && 'rejection_reason' in row)).toBe(true)
    expect(updateRows.some(row => row && 'retention_until' in row)).toBe(true)
  })
})
