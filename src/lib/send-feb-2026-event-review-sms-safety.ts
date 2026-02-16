import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  return TRUTHY.has(value.trim().toLowerCase())
}

export function isFeb2026EventReviewSmsRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_FEB_REVIEW_SMS_SEND)
}

export function isFeb2026EventReviewSmsSendEnabled(argv: string[] = process.argv): boolean {
  return argv.includes('--confirm') && isFeb2026EventReviewSmsRunEnabled()
}

export function assertFeb2026EventReviewSmsSendAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'send-feb-2026-event-review-sms',
    envVar: 'ALLOW_FEB_REVIEW_SMS_SEND',
  })
}

function parseOptionalPositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function readFeb2026EventReviewSmsSendLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.FEB_REVIEW_SMS_SEND_LIMIT)
}

export function assertFeb2026EventReviewSmsSendLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('send-feb-2026-event-review-sms blocked: send limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `send-feb-2026-event-review-sms blocked: send limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

