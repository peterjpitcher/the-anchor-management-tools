import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The statement import service and the work that follows an import.
 *
 * The database function that stores a statement is tested on a real Postgres in tests/sql. These
 * tests cover what the service sends it, what it tells the user, and that the follow-up work
 * (rules, AI, invoice matching, duplicate check) can stop anywhere and be picked up again.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn() },
}))

vi.mock('@/services/receipts/receiptAutomation', () => ({
  applyAutomationRules: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { jobQueue } from '@/lib/unified-job-queue'
import { applyAutomationRules } from '@/services/receipts/receiptAutomation'
import { performImportReceiptStatement, processReceiptBatchFollowup } from '@/services/receipts/receiptImport'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedEnqueue = jobQueue.enqueue as unknown as Mock
const mockedRules = applyAutomationRules as unknown as Mock

const USER = '22222222-2222-4222-8222-222222222222'
const BATCH = '33333333-3333-4333-8333-333333333333'
const BANK_HEADER = 'Date,Details,Transaction Type,In,Out,Balance'

function statement(lines: string[], name = 'statement.csv') {
  const text = [BANK_HEADER, ...lines].join('\n')
  return { file: new File([text], name, { type: 'text/csv' }), buffer: Buffer.from(text, 'utf-8') }
}

function rulesResult(overrides: Record<string, number> = {}) {
  return {
    statusAutoUpdated: 0,
    classificationUpdated: 0,
    matched: 0,
    vendorIntended: 0,
    expenseIntended: 0,
    protectedCount: 0,
    conflicts: 0,
    failed: 0,
    ...overrides,
  }
}

function transactions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `tx-${String(index + 1).padStart(4, '0')}`,
    batch_id: BATCH,
  }))
}

function seed(batch: Record<string, unknown> = {}, count = 3): FakeDb {
  const db = createFakeDb({
    receipt_batches: [
      { id: BATCH, uploaded_by: USER, followup_status: 'queued', followup_state: {}, followup_error: null, ...batch },
    ],
    receipt_transactions: transactions(count),
  })
  mockedCreateAdminClient.mockReturnValue(db.client)
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedEnqueue.mockResolvedValue({ success: true, jobId: 'job-1' })
  mockedRules.mockResolvedValue(rulesResult())
})

