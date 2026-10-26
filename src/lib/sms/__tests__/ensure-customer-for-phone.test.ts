import { describe, it, expect, vi } from 'vitest'
import { ensureCustomerForPhone } from '../customers'

// ---------------------------------------------------------------------------
// In-memory fake of the `customers` table that enforces the two unique indexes
// present in production:
//   - idx_customers_mobile_e164 : unique(mobile_e164) where not null
//   - idx_customers_email_unique: unique(lower(email))  where not null
// This lets us faithfully reproduce the 23505 unique-violation that was
// blocking returning customers from booking.
// ---------------------------------------------------------------------------

type Row = {
  id: string
  mobile_e164: string | null
  mobile_number: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  created_at: string
}

const lower = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

function makeDb(seed: Partial<Row>[] = []) {
  let seq = 0
  const rows: Row[] = seed.map((r, i) => ({
    id: r.id ?? `seed-${i}`,
    mobile_e164: r.mobile_e164 ?? null,
    mobile_number: r.mobile_number ?? r.mobile_e164 ?? null,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    email: r.email ?? null,
    created_at: r.created_at ?? `2025-01-0${i + 1}T00:00:00Z`,
  }))

  function query() {
    const state: {
      op: 'select' | 'insert' | 'update'
      filters: Array<['eq' | 'in' | 'ilike', string, unknown]>
      insertPayload: Partial<Row> | null
      updatePayload: Partial<Row> | null
    } = { op: 'select', filters: [], insertPayload: null, updatePayload: null }

    const applyFilters = (list: Row[]): Row[] => {
      let out = list
      for (const [type, col, val] of state.filters) {
        if (type === 'eq') out = out.filter(r => (r as Record<string, unknown>)[col] === val)
        else if (type === 'in') out = out.filter(r => (val as unknown[]).includes((r as Record<string, unknown>)[col]))
        else if (type === 'ilike') out = out.filter(r => lower((r as Record<string, string | null>)[col]) === lower(val as string))
      }
      return out.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
    }

    const runInsert = () => {
      const p = state.insertPayload as Partial<Row>
      if (p.mobile_e164 != null && rows.some(r => r.mobile_e164 === p.mobile_e164)) {
        return { data: null, error: { code: '23505', message: 'idx_customers_mobile_e164' } }
      }
      if (p.email != null && rows.some(r => r.email != null && lower(r.email) === lower(p.email))) {
        return { data: null, error: { code: '23505', message: 'idx_customers_email_unique' } }
      }
      const row: Row = {
        id: `new-${++seq}`,
        mobile_e164: p.mobile_e164 ?? null,
        mobile_number: p.mobile_number ?? p.mobile_e164 ?? null,
        first_name: p.first_name ?? null,
        last_name: p.last_name ?? null,
        email: p.email ?? null,
        created_at: `2026-07-05T00:00:0${seq}Z`,
      }
      rows.push(row)
      return { data: { id: row.id }, error: null }
    }

    const runUpdate = () => {
      const matched = applyFilters(rows)
      if (matched[0]) Object.assign(matched[0], state.updatePayload)
      return { data: matched[0] ? { id: matched[0].id } : null, error: null }
    }

    const builder: Record<string, unknown> = {}
    builder.select = vi.fn(() => builder)
    builder.insert = vi.fn((payload: Partial<Row>) => { state.op = 'insert'; state.insertPayload = payload; return builder })
    builder.update = vi.fn((payload: Partial<Row>) => { state.op = 'update'; state.updatePayload = payload; return builder })
    builder.eq = vi.fn((col: string, val: unknown) => { state.filters.push(['eq', col, val]); return builder })
    builder.in = vi.fn((col: string, val: unknown) => { state.filters.push(['in', col, val]); return builder })
    builder.ilike = vi.fn((col: string, val: unknown) => { state.filters.push(['ilike', col, val]); return builder })
    builder.order = vi.fn(() => builder)
    // Terminals
    builder.limit = vi.fn(() => Promise.resolve({ data: applyFilters(rows), error: null }))
    builder.single = vi.fn(() => Promise.resolve(state.op === 'insert' ? runInsert() : { data: applyFilters(rows)[0] ?? null, error: null }))
    builder.maybeSingle = vi.fn(() => Promise.resolve(state.op === 'update' ? runUpdate() : { data: applyFilters(rows)[0] ?? null, error: null }))
    return builder
  }

  return {
    from: vi.fn(() => query()),
    __rows: rows,
  }
}

