import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn(),
}))

import { getOpenAIConfig } from '@/lib/openai/config'
import { RECEIPT_AI_PROMPT_VERSION, ReceiptAiError } from '@/lib/receipts/ai-client'
import { classifyReceiptTransactionsWithAI } from '@/lib/receipts/ai-classification'
import { createFakeDb, fakeReceiptsRpc, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * The classifier, run for real against in-memory rows, with only the network stubbed. The
 * request that would go to OpenAI is captured, so the tests can read exactly what would have
 * left the building.
 */

type Row = Record<string, unknown>

const mockedConfig = getOpenAIConfig as unknown as ReturnType<typeof vi.fn>
const fetchMock = vi.fn()

// Invented people. No real member of staff appears in a test.
const EMPLOYEES: Row[] = [
  { employee_id: 'e1', first_name: 'Morwenna', last_name: 'Trevithick', preferred_name: null },
  { employee_id: 'e2', first_name: 'Jago', last_name: 'Polkinghorne', preferred_name: 'Jay' },
]
const EMPLOYEE_NAMES = ['morwenna', 'trevithick', 'jago', 'polkinghorne']

function payment(id: string, overrides: Row = {}): Row {
  return {
    id,
    transaction_date: '2026-09-15',
    details: `PAYMENT ${id}`,
    transaction_type: null,
    amount_in: null,
    amount_out: 25,
    vendor_id: null,
    vendor_name: null,
    vendor_source: null,
    vendor_rule_id: null,
    expense_category: null,
    no_category_applies: false,
    expense_category_source: null,
    expense_rule_id: null,
    status: 'pending',
    marked_method: null,
    source_type: 'bank',
    merchant_category: null,
    merchant_town: null,
    updated_at: 'v1',
    ...overrides,
  }
}

function vendor(id: string, name: string, overrides: Row = {}): Row {
  return {
    id,
    canonical_name: name,
    vendor_key: name.toLowerCase(),
    status: 'confirmed',
    kind: 'business',
    origin: 'manual',
    default_expense_category: null,
    merged_into_vendor_id: null,
    ...overrides,
  }
}

function arrange(seed: {
  payments: Row[]
  vendors?: Row[]
  aliases?: Row[]
  employees?: Row[]
  attempts?: Row[]
  settings?: Row[]
  logs?: Row[]
}): FakeDb {
  const db = createFakeDb({
    receipt_transactions: seed.payments,
    receipt_vendors: seed.vendors ?? [vendor('v-bt', 'BT'), vendor('v-booker', 'Booker')],
    receipt_vendor_aliases: seed.aliases ?? [],
    employees: seed.employees ?? EMPLOYEES,
    receipt_ai_attempts: seed.attempts ?? [],
    receipt_settings: seed.settings ?? [],
    receipt_transaction_logs: seed.logs ?? [],
  })
  db.onRpc(fakeReceiptsRpc(db))
  return db
}

function answerItem(id: string, overrides: Row = {}): Row {
  return {
    id,
    vendor_id: null,
    new_vendor_name: null,
    expense_category: null,
    no_category_applies: false,
    confidence: 90,
    reasoning: 'Because',
    ...overrides,
  }
}

function modelAnswers(items: Row[], onCall?: () => void): void {
  fetchMock.mockImplementation(async () => {
    onCall?.()
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        model: 'gpt-test',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ classifications: items }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    }
  })
}

function modelFails(status: number): void {
  fetchMock.mockResolvedValue({ ok: false, status, text: async () => 'nope', json: async () => ({}) })
}

/** Everything in the one request that was made, as text. */
function requestText(): string {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  return String(fetchMock.mock.calls[0][1].body)
}

function userPrompt(): string {
  const body = JSON.parse(requestText())
  return body.messages.find((message: { role: string }) => message.role === 'user').content
}

function attemptFor(db: FakeDb, id: string): Row | undefined {
  return db.rows('receipt_ai_attempts').find((row) => row.transaction_id === id)
}

function paymentRow(db: FakeDb, id: string): Row {
  return db.rows('receipt_transactions').find((row) => row.id === id) as Row
}

