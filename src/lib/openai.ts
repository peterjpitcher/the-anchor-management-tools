import type { ReceiptExpenseCategory } from '@/types/database'
import { getOpenAIConfig } from '@/lib/openai/config'
import { retry, RetryConfigs } from '@/lib/retry'

const MODEL_PRICING_PER_1K_TOKENS: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4o-mini-2024-07-18': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4o': { prompt: 0.0025, completion: 0.01 },
  'gpt-4.1-mini': { prompt: 0.0004, completion: 0.0016 },
}

export type ClassificationUsage = {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
}

export type ReceiptClassificationResult = {
  vendorName: string | null
  expenseCategory: ReceiptExpenseCategory | null
  reasoning: string | null
  confidence: number | null
  suggestedRuleKeywords: string | null
}

export type ClassificationOutcome = {
  result: ReceiptClassificationResult | null
  usage?: ClassificationUsage
}

export type FewShotExample = {
  details: string
  direction: 'in' | 'out'
  vendorName: string | null
  expenseCategory: ReceiptExpenseCategory | null
}

export type CrossTransactionHint = {
  details: string
  vendorName: string
  source: 'manual' | 'rule'
}

export type BatchClassificationItem = {
  id: string
  details: string
  amountIn: number | null
  amountOut: number | null
  transactionType: string | null
  direction: 'in' | 'out'
  skipVendor?: boolean
  existingVendor?: string | null
  existingExpenseCategory?: ReceiptExpenseCategory | null
}

export type BatchClassificationResult = {
  id: string
  vendorName: string | null
  expenseCategory: ReceiptExpenseCategory | null
  reasoning: string | null
  confidence: number | null
  suggestedRuleKeywords: string | null
}

export type BatchClassificationOutcome = {
  results: BatchClassificationResult[]
  usage?: ClassificationUsage
}

function calculateOpenAICost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING_PER_1K_TOKENS[model] ?? MODEL_PRICING_PER_1K_TOKENS['gpt-4o-mini']
  const promptCost = (promptTokens / 1000) * pricing.prompt
  const completionCost = (completionTokens / 1000) * pricing.completion
  return Number((promptCost + completionCost).toFixed(6))
}

function extractContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part && typeof (part as Record<string, unknown>).text === 'string') {
          return (part as Record<string, string>).text
        }
        return ''
      })
      .filter(Boolean)
    return parts.join('').trim() || null
  }
  return null
}

function normaliseVendorName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed.slice(0, 120) : null
}

function normaliseExpenseCategory(
  value: unknown,
  categories: readonly ReceiptExpenseCategory[]
): ReceiptExpenseCategory | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = categories.find((option) => option.toLowerCase() === trimmed.toLowerCase())
  return match ?? null
}

function normaliseConfidence(value: unknown): number | null {
  if (typeof value !== 'number') return null
  const rounded = Math.round(value)
  if (rounded < 0 || rounded > 100) return null
  return rounded
}

function normaliseKeywords(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed.slice(0, 300) : null
}

const UK_PUB_SYSTEM_PROMPT = `You are an expert bookkeeper for a UK pub and hospitality business.
You classify bank transactions into vendor names and HMRC-aligned expense categories.
Context: This is a British pub. Common vendors include breweries (Heineken, Carlsberg, BrewDog, Estrella),
food suppliers (Bidfood, Brakes, Booker), HMRC for VAT/PAYE, energy providers, Sky,
local councils (business rates), insurance companies, waste management, and payment processors.
Transactions are in GBP. Use UK English in vendor names.
Only respond with valid JSON matching the schema. Use null when genuinely unsure.`

