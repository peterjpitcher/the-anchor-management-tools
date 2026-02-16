const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return TRUTHY.has(value.trim().toLowerCase())
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

function parseOptionalNonNegativeInt(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

export function isParkingSmsBackfillRunEnabled(): boolean {
  return isTruthyEnv(process.env.RUN_PARKING_SMS_BACKFILL_MUTATION)
}

export function assertParkingSmsBackfillRunEnabled(): void {
  if (isParkingSmsBackfillRunEnabled()) {
    return
  }

  throw new Error(
    'parking-sms-backfill is in read-only mode. Set RUN_PARKING_SMS_BACKFILL_MUTATION=true and ALLOW_PARKING_SMS_BACKFILL_MUTATION=true to run mutations.'
  )
}

export function assertParkingSmsBackfillMutationAllowed(): void {
  if (
    isTruthyEnv(process.env.ALLOW_PARKING_SMS_BACKFILL_MUTATION) ||
    isTruthyEnv(process.env.ALLOW_PARKING_SMS_BACKFILL_SCRIPT)
  ) {
    return
  }

  throw new Error(
    'parking-sms-backfill blocked by safety guard. Set ALLOW_PARKING_SMS_BACKFILL_MUTATION=true to run this mutation script.'
  )
}

export function readParkingSmsBackfillLimit(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--limit='))
  if (eq) {
    return parseOptionalPositiveInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--limit')
  if (idx !== -1) {
    return parseOptionalPositiveInt(argv[idx + 1])
  }

  return parseOptionalPositiveInt(process.env.PARKING_SMS_BACKFILL_LIMIT)
}

export function assertParkingSmsBackfillLimit(limit: number, max: number): void {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('parking-sms-backfill blocked: limit must be a positive integer.')
  }

  if (limit > max) {
    throw new Error(
      `parking-sms-backfill blocked: limit ${limit} exceeds hard cap ${max}. Run in smaller batches.`
    )
  }
}

export function readParkingSmsBackfillOffset(argv: string[] = process.argv): number | null {
  const eq = argv.find((arg) => arg.startsWith('--offset='))
  if (eq) {
    return parseOptionalNonNegativeInt(eq.split('=')[1])
  }

  const idx = argv.findIndex((arg) => arg === '--offset')
  if (idx !== -1) {
    return parseOptionalNonNegativeInt(argv[idx + 1])
  }

  return parseOptionalNonNegativeInt(process.env.PARKING_SMS_BACKFILL_OFFSET)
}

