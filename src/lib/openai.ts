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

export type VendorCostReviewOutcome = {
  result: ReceiptVendorAiReview | null
  usage?: ClassificationUsage
}

export function calculateOpenAICost(model: string, promptTokens: number, completionTokens: number): number {
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

// What a model writes when it means "no answer". Five pending rule suggestions named their
// vendor "null" because the string was taken at face value.
const PLACEHOLDER_VENDOR_NAMES = new Set(['null', 'none', 'unknown', 'n/a', 'na', 'undefined', 'not applicable', '-'])

export function normaliseVendorName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.length) return null
  if (PLACEHOLDER_VENDOR_NAMES.has(trimmed.toLowerCase())) return null
  return trimmed.slice(0, 120)
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