export async function classifyReceiptTransaction(input: {
  details: string
  amountIn: number | null
  amountOut: number | null
  transactionType?: string | null
  categories: readonly ReceiptExpenseCategory[]
  direction: 'in' | 'out'
  existingVendor?: string | null
  existingExpenseCategory?: ReceiptExpenseCategory | null
}): Promise<ClassificationOutcome | null> {
  const { apiKey, baseUrl, receiptsModel } = await getOpenAIConfig()

  if (!apiKey) {
    console.warn('OpenAI not configured; skipping classification')
    return null
  }

  const model = receiptsModel

  const { details, amountIn, amountOut, transactionType, categories, direction, existingVendor, existingExpenseCategory } = input

  const amountLabel = direction === 'in' ? amountIn ?? amountOut ?? 0 : amountOut ?? amountIn ?? 0
  const amountDescription = amountLabel ? `Amount: £${amountLabel.toFixed(2)}` : 'Amount: £0.00'

  const userPrompt = [
    `Transaction details: ${details}`,
    amountDescription,
    transactionType ? `Transaction type: ${transactionType}` : null,
    `Direction: ${direction === 'in' ? 'Money in' : 'Money out'}`,
    existingVendor ? `Existing vendor: ${existingVendor}` : null,
    existingExpenseCategory ? `Existing expense category: ${existingExpenseCategory}` : null,
    'Allowed expense categories:',
    ...categories.map((category) => `- ${category}`),
    '',
    'Return JSON with keys vendor_name, expense_category, reasoning, confidence (0-100), suggested_rule_keywords (comma-separated keywords for matching this type of transaction). Use null where you are unsure.'
  ]
    .filter(Boolean)
    .join('\n')

  const response = await retry(
    async () => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: UK_PUB_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'receipt_classification',
            schema: {
              type: 'object',
              properties: {
                vendor_name: { type: ['string', 'null'], description: 'The suggested vendor or merchant name.' },
                expense_category: {
                  type: ['string', 'null'],
                  description: 'The accounting bucket that matches the transaction.',
                  enum: categories,
                },
                reasoning: { type: ['string', 'null'], description: 'One-line explanation for auditing.' },
                confidence: { type: ['number', 'null'], description: 'Confidence score 0-100.' },
                suggested_rule_keywords: { type: ['string', 'null'], description: 'Comma-separated keywords to match similar transactions.' },
              },
              required: ['vendor_name', 'expense_category'],
              additionalProperties: false,
            },
          },
        },
        max_tokens: 300,
      }),
    }),
    RetryConfigs.api
  )

  if (!response.ok) {
    console.error('OpenAI classification request failed', await response.text())
    return null
  }

  const payload = await response.json()
  const choice = payload?.choices?.[0]
  const content = extractContent(choice?.message?.content)
  if (!content) {
    console.warn('OpenAI classification returned empty content')
    return null
  }

  let parsed: { vendor_name?: unknown; expense_category?: unknown; reasoning?: unknown; confidence?: unknown; suggested_rule_keywords?: unknown }
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    console.error('Failed to parse OpenAI classification response', error)
    return null
  }

  const vendorName = normaliseVendorName(parsed.vendor_name)
  const expenseCategory = normaliseExpenseCategory(parsed.expense_category, categories)
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim().slice(0, 200) : null
  const confidence = normaliseConfidence(parsed.confidence)
  const suggestedRuleKeywords = normaliseKeywords(parsed.suggested_rule_keywords)

  const usage: ClassificationUsage | undefined = payload?.usage
    ? {
      model: payload.usage.model ?? model,
      promptTokens: payload.usage.prompt_tokens ?? 0,
      completionTokens: payload.usage.completion_tokens ?? 0,
      totalTokens: payload.usage.total_tokens ?? ((payload.usage.prompt_tokens ?? 0) + (payload.usage.completion_tokens ?? 0)),
      cost: calculateOpenAICost(
        payload.usage.model ?? model,
        payload.usage.prompt_tokens ?? 0,
        payload.usage.completion_tokens ?? 0
      ),
    }
    : undefined

  return {
    result: {
      vendorName,
      expenseCategory,
      reasoning,
      confidence,
      suggestedRuleKeywords,
    },
    usage,
  }
}