describe('performImportReceiptStatement', () => {
  it('sends the whole account of the file to the database in one call', async () => {
    const db = seed({}, 0)
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
    db.onRpc((name, args) => {
      rpcCalls.push({ name, args })
      return {
        data: {
          outcome: 'imported',
          batch: { id: BATCH, followup_status: 'done' },
          inserted_count: 2,
          duplicate_count: 0,
        },
        error: null,
      }
    })

    const { file, buffer } = statement([
      '01/09/2026,TESCO STORES,Card Purchase,,12.50,1000.00',
      '02/13/2026,BAD DATE,Card Purchase,,5.00,995.00',
      '03/09/2026,CLIENT LTD,Credit,250.00,,1245.00',
    ])
    const result = await performImportReceiptStatement(USER, 'someone@example.com', file, buffer, 'bank')

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].name).toBe('import_receipt_statement')
    const batch = rpcCalls[0].args.p_batch as Record<string, unknown>
    expect(batch).toMatchObject({
      source_type: 'bank',
      original_filename: 'statement.csv',
      uploaded_by: USER,
      records_in_file: 3,
      rejected_count: 1,
      repeated_in_file: 0,
    })
    expect(batch.source_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(batch.rejected_records).toEqual([
      expect.objectContaining({ record: 2, reason: 'impossible_date' }),
    ])

    const rows = rpcCalls[0].args.p_rows as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      source_type: 'bank',
      transaction_date: '2026-09-01',
      details: 'TESCO STORES',
      amount_in: null,
      amount_out: 12.5,
      balance: 1000,
      status: 'pending',
      receipt_required: true,
      vendor_name: null,
    })
    expect(rows[1]).toMatchObject({ amount_in: 250, amount_out: null })

    // inserted + already held + rejected = records in the file
    expect(result).toMatchObject({
      success: true,
      inserted: 2,
      skipped: 0,
      recordsInFile: 3,
      repeatedInFile: 0,
      alreadyImported: false,
      followupStatus: 'done',
    })
    expect(result.rejected).toHaveLength(1)
    expect(result.warning).toBe(
      '1 record could not be read. Record 2: The date "02/13/2026" is not a real date.'
    )
  })

  it('stores nothing and says why when no record in the file can be read', async () => {
    const db = seed({}, 0)
    const rpc = vi.fn()
    db.onRpc(rpc)

    const { file, buffer } = statement([
      '02/13/2026,BAD DATE,Card Purchase,,5.00,995.00',
      '03/09/2026,BAD AMOUNT,Card Purchase,,12abc,990.00',
    ])
    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(rpc).not.toHaveBeenCalled()
    expect(result.success).toBeUndefined()
    expect(result.error).toMatch(/^Nothing was imported: 2 records could not be read\. Record 1: /)
    expect(result.recordsInFile).toBe(2)
    expect(result.rejected).toHaveLength(2)
  })

  it('names the missing column when the file is not a bank statement', async () => {
    const db = seed({}, 0)
    const rpc = vi.fn()
    db.onRpc(rpc)

    const text = 'Date,Description,Amount\n01/09/2026,SOMETHING,1.00\n'
    const result = await performImportReceiptStatement(
      USER,
      '',
      new File([text], 'wrong.csv'),
      Buffer.from(text),
      'bank'
    )

    expect(rpc).not.toHaveBeenCalled()
    expect(result.error).toMatch(/columns are missing/)
  })

  it('reports an empty file plainly', async () => {
    seed({}, 0)
    const text = `${BANK_HEADER}\n`
    const result = await performImportReceiptStatement(USER, '', new File([text], 'empty.csv'), Buffer.from(text), 'bank')

    expect(result).toEqual({ error: 'No transactions were found in the CSV file.' })
  })

  it('says nothing was imported when the database refuses the statement', async () => {
    const db = seed({}, 0)
    db.onRpc(() => ({ data: null, error: { message: 'deadlock detected' } }))
    const { file, buffer } = statement(['01/09/2026,TESCO STORES,Card Purchase,,12.50,1000.00'])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result).toEqual({
      error: 'The statement could not be stored. Nothing was imported, so it is safe to upload it again.',
    })
    expect(mockedRules).not.toHaveBeenCalled()
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('runs the follow-up straight away and reports what the rules did', async () => {
    const db = seed({ followup_status: 'queued' }, 2)
    db.onRpc(() => ({
      data: { outcome: 'imported', batch: { id: BATCH, followup_status: 'queued' }, inserted_count: 2, duplicate_count: 0 },
      error: null,
    }))
    mockedRules.mockResolvedValue(rulesResult({ statusAutoUpdated: 1, classificationUpdated: 2 }))
    const { file, buffer } = statement([
      '01/09/2026,TESCO STORES,Card Purchase,,12.50,1000.00',
      '02/09/2026,CLIENT LTD,Credit,250.00,,1250.00',
    ])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result).toMatchObject({ success: true, autoApplied: 1, autoClassified: 2, followupStatus: 'done' })
    expect(result.warning).toBeUndefined()
    expect(db.rows('receipt_batches')[0].followup_status).toBe('done')
  })

  it('still succeeds, with a warning, when the follow-up fails: the lines are stored and the work is queued', async () => {
    const db = seed({ followup_status: 'queued' }, 2)
    db.onRpc(() => ({
      data: { outcome: 'imported', batch: { id: BATCH, followup_status: 'queued' }, inserted_count: 2, duplicate_count: 0 },
      error: null,
    }))
    mockedRules.mockRejectedValue(new Error('Failed to load receipt rules'))
    const { file, buffer } = statement([
      '01/09/2026,TESCO STORES,Card Purchase,,12.50,1000.00',
      '02/09/2026,CLIENT LTD,Credit,250.00,,1250.00',
    ])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result.success).toBe(true)
    expect(result.inserted).toBe(2)
    expect(result.followupStatus).toBe('queued')
    expect(result.warning).toMatch(/The transactions are stored\..*will be retried in the background\./)
    expect(db.rows('receipt_batches')[0]).toMatchObject({
      followup_status: 'failed',
      followup_error: 'Failed to load receipt rules',
    })
  })

  it('reports a repeat upload that added nothing as already imported, without redoing the follow-up', async () => {
    const db = seed({ followup_status: 'done' }, 2)
    db.onRpc(() => ({
      data: { outcome: 'already_imported', batch: { id: BATCH, followup_status: 'done' }, inserted_count: 0, duplicate_count: 2 },
      error: null,
    }))
    const { file, buffer } = statement([
      '01/09/2026,TESCO STORES,Card Purchase,,12.50,1000.00',
      '02/09/2026,CLIENT LTD,Credit,250.00,,1250.00',
    ])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result).toMatchObject({ success: true, alreadyImported: true, inserted: 0, skipped: 2, followupStatus: 'done' })
    expect(mockedRules).not.toHaveBeenCalled()
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('processes the lines a repeat upload recovers', async () => {
    // The file was imported before the bank's own charges were read. Uploading it again adds them.
    const db = seed({ followup_status: 'queued' }, 3)
    db.onRpc(() => ({
      data: { outcome: 'already_imported', batch: { id: BATCH, followup_status: 'queued' }, inserted_count: 1, duplicate_count: 2 },
      error: null,
    }))
    const { file, buffer } = statement([
      '01/09/2026,TESCO STORES,Card Purchase,,12.50,1000.00',
      '02/09/2026,CLIENT LTD,Credit,250.00,,1250.00',
      '03/09/2026,,Transaction Charges,,7.20,1242.80',
    ])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result).toMatchObject({ success: true, alreadyImported: true, inserted: 1, skipped: 2, followupStatus: 'done' })
    expect(mockedRules).toHaveBeenCalledTimes(1)
  })

  it('reads an American Express file when told it is one', async () => {
    const db = seed({}, 0)
    let sent: Array<Record<string, unknown>> = []
    db.onRpc((_name, args) => {
      sent = args.p_rows as Array<Record<string, unknown>>
      return {
        data: { outcome: 'imported', batch: { id: BATCH, followup_status: 'done' }, inserted_count: 1, duplicate_count: 0 },
        error: null,
      }
    })
    const text = [
      'Date,Description,Card Member,Account #,Amount',
      '03/09/2026,PAYMENT RECEIVED - THANK YOU,MR A PERSON,-12345,-500.00',
    ].join('\n')

    await performImportReceiptStatement(USER, '', new File([text], 'amex.csv'), Buffer.from(text), 'amex')

    expect(sent[0]).toMatchObject({
      source_type: 'amex',
      status: 'no_receipt_required',
      receipt_required: false,
      vendor_name: 'American Express',
      vendor_source: 'import',
      card_account: '12345',
    })
  })
})

