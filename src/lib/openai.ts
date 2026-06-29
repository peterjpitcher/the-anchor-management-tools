import type { ReceiptExpenseCategory } from '@/types/database'
import { getOpenAIConfig } from '@/lib/openai/config'
import { retry, RetryConfigs } from '@/lib/retry'
import type {
  ReceiptVendorAiReview,
  ReceiptVendorAiReviewItem,
  ReceiptVendorCostSignal,
  ReceiptVendorDetail,
  ReceiptVendorMovementSignal,
} from '@/services/receipts/types'

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
  /** Optional merchant context (category · town) for Amex rows; improves vendor/category accuracy. */
  merchantHint?: string | null
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

export type VendorCostReviewOutcome = {
  result: ReceiptVendorAiReview | null
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

function normaliseReviewText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length ? trimmed.slice(0, maxLength) : null
}

function normaliseReviewSeverity(value: unknown): ReceiptVendorAiReviewItem['severity'] | null {
  return value === 'high' || value === 'medium' ? value : null
}

function normaliseReviewDirection(value: unknown): ReceiptVendorAiReviewItem['direction'] | null {
  return value === 'spike' || value === 'drop' || value === 'new' || value === 'resumed' ? value : null
}

function normaliseReviewItems(
  value: unknown,
  vendorLabels: string[],
): ReceiptVendorAiReviewItem[] {
  if (!Array.isArray(value)) return []

  const labelMap = new Map(vendorLabels.map((label) => [label.toLowerCase(), label]))

  return value
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item): ReceiptVendorAiReviewItem | null => {
      const rawVendorLabel = normaliseReviewText(item.vendor_label, 120)
      const vendorLabel = rawVendorLabel
        ? labelMap.get(rawVendorLabel.toLowerCase()) ?? rawVendorLabel
        : null
      const severity = normaliseReviewSeverity(item.severity)
      const direction = normaliseReviewDirection(item.direction)
      const reason = normaliseReviewText(item.reason, 240)
      const suggestedReview = normaliseReviewText(item.suggested_review, 240)

      if (!vendorLabel || !severity || !direction || !reason || !suggestedReview) {
        return null
      }

      return {
        vendorLabel,
        severity,
        direction,
        reason,
        suggestedReview,
      }
    })
    .filter((item): item is ReceiptVendorAiReviewItem => Boolean(item))
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
        item.merchantHint ? `  merchant_hint: ${item.merchantHint}` : null,
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

