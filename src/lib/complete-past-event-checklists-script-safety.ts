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

function parseOptionalPositiveInt(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseOptionalNonNegativeInt(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function isCompletePastEventChecklistsMutationEnabled(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    argv.includes('--confirm') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(env.RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION)
  )
}

export function assertCompletePastEventChecklistsMutationAllowed(): void {
  assertScriptMutationAllowed({
    scriptName: 'complete-past-event-checklists',
    envVar: 'ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT'
  })
}

export function readCompletePastEventChecklistsEventLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalPositiveInt(findFlagValue(argv, '--event-limit')) ??
    parseOptionalPositiveInt(env.COMPLETE_PAST_EVENT_CHECKLISTS_EVENT_LIMIT)
  )
}

export function readCompletePastEventChecklistsOffset(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalNonNegativeInt(findFlagValue(argv, '--offset')) ??
    parseOptionalNonNegativeInt(env.COMPLETE_PAST_EVENT_CHECKLISTS_OFFSET)
  )
}

export function readCompletePastEventChecklistsCutoffDate(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): string {
  const fromArg = findFlagValue(argv, '--cutoff-date')
  if (fromArg && fromArg.trim().length > 0) {
    return fromArg.trim()
  }

  const fromEnv = env.COMPLETE_PAST_EVENT_CHECKLISTS_CUTOFF_DATE
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim()
  }

  return '2025-10-17'
}

export function assertCompletePastEventChecklistsEventLimit(
  limit: number | null,
  hardCap: number
): number {
  if (limit === null) {
    throw new Error('complete-past-event-checklists blocked: --event-limit is required in mutation mode.')
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('complete-past-event-checklists blocked: --event-limit must be a positive integer.')
  }
  if (limit > hardCap) {
    throw new Error(
      `complete-past-event-checklists blocked: --event-limit ${limit} exceeds hard cap ${hardCap}. Run in smaller batches.`
    )
  }
  return limit
}
