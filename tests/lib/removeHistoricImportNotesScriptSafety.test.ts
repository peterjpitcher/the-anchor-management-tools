import { describe, expect, it } from 'vitest'
import {
  assertRemoveHistoricImportNotesLimit,
  assertRemoveHistoricImportNotesMutationAllowed,
  isRemoveHistoricImportNotesMutationEnabled,
  readRemoveHistoricImportNotesLimit,
  readRemoveHistoricImportNotesOffset
} from '@/lib/remove-historic-import-notes-script-safety'

describe('remove-historic-import-notes script safety', () => {
  it('requires explicit confirm + RUN env to enable mutations', () => {
    expect(isRemoveHistoricImportNotesMutationEnabled(['node', 'script'], {})).toBe(false)
    expect(
      isRemoveHistoricImportNotesMutationEnabled(['node', 'script', '--confirm'], {})
    ).toBe(false)
    expect(
      isRemoveHistoricImportNotesMutationEnabled(
        ['node', 'script', '--confirm'],
        { RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION: 'true' }
      )
    ).toBe(true)
    expect(
      isRemoveHistoricImportNotesMutationEnabled(
        ['node', 'script', '--confirm', '--dry-run'],
        { RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION: 'true' }
      )
    ).toBe(false)
  })

  it('blocks mutations unless ALLOW env var is enabled (supports legacy + new allow vars)', () => {
    const prevLegacy = process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_SCRIPT
    const prevNew = process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT
    delete process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_SCRIPT
    delete process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT

    expect(() => assertRemoveHistoricImportNotesMutationAllowed()).toThrow(
      'remove-historic-import-notes blocked by safety guard. Set ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_SCRIPT = 'true'
    expect(() => assertRemoveHistoricImportNotesMutationAllowed()).not.toThrow()
    delete process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_SCRIPT

    process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT = 'true'
    expect(() => assertRemoveHistoricImportNotesMutationAllowed()).not.toThrow()

    if (prevLegacy === undefined) {
      delete process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_SCRIPT
    } else {
      process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_SCRIPT = prevLegacy
    }

    if (prevNew === undefined) {
      delete process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT
    } else {
      process.env.ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT = prevNew
    }
  })

  it('reads limit/offset from argv or env', () => {
    expect(readRemoveHistoricImportNotesLimit(['node', 'script', '--limit', '12'], {})).toBe(12)
    expect(readRemoveHistoricImportNotesLimit(['node', 'script', '--limit=9'], {})).toBe(9)
    expect(
      readRemoveHistoricImportNotesLimit(['node', 'script'], {
        REMOVE_HISTORIC_IMPORT_NOTES_LIMIT: '7'
      })
    ).toBe(7)

    expect(readRemoveHistoricImportNotesOffset(['node', 'script', '--offset', '3'], {})).toBe(3)
    expect(readRemoveHistoricImportNotesOffset(['node', 'script', '--offset=5'], {})).toBe(5)
    expect(
      readRemoveHistoricImportNotesOffset(['node', 'script'], {
        REMOVE_HISTORIC_IMPORT_NOTES_OFFSET: '11'
      })
    ).toBe(11)
  })

  it('enforces a hard cap for limit', () => {
    expect(() => assertRemoveHistoricImportNotesLimit(null, 500)).toThrow('--limit is required')
    expect(() => assertRemoveHistoricImportNotesLimit(0, 500)).toThrow(
      '--limit must be a positive integer'
    )
    expect(() => assertRemoveHistoricImportNotesLimit(501, 500)).toThrow('exceeds hard cap')
    expect(assertRemoveHistoricImportNotesLimit(25, 500)).toBe(25)
  })
})