async function classify(db: FakeDb, ids: string[], options: { retryFinalFailures?: boolean } = {}) {
  return classifyReceiptTransactionsWithAI(db.client as never, ids, options)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  mockedConfig.mockResolvedValue({ apiKey: 'key', baseUrl: 'https://api.test/v1', receiptsModel: 'gpt-test' })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('what the AI writes and what it only suggests', () => {
  it('writes the vendor from our list and the category, as one change', async () => {
    const db = arrange({ payments: [payment('p1', { details: 'BT GROUP PLC DD' })] })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Telephone', confidence: 92 })])

    const summary = await classify(db, ['p1'])

    expect(summary).toMatchObject({
      considered: 1,
      sent: 1,
      vendorsWritten: 1,
      categoriesWritten: 1,
      categoriesProposed: 0,
      failed: 0,
    })

    const row = paymentRow(db, 'p1')
    expect(row).toMatchObject({ vendor_id: 'v-bt', vendor_name: 'BT', vendor_source: 'ai' })
    // The category is on the payment, marked as the AI's, with no rule behind it.
    expect(row).toMatchObject({ expense_category: 'Telephone', expense_category_source: 'ai', expense_rule_id: null })
    // Classifying is not closing: the payment still needs its receipt.
    expect(row.status).toBe('pending')

    expect(attemptFor(db, 'p1')).toMatchObject({
      prompt_version: RECEIPT_AI_PROMPT_VERSION,
      outcome: 'vendor_written',
      vendor_id: 'v-bt',
      vendor_written: true,
      proposed_expense_category: 'Telephone',
      category_state: 'written',
      confidence: 92,
      model: 'gpt-test',
      tries: 1,
    })

    expect(db.rows('receipt_transaction_logs')).toEqual([
      expect.objectContaining({ transaction_id: 'p1', action_type: 'ai_vendor', performed_by: null }),
      expect.objectContaining({
        transaction_id: 'p1',
        action_type: 'ai_category',
        note: 'Category → Telephone (AI, 92% sure)',
        performed_by: null,
      }),
    ])
    expect(db.rows('ai_usage_events')).toEqual([
      expect.objectContaining({ context: 'receipt_classification:1', model: 'gpt-test', total_tokens: 120 }),
    ])
  })

  it('never writes "no category applies": it stays a suggestion for a person', async () => {
    const db = arrange({ payments: [payment('p1', { details: 'HMRC VAT' })] })
    modelAnswers([answerItem('p1', { no_category_applies: true })])

    const summary = await classify(db, ['p1'])

    expect(summary).toMatchObject({ categoriesWritten: 0, categoriesProposed: 1 })
    expect(paymentRow(db, 'p1')).toMatchObject({
      no_category_applies: false,
      expense_category: null,
      expense_category_source: null,
    })
    expect(db.rows('receipt_transaction_logs')).toHaveLength(0)
    expect(attemptFor(db, 'p1')).toMatchObject({
      outcome: 'category_proposed',
      proposed_expense_category: null,
      proposed_no_category: true,
      category_state: 'proposed',
    })
  })

  it('writes the category a person set as the vendor default, whatever the model says', async () => {
    const db = arrange({
      payments: [payment('p1', { details: 'BT GROUP PLC DD' })],
      vendors: [vendor('v-bt', 'BT', { default_expense_category: 'Telephone' })],
    })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Entertainment' })])

    await classify(db, ['p1'])

    expect(paymentRow(db, 'p1')).toMatchObject({ expense_category: 'Telephone', expense_category_source: 'ai' })
    expect(attemptFor(db, 'p1')).toMatchObject({
      outcome: 'vendor_written',
      proposed_expense_category: 'Telephone',
      category_state: 'written',
    })
  })

  it('writes only the category when the vendor is already there', async () => {
    const db = arrange({
      payments: [payment('p1', { vendor_id: 'v-booker', vendor_name: 'Booker', vendor_source: 'manual' })],
    })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Sundries/Consumables', confidence: 81 })])

    const summary = await classify(db, ['p1'])

    expect(userPrompt()).toContain('Booker')
    expect(summary).toMatchObject({ vendorsWritten: 0, categoriesWritten: 1 })
    expect(paymentRow(db, 'p1')).toMatchObject({
      vendor_id: 'v-booker',
      vendor_name: 'Booker',
      vendor_source: 'manual',
      expense_category: 'Sundries/Consumables',
      expense_category_source: 'ai',
    })
    expect(attemptFor(db, 'p1')).toMatchObject({
      outcome: 'category_written',
      vendor_written: false,
      category_state: 'written',
    })
    expect(db.rows('receipt_transaction_logs')).toEqual([
      expect.objectContaining({ action_type: 'ai_category' }),
    ])
  })

  it('writes the vendor default without a call when only the category is missing', async () => {
    const db = arrange({
      payments: [payment('p1', { vendor_id: 'v-bt', vendor_name: 'BT', vendor_source: 'manual' })],
      vendors: [vendor('v-bt', 'BT', { default_expense_category: 'Telephone' })],
    })

    const summary = await classify(db, ['p1'])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ considered: 1, sent: 0, categoriesWritten: 1, categoriesProposed: 0 })
    expect(attemptFor(db, 'p1')).toMatchObject({
      outcome: 'category_written',
      proposed_expense_category: 'Telephone',
      category_state: 'written',
    })
    expect(paymentRow(db, 'p1')).toMatchObject({
      vendor_name: 'BT',
      vendor_source: 'manual',
      expense_category: 'Telephone',
      expense_category_source: 'ai',
    })
    expect(db.rows('receipt_transaction_logs')).toEqual([
      expect.objectContaining({ action_type: 'ai_category', note: 'Category → Telephone (the default for this vendor)' }),
    ])
  })

  it('never gives a category to money in', async () => {
    const db = arrange({ payments: [payment('p1', { amount_in: 300, amount_out: null, details: 'SUMUP SETTLEMENT' })] })
    modelAnswers([answerItem('p1', { new_vendor_name: 'SumUp', expense_category: 'Telephone' })])

    await classify(db, ['p1'])

    expect(userPrompt()).toContain('category: not wanted')
    expect(paymentRow(db, 'p1').expense_category).toBeNull()
    expect(attemptFor(db, 'p1')).toMatchObject({
      outcome: 'vendor_written',
      proposed_expense_category: null,
      category_state: 'none',
    })
  })

  it('does nothing with an answer it is not sure of', async () => {
    const db = arrange({ payments: [payment('p1'), payment('p2')] })
    modelAnswers([
      answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Telephone', confidence: 69 }),
      { id: 'p2', vendor_id: 'v-bt', new_vendor_name: null, expense_category: 'Telephone', no_category_applies: false, reasoning: null },
    ])

    const summary = await classify(db, ['p1', 'p2'])

    expect(summary).toMatchObject({ lowConfidence: 2, vendorsWritten: 0, categoriesWritten: 0, categoriesProposed: 0 })
    for (const id of ['p1', 'p2']) {
      expect(paymentRow(db, id).vendor_name).toBeNull()
      expect(paymentRow(db, id).expense_category).toBeNull()
      expect(attemptFor(db, id)).toMatchObject({ outcome: 'low_confidence', category_state: 'none' })
    }
  })

  it('records that nothing could be identified, so it is not asked again', async () => {
    const db = arrange({ payments: [payment('p1')] })
    modelAnswers([answerItem('p1')])

    const summary = await classify(db, ['p1'])

    expect(summary.nothingIdentified).toBe(1)
    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'nothing_identified' })
  })
})