describe('processReceiptBatchFollowup', () => {
  it('runs rules, then queues AI, invoice matching and the duplicate check, and marks the batch done', async () => {
    const db = seed({}, 25)
    mockedRules.mockResolvedValue(rulesResult({ statusAutoUpdated: 4, classificationUpdated: 9, conflicts: 1, protectedCount: 2 }))
    const order: string[] = []
    mockedRules.mockImplementation(async () => {
      order.push('rules')
      return rulesResult({ statusAutoUpdated: 4, classificationUpdated: 9, conflicts: 1, protectedCount: 2 })
    })
    mockedEnqueue.mockImplementation(async (type: string) => {
      order.push(type)
      return { success: true, jobId: 'job' }
    })

    const result = await processReceiptBatchFollowup(BATCH, { initiatedBy: USER })

    expect(result).toEqual({ alreadyDone: false, autoApplied: 4, autoClassified: 9 })

    // Rules finish before anything is queued: the AI only looks at what the rules left blank.
    expect(order[0]).toBe('rules')
    expect(mockedRules).toHaveBeenCalledWith(
      transactions(25).map((row) => row.id),
      { performedBy: USER }
    )

    const calls = mockedEnqueue.mock.calls as Array<[string, Record<string, unknown>, Record<string, unknown>]>
    const classify = calls.filter(([type]) => type === 'classify_receipt_transactions')
    // 25 payments in groups of ten
    expect(classify.map(([, payload]) => (payload.transactionIds as string[]).length)).toEqual([10, 10, 5])
    expect(classify.map(([, , options]) => options)).toEqual([
      { priority: -10, unique: `receipts:classify:${BATCH}:0` },
      { priority: -10, unique: `receipts:classify:${BATCH}:1` },
      { priority: -10, unique: `receipts:classify:${BATCH}:2` },
    ])

    const reconcile = calls.filter(([type]) => type === 'reconcile_receipt_invoice_payments')
    expect(reconcile).toHaveLength(1)
    expect(reconcile[0][1]).toMatchObject({ initiated_by: USER })
    expect((reconcile[0][1].transaction_ids as string[]).length).toBe(25)

    expect(calls.filter(([type]) => type === 'refresh_receipt_duplicate_candidates')).toHaveLength(1)

    const batch = db.rows('receipt_batches')[0]
    expect(batch.followup_status).toBe('done')
    expect(batch.followup_error).toBeNull()
    expect(batch.followup_completed_at).toEqual(expect.any(String))
    expect(batch.followup_state).toMatchObject({
      rules: { auto_applied: 4, auto_classified: 9, conflicts: 1, protected: 2 },
      ai: { queued_transactions: 25 },
      reconcile: { jobs: 1 },
      duplicates: true,
    })
  })

  it('sends invoice matching in hundreds, never every payment in one job', async () => {
    seed({}, 230)

    await processReceiptBatchFollowup(BATCH)

    const reconcile = (mockedEnqueue.mock.calls as Array<[string, Record<string, unknown>]>).filter(
      ([type]) => type === 'reconcile_receipt_invoice_payments'
    )
    expect(reconcile.map(([, payload]) => (payload.transaction_ids as string[]).length)).toEqual([100, 100, 30])
  })

  it('credits the work to the person who uploaded the file when the queue runs it', async () => {
    seed({}, 1)

    await processReceiptBatchFollowup(BATCH)

    expect(mockedRules).toHaveBeenCalledWith(['tx-0001'], { performedBy: USER })
  })

  it('does nothing when the batch is already done', async () => {
    const db = seed({
      followup_status: 'done',
      followup_state: { rules: { auto_applied: 3, auto_classified: 5, conflicts: 0, protected: 0 } },
    })

    const result = await processReceiptBatchFollowup(BATCH)

    expect(result).toEqual({ alreadyDone: true, autoApplied: 3, autoClassified: 5 })
    expect(mockedRules).not.toHaveBeenCalled()
    expect(mockedEnqueue).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
  })

  it('records a failed step and throws, so the queue retries', async () => {
    const db = seed({}, 12)
    mockedEnqueue.mockImplementation(async (type: string) =>
      type === 'classify_receipt_transactions' ? { success: false, error: 'queue down' } : { success: true }
    )

    await expect(processReceiptBatchFollowup(BATCH)).rejects.toThrow(
      'AI classification could not be queued for 2 of 2 groups of transactions'
    )

    const batch = db.rows('receipt_batches')[0]
    expect(batch.followup_status).toBe('failed')
    expect(batch.followup_error).toBe('AI classification could not be queued for 2 of 2 groups of transactions')
    // The rules step finished and is remembered. The AI step is not marked done.
    expect(batch.followup_state).toMatchObject({ rules: expect.any(Object) })
    expect((batch.followup_state as Record<string, unknown>).ai).toBeUndefined()
  })

  it('picks up where a failed run stopped, without running the rules twice', async () => {
    const db = seed({}, 12)
    mockedEnqueue.mockImplementationOnce(async () => ({ success: false, error: 'queue down' }))

    await expect(processReceiptBatchFollowup(BATCH)).rejects.toThrow(/AI classification could not be queued/)
    expect(mockedRules).toHaveBeenCalledTimes(1)

    mockedEnqueue.mockResolvedValue({ success: true })
    const result = await processReceiptBatchFollowup(BATCH)

    expect(result.alreadyDone).toBe(false)
    expect(mockedRules).toHaveBeenCalledTimes(1)
    expect(db.rows('receipt_batches')[0]).toMatchObject({ followup_status: 'done', followup_error: null })
  })

  it('fails the batch when rules could not be written to some payments', async () => {
    const db = seed({}, 3)
    mockedRules.mockResolvedValue(rulesResult({ failed: 2 }))

    await expect(processReceiptBatchFollowup(BATCH)).rejects.toThrow('Rules could not be applied to 2 transactions')

    expect(db.rows('receipt_batches')[0].followup_status).toBe('failed')
    expect((db.rows('receipt_batches')[0].followup_state as Record<string, unknown>).rules).toBeUndefined()
    expect(mockedEnqueue).not.toHaveBeenCalled()
  })

  it('stands back when another run started moments ago', async () => {
    const db = seed({
      followup_status: 'running',
      followup_state: { started_at: new Date(Date.now() - 30_000).toISOString() },
    })

    await expect(processReceiptBatchFollowup(BATCH)).rejects.toThrow('Receipt batch follow-up is already running')

    expect(mockedRules).not.toHaveBeenCalled()
    // It must not mark the other run's batch as failed.
    expect(db.writes).toEqual([])
    expect(db.rows('receipt_batches')[0].followup_status).toBe('running')
  })

  it('takes over a run that has been marked running for too long', async () => {
    const db = seed({
      followup_status: 'running',
      followup_state: { started_at: new Date(Date.now() - 10 * 60_000).toISOString() },
    })

    await processReceiptBatchFollowup(BATCH)

    expect(mockedRules).toHaveBeenCalledTimes(1)
    expect(db.rows('receipt_batches')[0].followup_status).toBe('done')
  })

  it('throws when the batch does not exist', async () => {
    seed()

    await expect(processReceiptBatchFollowup('44444444-4444-4444-8444-444444444444')).rejects.toThrow(/not found/)
  })

  it('throws when its progress cannot be saved, rather than carrying on unrecorded', async () => {
    const db = seed({}, 2)
    db.failNext({ table: 'receipt_batches', operation: 'update', message: 'connection reset' })

    await expect(processReceiptBatchFollowup(BATCH)).rejects.toThrow(
      'Failed to record receipt batch follow-up state: connection reset'
    )
    expect(mockedRules).not.toHaveBeenCalled()
  })
})

