import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn(),
}))

import { getOpenAIConfig } from '@/lib/openai/config'
import {
  ReceiptAiError,
  buildReceiptAiPrompt,
  classifyReceiptPayments,
  type AiPaymentInput,
  type AiVendorOption,
} from '@/lib/receipts/ai-client'
import type { ReceiptExpenseCategory } from '@/types/database'

const mockedConfig = getOpenAIConfig as unknown as ReturnType<typeof vi.fn>

const categories: ReceiptExpenseCategory[] = ['Telephone', 'Licensing', 'Entertainment']
const vendors: AiVendorOption[] = [
  { id: 'v-bt', name: 'BT', aliases: ['British Telecom'] },
  { id: 'v-prs', name: 'PRS for Music', aliases: [] },
]
const payments: AiPaymentInput[] = [
  { id: 'p1', details: 'BT GROUP PLC DD', amount: 54.2, direction: 'out', transactionType: 'DD', needsVendor: true, needsCategory: true },
  { id: 'p2', details: 'PRS LICENCE', amount: 120, direction: 'out', transactionType: null, needsVendor: false, needsCategory: true, existingVendor: 'PRS for Music' },
]

function answer(classifications: unknown, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: 'gpt-test',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ classifications }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      ...extra,
    }),
    text: async () => '',
  }
}