describe('new vendors', () => {
  it('adds a vendor the model names that is not on the list, unconfirmed and marked as from the AI', async () => {
    const db = arrange({ payments: [payment('p1', { details: 'SCREWFIX DIRECT' })] })
    modelAnswers([answerItem('p1', { new_vendor_name: 'Screwfix' })])

    await classify(db, ['p1'])

    const created = db.rows('receipt_vendors').find((row) => row.canonical_name === 'Screwfix')
    expect(created).toMatchObject({ status: 'unconfirmed', origin: 'ai', kind: 'business' })
    expect(paymentRow(db, 'p1')).toMatchObject({ vendor_id: created?.id, vendor_name: 'Screwfix', vendor_source: 'ai' })
  })

  it('uses the vendor we already have when the model spells it differently', async () => {
    const db = arrange({ payments: [payment('p1', { details: 'BOOKER LTD STAINES' })] })
    modelAnswers([answerItem('p1', { new_vendor_name: 'Booker Ltd' })])

    await classify(db, ['p1'])

    expect(db.rows('receipt_vendors')).toHaveLength(2)
    expect(paymentRow(db, 'p1')).toMatchObject({ vendor_id: 'v-booker', vendor_name: 'Booker' })
  })

  it('does not make a vendor out of a member of staff', async () => {
    const db = arrange({ payments: [payment('p1', { details: 'FP 0412 REF 99' })] })
    modelAnswers([answerItem('p1', { new_vendor_name: 'Morwenna Trevithick' })])

    await classify(db, ['p1'])

    expect(db.rows('receipt_vendors')).toHaveLength(2)
    expect(paymentRow(db, 'p1').vendor_name).toBeNull()
    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'nothing_identified', vendor_written: false })
  })
})