describe('the bank balance check after an import', () => {
  /** Stores what it is sent, as the real database function does, so the check can see it. */
  function storeOnImport(db: FakeDb) {
    db.onRpc((_name, args) => {
      const rows = args.p_rows as Array<Record<string, unknown>>
      rows.forEach((row, index) => db.rows('receipt_transactions').push({ id: `new-${index + 1}`, batch_id: BATCH, ...row }))
      return {
        data: { outcome: 'imported', batch: { id: BATCH, followup_status: 'done' }, inserted_count: rows.length, duplicate_count: 0 },
        error: null,
      }
    })
  }

  function held(date: string, moneyOut: number, balance: number) {
    return { id: `held-${date}`, source_type: 'bank', transaction_date: date, amount_in: null, amount_out: moneyOut, balance }
  }

  // Opens on 1 June at 50,235.99: 50,038.99 after the first line, plus the 197.00 it paid out.
  const JUNE = ['02/06/2026,NEST,Direct Debit,,38.99,50000.00', '01/06/2026,SPELTHORNE BCCTAX,Direct Debit,,197.00,50038.99']

  it('warns when the statement does not join up with the one held before it', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(held('2026-05-27', 113.78, 48072))
    storeOnImport(db)
    const { file, buffer } = statement(JUNE)

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result.success).toBe(true)
    expect(result.warning).toContain(
      'between 27 May 2026 and 1 June 2026, £2,163.99 more came in than the payments held show'
    )
  })

  it('says nothing when the statement joins up', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(held('2026-05-29', 3.4, 50235.99))
    storeOnImport(db)
    const { file, buffer } = statement(JUNE)

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result).toMatchObject({ success: true, inserted: 2 })
    expect(result.warning).toBeUndefined()
  })

  it('also looks at the statement held after it', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(held('2026-05-29', 3.4, 50235.99), held('2026-06-03', 12.99, 49900))
    storeOnImport(db)
    const { file, buffer } = statement(JUNE)

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result.warning).toContain('between 2 June 2026 and 3 June 2026, £87.01 more went out than the payments held show')
  })

  it('keeps the import and says so when the balance cannot be read', async () => {
    const db = seed({}, 0)
    storeOnImport(db)
    db.failNext({ table: 'receipt_transactions', operation: 'select', message: 'connection reset' })
    const { file, buffer } = statement(JUNE)

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'bank')

    expect(result).toMatchObject({ success: true, inserted: 2 })
    expect(result.warning).toContain('The bank balance could not be checked this time')
  })

  it('does not run on an American Express statement', async () => {
    const db = seed({}, 0)
    // A bank line that would not join up with anything, were the bank check to run.
    db.rows('receipt_transactions').push(held('2026-09-02', 10, 999))
    storeOnImport(db)
    const text = ['Date,Description,Card Member,Account #,Amount', '03/09/2026,TESCO STORE,MR A PERSON,-12345,12.50'].join('\n')

    const result = await performImportReceiptStatement(USER, '', new File([text], 'amex.csv'), Buffer.from(text), 'amex')

    expect(result.success).toBe(true)
    expect(result.warning ?? '').not.toContain('bank balance')
  })
})