describe('ensureCustomerForPhone – email unique-index handling', () => {
  it('gives an unknown number its own customer when the typed email is on another customer, and leaves that customer alone (BK-077)', async () => {
    const db = makeDb([
      {
        id: 'c1',
        mobile_e164: '+447700900001',
        mobile_number: '+447700900001',
        first_name: 'Repeat',
        last_name: 'Customer',
        email: 'repeat@example.com',
      },
    ])

    // Someone books with a number we do not know and an email that is already on c1. Until
    // October 2026 the booking was put on c1, so c1's mobile got this guest's texts.
    const result = await ensureCustomerForPhone(db as never, '+447700900999', {
      firstName: 'Someone',
      lastName: 'Else',
      email: 'Repeat@Example.com',
    })

    expect(result.resolutionError).toBeUndefined()
    expect(result.customerId).not.toBe('c1')
    expect(db.__rows).toHaveLength(2)
    const created = db.__rows.find((row) => row.id === result.customerId)
    expect(created).toMatchObject({ mobile_e164: '+447700900999', email: null, first_name: 'Someone' })
    // The other customer's record is untouched.
    expect(db.__rows.find((row) => row.id === 'c1')).toMatchObject({
      mobile_e164: '+447700900001',
      first_name: 'Repeat',
      last_name: 'Customer',
      email: 'repeat@example.com',
    })
    // The typed address stays with this booking.
    expect(result.bookingContactEmail).toBe('repeat@example.com')
  })

  it('never writes a website-typed email onto a known number whose record has none (BK-077)', async () => {
    const db = makeDb([
      { id: 'c1', mobile_e164: '+447700900001', first_name: 'Regular', last_name: 'Guest', email: null },
    ])

    const result = await ensureCustomerForPhone(db as never, '+447700900001', {
      firstName: 'Regular',
      lastName: 'Guest',
      email: 'someone.typed@example.com',
    })

    expect(result.customerId).toBe('c1')
    expect(db.__rows[0].email).toBeNull()
    expect(result.bookingContactEmail).toBe('someone.typed@example.com')
  })

  it('lets a staff entry fill a blank email on the matched customer', async () => {
    const db = makeDb([
      { id: 'c1', mobile_e164: '+447700900001', first_name: 'Regular', last_name: 'Guest', email: null },
    ])

    const result = await ensureCustomerForPhone(
      db as never,
      '+447700900001',
      { firstName: 'Regular', lastName: 'Guest', email: 'regular@example.com' },
      { trustedEntry: true }
    )

    expect(result.customerId).toBe('c1')
    expect(db.__rows[0].email).toBe('regular@example.com')
    expect(result.bookingContactEmail).toBeNull()
  })

  it('keeps a different typed email on the booking and never replaces the stored one (BK-078)', async () => {
    const db = makeDb([
      { id: 'c1', mobile_e164: '+447700900001', first_name: 'Regular', last_name: 'Guest', email: 'old@example.com' },
    ])

    const result = await ensureCustomerForPhone(
      db as never,
      '+447700900001',
      { firstName: 'Regular', lastName: 'Guest', email: 'New@Example.com' },
      { trustedEntry: true }
    )

    expect(result.customerId).toBe('c1')
    expect(db.__rows[0].email).toBe('old@example.com')
    expect(result.bookingContactEmail).toBe('new@example.com')
  })

  it('matches an existing customer by phone without inserting (happy path unchanged)', async () => {
    const db = makeDb([
      {
        id: 'c1',
        mobile_e164: '+447700900001',
        mobile_number: '+447700900001',
        first_name: 'Regular',
        last_name: 'Guest',
        email: 'regular@example.com',
      },
    ])

    const result = await ensureCustomerForPhone(db as never, '+447700900001', {
      firstName: 'Regular',
      lastName: 'Guest',
      email: 'regular@example.com',
    })

    expect(result.resolutionError).toBeUndefined()
    expect(result.customerId).toBe('c1')
    expect(db.__rows).toHaveLength(1)
    // The record already holds the typed address, so the booking needs no copy of it.
    expect(result.bookingContactEmail).toBeNull()
  })

  it('creates a new customer when neither phone nor email exist (happy path unchanged)', async () => {
    const db = makeDb([])

    const result = await ensureCustomerForPhone(db as never, '+447700900123', {
      firstName: 'Brand',
      lastName: 'New',
      email: 'brand.new@example.com',
    })

    expect(result.resolutionError).toBeUndefined()
    expect(result.customerId).toBeTruthy()
    expect(db.__rows).toHaveLength(1)
    expect(db.__rows[0].email).toBe('brand.new@example.com')
  })
})
