import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mcp/generated/loaders', () => ({ ACTION_MODULES: {}, ROUTE_MODULES: {} }))

import { MAX_RESULT_CHARS, matchRoutePath, toFormData, toText } from '@/lib/mcp/bridge'
import { MAX_QUERY_ROWS, TABLES, queryRecords, validateQuery } from '@/lib/mcp/records'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('toFormData', () => {
  it('repeats array keys, JSON-encodes objects, skips nulls and builds files', async () => {
    const form = toFormData({
      name: 'Parking',
      days: [1, 2],
      meta: { a: 1 },
      empty: null,
      file: { filename: 'r.txt', mimeType: 'text/plain', base64: Buffer.from('hi').toString('base64') },
    })
    expect(form.get('name')).toBe('Parking')
    expect(form.getAll('days')).toEqual(['1', '2'])
    expect(form.get('meta')).toBe('{"a":1}')
    expect(form.has('empty')).toBe(false)
    const file = form.get('file') as File
    expect(file.name).toBe('r.txt')
    expect(file.type).toBe('text/plain')
    // jsdom's File has no text(); the size proves the bytes were decoded from base64.
    expect(file.size).toBe(2)
  })
})

describe('matchRoutePath', () => {
  it('fills single, catch-all and optional catch-all segments', () => {
    expect(matchRoutePath('/api/invoices/[id]/pdf', '/api/invoices/abc/pdf')).toEqual({ id: 'abc' })
    expect(matchRoutePath('/api/training/images/[versionId]/[...src]', '/api/training/images/v1/a/b.png')).toEqual({
      versionId: 'v1',
      src: ['a', 'b.png'],
    })
    expect(matchRoutePath('/api/x/[[...rest]]', '/api/x')).toEqual({ rest: [] })
  })

  it('refuses a path of a different shape', () => {
    expect(matchRoutePath('/api/invoices/[id]/pdf', '/api/invoices/abc')).toBeNull()
    expect(matchRoutePath('/api/invoices/[id]/pdf', '/api/invoices/abc/pdf/extra')).toBeNull()
    expect(matchRoutePath('/api/a/[...rest]', '/api/a')).toBeNull()
  })
})

describe('toText', () => {
  it('cuts a long result and says so', () => {
    const text = toText('x'.repeat(MAX_RESULT_CHARS + 10))
    expect(text.length).toBeLessThan(MAX_RESULT_CHARS + 300)
    expect(text).toContain('Cut at')
  })

  it('serialises bigints, maps and sets', () => {
    expect(JSON.parse(toText({ n: BigInt(5), m: new Map([['a', 1]]), s: new Set([1]) }))).toEqual({ n: '5', m: { a: 1 }, s: [1] })
  })
})

describe('validateQuery', () => {
  const table = TABLES.find((entry) => entry.name === 'customers')!
  const column = table.columns[0].name

  it('accepts a sound query', () => {
    expect(validateQuery({ table: 'customers', select: 'id,first_name', filters: [{ column, op: 'eq', value: 'x' }], limit: 10 })).toBeNull()
  })

  it.each([
    [{ table: 'nope' }, 'No table'],
    [{ table: 'customers', filters: [{ column: 'nope', op: 'eq' as const, value: 1 }] }, 'no column'],
    [{ table: 'customers', filters: [{ column, op: 'in' as const, value: 'x' }] }, 'needs an array'],
    [{ table: 'customers', filters: [{ column, op: 'is' as const, value: 'x' }] }, 'takes null'],
    [{ table: 'customers', order: [{ column: 'nope' }] }, 'to order by'],
    [{ table: 'customers', limit: MAX_QUERY_ROWS + 1 }, 'limit must be'],
    [{ table: 'customers', select: 'id; drop table customers' }, 'select may only'],
  ])('refuses %j', (input, message) => {
    expect(validateQuery(input)).toContain(message)
  })
})

describe('queryRecords', () => {
  it('returns a failed read as an error, never as an empty list', async () => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'order']) builder[method] = () => builder
    builder.range = async () => ({ data: null, error: { message: 'permission denied for table customers', code: '42501' }, count: null })
    const client = { from: () => builder } as unknown as SupabaseClient

    const result = await queryRecords(client, { table: 'customers' })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('permission denied') })
  })

  it('pages with offset and limit and reports whether there is more', async () => {
    const calls: unknown[] = []
    const builder: Record<string, unknown> = {}
    builder.select = (...args: unknown[]) => {
      calls.push(['select', ...args])
      return builder
    }
    builder.range = async (from: number, to: number) => {
      calls.push(['range', from, to])
      return { data: [{ id: 1 }, { id: 2 }], error: null, count: 5 }
    }
    const client = { from: () => builder } as unknown as SupabaseClient

    const result = await queryRecords(client, { table: 'customers', limit: 2, offset: 2, count: true })
    const body = JSON.parse((result.content[0] as { text: string }).text)
    expect(calls).toContainEqual(['range', 2, 3])
    expect(body).toMatchObject({ returned: 2, total: 5, more: true })
  })
})
