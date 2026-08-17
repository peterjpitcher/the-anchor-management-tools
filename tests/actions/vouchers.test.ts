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
  issueVoucher,
  redeemVoucher,
  undoVoucherRedeem,
  cancelVoucher,
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