describe('Amex lines held from another download', () => {
  const WITH_REFERENCE = 'Date,Description,Card Member,Account #,Amount,Reference'
  const WITHOUT_REFERENCE = 'Date,Description,Card Member,Account #,Amount'

  function amexFile(header: string, lines: string[]) {
    const text = [header, ...lines].join('\n')
    return { file: new File([text], 'activity.csv', { type: 'text/csv' }), buffer: Buffer.from(text, 'utf-8') }
  }

  /** A held Amex line as the import stores it. */
  function heldAmex(overrides: Record<string, unknown> = {}) {
    return {
      id: 'held-amex-1',
      source_type: 'amex',
      transaction_date: '2026-07-01',
      amount_in: 370.52,
      amount_out: null,
      card_account: '71001',
      card_member: 'Mr P Pitcher',
      details: 'PAYMENT RECEIVED - THANK YOU',
      external_reference: null,
      dedupe_hash: 'old-hash-1',
      status: 'no_receipt_required',
      ...overrides,
    }
  }

  /** Stores what the import is sent, as the real function does, and records each call. */
  function captureImport(db: FakeDb) {
    const sent: Array<Array<Record<string, unknown>>> = []
    db.onRpc((_name, args) => {
      const rows = args.p_rows as Array<Record<string, unknown>>
      sent.push(rows)
      const ids = rows.map((_row, index) => `new-amex-${index + 1}`)
      rows.forEach((row, index) => db.rows('receipt_transactions').push({ id: ids[index], batch_id: BATCH, ...row }))
      return {
        data: {
          outcome: 'imported',
          batch: { id: BATCH, followup_status: 'done', duplicate_count: 0 },
          inserted_count: rows.length,
          duplicate_count: 0,
          inserted_ids: ids,
        },
        error: null,
      }
    })
    return sent
  }

  const PAYMENT = "01/07/2026,PAYMENT RECEIVED - THANK YOU,MR P PITCHER,-71001,-370.52,'10000000010627999902460'"

  it('gives a held line its reference instead of storing the purchase again', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(heldAmex())
    const sent = captureImport(db)
    const { file, buffer } = amexFile(WITH_REFERENCE, [PAYMENT])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'amex')

    expect(sent).toEqual([[]])
    expect(result).toMatchObject({ success: true, inserted: 0, skipped: 1, recordsInFile: 1 })
    expect(result.warning).toContain(
      '1 line was already held from another download of this statement, so it was not added again (Amex reference numbers added to 1 of them).'
    )
    const heldLine = db.rows('receipt_transactions').find((row) => row.id === 'held-amex-1')
    expect(heldLine).toMatchObject({ external_reference: '10000000010627999902460' })
    expect(heldLine?.dedupe_hash).not.toBe('old-hash-1')
    expect(db.rows('receipt_transaction_logs')).toEqual([
      expect.objectContaining({ transaction_id: 'held-amex-1', action_type: 'reference_added', new_status: 'no_receipt_required' }),
    ])
    expect(db.rows('receipt_batches')[0]).toMatchObject({ duplicate_count: 1 })
  })

  it('does not store again a purchase held with its reference when the new download has none', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(heldAmex({ external_reference: '10000000010627999902460', dedupe_hash: 'hash-with-reference' }))
    const sent = captureImport(db)
    const { file, buffer } = amexFile(WITHOUT_REFERENCE, ['01/07/2026,PAYMENT RECEIVED - THANK YOU,MR P PITCHER,-71001,-370.52'])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'amex')

    expect(sent).toEqual([[]])
    expect(result).toMatchObject({ success: true, inserted: 0, skipped: 1 })
    expect(db.rows('receipt_transactions')[0]).toMatchObject({ dedupe_hash: 'hash-with-reference' })
    expect(db.rows('receipt_transaction_logs')).toEqual([])
  })

  it('pairs identical purchases one for one', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(
      heldAmex({ transaction_date: '2026-07-21', amount_in: null, amount_out: 5.7, card_account: '71019', card_member: 'Mr B Summers', details: 'TESCO STORE 2047 2047TE STAINES' })
    )
    const sent = captureImport(db)
    const { file, buffer } = amexFile(WITH_REFERENCE, [
      "21/07/2026,TESCO STORE 2047 2047TE STAINES,MR B SUMMERS,-71019,5.70,'AT-FIRST'",
      "21/07/2026,TESCO STORE 2047 2047TE STAINES,MR B SUMMERS,-71019,5.70,'AT-SECOND'",
    ])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'amex')

    expect(sent[0]).toHaveLength(1)
    expect(sent[0][0]).toMatchObject({ external_reference: 'AT-SECOND' })
    expect(result).toMatchObject({ inserted: 1, skipped: 1 })
    expect(db.rows('receipt_transactions').find((row) => row.id === 'held-amex-1')).toMatchObject({ external_reference: 'AT-FIRST' })
  })

  it('keeps a purchase on another card apart', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(heldAmex({ card_account: '71019' }))
    const sent = captureImport(db)
    const { file, buffer } = amexFile(WITH_REFERENCE, [PAYMENT])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'amex')

    expect(sent[0]).toHaveLength(1)
    expect(result).toMatchObject({ inserted: 1, skipped: 0 })
    expect(db.rows('receipt_transactions').find((row) => row.id === 'held-amex-1')).toMatchObject({ external_reference: null })
  })

  it('refuses the upload when the lines already held cannot be read', async () => {
    const db = seed({}, 0)
    const sent = captureImport(db)
    db.failNext({ table: 'receipt_transactions', operation: 'select', message: 'connection reset' })
    const { file, buffer } = amexFile(WITH_REFERENCE, [PAYMENT])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'amex')

    expect(result.error).toBe(
      'The statement could not be checked against the payments already held, so nothing was imported. It is safe to upload it again.'
    )
    expect(sent).toEqual([])
  })

  it('warns about a new line that looks like a payment already held, credits included', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(
      heldAmex({ transaction_date: '2026-07-15', amount_in: 1187.93, details: 'AMZNMKTPLACE AMAZON.CO.UK', status: 'no_receipt_required' })
    )
    captureImport(db)
    const { file, buffer } = amexFile(WITH_REFERENCE, [
      "15/07/2026,AMZNMKTPLACE*CZ6WV1P45  AMAZON.CO.UK,MR P PITCHER,-71001,-1187.93,'AT261970048000012596112'",
    ])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'amex')

    expect(result).toMatchObject({ success: true, inserted: 1 })
    expect(result.warning).toContain(
      '1 new line looks like a payment already held, with the same date, amount and card (for example AMZNMKTPLACE*CZ6WV1P45 AMAZON.CO.UK, £1,187.93 on 15 July 2026). Check for a duplicate before claiming it.'
    )
  })

  it('says nothing about a different shop on the same day for the same amount', async () => {
    const db = seed({}, 0)
    db.rows('receipt_transactions').push(
      heldAmex({ transaction_date: '2026-07-21', amount_in: null, amount_out: 5.7, details: 'TESCO STORE 2047 2047TE STAINES', status: 'pending' })
    )
    captureImport(db)
    const { file, buffer } = amexFile(WITH_REFERENCE, ["21/07/2026,BOOTS STAINES,MR P PITCHER,-71001,5.70,'AT-BOOTS'"])

    const result = await performImportReceiptStatement(USER, '', file, buffer, 'amex')

    expect(result).toMatchObject({ success: true, inserted: 1 })
    expect(result.warning).toBeUndefined()
  })
})
