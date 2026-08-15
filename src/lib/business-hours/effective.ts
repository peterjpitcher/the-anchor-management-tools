// src/lib/business-hours/effective.ts
//
// Server-side access to effective-dated opening hours. Every reader of
// business_hours should come through here rather than selecting on day_of_week,
// which picks an arbitrary row once more than one version exists.
//
// Two shapes, because the callers differ:
//   * getBusinessHoursForDate  - one date, one round trip, via the SQL resolver.
//   * loadPublishedVersions + resolveForDates - a whole range in three queries,
//     because the rota planner and missing-cashups cover up to a year and a query
//     per day would undo work that deliberately cut 728 queries to three.

import { createAdminClient } from '@/lib/supabase/admin'
import type { BusinessHours, BusinessHoursVersion } from '@/types/business-hours'
import { resolveForDates, type LoadedVersion } from '@/lib/business-hours/resolve'

type Db = ReturnType<typeof createAdminClient>

/** The weekly row in force on a date, or null if none applies. */
export async function getBusinessHoursForDate(
  isoDate: string,
  db: Db = createAdminClient(),
): Promise<BusinessHours | null> {
  const { data, error } = await db.rpc('business_hours_for_date', { p_date: isoDate })
  if (error) throw error
  const rows = (data ?? []) as unknown as BusinessHours[]
  return rows[0] ?? null
}

/**
 * Every published version with its seven rows, oldest first.
 *
 * Two queries regardless of how many dates the caller needs. Drafts and withdrawn
 * versions are excluded here rather than filtered later, so a caller cannot
 * accidentally resolve against one.
 */
export async function loadPublishedVersions(
  db: Db = createAdminClient(),
): Promise<LoadedVersion<BusinessHours>[]> {
  const { data: versions, error: versionError } = await db
    .from('business_hours_versions')
    .select('id, effective_from')
    .eq('status', 'published')
    .order('effective_from', { ascending: true })
  if (versionError) throw versionError
  if (!versions?.length) return []

  const { data: rows, error: rowError } = await db
    .from('business_hours')
    .select('*')
    .in('version_id', versions.map(v => v.id))
  if (rowError) throw rowError

  const byVersion = new Map<string, BusinessHours[]>()
  for (const row of (rows ?? []) as BusinessHours[]) {
    const list = byVersion.get(row.version_id) ?? []
    list.push(row)
    byVersion.set(row.version_id, list)
  }

  return versions.map(v => ({
    effectiveFrom: v.effective_from as string,
    rows: byVersion.get(v.id as string) ?? [],
  }))
}

/**
 * Resolve a set of dates in three queries. A date with no applicable version is
 * absent from the map: treat that as "hours unknown", never as "closed".
 */
export async function getBusinessHoursForDates(
  isoDates: string[],
  db: Db = createAdminClient(),
): Promise<Map<string, BusinessHours>> {
  if (isoDates.length === 0) return new Map()
  const versions = await loadPublishedVersions(db)
  return resolveForDates(versions, isoDates)
}

/** Every version, newest first, for the settings screen. */
export async function listVersions(
  db: Db = createAdminClient(),
): Promise<BusinessHoursVersion[]> {
  const { data, error } = await db
    .from('business_hours_versions')
    .select('*')
    .order('effective_from', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as BusinessHoursVersion[]
}

/** The seven rows of one version, ordered Sunday first to match day_of_week. */
export async function getVersionRows(
  versionId: string,
  db: Db = createAdminClient(),
): Promise<BusinessHours[]> {
  const { data, error } = await db
    .from('business_hours')
    .select('*')
    .eq('version_id', versionId)
    .order('day_of_week', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as BusinessHours[]
}

/** The version in force today, which is what the settings screen opens on. */
export async function getActiveVersion(
  isoDate: string,
  db: Db = createAdminClient(),
): Promise<BusinessHoursVersion | null> {
  const { data, error } = await db
    .from('business_hours_versions')
    .select('*')
    .eq('status', 'published')
    .lte('effective_from', isoDate)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as BusinessHoursVersion) ?? null
}