describe('a payment is asked about once', () => {
  it('does not send a payment that already has an attempt for this version of the question', async () => {
    const db = arrange({
      payments: [payment('p1')],
      attempts: [{ transaction_id: 'p1', prompt_version: RECEIPT_AI_PROMPT_VERSION, outcome: 'nothing_identified', tries: 1 }],
    })

    const summary = await classify(db, ['p1'])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ considered: 0, sent: 0 })
  })

  it('asks again when the only attempt was for an older version of the question', async () => {
    const db = arrange({
      payments: [payment('p1')],
      attempts: [{ transaction_id: 'p1', prompt_version: '2025-01-01.0', outcome: 'nothing_identified', tries: 1 }],
    })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt' })])

    await classify(db, ['p1'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(db.rows('receipt_ai_attempts')).toHaveLength(2)
  })

  it('closes a suggestion left open by an older version of the question when it asks again', async () => {
    const db = arrange({
      payments: [payment('p1'), payment('p2')],
      attempts: [
        { transaction_id: 'p1', prompt_version: '2025-01-01.0', outcome: 'category_proposed', proposed_no_category: true, category_state: 'proposed', tries: 1 },
        // Not asked about this time: its old suggestion is left as it is.
        { transaction_id: 'other', prompt_version: '2025-01-01.0', outcome: 'category_proposed', proposed_no_category: true, category_state: 'proposed', tries: 1 },
        // Already answered by a person: not reopened and not relabelled.
        { transaction_id: 'p2', prompt_version: '2025-01-01.0', outcome: 'category_proposed', proposed_no_category: true, category_state: 'dismissed', tries: 1 },
      ],
    })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Telephone' }), answerItem('p2', { vendor_id: 'v-booker' })])

    await classify(db, ['p1', 'p2'])

    const states = (id: string) =>
      db
        .rows('receipt_ai_attempts')
        .filter((row) => row.transaction_id === id)
        .map((row) => `${row.prompt_version}:${row.category_state}`)
        .sort()
    expect(states('p1')).toEqual(['2025-01-01.0:superseded', `${RECEIPT_AI_PROMPT_VERSION}:written`])
    expect(states('other')).toEqual(['2025-01-01.0:proposed'])
    expect(states('p2')).toEqual(['2025-01-01.0:dismissed', `${RECEIPT_AI_PROMPT_VERSION}:none`])
  })

  it('treats "no category applies" with no reason as nothing identified', async () => {
    const db = arrange({ payments: [payment('p1', { details: 'Card Purchase NCP CSL P D' })] })
    modelAnswers([answerItem('p1', { no_category_applies: true, confidence: 100, reasoning: null })])

    const summary = await classify(db, ['p1'])

    expect(summary).toMatchObject({ categoriesProposed: 0, nothingIdentified: 1 })
    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'nothing_identified', proposed_no_category: false, category_state: 'none' })
  })

  it('tries again after a failure that may not happen twice, and counts the tries', async () => {
    const db = arrange({
      payments: [payment('p1')],
      attempts: [{ transaction_id: 'p1', prompt_version: RECEIPT_AI_PROMPT_VERSION, outcome: 'failed_retryable', tries: 2 }],
    })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt' })])

    await classify(db, ['p1'])

    expect(db.rows('receipt_ai_attempts')).toHaveLength(1)
    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'vendor_written', tries: 3 })
  })

  it('leaves a payment that was given up on, unless a person asks for it', async () => {
    const seed = {
      payments: [payment('p1')],
      attempts: [{ transaction_id: 'p1', prompt_version: RECEIPT_AI_PROMPT_VERSION, outcome: 'failed_final', tries: 5 }],
    }

    const untouched = arrange(seed)
    await classify(untouched, ['p1'])
    expect(fetchMock).not.toHaveBeenCalled()

    const retried = arrange(seed)
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt' })])
    await classify(retried, ['p1'], { retryFinalFailures: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(attemptFor(retried, 'p1')).toMatchObject({ outcome: 'vendor_written', tries: 6 })
  })

  it('does not consider a payment that needs nothing', async () => {
    const db = arrange({
      payments: [
        payment('rule', { vendor_name: 'BT', vendor_source: 'rule', expense_category: 'Telephone', expense_category_source: 'rule' }),
        // A person cleared both: a deliberate blank is a decision.
        payment('blank', { vendor_source: 'manual', expense_category_source: 'manual' }),
        payment('none', { vendor_name: 'HMRC', vendor_source: 'manual', no_category_applies: true }),
      ],
    })

    const summary = await classify(db, ['rule', 'blank', 'none'])

    expect(summary.considered).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('receipt_ai_attempts')).toHaveLength(0)
  })
})

