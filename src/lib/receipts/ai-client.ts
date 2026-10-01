/**
 * The one call the receipts section makes to OpenAI: name the vendor of some payments from our
 * own vendor list, and suggest an expense category.
 *
 * Server only, and not a server action. It is called by the classification job and nowhere else.
 *
 * What it will not do quietly:
 *  - a failed call throws a `ReceiptAiError` saying whether trying again can help, so the job
 *    queue retries or stops. A failure used to return null and the job was marked complete;
 *  - the call is abandoned after 30 seconds, and when the job that started it is cancelled;
 *  - a reply cut short by the token limit is a failure, not a partial answer;
 *  - a vendor id that is not on the list we sent is ignored, and a missing confidence is treated
 *    as no confidence.
 *
 * The caller decides what may be sent. Nothing here adds to the prompt beyond what it is given.
 */

import { calculateOpenAICost, normaliseVendorName, type ClassificationUsage } from '@/lib/openai'
import { getOpenAIConfig } from '@/lib/openai/config'
import type { ReceiptExpenseCategory } from '@/types/database'

/** Bump when the prompt or the schema changes in a way that could change answers. */
export const RECEIPT_AI_PROMPT_VERSION = '2026-10-01.1'

/** Below this the model's answer is not used. */
export const RECEIPT_AI_MIN_CONFIDENCE = 70

const REQUEST_TIMEOUT_MS = 30_000

export class ReceiptAiError extends Error {
  constructor(
    message: string,
    /** True when the same request may succeed later: rate limits, server errors, timeouts. */
    public readonly retryable: boolean,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'ReceiptAiError'
  }
}

export type AiVendorOption = { id: string; name: string; aliases: string[] }

export type AiPaymentInput = {
  id: string
  details: string
  amount: number
  direction: 'in' | 'out'
  transactionType: string | null
  /** For Amex lines: the merchant's own category and town. */
  merchantHint?: string | null
  needsVendor: boolean
  needsCategory: boolean
  /** The vendor already on the payment, when only a category is wanted. */
  existingVendor?: string | null
}

export type AiExample = {
  details: string
  direction: 'in' | 'out'
  vendorName: string | null
  expenseCategory: ReceiptExpenseCategory | null
}

export type AiPaymentResult = {
  id: string
  /** A vendor from the list that was sent. */
  vendorId: string | null
  /** A real vendor that is not on the list. */
  newVendorName: string | null
  expenseCategory: ReceiptExpenseCategory | null
  noCategoryApplies: boolean
  /** Null when the model gave none, or one outside 0 to 100. */
  confidence: number | null
  reasoning: string | null
}

export type AiClassificationOutcome = {
  results: AiPaymentResult[]
  usage?: ClassificationUsage
  model: string
}

const SYSTEM_PROMPT = `You are a bookkeeper for a UK pub. You are given bank and card payments and must say who each was paid to or received from, and which expense category it belongs to.

Vendor:
- Choose the vendor from the VENDORS list and return its id as vendor_id. Use the list's spellings: the names after "also:" are other spellings of the same vendor.
- If the payment is clearly to or from a real business that is not on the list, return its ordinary trading name as new_vendor_name and leave vendor_id null.
- If you cannot tell who it is, return null for both. Never invent a vendor and never return a placeholder such as "unknown".
- Where a payment says the vendor is already set, return null for both.

Category:
- Choose expense_category from the CATEGORIES list for money going out, when the payment is an expense of the business.
- If the payment is not an expense that belongs in any category (tax paid to HMRC, drawings, transfers between the business's own accounts, loan or brewery account payments), set no_category_applies to true and leave expense_category null.
- If you are not sure, leave expense_category null and no_category_applies false.
- Money coming in never takes a category.

Give confidence from 0 to 100 for your answer as a whole. Return one entry for every payment, using the id you were given.`

function describeAmount(value: number): string {
  return `£${(Number.isFinite(value) ? value : 0).toFixed(2)}`
}

/** The text sent to the model. Exported so a test can check exactly what leaves the building. */
export function buildReceiptAiPrompt(input: {
  payments: AiPaymentInput[]
  vendors: AiVendorOption[]
  categories: readonly ReceiptExpenseCategory[]
  examples?: AiExample[]
}): string {
  const vendorLines = input.vendors.length
    ? input.vendors.map(
        (vendor) => `  ${vendor.id} | ${vendor.name}${vendor.aliases.length ? ` | also: ${vendor.aliases.join('; ')}` : ''}`
      )
    : ['  (none yet)']

  const exampleLines = (input.examples ?? []).map(
    (example) =>
      `  "${example.details}" (${example.direction}) → vendor: ${example.vendorName ?? 'none'}, category: ${example.expenseCategory ?? 'none'}`
  )

  const paymentLines = input.payments.map((payment, index) =>
    [
      `[${index}] id="${payment.id}"`,
      `  details: ${payment.details}`,
      `  amount: ${describeAmount(payment.amount)}`,
      `  direction: ${payment.direction === 'in' ? 'money in' : 'money out'}`,
      payment.transactionType ? `  type: ${payment.transactionType}` : null,
      payment.merchantHint ? `  merchant_hint: ${payment.merchantHint}` : null,
      payment.needsVendor ? null : `  vendor: already set${payment.existingVendor ? ` (${payment.existingVendor})` : ''}`,
      payment.needsCategory ? null : '  category: not wanted',
    ]
      .filter(Boolean)
      .join('\n')
  )

  return [
    'VENDORS (id | name | other spellings):',
    ...vendorLines,
    '',
    'CATEGORIES:',
    ...input.categories.map((category) => `  - ${category}`),
    '',
    ...(exampleLines.length ? ['EXAMPLES a person has classified:', ...exampleLines, ''] : []),
    'PAYMENTS:',
    paymentLines.join('\n\n'),
  ].join('\n')
}

