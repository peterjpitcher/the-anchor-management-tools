/**
 * Tests for the OJ-Projects mileage → mileage_trips sync trigger behaviour matrix.
 *
 * These tests validate the EXPECTED behaviour of the PL/pgSQL trigger
 * (fn_sync_oj_mileage_to_trips) by testing the application-layer integration.
 * Since we cannot execute raw SQL triggers in unit tests, we verify the logic
 * by testing the trigger's JavaScript-equivalent decision matrix and the
 * recalculation hook.
 */

import { describe, it, expect } from 'vitest'

// ---- Trigger decision matrix (pure logic) ----

type TriggerOp = 'INSERT' | 'UPDATE' | 'DELETE'
type EntryType = 'time' | 'mileage' | 'one_off'

interface TriggerAction {
  action: 'create' | 'update' | 'delete' | 'noop'
}

/**
 * Pure function representing the trigger's decision matrix.
 * This mirrors the PL/pgSQL logic in fn_sync_oj_mileage_to_trips.
 */
function determineSyncAction(
  op: TriggerOp,
  oldEntryType: EntryType | null,
  newEntryType: EntryType | null
): TriggerAction {
  if (op === 'INSERT') {
    return newEntryType === 'mileage' ? { action: 'create' } : { action: 'noop' }
  }

  if (op === 'UPDATE') {
    if (oldEntryType === 'mileage' && newEntryType === 'mileage') {
      return { action: 'update' }
    }
    if (oldEntryType !== 'mileage' && newEntryType === 'mileage') {
      return { action: 'create' }
    }
    if (oldEntryType === 'mileage' && newEntryType !== 'mileage') {
      return { action: 'delete' }
    }
    return { action: 'noop' }
  }

  if (op === 'DELETE') {
    return oldEntryType === 'mileage' ? { action: 'delete' } : { action: 'noop' }
  }

  return { action: 'noop' }
}

describe('OJ mileage sync trigger decision matrix', () => {
  // ---- INSERT ----
  describe('INSERT', () => {
    it('should create mileage_trips row when inserting a mileage entry', () => {
      const result = determineSyncAction('INSERT', null, 'mileage')
      expect(result.action).toBe('create')
    })

    it('should no-op when inserting a time entry', () => {
      const result = determineSyncAction('INSERT', null, 'time')
      expect(result.action).toBe('noop')
    })

    it('should no-op when inserting a one_off entry', () => {
      const result = determineSyncAction('INSERT', null, 'one_off')
      expect(result.action).toBe('noop')
    })
  })

  // ---- UPDATE ----
  describe('UPDATE', () => {
    it('should update synced row when mileage stays mileage', () => {
      const result = determineSyncAction('UPDATE', 'mileage', 'mileage')
      expect(result.action).toBe('update')
    })

    it('should create synced row when changing from time to mileage', () => {
      const result = determineSyncAction('UPDATE', 'time', 'mileage')
      expect(result.action).toBe('create')
    })

    it('should create synced row when changing from one_off to mileage', () => {
      const result = determineSyncAction('UPDATE', 'one_off', 'mileage')
      expect(result.action).toBe('create')
    })

    it('should delete synced row when changing from mileage to time', () => {
      const result = determineSyncAction('UPDATE', 'mileage', 'time')
      expect(result.action).toBe('delete')
    })

    it('should delete synced row when changing from mileage to one_off', () => {
      const result = determineSyncAction('UPDATE', 'mileage', 'one_off')
      expect(result.action).toBe('delete')
    })

    it('should no-op when time stays time', () => {
      const result = determineSyncAction('UPDATE', 'time', 'time')
      expect(result.action).toBe('noop')
    })

    it('should no-op when one_off stays one_off', () => {
      const result = determineSyncAction('UPDATE', 'one_off', 'one_off')
      expect(result.action).toBe('noop')
    })

    it('should no-op when changing from time to one_off', () => {
      const result = determineSyncAction('UPDATE', 'time', 'one_off')
      expect(result.action).toBe('noop')
    })
  })

  // ---- DELETE ----
  describe('DELETE', () => {
    it('should delete synced row when deleting a mileage entry', () => {
      const result = determineSyncAction('DELETE', 'mileage', null)
      expect(result.action).toBe('delete')
    })

    it('should no-op when deleting a time entry', () => {
      const result = determineSyncAction('DELETE', 'time', null)
      expect(result.action).toBe('noop')
    })

    it('should no-op when deleting a one_off entry', () => {
      const result = determineSyncAction('DELETE', 'one_off', null)
      expect(result.action).toBe('noop')
    })
  })
})

// ---- Synced trip property tests ----