describe('a rule or a person always wins', () => {
  it('does not overwrite a vendor that was set while the model was answering', async () => {
    const db = arrange({ payments: [payment('p1')] })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Telephone' })], () => {
      Object.assign(paymentRow(db, 'p1'), {
        vendor_id: 'v-booker',
        vendor_name: 'Booker',
        vendor_source: 'rule',
        updated_at: 'v2',
      })
    })

    const summary = await classify(db, ['p1'])

    expect(paymentRow(db, 'p1')).toMatchObject({ vendor_id: 'v-booker', vendor_name: 'Booker', vendor_source: 'rule' })
    expect(summary).toMatchObject({ vendorsWritten: 0, categoriesWritten: 0, skippedProtected: 1 })
    // The model's category went with its own vendor, so it is not written beside another one.
    expect(paymentRow(db, 'p1').expense_category).toBeNull()
    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'skipped_protected', vendor_written: false, category_state: 'none' })
    expect(db.rows('receipt_transaction_logs')).toHaveLength(0)
  })

  it('does not overwrite a category that was set while the model was answering', async () => {
    const db = arrange({ payments: [payment('p1')] })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Telephone' })], () => {
      Object.assign(paymentRow(db, 'p1'), {
        expense_category: 'Entertainment',
        expense_category_source: 'manual',
        updated_at: 'v2',
      })
    })

    const summary = await classify(db, ['p1'])

    // The vendor was still needed and is written. The person's category stays.
    expect(summary).toMatchObject({ vendorsWritten: 1, categoriesWritten: 0 })
    expect(paymentRow(db, 'p1')).toMatchObject({
      vendor_name: 'BT',
      vendor_source: 'ai',
      expense_category: 'Entertainment',
      expense_category_source: 'manual',
    })
    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'vendor_written', category_state: 'none', proposed_expense_category: null })
    expect(db.rows('receipt_transaction_logs')).toEqual([expect.objectContaining({ action_type: 'ai_vendor' })])
  })

  it('leaves a category a person cleared on purpose, and does not ask for one', async () => {
    const db = arrange({ payments: [payment('p1', { expense_category_source: 'manual' })] })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Telephone' })])

    await classify(db, ['p1'])

    expect(userPrompt()).toContain('category: not wanted')
    expect(paymentRow(db, 'p1')).toMatchObject({
      vendor_name: 'BT',
      expense_category: null,
      expense_category_source: 'manual',
    })
  })

  it('does not give a category to a payment marked "no category applies"', async () => {
    const db = arrange({ payments: [payment('p1', { no_category_applies: true, expense_category_source: 'manual' })] })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Telephone' })])

    await classify(db, ['p1'])

    expect(paymentRow(db, 'p1')).toMatchObject({ vendor_name: 'BT', expense_category: null, no_category_applies: true })
  })

  it('records a failure, to be tried again, when the write cannot be saved', async () => {
    const db = arrange({ payments: [payment('p1')] })
    const receiptsRpc = fakeReceiptsRpc(db)
    db.onRpc((name, args) =>
      name === 'apply_receipt_rule_change' ? { data: null, error: { message: 'deadlock detected' } } : receiptsRpc(name, args)
    )
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt', expense_category: 'Telephone' })])

    const summary = await classify(db, ['p1'])

    expect(summary).toMatchObject({ vendorsWritten: 0, categoriesWritten: 0, failed: 1 })
    expect(paymentRow(db, 'p1')).toMatchObject({ vendor_name: null, expense_category: null })
    expect(attemptFor(db, 'p1')).toMatchObject({
      outcome: 'failed_retryable',
      error: 'The classification could not be saved',
      category_state: 'none',
    })
  })

  it('writes on the payment as it now is when something else about it changed', async () => {
    const db = arrange({ payments: [payment('p1')] })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt' })], () => {
      Object.assign(paymentRow(db, 'p1'), { notes: 'A note added meanwhile', updated_at: 'v2' })
    })

    const summary = await classify(db, ['p1'])

    expect(summary.vendorsWritten).toBe(1)
    expect(paymentRow(db, 'p1')).toMatchObject({ vendor_name: 'BT', vendor_source: 'ai', notes: 'A note added meanwhile' })
  })

  it('leaves alone a payment on or before the lock date, without asking about it', async () => {
    const db = arrange({
      payments: [payment('old', { transaction_date: '2026-03-31' }), payment('new', { transaction_date: '2026-04-01' })],
      settings: [{ key: 'locked_before', value: { date: '2026-03-31' } }],
    })
    modelAnswers([answerItem('new', { vendor_id: 'v-bt' })])

    const summary = await classify(db, ['old', 'new'])

    expect(summary).toMatchObject({ locked: 1, considered: 1, sent: 1 })
    expect(userPrompt()).not.toContain('id="old"')
    expect(paymentRow(db, 'old').vendor_name).toBeNull()
    expect(attemptFor(db, 'old')).toBeUndefined()
  })
})