export async function classifyReceiptTransactionsBatch(input: {
  items: BatchClassificationItem[]
  categories: readonly ReceiptExpenseCategory[]
  fewShotExamples?: FewShotExample[]
  crossTransactionHints?: CrossTransactionHint[]
}): Promise<BatchClassificationOutcome | null> {
  const { apiKey, baseUrl, receiptsModel } = await getOpenAIConfig()

  if (!apiKey) {
    console.warn('OpenAI not configured; skipping batch classification')
    return null
  }

  const { items, categories, fewShotExamples = [], crossTransactionHints = [] } = input

  if (!items.length) return { results: [] }

  const model = receiptsModel

  const fewShotSection = fewShotExamples.length
    ? [
        'EXAMPLES OF CORRECT CLASSIFICATIONS (from manual corrections):',
        ...fewShotExamples.map((ex) =>
          `  "${ex.details}" (${ex.direction}) → vendor: ${ex.vendorName ?? 'null'}, category: ${ex.expenseCategory ?? 'null'}`
        ),
        '',
      ].join('\n')
    : ''

  const crossTxSection = crossTransactionHints.length
    ? [
        'KNOWN VENDORS FROM EXISTING TRANSACTIONS:',
        ...crossTransactionHints.map((hint) =>
          `  "${hint.details}" → ${hint.vendorName} (source: ${hint.source})`
        ),
        '',
      ].join('\n')
    : ''

  const categoriesSection = [
    'ALLOWED EXPENSE CATEGORIES:',
    ...categories.map((c) => `  - ${c}`),
    '',
  ].join('\n')

  const itemsSection = items
    .map((item, index) => {
      const amountLabel = item.direction === 'in'
        ? item.amountIn ?? item.amountOut ?? 0
        : item.amountOut ?? item.amountIn ?? 0
      const lines = [
        `[${index}] id="${item.id}"`,
        `  details: ${item.details}`,
        `  amount: £${amountLabel?.toFixed(2) ?? '0.00'}`,
        `  direction: ${item.direction === 'in' ? 'money in' : 'money out'}`,
        item.transactionType ? `  type: ${item.transactionType}` : null,
        item.skipVendor ? '  vendor: ALREADY SET (skip)' : null,
        item.existingVendor ? `  existing_vendor: ${item.existingVendor}` : null,
        item.existingExpenseCategory ? `  existing_category: ${item.existingExpenseCategory}` : null,
      ].filter(Boolean)
      return lines.join('\n')
    })
    .join('\n\n')

  const userPrompt = [
    fewShotSection,
    crossTxSection,
    categoriesSection,
    'TRANSACTIONS TO CLASSIFY:',
    itemsSection,
    '',
    'Return a JSON object with a "classifications" array. Each element must have:',
    '  id (string), vendor_name (string|null), expense_category (string|null),',
    '  reasoning (string|null), confidence (number 0-100|null),',
    '  suggested_rule_keywords (comma-separated keywords|null)',
    'If vendor is marked ALREADY SET, return vendor_name as null.',
    'Return one entry per transaction in the same order.',
  ]
    .filter(Boolean)
    .join('\n')

  const classificationSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      vendor_name: { type: ['string', 'null'] },
      expense_category: { type: ['string', 'null'], enum: [...categories, null] },
      reasoning: { type: ['string', 'null'] },
      confidence: { type: ['number', 'null'] },
      suggested_rule_keywords: { type: ['string', 'null'] },
    },
    required: ['id', 'vendor_name', 'expense_category'],
    additionalProperties: false,
  }

  const response = await retry(
    async () => fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: UK_PUB_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'batch_receipt_classification',
            schema: {
              type: 'object',
              properties: {
                classifications: {
                  type: 'array',
                  items: classificationSchema,
                },
              },
              required: ['classifications'],
              additionalProperties: false,
            },
          },
        },
        max_tokens: 2000,
      }),
    }),
    RetryConfigs.api
  )

  if (!response.ok) {
    console.error('OpenAI batch classification request failed', await response.text())
    return null
  }

  const payload = await response.json()
  const choice = payload?.choices?.[0]
  const content = extractContent(choice?.message?.content)
  if (!content) {
    console.warn('OpenAI batch classification returned empty content')
    return null
  }

  let parsed: { classifications?: unknown[] }
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    console.error('Failed to parse OpenAI batch classification response', error)
    return null
  }

  const rawItems = Array.isArray(parsed?.classifications) ? parsed.classifications : []
  const results: BatchClassificationResult[] = rawItems
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      vendorName: normaliseVendorName(item.vendor_name),
      expenseCategory: normaliseExpenseCategory(item.expense_category, categories),
      reasoning: typeof item.reasoning === 'string' ? item.reasoning.trim().slice(0, 200) : null,
      confidence: normaliseConfidence(item.confidence),
      suggestedRuleKeywords: normaliseKeywords(item.suggested_rule_keywords),
    }))
    .filter((r) => r.id)

  const usage: ClassificationUsage | undefined = payload?.usage
    ? {
      model: payload.usage.model ?? model,
      promptTokens: payload.usage.prompt_tokens ?? 0,
      completionTokens: payload.usage.completion_tokens ?? 0,
      totalTokens: payload.usage.total_tokens ?? ((payload.usage.prompt_tokens ?? 0) + (payload.usage.completion_tokens ?? 0)),
      cost: calculateOpenAICost(
        payload.usage.model ?? model,
        payload.usage.prompt_tokens ?? 0,
        payload.usage.completion_tokens ?? 0
      ),
    }
    : undefined

  return { results, usage }
}
