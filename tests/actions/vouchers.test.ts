import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Vouchers carry real redeemable value and none of this file was covered.
 *
 * The invariants that matter are the ones that stop the same card being worth money
 * twice: the permission gate, the idempotency key reaching the database function, and
 * a replayed request not writing a second audit entry as though it were a second
 * redemption. The voucher number parser runs for real rather than mocked, because a
 * loose parser is how you redeem the wrong card.
 */

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/dateUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dateUtils')>()
  return { ...actual, getTodayIsoDate: () => '2026-08-17' }
})

import {
  createVoucherBatch,
  issueVoucher,
  redeemVoucher,
  undoVoucherRedeem,
  cancelVoucher,
  getVoucherSummary,
} from '@/app/actions/vouchers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'

const mockedCreateClient = createClient as unknown as Mock
const mockedAdmin = createAdminClient as unknown as Mock
const mockedPermission = checkUserPermission as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock

const VOUCHER_NUMBER = 'AN-2607-0148'

const VOUCHER_ROW = {
  id: 'v-1',
  voucher_number: VOUCHER_NUMBER,
  type_id: 't-1',
  batch_id: 'b-1',
  status: 'issued',
  value_pence: 1000,
  terms_version: 1,
  issued_at: '2026-08-17T10:00:00.000Z',
  issued_by: 'emp-1',
  issued_by_name: 'Sam',
  issued_by_user_id: 'user-1',
  event_id: null,
  won_at_label: 'Quiz night',
  expiry_date: '2026-12-31',
  customer_id: null,
  redeemed_at: null,
  redeemed_by: null,
  redeemed_by_name: null,
  redeemed_by_user_id: null,
  transaction_ref: null,
  booking_ref: null,
  cancelled_at: null,
  cancelled_reason: null,
  replaced_by_id: null,
  replaces_id: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-17T10:00:00.000Z',
}

let rpc: Mock

function setAuth(signedIn: boolean) {
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: signedIn
            ? { id: 'user-1', email: 'sam@example.com', user_metadata: { full_name: 'Sam Manager' } }
            : null,
        },
      }),
    },
  })
}

/** @param employeeStatus 'Active' or anything else, to exercise the active-staff gate */
function setAdmin(opts: { employeeStatus?: string; rpcResult?: any; rpcError?: any } = {}) {
  rpc = vi.fn().mockResolvedValue(
    opts.rpcError
      ? { data: null, error: opts.rpcError }
      : {
          data: opts.rpcResult ?? { success: true, voucher: VOUCHER_ROW, idempotent_replay: false },
          error: null,
        }
  )

  const employeeChain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        employee_id: 'emp-1',
        first_name: 'Sam',
        last_name: 'Jones',
        preferred_name: null,
        status: opts.employeeStatus ?? 'Active',
      },
      error: null,
    }),
  }

  mockedAdmin.mockReturnValue({ from: vi.fn(() => employeeChain), rpc })
}

beforeEach(() => {
  vi.clearAllMocks()
  setAuth(true)
  mockedPermission.mockResolvedValue(true)
  setAdmin()
})

