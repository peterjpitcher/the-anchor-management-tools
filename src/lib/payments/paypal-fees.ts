import type { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

/**
 * PayPal's fee for a capture (BK-117), from `seller_receivable_breakdown` on the capture: the
 * capture response and the PAYMENT.CAPTURE.COMPLETED webhook carry the same object. Every capture
 * the app makes, in any part of it, is reported to the one PayPal webhook, so recording the fee
 * there covers them all in one place.
 */
export type PayPalCaptureFee = {
  captureId: string
  fee: number
  gross: number | null
  net: number | null
  currency: string
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null
}

/** The fee on a PayPal capture object, or null when PayPal did not report one. */
export function readPayPalCaptureFee(capture: unknown): PayPalCaptureFee | null {
  if (!capture || typeof capture !== 'object') return null
  const resource = capture as {
    id?: unknown
    status?: unknown
    amount?: { currency_code?: unknown }
    seller_receivable_breakdown?: {
      gross_amount?: { value?: unknown; currency_code?: unknown }
      paypal_fee?: { value?: unknown; currency_code?: unknown }
      net_amount?: { value?: unknown }
    }
  }
  const captureId = typeof resource.id === 'string' ? resource.id.trim() : ''
  const breakdown = resource.seller_receivable_breakdown
  const fee = money(breakdown?.paypal_fee?.value)
  if (!captureId || fee === null || fee < 0) return null
  const currencyRaw = breakdown?.paypal_fee?.currency_code ?? breakdown?.gross_amount?.currency_code ?? resource.amount?.currency_code
  return {
    captureId,
    fee,
    gross: money(breakdown?.gross_amount?.value),
    net: money(breakdown?.net_amount?.value),
    currency: typeof currencyRaw === 'string' && currencyRaw.trim() ? currencyRaw.trim().toUpperCase() : 'GBP',
  }
}

/**
 * Records a capture's fee once (the capture id is the key). Never throws: a missing fee is a gap in
 * a report, never a reason to fail a payment or make PayPal retry a webhook. A failed write is
 * logged as an error.
 */
export async function recordPayPalCaptureFee(
  db: ReturnType<typeof createAdminClient>,
  fee: PayPalCaptureFee,
  source: string
): Promise<boolean> {
  try {
    const { error } = await db
      .from('paypal_capture_fees')
      .upsert(
        {
          capture_id: fee.captureId,
          fee_amount: fee.fee,
          gross_amount: fee.gross,
          net_amount: fee.net,
          currency: fee.currency,
          source,
        },
        { onConflict: 'capture_id', ignoreDuplicates: true }
      )
    if (error) throw new Error(error.message)
    return true
  } catch (error) {
    logger.error('Failed to record a PayPal capture fee', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { captureId: fee.captureId, source },
    })
    return false
  }
}
