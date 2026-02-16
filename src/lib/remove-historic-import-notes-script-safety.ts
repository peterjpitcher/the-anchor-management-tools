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

export function isRemoveHistoricImportNotesMutationEnabled(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    argv.includes('--confirm') &&
    !argv.includes('--dry-run') &&
    isTruthyEnv(env.RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION)
  )
}

export function assertRemoveHistoricImportNotesMutationAllowed(
  env: NodeJS.ProcessEnv = process.env
): void {
  // Support legacy allow env var name for backwards compatibility.
  if (isTruthyEnv(env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT)) {
    return
  }

  assertScriptMutationAllowed({
    scriptName: 'remove-historic-import-notes',
    envVar: 'ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_SCRIPT'
  })
}

export function readRemoveHistoricImportNotesLimit(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalPositiveInt(findFlagValue(argv, '--limit')) ??
    parseOptionalPositiveInt(env.REMOVE_HISTORIC_IMPORT_NOTES_LIMIT)
  )
}

export function readRemoveHistoricImportNotesOffset(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): number | null {
  return (
    parseOptionalNonNegativeInt(findFlagValue(argv, '--offset')) ??
    parseOptionalNonNegativeInt(env.REMOVE_HISTORIC_IMPORT_NOTES_OFFSET)
  )
}

export function assertRemoveHistoricImportNotesLimit(
  limit: number | null,
  hardCap: number
): number {
  if (limit === null) {
    throw new Error('remove-historic-import-notes blocked: --limit is required in mutation mode.')
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('remove-historic-import-notes blocked: --limit must be a positive integer.')
  }

  if (limit > hardCap) {
    throw new Error(
      `remove-historic-import-notes blocked: --limit ${limit} exceeds hard cap ${hardCap}. Run in smaller batches.`
    )
  }

  return limit
}