export async function summarizeReceiptVendorCostReview(input: {
  signals: ReceiptVendorCostSignal[]
  movementSignals?: ReceiptVendorMovementSignal[]
  monthWindow: number
  vendorLabel?: string
  detail?: Pick<
    ReceiptVendorDetail,
    | 'vendorLabel'
    | 'totalOutgoing'
    | 'totalIncome'
    | 'transactionCount'
    | 'historyTotalOutgoing'
    | 'historyTotalIncome'
    | 'historyTransactionCount'
    | 'historyStartDate'
    | 'historyEndDate'
    | 'recentAverageOutgoing'
    | 'previousAverageOutgoing'
    | 'changePercentage'
    | 'categoryBreakdown'
    | 'movementMonths'
    | 'movementSignals'
    | 'transactions'
    | 'recentTransactions'
    | 'months'
  >
}): Promise<VendorCostReviewOutcome | null> {
  const { apiKey, baseUrl, receiptsModel } = await getOpenAIConfig()

  if (!apiKey) {
    console.warn('OpenAI not configured; skipping vendor cost review')
    return null
  }

  const movementSignals = input.movementSignals ?? input.detail?.movementSignals ?? []

  if (!input.signals.length && !movementSignals.length && !input.detail) {
    return null
  }

  const model = receiptsModel
  const vendorLabels = Array.from(new Set([
    ...input.signals.map((signal) => signal.vendorLabel),
    ...movementSignals.map((signal) => signal.vendorLabel),
    input.detail?.vendorLabel,
  ].filter((label): label is string => Boolean(label))))

  const payloadFacts = {
    scope: input.vendorLabel ? 'single_vendor' : 'all_vendors',
    monthWindow: input.monthWindow,
    vendorLabel: input.vendorLabel ?? null,
    costSignals: input.signals.slice(0, 12).map((signal) => ({
      vendorLabel: signal.vendorLabel,
      severity: signal.severity,
      direction: signal.direction,
      recentAverageOutgoing: signal.recentAverageOutgoing,
      previousAverageOutgoing: signal.previousAverageOutgoing,
      recentTotalOutgoing: signal.recentTotalOutgoing,
      previousTotalOutgoing: signal.previousTotalOutgoing,
      absoluteDelta: signal.absoluteDelta,
      percentageChange: signal.percentageChange,
      reason: signal.reason,
    })),
    movementSignals: movementSignals.slice(0, 12).map((signal) => ({
      vendorLabel: signal.vendorLabel,
      severity: signal.severity,
      direction: signal.direction,
      comparison: signal.comparison,
      monthStart: signal.monthStart,
      currentOutgoing: signal.currentOutgoing,
      baselineOutgoing: signal.baselineOutgoing,
      baselineMonthStart: signal.baselineMonthStart,
      absoluteDelta: signal.absoluteDelta,
      percentageChange: signal.percentageChange,
      reason: signal.reason,
    })),
    vendorDetail: input.detail
      ? {
          vendorLabel: input.detail.vendorLabel,
          totalOutgoing: input.detail.totalOutgoing,
          totalIncome: input.detail.totalIncome,
          transactionCount: input.detail.transactionCount,
          historyTotalOutgoing: input.detail.historyTotalOutgoing,
          historyTotalIncome: input.detail.historyTotalIncome,
          historyTransactionCount: input.detail.historyTransactionCount,
          historyStartDate: input.detail.historyStartDate,
          historyEndDate: input.detail.historyEndDate,
          recentAverageOutgoing: input.detail.recentAverageOutgoing,
          previousAverageOutgoing: input.detail.previousAverageOutgoing,
          changePercentage: input.detail.changePercentage,
          categoryBreakdown: input.detail.categoryBreakdown.slice(0, 8),
          movementSignals: input.detail.movementSignals.slice(0, 10),
          movementMonths: input.detail.movementMonths.slice(-18).map((month) => ({
            monthStart: month.monthStart,
            totalOutgoing: month.totalOutgoing,
            transactionCount: month.transactionCount,
            momDelta: month.momDelta,
            momPercentageChange: month.momPercentageChange,
            yoyDelta: month.yoyDelta,
            yoyPercentageChange: month.yoyPercentageChange,
          })),
          recentTransactions: (input.detail.transactions.length
            ? input.detail.transactions
            : input.detail.recentTransactions
          ).slice(0, 10).map((tx) => ({
            date: tx.transaction_date,
            details: tx.details,
            amountOut: tx.amount_out,
            amountIn: tx.amount_in,
            expenseCategory: tx.expense_category,
            status: tx.status,
          })),
          months: input.detail.months.slice(-12),
        }
      : null,
  }

  const userPrompt = [
    'Summarise these receipt vendor cost signals for a UK pub operator.',
    'Use only the supplied numbers. Do not invent causes, vendors, invoices, or categories.',
    'Prioritise what should be reviewed next.',
    'Use movementSignals for MoM and YoY changes when provided.',
    'If there are no costSignals or movementSignals, give a concise overview and return an empty review_items array.',
    '',
    JSON.stringify(payloadFacts, null, 2),
  ].join('\n')

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
          {
            role: 'system',
            content: 'You are an expert bookkeeper for a UK pub. Return concise, audit-friendly JSON only.',
          },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'receipt_vendor_cost_review',
            schema: {
              type: 'object',
              properties: {
                overview: { type: 'string' },
                review_items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      vendor_label: { type: 'string' },
                      severity: { type: 'string', enum: ['high', 'medium'] },
                      direction: { type: 'string', enum: ['spike', 'drop', 'new', 'resumed'] },
                      reason: { type: 'string' },
                      suggested_review: { type: 'string' },
                    },
                    required: ['vendor_label', 'severity', 'direction', 'reason', 'suggested_review'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['overview', 'review_items'],
              additionalProperties: false,
            },
          },
        },
        max_tokens: 900,
      }),
    }),
    RetryConfigs.api,
  )

  if (!response.ok) {
    console.error('OpenAI vendor cost review request failed', await response.text())
    return null
  }

  const payload = await response.json()
  const choice = payload?.choices?.[0]
  const content = extractContent(choice?.message?.content)
  if (!content) {
    console.warn('OpenAI vendor cost review returned empty content')
    return null
  }

  let parsed: { overview?: unknown; review_items?: unknown }
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    console.error('Failed to parse OpenAI vendor cost review response', error)
    return null
  }

  const overview = normaliseReviewText(parsed.overview, 500)
  if (!overview) {
    return null
  }

  const usage: ClassificationUsage | undefined = payload?.usage
    ? {
        model: payload.usage.model ?? model,
        promptTokens: payload.usage.prompt_tokens ?? 0,
        completionTokens: payload.usage.completion_tokens ?? 0,
        totalTokens: payload.usage.total_tokens ?? ((payload.usage.prompt_tokens ?? 0) + (payload.usage.completion_tokens ?? 0)),
        cost: calculateOpenAICost(
          payload.usage.model ?? model,
          payload.usage.prompt_tokens ?? 0,
          payload.usage.completion_tokens ?? 0,
        ),
      }
    : undefined

  return {
    result: {
      overview,
      reviewItems: normaliseReviewItems(parsed.review_items, vendorLabels),
      source: 'ai',
      generatedAt: new Date().toISOString(),
      model: usage?.model ?? model,
    },
    usage,
  }
}