describe('wage payments', () => {
  it('classifies an unambiguous wage payment here, without a call, and closes it', async () => {
    const db = arrange({ payments: [payment('wage', { details: 'MORWENNA TREVITHICK THE ANCHOR', amount_out: 412.5 })] })

    const summary = await classify(db, ['wage'])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ payrollLocal: 1, sent: 0 })

    const person = db.rows('receipt_vendors').find((row) => row.canonical_name === 'Morwenna Trevithick')
    expect(person).toMatchObject({ kind: 'person', origin: 'payroll' })
    expect(paymentRow(db, 'wage')).toMatchObject({
      vendor_id: person?.id,
      vendor_name: 'Morwenna Trevithick',
      vendor_source: 'rule',
      expense_category: 'Total Staff',
      expense_category_source: 'rule',
      status: 'no_receipt_required',
      receipt_required: false,
      marked_method: 'rule',
    })
    expect(attemptFor(db, 'wage')).toMatchObject({ outcome: 'payroll_local', vendor_written: true })
    expect(db.rows('receipt_transaction_logs')).toEqual([expect.objectContaining({ action_type: 'payroll_local' })])
  })

  it('uses the payroll reference from the settings', async () => {
    const db = arrange({
      payments: [payment('wage', { details: 'MORWENNA TREVITHICK STAFF PAY' })],
      settings: [{ key: 'payroll_reference', value: { text: 'staff pay' } }],
    })

    const summary = await classify(db, ['wage'])

    expect(summary.payrollLocal).toBe(1)
  })

  it('does not reopen or close a wage payment a person has already dealt with', async () => {
    const db = arrange({
      payments: [
        payment('wage', { details: 'MORWENNA TREVITHICK THE ANCHOR', status: 'completed', marked_method: 'manual' }),
      ],
    })

    await classify(db, ['wage'])

    expect(paymentRow(db, 'wage')).toMatchObject({ status: 'completed', marked_method: 'manual', expense_category: 'Total Staff' })
  })

  it('holds anything doubtful for a person, writes nothing and sends nothing', async () => {
    const db = arrange({
      payments: [
        payment('expense', { details: 'MORWENNA TREVITHICK PETTY CASH' }),
        payment('unknown', { details: 'DEMELZA CARNE THE ANCHOR' }),
      ],
    })

    const summary = await classify(db, ['expense', 'unknown'])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ payrollCheck: 2, payrollLocal: 0, sent: 0 })
    for (const id of ['expense', 'unknown']) {
      expect(paymentRow(db, id)).toMatchObject({ vendor_name: null, expense_category: null, status: 'pending' })
      expect(attemptFor(db, id)).toMatchObject({ outcome: 'payroll_check', category_state: 'none' })
    }
    // The note says why, and does not repeat the name.
    expect(String(attemptFor(db, 'expense')?.reasoning).toLowerCase()).not.toContain('trevithick')
  })
})

