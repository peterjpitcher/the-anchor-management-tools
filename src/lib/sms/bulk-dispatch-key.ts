import crypto from 'crypto'

type BulkDispatchKeyInput = {
  customerIds: string[]
  message: string
  eventId?: string
  categoryId?: string
  batchIndex?: number
}

const DEFAULT_BULK_SMS_MAX_RECIPIENTS = 500

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function normalizeBulkRecipientIds(customerIds: string[]): string[] {
  return Array.from(new Set(customerIds.filter((id) => typeof id === 'string' && id.length > 0))).sort()
}

export function getBulkSmsRecipientLimit(): number {
  return parsePositiveInt(process.env.BULK_SMS_MAX_RECIPIENTS, DEFAULT_BULK_SMS_MAX_RECIPIENTS)
}

export function validateBulkSmsRecipientCount(recipientCount: number): string | null {
  const limit = getBulkSmsRecipientLimit()
  if (recipientCount > limit) {
    return `Bulk SMS recipient limit exceeded (${recipientCount}/${limit}). Split this send into smaller batches.`
  }
  return null
}

export function buildBulkSmsDispatchKey(input: BulkDispatchKeyInput): string {
  const payload = JSON.stringify({
    customer_ids: normalizeBulkRecipientIds(input.customerIds),
    message: input.message.trim(),
    event_id: input.eventId ?? null,
    category_id: input.categoryId ?? null,
    batch_index: input.batchIndex ?? null
  })

  const hash = crypto.createHash('sha256').update(payload).digest('hex')
  return `bulk_sms:${hash.slice(0, 48)}`
}
