import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn(),
}))

import { getOpenAIConfig } from '@/lib/openai/config'
import { summarizeReceiptVendorCostReview } from '@/lib/openai'
import type { ReceiptVendorCostSignal, ReceiptVendorMovementSignal } from '@/services/receipts'

const mockedGetOpenAIConfig = getOpenAIConfig as unknown as Mock

const signal: ReceiptVendorCostSignal = {
  vendorLabel: 'Brewery A',
  severity: 'high',
  direction: 'spike',
  recentAverageOutgoing: 300,
  previousAverageOutgoing: 100,
  recentTotalOutgoing: 900,
  previousTotalOutgoing: 300,
  absoluteDelta: 200,
  percentageChange: 200,
  reason: 'Brewery A moved from £100 to £300 average monthly spend (+200.0%).',
}

const movementSignal: ReceiptVendorMovementSignal = {
  vendorLabel: 'Brewery A',
  severity: 'high',
  direction: 'resumed',
  comparison: 'yoy',
  monthStart: '2026-06-01',
  currentOutgoing: 300,
  baselineOutgoing: 0,
  baselineMonthStart: '2025-06-01',
  absoluteDelta: 300,
  percentageChange: 100,
  reason: 'Brewery A resumed at £300 in Jun 2026 after a zero YoY baseline.',
}

function openAIResponse(content: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      model: 'gpt-4o-mini',
    },
  }), { status: 200 })
}

describe('summarizeReceiptVendorCostReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetOpenAIConfig.mockResolvedValue({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1',
      receiptsModel: 'gpt-4o-mini',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a structured AI review for valid JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAIResponse(JSON.stringify({
      overview: 'Brewery spend is materially higher and should be checked.',
      review_items: [{
        vendor_label: 'Brewery A',
        severity: 'high',
        direction: 'spike',
        reason: 'Average monthly spend rose from £100 to £300.',
        suggested_review: 'Check invoices and one-off purchases.',
      }],
    })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await summarizeReceiptVendorCostReview({
      signals: [signal],
      monthWindow: 12,
    })

    expect(result?.result).toMatchObject({
      overview: 'Brewery spend is materially higher and should be checked.',
      source: 'ai',
      reviewItems: [{
        vendorLabel: 'Brewery A',
        severity: 'high',
        direction: 'spike',
      }],
    })
    expect(result?.usage?.cost).toBeGreaterThan(0)
  })

  it('accepts movement signals in the structured AI review', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAIResponse(JSON.stringify({
      overview: 'Brewery A resumed year-on-year and should be checked.',
      review_items: [{
        vendor_label: 'Brewery A',
        severity: 'high',
        direction: 'resumed',
        reason: 'Spend resumed from a zero YoY baseline.',
        suggested_review: 'Check whether this is a returning supplier or a renamed vendor.',
      }],
    })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await summarizeReceiptVendorCostReview({
      signals: [],
      movementSignals: [movementSignal],
      monthWindow: 12,
    })

    expect(result?.result.reviewItems[0]).toMatchObject({
      vendorLabel: 'Brewery A',
      direction: 'resumed',
      severity: 'high',
    })
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(requestBody.response_format.json_schema.schema.properties.review_items.items.properties.direction.enum).toContain('resumed')
    expect(requestBody.messages[1].content).toContain('movementSignals')
  })

  it('returns null when OpenAI is not configured', async () => {
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await summarizeReceiptVendorCostReview({
      signals: [signal],
      monthWindow: 12,
    })

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null for invalid JSON content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openAIResponse('not json')))

    const result = await summarizeReceiptVendorCostReview({
      signals: [signal],
      monthWindow: 12,
    })

    expect(result).toBeNull()
  })

  it('returns null when the OpenAI request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad request', { status: 400 })))

    const result = await summarizeReceiptVendorCostReview({
      signals: [signal],
      monthWindow: 12,
    })

    expect(result).toBeNull()
  })
})