describe('what is sent to OpenAI', () => {
  it('never includes the name of a member of staff, wherever it is held', async () => {
    const db = arrange({
      payments: [
        payment('wage', { details: 'MORWENNA TREVITHICK THE ANCHOR' }),
        payment('repaid', { details: 'JAGO POLKINGHORNE EXPENSES' }),
        payment('initial', { details: 'J POLKINGHORNE THE ANCHOR' }),
        payment('supplier', { details: 'BOOKER WHOLESALE STAINES' }),
        payment('example-wage', {
          details: 'JAY POLKINGHORNE THE ANCHOR',
          vendor_name: 'Jago Polkinghorne',
          vendor_source: 'manual',
          expense_category: 'Total Staff',
          expense_category_source: 'manual',
        }),
        payment('example-named', {
          details: 'REFUND TO MORWENNA TREVITHICK',
          vendor_name: 'Refunds',
          vendor_source: 'manual',
          expense_category: 'Sundries/Consumables',
          expense_category_source: 'manual',
        }),
        payment('example-person-vendor', {
          details: 'CLEANING OCT',
          vendor_id: 'v-person',
          vendor_name: 'M Trevithick Cleaning',
          vendor_source: 'manual',
          expense_category: 'Waste Disposal/Cleaning/Hygiene',
          expense_category_source: 'manual',
        }),
        payment('example-ok', {
          details: 'SKY SUBSCRIPTION',
          vendor_name: 'Sky',
          vendor_source: 'manual',
          expense_category: 'Sky / PRS / Vidimix',
          expense_category_source: 'manual',
        }),
      ],
      vendors: [
        vendor('v-booker', 'Booker'),
        vendor('v-person', 'M Trevithick Cleaning', { kind: 'person' }),
        // Made before people were told apart from businesses.
        vendor('v-legacy', 'Jago Polkinghorne', { kind: 'business' }),
      ],
      aliases: [
        { id: 'a1', vendor_id: 'v-booker', alias: 'Booker Wholesale', alias_key: 'booker wholesale' },
        { id: 'a2', vendor_id: 'v-booker', alias: 'Morwenna Trevithick', alias_key: 'morwenna trevithick' },
      ],
      logs: ['example-wage', 'example-named', 'example-person-vendor', 'example-ok'].map((id, index) => ({
        id: `log-${index}`,
        transaction_id: id,
        action_type: 'manual_classification',
        performed_at: `2026-09-2${index}T10:00:00Z`,
      })),
    })
    modelAnswers([answerItem('supplier', { vendor_id: 'v-booker' })])

    const summary = await classify(db, ['wage', 'repaid', 'initial', 'supplier'])

    expect(summary).toMatchObject({ payrollLocal: 1, payrollCheck: 2, sent: 1 })

    const sent = requestText().toLowerCase()
    for (const name of EMPLOYEE_NAMES) {
      expect(sent, `the request must not contain "${name}"`).not.toContain(name)
    }

    const prompt = userPrompt()
    // The supplier, its other spelling and the safe example did go.
    expect(prompt).toContain('BOOKER WHOLESALE STAINES')
    expect(prompt).toContain('also: Booker Wholesale')
    expect(prompt).toContain('SKY SUBSCRIPTION')
    // Nothing held back for a person was sent.
    for (const id of ['wage', 'repaid', 'initial']) {
      expect(prompt).not.toContain(`id="${id}"`)
    }
    expect(prompt).not.toContain('v-person')
    expect(prompt).not.toContain('v-legacy')
    expect(prompt).not.toContain('CLEANING OCT')
  })

  it('sends the merchant category and town for a card payment', async () => {
    const db = arrange({
      payments: [payment('p1', { source_type: 'amex', merchant_category: 'Hardware', merchant_town: 'Staines' })],
    })
    modelAnswers([answerItem('p1')])

    await classify(db, ['p1'])

    expect(userPrompt()).toContain('merchant_hint: Hardware · Staines')
  })
})

