#!/usr/bin/env tsx

/**
 * remove-historic-import-notes (safe by default)
 *
 * Removes the "Historic Import" marker from cashing-up session notes.
 *
 * Dry-run (default):
 *   tsx scripts/cleanup/remove-historic-import-notes.ts
 *
 * Mutation mode (requires multi-gating + explicit caps):
 *   RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION=true \\
 *   ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT=true \\
 *     tsx scripts/cleanup/remove-historic-import-notes.ts --confirm --limit 100 [--offset 0]
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety'
import {
  assertRemoveHistoricImportNotesLimit,
  assertRemoveHistoricImportNotesMutationAllowed,
  isRemoveHistoricImportNotesMutationEnabled,
  readRemoveHistoricImportNotesLimit,
  readRemoveHistoricImportNotesOffset
} from '../../src/lib/remove-historic-import-notes-script-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

function isFlagPresent(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(flag)
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s\s+/g, ' ').trim()
}

function stripHistoricImportMarker(value: string): string | null {
  const withoutMarker = normalizeWhitespace(value.replace(/Historic Import/gi, ''))
  return withoutMarker.length === 0 ? null : withoutMarker
}

type SessionRow = {
  id: string
  notes: string | null
  created_at?: string | null
}

async function run(): Promise<void> {
  const argv = process.argv
  const confirm = isFlagPresent('--confirm', argv)
  const mutationEnabled = isRemoveHistoricImportNotesMutationEnabled(argv, process.env)

  const HARD_CAP = 500

  if (isFlagPresent('--help', argv)) {
    console.log(`
remove-historic-import-notes (safe by default)

Dry-run (default):
  tsx scripts/cleanup/remove-historic-import-notes.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION=true \\
  ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT=true \\
    tsx scripts/cleanup/remove-historic-import-notes.ts --confirm --limit 100 [--offset 0]

Notes:
  - --limit is required in mutation mode (hard cap ${HARD_CAP}).
  - In dry-run mode, no rows are updated.
`)
    return
  }

  if (confirm && !mutationEnabled && !isFlagPresent('--dry-run', argv)) {
    throw new Error(
      'remove-historic-import-notes received --confirm but RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION is not enabled. Set RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION=true and ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT=true to apply updates.'
    )
  }

  if (mutationEnabled) {
    assertRemoveHistoricImportNotesMutationAllowed(process.env)
  }

  const supabase = createAdminClient()
  const modeLabel = mutationEnabled ? 'MUTATION' : 'DRY-RUN'

  console.log(`🧹 Removing "Historic Import" from cashup session notes (${modeLabel})`)

  const { count: totalCountRaw, error: countError } = await supabase
    .from('cashup_sessions')
    .select('id', { count: 'exact', head: true })
    .ilike('notes', '%Historic Import%')

  assertScriptQuerySucceeded({
    operation: 'Count cashup_sessions rows with Historic Import notes',
    error: countError,
    data: { ok: true }
  })

  const totalCount = typeof totalCountRaw === 'number' && Number.isInteger(totalCountRaw) ? totalCountRaw : 0
  console.log(`Matching sessions: ${totalCount}`)

  if (totalCount === 0) {
    console.log('✅ No sessions found with "Historic Import" in notes.')
    return
  }

  if (!mutationEnabled) {
    const { data: sampleRowsRaw, error: sampleError } = await supabase
      .from('cashup_sessions')
      .select('id, notes, created_at')
      .ilike('notes', '%Historic Import%')
      .order('created_at', { ascending: false })
      .limit(10)

    const sampleRows = assertScriptQuerySucceeded({
      operation: 'Load sample cashup_sessions rows with Historic Import notes',
      error: sampleError,
      data: sampleRowsRaw ?? [],
      allowMissing: true
    }) as SessionRow[]

    if (sampleRows.length > 0) {
      console.log('\nSample sessions (showing before -> after):')
      sampleRows.forEach((row) => {
        const before = row.notes ?? ''
        const after = stripHistoricImportMarker(before)
        const beforePreview = before.length > 80 ? `${before.slice(0, 80)}…` : before
        const afterPreview =
          after === null ? '<null>' : after.length > 80 ? `${after.slice(0, 80)}…` : after
        console.log(`- ${row.id}: "${beforePreview}" -> "${afterPreview}"`)
      })
    }

    console.log('\nDry-run mode: no rows updated.')
    console.log(
      'To mutate, pass --confirm + --limit, and set RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION=true and ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT=true.'
    )
    return
  }

  const limit = assertRemoveHistoricImportNotesLimit(
    readRemoveHistoricImportNotesLimit(argv, process.env),
    HARD_CAP
  )
  const offset = readRemoveHistoricImportNotesOffset(argv, process.env) ?? 0
  const rangeStart = offset
  const rangeEnd = offset + limit - 1

  console.log(`Processing window: offset=${offset} limit=${limit}`)

  const { data: sessionsRaw, error: fetchError } = await supabase
    .from('cashup_sessions')
    .select('id, notes, created_at')
    .ilike('notes', '%Historic Import%')
    .order('id', { ascending: true })
    .range(rangeStart, rangeEnd)

  const sessions = assertScriptQuerySucceeded({
    operation: 'Load cashup_sessions rows for Historic Import note cleanup',
    error: fetchError,
    data: sessionsRaw ?? [],
    allowMissing: true
  }) as SessionRow[]

  if (sessions.length === 0) {
    console.log('No sessions found in the selected window. Nothing to update.')
    return
  }

  const failures: string[] = []
  let updatedCount = 0

  for (const session of sessions) {
    const before = session.notes ?? ''
    const nextNotes = stripHistoricImportMarker(before)

    const { data: updatedRows, error: updateError } = await supabase
      .from('cashup_sessions')
      .update({ notes: nextNotes })
      .eq('id', session.id)
      .ilike('notes', '%Historic Import%')
      .select('id')

    try {
      const { updatedCount: rowCount } = assertScriptMutationSucceeded({
        operation: `Update cashup_sessions notes for ${session.id}`,
        error: updateError,
        updatedRows: updatedRows as Array<{ id?: string }> | null,
        allowZeroRows: false
      })
      assertScriptExpectedRowCount({
        operation: `Update cashup_sessions notes for ${session.id}`,
        expected: 1,
        actual: rowCount
      })
      updatedCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${session.id}:${message}`)
      console.error(`❌ Failed updating session ${session.id}: ${message}`)
    }
  }

  console.log(`✅ Updated ${updatedCount}/${sessions.length} session(s).`)

  assertScriptCompletedWithoutFailures({
    scriptName: 'remove-historic-import-notes',
    failureCount: failures.length,
    failures
  })
}

run().catch((error) => {
  console.error('remove-historic-import-notes failed:', error)
  process.exitCode = 1
})