describe('voucher mutations: permission gate', () => {
  const cases: Array<[string, () => Promise<{ error?: string }>]> = [
    ['issueVoucher', () => issueVoucher({ voucherNumber: VOUCHER_NUMBER, employeeId: '11111111-1111-4111-8111-111111111111', wonAtLabel: 'Quiz', expiryDate: '2026-12-31', idempotencyKey: 'perm-key-1' })],
    ['redeemVoucher', () => redeemVoucher({ voucherNumber: VOUCHER_NUMBER, employeeId: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'perm-key-2' })],
    ['undoVoucherRedeem', () => undoVoucherRedeem({ voucherNumber: VOUCHER_NUMBER, reason: 'Rang it up twice', idempotencyKey: 'perm-key-3' })],
    ['cancelVoucher', () => cancelVoucher({ voucherNumber: VOUCHER_NUMBER, reason: 'Card destroyed', idempotencyKey: 'perm-key-4' })],
  ]

  it.each(cases)('%s refuses a user without vouchers manage and touches no RPC', async (_name, run) => {
    mockedPermission.mockResolvedValue(false)

    const result = await run()

    expect(result.error).toMatch(/permission/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(cases)('%s refuses an unauthenticated caller and touches no RPC', async (_name, run) => {
    setAuth(false)

    const result = await run()

    expect(result.error).toMatch(/permission/i)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('redeemVoucher: not paying out twice', () => {
  const input = {
    voucherNumber: VOUCHER_NUMBER,
    employeeId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'redeem-key-1',
  }

  it('hands the idempotency key to the database function', async () => {
    await redeemVoucher(input)

    // Without this reaching the RPC, a double-submit redeems the card twice.
    expect(rpc).toHaveBeenCalledWith('voucher_redeem', expect.objectContaining({
      p_voucher_number: VOUCHER_NUMBER,
      p_idempotency_key: 'redeem-key-1',
      p_user_id: 'user-1',
    }))
  })

  it('passes the discount given to the database function, and nothing when none was typed', async () => {
    await redeemVoucher({ ...input, redeemedValuePence: 412 })
    expect(rpc).toHaveBeenLastCalledWith('voucher_redeem', expect.objectContaining({ p_redeemed_value_pence: 412 }))

    await redeemVoucher(input)
    expect(rpc).toHaveBeenLastCalledWith('voucher_redeem', expect.objectContaining({ p_redeemed_value_pence: null }))
  })

  it('refuses a negative discount before calling the database', async () => {
    const result = await redeemVoucher({ ...input, redeemedValuePence: -1 })

    expect(result.error).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not write a second audit entry when the database reports a replay', async () => {
    setAdmin({ rpcResult: { success: true, voucher: VOUCHER_ROW, idempotent_replay: true } })

    const result = await redeemVoucher(input)

    expect(result.success).toBe(true)
    expect(result.data?.idempotentReplay).toBe(true)
    // A replay is the same redemption reaching us twice, not a second one.
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('writes exactly one audit entry for a genuine redemption', async () => {
    await redeemVoucher(input)

    expect(mockedAudit).toHaveBeenCalledTimes(1)
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_status: 'success',
      additional_info: expect.objectContaining({ voucher_number: VOUCHER_NUMBER }),
    }))
  })

  it('surfaces a refusal from the database rather than reporting success', async () => {
    setAdmin({ rpcResult: { success: false, error_code: 'already_redeemed' } })

    const result = await redeemVoucher(input)

    expect(result.success).toBeUndefined()
    expect(result.error).toBeTruthy()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('honours success:false even when the database still returns the voucher row', async () => {
    // The shape that matters: the function refuses the redemption but still reports
    // the card's current state. Checking only for a missing voucher row would read
    // that as a successful redemption and mark a spent card as freshly redeemed.
    setAdmin({
      rpcResult: { success: false, error_code: 'already_redeemed', voucher: VOUCHER_ROW },
    })

    const result = await redeemVoucher(input)

    expect(result.success).toBeUndefined()
    expect(result.error).toBeTruthy()
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('surfaces a database failure rather than reporting success', async () => {
    setAdmin({ rpcError: { message: 'connection reset' } })

    const result = await redeemVoucher(input)

    expect(result.success).toBeUndefined()
    expect(result.error).toMatch(/something went wrong/i)
  })
})

describe('voucher number parsing', () => {
  it('refuses a partial number instead of guessing which card was meant', async () => {
    const result = await redeemVoucher({
      voucherNumber: '0148',
      employeeId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'valid-key-1',
    })

    expect(result.error).toMatch(/full voucher number/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('normalises a lowercase, loosely spaced number to the canonical form', async () => {
    const result = await redeemVoucher({
      voucherNumber: ' an-2607-0148 ',
      employeeId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'valid-key-1',
    })

    expect(result.success).toBe(true)
    expect(rpc).toHaveBeenCalledWith('voucher_redeem', expect.objectContaining({
      p_voucher_number: VOUCHER_NUMBER,
    }))
  })
})

describe('issueVoucher', () => {
  const base = {
    voucherNumber: VOUCHER_NUMBER,
    employeeId: '11111111-1111-4111-8111-111111111111',
    wonAtLabel: 'Quiz night',
    idempotencyKey: 'issue-key-1',
  }

  it('refuses an expiry date already in the past', async () => {
    const result = await issueVoucher({ ...base, expiryDate: '2026-08-16' })

    expect(result.error).toMatch(/expiry date cannot be in the past/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts an expiry date of today', async () => {
    const result = await issueVoucher({ ...base, expiryDate: '2026-08-17' })

    expect(result.success).toBe(true)
  })

  it('refuses a staff member who is not active', async () => {
    setAdmin({ employeeStatus: 'Left' })

    const result = await issueVoucher({ ...base, expiryDate: '2026-12-31' })

    expect(result.error).toMatch(/active staff member/i)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires somewhere the voucher was won', async () => {
    const result = await issueVoucher({ ...base, wonAtLabel: '   ', expiryDate: '2026-12-31' })

    expect(result.error).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('undoVoucherRedeem and cancelVoucher', () => {
  it('undo requires a reason, which goes on the record', async () => {
    const result = await undoVoucherRedeem({
      voucherNumber: VOUCHER_NUMBER,
      reason: '',
      idempotencyKey: 'valid-key-1',
    })

    expect(result.error).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('undo passes the reason and idempotency key to the database', async () => {
    await undoVoucherRedeem({
      voucherNumber: VOUCHER_NUMBER,
      reason: 'Rang it up twice',
      idempotencyKey: 'undo-key-1',
    })

    expect(rpc).toHaveBeenCalledWith('voucher_undo_redeem', expect.objectContaining({
      p_reason: 'Rang it up twice',
      p_idempotency_key: 'undo-key-1',
    }))
  })

  it('cancel requires a reason', async () => {
    const result = await cancelVoucher({
      voucherNumber: VOUCHER_NUMBER,
      reason: '',
      idempotencyKey: 'valid-key-1',
    })

    expect(result.error).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('createVoucherBatch: email-only vouchers are never printed', () => {
  function setTypes(rows: Array<{ id: string; digital_only: boolean }> | null, error: unknown = null) {
    rpc = vi.fn().mockResolvedValue({ data: { success: true, batch_id: 'b-9', total_count: 1 }, error: null })
    const typesChain: any = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: rows, error }),
    }
    mockedAdmin.mockReturnValue({ from: vi.fn(() => typesChain), rpc })
  }

  it('refuses a batch that includes a return-visit type and generates nothing', async () => {
    setTypes([
      { id: 'food-10', digital_only: false },
      { id: 'return-10', digital_only: true },
    ])

    const result = await createVoucherBatch({
      items: [
        { typeId: 'food-10', quantity: 5 },
        { typeId: 'return-10', quantity: 5 },
      ],
    })

    expect(result.error).toMatch(/sent by email only/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses when the types cannot be read, rather than printing blind', async () => {
    setTypes(null, { message: 'boom' })

    const result = await createVoucherBatch({ items: [{ typeId: 'food-10', quantity: 5 }] })

    expect(result.error).toMatch(/could not check/i)
    expect(rpc).not.toHaveBeenCalled()
  })
})


describe('getVoucherSummary (spec 5.4)', () => {
  type Call = { method: string; args: unknown[] }

  function voucher(index: number, overrides: Record<string, unknown> = {}) {
    return {
      id: `v-${String(index).padStart(5, '0')}`,
      status: 'issued',
      type_id: 't-1',
      value_pence: 1000,
      issued_at: '2026-08-10T10:00:00.000Z',
      expiry_date: '2026-12-31',
      redeemed_at: null,
      batch_id: 'b-ready',
      ...overrides,
    }
  }

  /** Answers each table's read; the vouchers read is served in pages from `rows`, honouring range. */
  function setSummaryAdmin(rows: Record<string, unknown>[], opts: { failPage?: number } = {}) {
    const queries: Array<{ table: string; calls: Call[] }> = []
    const from = vi.fn((table: string) => {
      const calls: Call[] = []
      queries.push({ table, calls })
      const builder: Record<string, unknown> = {}
      for (const method of ['select', 'order', 'range', 'eq']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args })
          return builder
        }
      }
      builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
        let result: unknown
        if (table === 'voucher_types') {
          result = {
            data: [
              { id: 't-1', display_title: 'Ten pounds off', value_pence: 1000, digital_only: false },
              { id: 't-2', display_title: 'Free pudding', value_pence: null, digital_only: true },
            ],
            error: null,
          }
        } else if (table === 'voucher_batches') {
          result = {
            data: [
              { id: 'b-ready', created_at: '2026-08-01T00:00:00Z', created_by_name: 'Sam', note: null, total_count: 10, pdf_status: 'ready', render_error: null },
              { id: 'b-pending', created_at: '2026-08-02T00:00:00Z', created_by_name: 'Sam', note: 'New', total_count: 5, pdf_status: 'pending', render_error: null },
            ],
            error: null,
          }
        } else if (table === 'vouchers') {
          const range = calls.find((call) => call.method === 'range')?.args as [number, number]
          const page = Math.floor(range[0] / 1000)
          result = opts.failPage === page
            ? { data: null, error: { message: 'timeout' } }
            : { data: rows.slice(range[0], range[1] + 1), error: null }
        } else {
          throw new Error(`Unexpected table ${table}`)
        }
        return Promise.resolve(result).then(onFulfilled, onRejected)
      }
      return builder
    })
    mockedAdmin.mockReturnValue({ from })
    return { queries }
  }

  it('reads vouchers in id order, page by page, and counts every row once', async () => {
    // 2,300 vouchers: 1,000 issued in stock type t-1, then a mix, across three pages.
    const rows = [
      ...Array.from({ length: 1000 }, (_, i) => voucher(i)),
      ...Array.from({ length: 800 }, (_, i) => voucher(1000 + i, { status: 'generated' })),
      ...Array.from({ length: 300 }, (_, i) => voucher(1800 + i, { status: 'generated', batch_id: 'b-pending' })),
      ...Array.from({ length: 150 }, (_, i) => voucher(2100 + i, { status: 'redeemed', redeemed_at: '2026-08-05T23:30:00.000Z' })),
      ...Array.from({ length: 30 }, (_, i) => voucher(2250 + i, { status: 'cancelled', type_id: 't-2' })),
      ...Array.from({ length: 20 }, (_, i) => voucher(2280 + i, { status: 'expired', type_id: 't-2' })),
    ]
    const { queries } = setSummaryAdmin(rows)

    const result = await getVoucherSummary()

    const voucherReads = queries.filter((query) => query.table === 'vouchers')
    expect(voucherReads.map((query) => query.calls.find((call) => call.method === 'range')?.args)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
    for (const read of voucherReads) {
      expect(read.calls.filter((call) => call.method === 'order').map((call) => call.args)).toEqual([['id', { ascending: true }]])
    }

    expect(result.error).toBeUndefined()
    const data = result.data!
    expect(data.totals).toEqual({ inStock: 800, issued: 1000, redeemed: 150, expired: 20, cancelled: 30 })
    expect(data.tiles).toEqual({ totalInStock: 800, totalOutstanding: 1000, redeemedThisMonth: 150, outstandingValuePence: 1_000_000 })
    expect(data.stock.map((row) => [row.typeId, row.displayTitle, row.inStock, row.lowStock, row.digitalOnly])).toEqual([
      ['t-1', 'Ten pounds off', 800, false, false],
      ['t-2', 'Free pudding', 0, false, true],
    ])
    expect(data.notPrintable).toEqual([
      { batchId: 'b-pending', createdAt: '2026-08-02T00:00:00Z', createdByName: 'Sam', note: 'New', totalCount: 5, pdfStatus: 'pending', renderError: null },
    ])
    // Ages run from the real clock, so check that every issued voucher lands in exactly one bucket.
    expect(data.ageBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1000)
  })

  it('selects only the type and batch fields the overview uses', async () => {
    const { queries } = setSummaryAdmin([voucher(1)])

    await getVoucherSummary()

    const selectOf = (table: string) => queries.find((query) => query.table === table)!.calls.find((call) => call.method === 'select')!.args[0]
    expect(selectOf('voucher_types')).toBe('id, display_title, value_pence, digital_only')
    expect(selectOf('voucher_batches')).toBe('id, created_at, created_by_name, note, total_count, pdf_status, render_error')
  })

  it('returns an error rather than partial totals when a page cannot be read', async () => {
    setSummaryAdmin(Array.from({ length: 1500 }, (_, i) => voucher(i)), { failPage: 1 })

    const result = await getVoucherSummary()

    expect(result).toEqual({ error: 'Could not load vouchers.' })
  })

  it('refuses without vouchers:manage and says so, so the page can redirect', async () => {
    mockedPermission.mockResolvedValue(false)
    setSummaryAdmin([])

    const result = await getVoucherSummary()

    expect(result).toEqual({ error: 'You do not have permission to view vouchers.', forbidden: true })
    expect(mockedAdmin).not.toHaveBeenCalled()
  })
})