describe('when the call fails', () => {
  it('records the failure on every payment it covered and throws, so the queue tries again', async () => {
    const db = arrange({ payments: [payment('p1'), payment('p2')] })
    modelFails(503)

    await expect(classify(db, ['p1', 'p2'])).rejects.toBeInstanceOf(ReceiptAiError)

    for (const id of ['p1', 'p2']) {
      expect(attemptFor(db, id)).toMatchObject({ outcome: 'failed_retryable', tries: 1, error: 'OpenAI returned 503' })
      expect(paymentRow(db, id).vendor_name).toBeNull()
    }
  })

  it('gives up after five tries', async () => {
    const db = arrange({
      payments: [payment('p1')],
      attempts: [{ transaction_id: 'p1', prompt_version: RECEIPT_AI_PROMPT_VERSION, outcome: 'failed_retryable', tries: 4 }],
    })
    modelFails(500)

    await expect(classify(db, ['p1'])).rejects.toBeInstanceOf(ReceiptAiError)

    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'failed_final', tries: 5 })
  })

  it('does not ask to be retried when trying again cannot help', async () => {
    const db = arrange({ payments: [payment('p1')] })
    modelFails(400)

    const summary = await classify(db, ['p1'])

    expect(summary.failed).toBe(1)
    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'failed_final', error: 'OpenAI returned 400' })
  })

  it('keeps what was done before the call: a wage payment stays classified when the call then fails', async () => {
    const db = arrange({
      payments: [payment('wage', { details: 'MORWENNA TREVITHICK THE ANCHOR' }), payment('p1')],
    })
    modelFails(503)

    await expect(classify(db, ['wage', 'p1'])).rejects.toBeInstanceOf(ReceiptAiError)

    expect(paymentRow(db, 'wage').expense_category).toBe('Total Staff')
    expect(attemptFor(db, 'wage')).toMatchObject({ outcome: 'payroll_local' })
    expect(attemptFor(db, 'p1')).toMatchObject({ outcome: 'failed_retryable' })
  })

  it('marks a payment the model skipped as failed, and uses the answers it did give', async () => {
    const db = arrange({ payments: [payment('p1'), payment('p2')] })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt' })])

    const summary = await classify(db, ['p1', 'p2'])

    expect(summary).toMatchObject({ vendorsWritten: 1, failed: 1 })
    expect(attemptFor(db, 'p2')).toMatchObject({
      outcome: 'failed_retryable',
      error: 'The model returned no answer for this payment',
    })
  })

  it('fails loudly when the record of what was asked cannot be saved', async () => {
    const db = arrange({ payments: [payment('p1')] })
    modelAnswers([answerItem('p1', { vendor_id: 'v-bt' })])
    db.failNext({ table: 'receipt_ai_attempts', operation: 'insert', message: 'disk full' })

    await expect(classify(db, ['p1'])).rejects.toThrow('Failed to record AI attempts: disk full')
  })

  it('fails loudly when the payments cannot be read', async () => {
    const db = arrange({ payments: [payment('p1')] })
    db.failNext({ table: 'receipt_transactions', operation: 'select', message: 'connection reset' })

    await expect(classify(db, ['p1'])).rejects.toThrow('connection reset')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