function responseSchema(categories: readonly ReceiptExpenseCategory[]) {
  return {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            vendor_id: { type: ['string', 'null'] },
            new_vendor_name: { type: ['string', 'null'] },
            expense_category: { type: ['string', 'null'], enum: [...categories, null] },
            no_category_applies: { type: 'boolean' },
            confidence: { type: 'number' },
            reasoning: { type: ['string', 'null'] },
          },
          required: ['id', 'vendor_id', 'new_vendor_name', 'expense_category', 'no_category_applies', 'confidence', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
    required: ['classifications'],
    additionalProperties: false,
  }
}

function confidenceOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return rounded >= 0 && rounded <= 100 ? rounded : null
}

function contentOf(message: unknown): string | null {
  const content = (message as { content?: unknown } | null | undefined)?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim()
    return text || null
  }
  return null
}

export async function classifyReceiptPayments(input: {
  payments: AiPaymentInput[]
  vendors: AiVendorOption[]
  categories: readonly ReceiptExpenseCategory[]
  examples?: AiExample[]
  /** Cancels the call when the job that started it is cancelled. */
  signal?: AbortSignal
}): Promise<AiClassificationOutcome> {
  const { apiKey, baseUrl, receiptsModel } = await getOpenAIConfig()
  if (!apiKey) {
    throw new ReceiptAiError('OpenAI is not configured', false)
  }
  if (!input.payments.length) {
    return { results: [], model: receiptsModel }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), REQUEST_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort(new Error('cancelled'))
  if (input.signal?.aborted) {
    onOuterAbort()
  } else {
    input.signal?.addEventListener('abort', onOuterAbort, { once: true })
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: receiptsModel,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildReceiptAiPrompt(input) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'receipt_classification',
            strict: true,
            schema: responseSchema(input.categories),
          },
        },
        max_tokens: 2000,
      }),
    })
  } catch (error) {
    const cancelled = Boolean(input.signal?.aborted)
    throw new ReceiptAiError(
      cancelled ? 'The classification was cancelled' : 'The request to OpenAI did not complete',
      // A network failure or our own timeout is worth another try.
      true
    )
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onOuterAbort)
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    const body = await response.text().catch(() => '')
    console.error('OpenAI receipt classification request failed', { status: response.status, body: body.slice(0, 500) })
    throw new ReceiptAiError(
      response.status === 401 || response.status === 403
        ? 'OpenAI refused the API key'
        : `OpenAI returned ${response.status}`,
      retryable,
      response.status
    )
  }

  const payload = await response.json().catch(() => null)
  const choice = payload?.choices?.[0]
  if (!choice) {
    throw new ReceiptAiError('OpenAI returned no answer', true)
  }
  if (choice.finish_reason === 'length') {
    throw new ReceiptAiError('The answer from OpenAI was cut short', true)
  }

  const content = contentOf(choice.message)
  if (!content) {
    throw new ReceiptAiError('OpenAI returned an empty answer', true)
  }

  let parsed: { classifications?: unknown }
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new ReceiptAiError('The answer from OpenAI was not valid JSON', true)
  }
  if (!Array.isArray(parsed.classifications)) {
    throw new ReceiptAiError('The answer from OpenAI was not in the expected form', true)
  }

  const paymentIds = new Set(input.payments.map((payment) => payment.id))
  const vendorIds = new Set(input.vendors.map((vendor) => vendor.id))
  const seen = new Set<string>()
  const results: AiPaymentResult[] = []

  for (const item of parsed.classifications as Array<Record<string, unknown> | null>) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id : ''
    // An id we did not send, or a second answer for the same payment, is ignored.
    if (!paymentIds.has(id) || seen.has(id)) continue
    seen.add(id)

    const vendorId = typeof item.vendor_id === 'string' && vendorIds.has(item.vendor_id) ? item.vendor_id : null
    const category =
      typeof item.expense_category === 'string'
        ? input.categories.find((option) => option.toLowerCase() === (item.expense_category as string).trim().toLowerCase()) ?? null
        : null

    results.push({
      id,
      vendorId,
      // A name is only taken when no vendor from the list was chosen.
      newVendorName: vendorId ? null : normaliseVendorName(item.new_vendor_name),
      expenseCategory: category,
      noCategoryApplies: !category && item.no_category_applies === true,
      confidence: confidenceOf(item.confidence),
      reasoning: typeof item.reasoning === 'string' ? item.reasoning.trim().slice(0, 300) || null : null,
    })
  }

  const model = (payload?.model as string | undefined) ?? receiptsModel
  const usage: ClassificationUsage | undefined = payload?.usage
    ? {
        model,
        promptTokens: payload.usage.prompt_tokens ?? 0,
        completionTokens: payload.usage.completion_tokens ?? 0,
        totalTokens:
          payload.usage.total_tokens ?? (payload.usage.prompt_tokens ?? 0) + (payload.usage.completion_tokens ?? 0),
        cost: calculateOpenAICost(model, payload.usage.prompt_tokens ?? 0, payload.usage.completion_tokens ?? 0),
      }
    : undefined

  return { results, usage, model }
}
