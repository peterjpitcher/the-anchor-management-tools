import {
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '@/lib/script-mutation-safety'

const FIX_PENDING_PAYMENT_LIMIT = 1

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

export function resolveFixPendingPaymentRow<T>(params: {
  operation: string
  row: T | null
  error: { message?: string } | null
}): T {
  const row = assertScriptQuerySucceeded({
    operation: params.operation,
    error: params.error,
    data: params.row
  })

  if (!row) {
    throw new Error(`${params.operation} returned no rows`)
  }

  return row
}

export function assertFixPendingPaymentMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'fix-pending-payment',
    envVar: 'ALLOW_FIX_PENDING_PAYMENT_MUTATION'
  })
}

export function readFixPendingPaymentLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  return findFlagValue(argv, '--limit') ?? env.FIX_PENDING_PAYMENT_LIMIT ?? null
}

export function assertFixPendingPaymentLimit(value: string | null): number {
  if (!value) {
    throw new Error(
      `fix-pending-payment blocked: --limit is required in mutation mode (expected --limit=${FIX_PENDING_PAYMENT_LIMIT}).`
    )
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed !== FIX_PENDING_PAYMENT_LIMIT) {
    throw new Error(
      `fix-pending-payment blocked: --limit must be ${FIX_PENDING_PAYMENT_LIMIT} in mutation mode.`
    )
  }

  return parsed
}

export function assertFixPendingPaymentMutationSucceeded(params: {
  operation: string
  error: { message?: string } | null
  row: { id?: string } | null
}): void {
  assertScriptMutationSucceeded({
    operation: params.operation,
    error: params.error,
    updatedRows: params.row ? [params.row] : [],
    allowZeroRows: false
  })
}
