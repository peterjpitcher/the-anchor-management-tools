import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return TRUTHY.has(value.trim().toLowerCase())
}

function findFlagValue(argv: string[], flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i]
    if (entry === flag) {
      const next = argv[i + 1]
      return typeof next === 'string' ? next : null
    }
    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      return entry.slice(withEqualsPrefix.length)
    }
  }
  return null
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export type TwilioLogBackfillArgs = {
  filePath: string
  confirm: boolean
  dryRun: boolean
  limit: number | null
  allowCreateCustomers: boolean
  createCustomersLimit: number | null
}

export function parseTwilioLogBackfillArgs(argv: string[] = process.argv): TwilioLogBackfillArgs {
  const [, , filePath, ...rest] = argv
  if (!filePath) {
    throw new Error(
      'Usage: tsx scripts/sms-tools/backfill-twilio-log.ts <path-to-csv> [--dry-run] [--confirm] --limit <n> [--allow-create-customers --create-customers-limit <n>]'
    )
  }

  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  const allowCreateCustomers = rest.includes('--allow-create-customers')
  const createCustomersLimit = parsePositiveInt(findFlagValue(rest, '--create-customers-limit'))

  return {
    filePath,
    confirm,
    dryRun,
    limit,
    allowCreateCustomers,
    createCustomersLimit,
  }
}

export function isTwilioLogBackfillMutationEnabled(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    argv.includes('--confirm') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(env.RUN_TWILIO_LOG_BACKFILL_MUTATION)
  )
}

export function assertTwilioLogBackfillMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'backfill-twilio-log',
    envVar: 'ALLOW_TWILIO_LOG_BACKFILL_MUTATION_SCRIPT',
  })
}

export function isTwilioLogBackfillCustomerCreationEnabled(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    isTwilioLogBackfillMutationEnabled(argv, env) &&
    argv.includes('--allow-create-customers') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(env.RUN_TWILIO_LOG_BACKFILL_CREATE_CUSTOMERS)
  )
}

export function assertTwilioLogBackfillCustomerCreationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'backfill-twilio-log:create-customers',
    envVar: 'ALLOW_TWILIO_LOG_BACKFILL_CREATE_CUSTOMERS',
  })
}

export function requireScriptLimit(params: {
  label: string
  value: number | null
  hardCap: number
}): number {
  if (!params.value) {
    throw new Error(`${params.label} is required`)
  }
  if (params.value > params.hardCap) {
    throw new Error(`${params.label} exceeds hard cap (max ${params.hardCap})`)
  }
  return params.value
}

export function buildTwilioLogBackfillPlaceholderCustomerInsert(params: {
  phoneE164: string
  fallbackName?: string
  now?: Date
}): Record<string, unknown> {
  const now = params.now ?? new Date()
  const nameParts = (params.fallbackName ?? '')
    .trim()
    .split(' ')
    .filter(Boolean)
  const firstName = nameParts[0] || 'Guest'
  const lastName = nameParts.slice(1).join(' ') || ''
  const nowIso = now.toISOString()

  return {
    first_name: firstName,
    last_name: lastName,
    mobile_number: params.phoneE164,
    mobile_e164: params.phoneE164,
    mobile_number_raw: params.phoneE164,
    sms_opt_in: false,
    marketing_sms_opt_in: false,
    sms_status: 'sms_deactivated',
    sms_deactivated_at: nowIso,
    sms_deactivation_reason: 'twilio_log_backfill_placeholder',
  }
}
