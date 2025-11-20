import type { ReceiptExpenseCategory } from '@/types/database'
import { getOpenAIConfig } from '@/lib/openai/config'
import { retry, RetryConfigs } from '@/lib/retry'

const MODEL_PRICING_PER_1K_TOKENS: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4o-mini-2024-07-18': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4o': { prompt: 0.0025, completion: 0.01 },
  'gpt-4.1-mini': { prompt: 0.00015, completion: 0.0006 },
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
}

export type ClassificationOutcome = {
  result: ReceiptClassificationResult | null
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

  const systemPrompt = `You help a hospitality business classify bank transactions.
Pick the best matching vendor/merchant name and choose an expense category from the provided list.
Only answer with valid JSON that matches the schema.`

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
    'Return JSON with keys vendor_name, expense_category, reasoning. Use null where you are unsure.'
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
          { role: 'system', content: systemPrompt },
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

  let parsed: { vendor_name?: unknown; expense_category?: unknown; reasoning?: unknown }
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    console.error('Failed to parse OpenAI classification response', error)
    return null
  }

  const vendorName = normaliseVendorName(parsed.vendor_name)
  const expenseCategory = normaliseExpenseCategory(parsed.expense_category, categories)
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim().slice(0, 200) : null

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
    },
    usage,
  }
}
