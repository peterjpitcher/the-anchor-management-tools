#!/usr/bin/env tsx

/**
 * fix-duplicate-loyalty-program (safe by default)
 *
 * Intended use: remove a duplicated loyalty program row created with empty settings.
 *
 * Dry-run (default):
 *   tsx scripts/fixes/fix-duplicate-loyalty-program.ts
 *
 * Mutation mode (requires multi-gating):
 *   RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true \\
 *   ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true \\
 *     tsx scripts/fixes/fix-duplicate-loyalty-program.ts --confirm [--limit 200]
 *
 * Notes:
 * - If members exist on the duplicate program, mutations require an explicit --limit (hard cap 500).
 * - The script migrates up to --limit members per run, then only deletes the duplicate program when empty.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertFixDuplicateLoyaltyProgramCompletedWithoutFailures,
  assertFixDuplicateLoyaltyProgramMutationAllowed,
  assertFixDuplicateLoyaltyProgramMutationSucceeded,
  isFixDuplicateLoyaltyProgramMutationRunEnabled,
  resolveFixDuplicateLoyaltyProgramCount,
  resolveFixDuplicateLoyaltyProgramRows
} from '../../src/lib/duplicate-loyalty-program-fix-safety'

type LoyaltyProgramRow = {
  id: string
  name: string | null
  active: boolean | null
  settings: Record<string, unknown> | null
}

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

function hasNonEmptySettings(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

function parseOptionalPositiveInt(
  raw: string | null | undefined,
  label: '--limit' | 'FIX_DUPLICATE_LOYALTY_PROGRAM_LIMIT'
): number | null {
  if (raw == null || raw === '') return null
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`fix-duplicate-loyalty-program blocked: ${label} must be a positive integer.`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`fix-duplicate-loyalty-program blocked: ${label} must be a positive integer.`)
  }

  return parsed
}

function readArgValue(argv: string[], flag: string): string | null {
  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    const value = argv[idx + 1]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    const [, value] = eq.split('=', 2)
    return value && value.trim().length > 0 ? value.trim() : null
  }

  return null
}

function readLimit(argv: string[]): number | null {
  return (
    parseOptionalPositiveInt(readArgValue(argv, '--limit'), '--limit') ??
    parseOptionalPositiveInt(
      process.env.FIX_DUPLICATE_LOYALTY_PROGRAM_LIMIT,
      'FIX_DUPLICATE_LOYALTY_PROGRAM_LIMIT'
    )
  )
}

function assertLimit(limit: number | null, hardCap: number): number {
  if (limit === null) {
    throw new Error('fix-duplicate-loyalty-program blocked: --limit is required when migrating members.')
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('fix-duplicate-loyalty-program blocked: --limit must be a positive integer.')
  }
  if (limit > hardCap) {
    throw new Error(
      `fix-duplicate-loyalty-program blocked: --limit ${limit} exceeds hard cap ${hardCap}. Run in smaller batches.`
    )
  }
  return limit
}

async function fixDuplicateLoyaltyProgram(params: {
  mutationEnabled: boolean
  limit: number | null
  hardCap: number
}): Promise<void> {
  console.log(`🔧 fix-duplicate-loyalty-program (${params.mutationEnabled ? 'MUTATION' : 'DRY-RUN'})\n`)

  const supabase = createAdminClient()
  const failures: string[] = []

  const { data: programsData, error: programError } = await supabase
    .from('loyalty_programs')
    .select('id, name, active, settings')
    .order('created_at', { ascending: true })

  const programs = resolveFixDuplicateLoyaltyProgramRows<LoyaltyProgramRow>({
    operation: 'Load loyalty programs for duplicate-fix inspection',
    rows: programsData as LoyaltyProgramRow[] | null,
    error: programError
  })

  console.log(`📊 Found ${programs.length} loyalty programs`)

  if (programs.length === 0) {
    console.log('\n⚠️  No loyalty programs found.')
    return
  }

  if (programs.length === 1) {
    console.log('\n✅ Only one loyalty program found - no duplicates to fix.')
    return
  }

  const emptyPrograms = programs.filter((program) => !hasNonEmptySettings(program.settings))
  const validPrograms = programs.filter((program) => hasNonEmptySettings(program.settings))

  if (emptyPrograms.length !== 1 || validPrograms.length !== 1) {
    failures.push(
      `Unable to identify a single empty/valid program pair (empty=${emptyPrograms.length}, valid=${validPrograms.length})`
    )
    console.log('\n⚠️  Could not identify which program to keep automatically:')
    programs.forEach((program, index) => {
      console.log(`\nProgram ${index + 1}:`)
      console.log(`   ID: ${program.id}`)
      console.log(`   Name: ${program.name}`)
      console.log(`   Active: ${program.active}`)
      console.log(`   Settings: ${JSON.stringify(program.settings)}`)
    })

    assertFixDuplicateLoyaltyProgramCompletedWithoutFailures({
      failureCount: failures.length,
      failures
    })
    return
  }

  const emptyProgram = emptyPrograms[0]
  const validProgram = validPrograms[0]

  console.log('\n🗑️ Program to remove (empty settings):')
  console.log(`   ID: ${emptyProgram.id}`)
  console.log(`   Name: ${emptyProgram.name}`)
  console.log(`   Active: ${emptyProgram.active}`)

  console.log('\n✅ Program to keep (valid settings):')
  console.log(`   ID: ${validProgram.id}`)
  console.log(`   Name: ${validProgram.name}`)
  console.log(`   Active: ${validProgram.active}`)
  console.log(`   Settings: ${JSON.stringify(validProgram.settings, null, 2)}`)

  const { count: memberCountRaw, error: memberCountError } = await supabase
    .from('loyalty_members')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', emptyProgram.id)

  const memberCount = resolveFixDuplicateLoyaltyProgramCount({
    operation: `Count loyalty members attached to duplicate program ${emptyProgram.id}`,
    count: memberCountRaw,
    error: memberCountError
  })

  console.log(`\n👥 Members on duplicate program: ${memberCount}`)

  if (memberCount > 0) {
    if (params.mutationEnabled) {
      const batchLimit = assertLimit(params.limit, params.hardCap)

      const { data: memberRows, error: memberRowsError } = await supabase
        .from('loyalty_members')
        .select('id')
        .eq('program_id', emptyProgram.id)
        .order('id', { ascending: true })
        .limit(batchLimit)

      const memberIds = resolveFixDuplicateLoyaltyProgramRows<{ id: string }>({
        operation: `Load up to ${batchLimit} loyalty member ids for migration`,
        rows: memberRows as Array<{ id: string }> | null,
        error: memberRowsError
      }).map((row) => row.id)

      if (memberIds.length === 0) {
        failures.push('Expected to migrate members but loaded none (count > 0)')
      } else {
        const { data: migratedRows, error: migrateError } = await supabase
          .from('loyalty_members')
          .update({ program_id: validProgram.id })
          .in('id', memberIds)
          .select('id')

        try {
          assertFixDuplicateLoyaltyProgramMutationSucceeded({
            operation: `Migrate ${memberIds.length} loyalty members to ${validProgram.id}`,
            error: migrateError,
            rows: migratedRows as Array<{ id?: string }> | null,
            expectedCount: memberIds.length
          })
          console.log(`✅ Migrated ${memberIds.length} member(s)`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push(message)
          console.error('❌ Member migration failed:', message)
        }
      }
    } else {
      console.log('\nRead-only mode: member migration skipped.')
      console.log(
        `To migrate members, re-run with --confirm RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true --limit=<n> (hard cap ${params.hardCap}).`
      )
    }
  }

  const { count: remainingMembersRaw, error: remainingMembersError } = await supabase
    .from('loyalty_members')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', emptyProgram.id)

  const remainingMembers = resolveFixDuplicateLoyaltyProgramCount({
    operation: `Re-count loyalty members attached to duplicate program ${emptyProgram.id}`,
    count: remainingMembersRaw,
    error: remainingMembersError
  })

  console.log(`\nRemaining members on duplicate program: ${remainingMembers}`)

  if (remainingMembers > 0) {
    console.log('\nDuplicate program still has members; skip deletion until empty.')
  } else if (params.mutationEnabled) {
    const { data: deletedRows, error: deleteError } = await supabase
      .from('loyalty_programs')
      .delete()
      .eq('id', emptyProgram.id)
      .select('id')

    try {
      assertFixDuplicateLoyaltyProgramMutationSucceeded({
        operation: `Delete duplicate loyalty program ${emptyProgram.id}`,
        error: deleteError,
        rows: deletedRows as Array<{ id?: string }> | null,
        expectedCount: 1
      })
      console.log('✅ Duplicate program deleted successfully')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error('❌ Duplicate program deletion failed:', message)
    }
  } else {
    console.log('\nRead-only mode: duplicate program deletion skipped.')
  }

  const { data: remainingProgramsData, error: remainingProgramsError } = await supabase
    .from('loyalty_programs')
    .select('id')
    .order('created_at', { ascending: true })

  const remainingPrograms = resolveFixDuplicateLoyaltyProgramRows<{ id: string }>({
    operation: 'Load remaining loyalty programs after duplicate fix',
    rows: remainingProgramsData as Array<{ id: string }> | null,
    error: remainingProgramsError
  })

  console.log(`\n📊 Remaining programs: ${remainingPrograms.length}`)

  if (params.mutationEnabled && remainingMembers === 0 && remainingPrograms.length !== 1) {
    failures.push(`Expected exactly 1 loyalty program after deletion, found ${remainingPrograms.length}`)
  }

  assertFixDuplicateLoyaltyProgramCompletedWithoutFailures({
    failureCount: failures.length,
    failures
  })
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2)
  const confirm = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const mutationEnabled = !dryRunOverride && confirm && isFixDuplicateLoyaltyProgramMutationRunEnabled()
  const limit = readLimit(argv)
  const HARD_CAP = 500

  if (argv.includes('--help')) {
    console.log(`
fix-duplicate-loyalty-program (safe by default)

Dry-run (default):
  tsx scripts/fixes/fix-duplicate-loyalty-program.ts

Mutation mode (requires multi-gating):
  RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true \\
  ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true \\
    tsx scripts/fixes/fix-duplicate-loyalty-program.ts --confirm --limit 200

Notes:
  - --limit is required when migrating members (hard cap ${HARD_CAP}).
`)
    return
  }

  if (confirm && !mutationEnabled && !dryRunOverride) {
    throw new Error(
      'fix-duplicate-loyalty-program blocked: --confirm requires RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true and ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true.'
    )
  }

  if (mutationEnabled) {
    assertFixDuplicateLoyaltyProgramMutationAllowed()
    console.log('Mutation mode enabled for fix-duplicate-loyalty-program.')
  } else {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `Read-only mode${extra}: set RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true and ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true and pass --confirm to apply changes.`
    )
  }

  await fixDuplicateLoyaltyProgram({ mutationEnabled, limit, hardCap: HARD_CAP })
}

run().catch((error) => {
  console.error('❌ fix-duplicate-loyalty-program script failed:', error)
  process.exitCode = 1
})