function item(overrides: Record<string, unknown>) {
  return {
    id: 'p1',
    vendor_id: null,
    new_vendor_name: null,
    expense_category: null,
    no_category_applies: false,
    confidence: 90,
    reasoning: null,
    ...overrides,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockedConfig.mockResolvedValue({ apiKey: 'key', baseUrl: 'https://api.test/v1', receiptsModel: 'gpt-test' })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function failure(run: Promise<unknown>): Promise<ReceiptAiError> {
  try {
    await run
  } catch (error) {
    expect(error).toBeInstanceOf(ReceiptAiError)
    return error as ReceiptAiError
  }
  throw new Error('expected the call to fail')
}

describe('buildReceiptAiPrompt', () => {
  it('sends the vendor list with ids and other spellings, the categories and the payments', () => {
    const prompt = buildReceiptAiPrompt({ payments, vendors, categories })

    expect(prompt).toContain('v-bt | BT | also: British Telecom')
    expect(prompt).toContain('v-prs | PRS for Music')
    expect(prompt).toContain('- Telephone')
    expect(prompt).toContain('id="p1"')
    expect(prompt).toContain('details: BT GROUP PLC DD')
    expect(prompt).toContain('amount: £54.20')
    expect(prompt).toContain('direction: money out')
    expect(prompt).toContain('type: DD')
  })

  it('says when a vendor is already set, so the model leaves it alone', () => {
    const prompt = buildReceiptAiPrompt({ payments, vendors, categories })
    expect(prompt).toContain('vendor: already set (PRS for Music)')
  })

  it('says when no category is wanted', () => {
    const prompt = buildReceiptAiPrompt({
      payments: [{ ...payments[0], needsCategory: false, direction: 'in' }],
      vendors,
      categories,
    })
    expect(prompt).toContain('category: not wanted')
    expect(prompt).toContain('direction: money in')
  })

  it('adds nothing it was not given: no examples section without examples', () => {
    expect(buildReceiptAiPrompt({ payments, vendors, categories })).not.toContain('EXAMPLES')
    expect(
      buildReceiptAiPrompt({
        payments,
        vendors,
        categories,
        examples: [{ details: 'SKY SUBSCRIPTION', direction: 'out', vendorName: 'Sky', expenseCategory: 'Entertainment' }],
      })
    ).toContain('"SKY SUBSCRIPTION" (out)')
  })

  it('copes with an empty vendor list', () => {
    expect(buildReceiptAiPrompt({ payments, vendors: [], categories })).toContain('(none yet)')
  })
})

describe('classifyReceiptPayments', () => {
  it('returns the answers and what the call cost', async () => {
    fetchMock.mockResolvedValue(
      answer([
        item({ id: 'p1', vendor_id: 'v-bt', expense_category: 'Telephone', confidence: 93.6, reasoning: '  Phone line  ' }),
        item({ id: 'p2', no_category_applies: true, confidence: 80 }),
      ])
    )

    const outcome = await classifyReceiptPayments({ payments, vendors, categories })

    expect(outcome.results).toEqual([
      { id: 'p1', vendorId: 'v-bt', newVendorName: null, expenseCategory: 'Telephone', noCategoryApplies: false, confidence: 94, reasoning: 'Phone line' },
      { id: 'p2', vendorId: null, newVendorName: null, expenseCategory: null, noCategoryApplies: true, confidence: 80, reasoning: null },
    ])
    expect(outcome.model).toBe('gpt-test')
    expect(outcome.usage).toMatchObject({ model: 'gpt-test', promptTokens: 100, completionTokens: 20, totalTokens: 120 })
  })

  it('asks for a strict schema that only allows our categories', async () => {
    fetchMock.mockResolvedValue(answer([]))
    await classifyReceiptPayments({ payments, vendors, categories })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/v1/chat/completions')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-test')
    expect(body.response_format.json_schema.strict).toBe(true)
    const itemSchema = body.response_format.json_schema.schema.properties.classifications.items
    expect(itemSchema.properties.expense_category.enum).toEqual([...categories, null])
    expect(itemSchema.additionalProperties).toBe(false)
    expect(init.headers.Authorization).toBe('Bearer key')
  })

  it('does not call the model with nothing to ask', async () => {
    const outcome = await classifyReceiptPayments({ payments: [], vendors, categories })
    expect(outcome.results).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails for good when there is no API key', async () => {
    mockedConfig.mockResolvedValue({ apiKey: '', baseUrl: 'https://api.test/v1', receiptsModel: 'gpt-test' })
    const error = await failure(classifyReceiptPayments({ payments, vendors, categories }))
    expect(error.retryable).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [404, false],
  ])('a %i from OpenAI is a failure, retryable: %s', async (status, retryable) => {
    fetchMock.mockResolvedValue({ ok: false, status, text: async () => 'nope', json: async () => ({}) })
    const error = await failure(classifyReceiptPayments({ payments, vendors, categories }))
    expect(error.retryable).toBe(retryable)
    expect(error.status).toBe(status)
  })

  it('a network failure is worth another try', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const error = await failure(classifyReceiptPayments({ payments, vendors, categories }))
    expect(error.retryable).toBe(true)
  })

  it('an answer cut short by the token limit is a failure, not half an answer', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{ finish_reason: 'length', message: { content: '{"classifications":[{"id":"p1"' } }],
      }),
    })
    const error = await failure(classifyReceiptPayments({ payments, vendors, categories }))
    expect(error.message).toMatch(/cut short/)
    expect(error.retryable).toBe(true)
  })

  it.each([
    ['no choices', { choices: [] }],
    ['an empty message', { choices: [{ finish_reason: 'stop', message: { content: '' } }] }],
    ['text that is not JSON', { choices: [{ finish_reason: 'stop', message: { content: 'Sorry, I cannot.' } }] }],
    ['JSON in the wrong form', { choices: [{ finish_reason: 'stop', message: { content: '{"answers":[]}' } }] }],
  ])('%s is a failure', async (_label, payload) => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', json: async () => payload })
    const error = await failure(classifyReceiptPayments({ payments, vendors, categories }))
    expect(error.retryable).toBe(true)
  })

  it('ignores an answer for a payment it was not asked about', async () => {
    fetchMock.mockResolvedValue(answer([item({ id: 'p999', vendor_id: 'v-bt' }), item({ id: 'p1', vendor_id: 'v-bt' })]))
    const outcome = await classifyReceiptPayments({ payments, vendors, categories })
    expect(outcome.results.map((result) => result.id)).toEqual(['p1'])
  })

  it('keeps the first answer when the same payment is answered twice', async () => {
    fetchMock.mockResolvedValue(
      answer([item({ id: 'p1', vendor_id: 'v-bt' }), item({ id: 'p1', vendor_id: 'v-prs' })])
    )
    const outcome = await classifyReceiptPayments({ payments, vendors, categories })
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].vendorId).toBe('v-bt')
  })

  it('ignores a vendor id that was not on the list it was sent', async () => {
    fetchMock.mockResolvedValue(answer([item({ id: 'p1', vendor_id: 'v-invented', new_vendor_name: null })]))
    const outcome = await classifyReceiptPayments({ payments, vendors, categories })
    expect(outcome.results[0]).toMatchObject({ vendorId: null, newVendorName: null })
  })

  it('takes a new vendor name only when no listed vendor was chosen', async () => {
    fetchMock.mockResolvedValue(
      answer([
        item({ id: 'p1', vendor_id: 'v-bt', new_vendor_name: 'British Telecommunications' }),
        item({ id: 'p2', vendor_id: null, new_vendor_name: 'Performing Right Society' }),
      ])
    )
    const outcome = await classifyReceiptPayments({ payments, vendors, categories })
    expect(outcome.results[0]).toMatchObject({ vendorId: 'v-bt', newVendorName: null })
    expect(outcome.results[1]).toMatchObject({ vendorId: null, newVendorName: 'Performing Right Society' })
  })

  it('treats a missing or impossible confidence as none', async () => {
    fetchMock.mockResolvedValue(
      answer([
        { id: 'p1', vendor_id: 'v-bt', new_vendor_name: null, expense_category: null, no_category_applies: false, reasoning: null },
        item({ id: 'p2', confidence: 250 }),
      ])
    )
    const outcome = await classifyReceiptPayments({ payments, vendors, categories })
    expect(outcome.results.map((result) => result.confidence)).toEqual([null, null])
  })

  it('drops a category that is not one of ours, and does not call that "no category applies"', async () => {
    fetchMock.mockResolvedValue(answer([item({ id: 'p1', expense_category: 'Groceries', no_category_applies: false })]))
    const outcome = await classifyReceiptPayments({ payments, vendors, categories })
    expect(outcome.results[0]).toMatchObject({ expenseCategory: null, noCategoryApplies: false })
  })

  it('a category wins over "no category applies" when the model sends both', async () => {
    fetchMock.mockResolvedValue(answer([item({ id: 'p1', expense_category: 'telephone', no_category_applies: true })]))
    const outcome = await classifyReceiptPayments({ payments, vendors, categories })
    expect(outcome.results[0]).toMatchObject({ expenseCategory: 'Telephone', noCategoryApplies: false })
  })

  it('gives up after 30 seconds and says it can be tried again', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )

    const run = failure(classifyReceiptPayments({ payments, vendors, categories }))
    await vi.advanceTimersByTimeAsync(30_000)
    const error = await run

    expect(error.retryable).toBe(true)
    expect(error.message).toMatch(/did not complete/)
  })

  it('stops when the job that started it is cancelled', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (init.signal.aborted) reject(new Error('aborted'))
          init.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )

    const run = failure(classifyReceiptPayments({ payments, vendors, categories, signal: controller.signal }))
    controller.abort()
    const error = await run

    expect(error.message).toMatch(/cancelled/)
  })
})