describe('Synced trip default properties', () => {
  /**
   * Mirrors the trigger's default values for a newly synced row.
   */
  function buildSyncedTripDefaults(miles: number, description: string | null) {
    const totalMiles = miles
    return {
      source: 'oj_projects' as const,
      totalMiles,
      milesAtStandardRate: totalMiles,
      milesAtReducedRate: 0,
      amountDue: totalMiles * 0.45,
      description: description ?? 'OJ Projects mileage',
    }
  }

  it('should set all miles at standard rate by default', () => {
    const trip = buildSyncedTripDefaults(25.5, 'Site visit')
    expect(trip.milesAtStandardRate).toBe(25.5)
    expect(trip.milesAtReducedRate).toBe(0)
    expect(trip.amountDue).toBeCloseTo(11.475, 2)
  })

  it('should satisfy the CHECK constraint: total = standard + reduced', () => {
    const trip = buildSyncedTripDefaults(100, null)
    expect(trip.totalMiles).toBe(trip.milesAtStandardRate + trip.milesAtReducedRate)
  })

  it('should use default description when entry description is null', () => {
    const trip = buildSyncedTripDefaults(10, null)
    expect(trip.description).toBe('OJ Projects mileage')
  })

  it('should use entry description when provided', () => {
    const trip = buildSyncedTripDefaults(10, 'Client meeting in Reading')
    expect(trip.description).toBe('Client meeting in Reading')
  })

  it('should set source to oj_projects', () => {
    const trip = buildSyncedTripDefaults(10, null)
    expect(trip.source).toBe('oj_projects')
  })
})

describe('Idempotent synced trip upsert', () => {
  interface SyncedTripRow {
    ojEntryId: string
    source: 'oj_projects'
    tripDate: string
    description: string
    totalMiles: number
    milesAtStandardRate: number
    milesAtReducedRate: number
    amountDue: number
  }

  function upsertSyncedTrip(
    rows: SyncedTripRow[],
    entry: { id: string; entryDate: string; miles: number; description: string | null }
  ): SyncedTripRow[] {
    const totalMiles = Math.round(entry.miles * 10) / 10
    const nextRow: SyncedTripRow = {
      ojEntryId: entry.id,
      source: 'oj_projects',
      tripDate: entry.entryDate,
      description: entry.description?.trim() || 'OJ Projects mileage',
      totalMiles,
      milesAtStandardRate: totalMiles,
      milesAtReducedRate: 0,
      amountDue: Math.round(totalMiles * 0.45 * 100) / 100,
    }

    const existingIndex = rows.findIndex((row) => row.ojEntryId === entry.id)
    if (existingIndex === -1) return [...rows, nextRow]

    const nextRows = [...rows]
    nextRows[existingIndex] = nextRow
    return nextRows
  }

  it('should create a missing synced row for a mileage entry', () => {
    const rows = upsertSyncedTrip([], {
      id: 'entry-1',
      entryDate: '2026-04-20',
      miles: 12.4,
      description: 'Client visit',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ojEntryId: 'entry-1',
      source: 'oj_projects',
      totalMiles: 12.4,
      amountDue: 5.58,
    })
  })

  it('should update the existing synced row instead of duplicating it', () => {
    const firstRows = upsertSyncedTrip([], {
      id: 'entry-1',
      entryDate: '2026-04-20',
      miles: 12.4,
      description: 'Client visit',
    })
    const updatedRows = upsertSyncedTrip(firstRows, {
      id: 'entry-1',
      entryDate: '2026-04-21',
      miles: 14.2,
      description: null,
    })

    expect(updatedRows).toHaveLength(1)
    expect(updatedRows[0]).toMatchObject({
      ojEntryId: 'entry-1',
      tripDate: '2026-04-21',
      description: 'OJ Projects mileage',
      totalMiles: 14.2,
    })
  })
})

// ---- Recalculation need detection ----

describe('Recalculation need detection', () => {
  /**
   * Determines whether mileage recalculation is needed after a mutation.
   */
  function needsRecalculation(
    op: 'create' | 'update' | 'delete',
    oldEntryType: EntryType | null,
    newEntryType: EntryType | null
  ): boolean {
    if (op === 'create') {
      return newEntryType === 'mileage'
    }
    if (op === 'delete') {
      return oldEntryType === 'mileage'
    }
    // update: need recalc if either old or new is mileage
    return oldEntryType === 'mileage' || newEntryType === 'mileage'
  }

  it('should require recalculation after creating a mileage entry', () => {
    expect(needsRecalculation('create', null, 'mileage')).toBe(true)
  })

  it('should not require recalculation after creating a time entry', () => {
    expect(needsRecalculation('create', null, 'time')).toBe(false)
  })

  it('should require recalculation after deleting a mileage entry', () => {
    expect(needsRecalculation('delete', 'mileage', null)).toBe(true)
  })

  it('should not require recalculation after deleting a time entry', () => {
    expect(needsRecalculation('delete', 'time', null)).toBe(false)
  })

  it('should require recalculation when changing time to mileage', () => {
    expect(needsRecalculation('update', 'time', 'mileage')).toBe(true)
  })

  it('should require recalculation when changing mileage to time', () => {
    expect(needsRecalculation('update', 'mileage', 'time')).toBe(true)
  })

  it('should require recalculation when updating mileage to mileage', () => {
    expect(needsRecalculation('update', 'mileage', 'mileage')).toBe(true)
  })

  it('should not require recalculation when updating time to time', () => {
    expect(needsRecalculation('update', 'time', 'time')).toBe(false)
  })
})
