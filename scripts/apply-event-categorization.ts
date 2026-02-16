#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptCompletedWithoutFailures,
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'apply-event-categorization'
const RUN_MUTATION_ENV = 'RUN_APPLY_EVENT_CATEGORIZATION_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_APPLY_EVENT_CATEGORIZATION_MUTATION_SCRIPT'
const HARD_CAP = 200

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
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: "${raw}"`)
  }

  return parsed
}

type Args = {
  confirm: boolean
  dryRun: boolean
  limit: number | null
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  const confirm = rest.includes('--confirm')
  const dryRun = !confirm || rest.includes('--dry-run')
  const limit = parsePositiveInt(findFlagValue(rest, '--limit'))
  return { confirm, dryRun, limit }
}

type CategoryRow = { id: string; name: string; slug: string }
type EventRow = { id: string; name: string; category_id: string | null }

const NEW_CATEGORIES = [
  {
    name: 'Celebrations',
    slug: 'celebrations',
    description: 'Special occasions and seasonal celebrations at The Anchor.',
    color: '#F59E0B',
    icon: 'StarIcon',
    is_active: true,
    default_event_status: 'scheduled',
    default_reminder_hours: 24,
    default_price: 0,
    default_is_free: false,
    sort_order: 20,
  },
  {
    name: 'World Cup 2026',
    slug: 'world-cup-2026',
    description: 'Live screenings of the 2026 World Cup matches.',
    color: '#3B82F6',
    icon: 'GlobeAltIcon',
    is_active: true,
    default_event_status: 'scheduled',
    default_reminder_hours: 1,
    default_price: 0,
    default_is_free: true,
    sort_order: 21,
  },
  {
    name: 'Sport',
    slug: 'sport',
    description: 'Live sports events and screenings.',
    color: '#16A34A',
    icon: 'TrophyIcon',
    is_active: true,
    default_event_status: 'scheduled',
    default_reminder_hours: 1,
    default_price: 0,
    default_is_free: true,
    sort_order: 22,
  },
]

const RULES: Array<{ pattern: RegExp; target: string }> = [
  { pattern: /quiz night/i, target: 'Quiz' },
  { pattern: /bingo/i, target: 'Bingo' },
  { pattern: /live at the anchor/i, target: 'Live Music' },
  { pattern: /karaoke/i, target: 'Karaoke' },
  { pattern: /tasting night/i, target: 'Tastings' },
  { pattern: /mother's day/i, target: 'Celebrations' },
  { pattern: /st patrick's day/i, target: 'Celebrations' },
  { pattern: /free mixer/i, target: 'Celebrations' },
  { pattern: /world cup 2026/i, target: 'World Cup 2026' },
  { pattern: /wimbledon/i, target: 'Sport' },
  { pattern: /mama mia/i, target: 'Parties' },
  { pattern: /halloween party/i, target: 'Parties' },
  { pattern: /movie night/i, target: 'Parties' },
]

function resolveTargetCategory(eventName: string): string | null {
  for (const rule of RULES) {
    if (rule.pattern.test(eventName)) {
      return rule.target
    }
  }
  return null
}

function getIsoDate(value: Date): string {
  return value.toISOString().split('T')[0]
}

async function loadCategories(admin: ReturnType<typeof createAdminClient>): Promise<CategoryRow[]> {
  const { data, error } = await (admin.from('event_categories') as any).select('id, name, slug')
  const rows = assertScriptQuerySucceeded({
    operation: 'Load event_categories',
    error,
    data: data as CategoryRow[] | null,
    allowMissing: true,
  })
  return Array.isArray(rows) ? rows : []
}

function buildCategoryMaps(categories: CategoryRow[]) {
  const bySlug = new Map<string, CategoryRow>()
  const idByName = new Map<string, string>()
  for (const cat of categories) {
    if (typeof cat?.slug === 'string' && cat.slug.length > 0) {
      bySlug.set(cat.slug, cat)
    }
    if (typeof cat?.name === 'string' && cat.name.length > 0 && typeof cat?.id === 'string' && cat.id.length > 0) {
      idByName.set(cat.name, cat.id)
    }
  }
  return { bySlug, idByName }
}

async function loadUpcomingEvents(admin: ReturnType<typeof createAdminClient>): Promise<EventRow[]> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = getIsoDate(today)

  const { data, error } = await (admin.from('events') as any)
    .select('id, name, category_id')
    .gte('date', todayStr)
    .neq('event_status', 'cancelled')
    .order('date', { ascending: true })

  const rows = assertScriptQuerySucceeded({
    operation: `Load events (>=${todayStr}, not cancelled)`,
    error,
    data: data as EventRow[] | null,
    allowMissing: true,
  })

  return Array.isArray(rows) ? rows : []
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  const admin = createAdminClient()

  console.log(`[${SCRIPT_NAME}] ${args.dryRun ? 'DRY RUN' : 'MUTATION'} starting`)

  const categories = await loadCategories(admin)
  const { bySlug, idByName } = buildCategoryMaps(categories)
  const missingCategories = NEW_CATEGORIES.filter((cat) => !bySlug.has(cat.slug))

  console.log(`[${SCRIPT_NAME}] categories loaded=${categories.length}`)
  console.log(`[${SCRIPT_NAME}] missing new categories=${missingCategories.length}`)
  if (missingCategories.length > 0) {
    console.log(
      `[${SCRIPT_NAME}] missing slugs: ${missingCategories.map((cat) => cat.slug).sort().join(', ')}`
    )
  }

  const events = await loadUpcomingEvents(admin)
  const plannedUpdates: Array<{
    id: string
    name: string
    fromId: string | null
    toName: string
  }> = []

  for (const event of events) {
    if (!event?.id || !event?.name) continue
    const targetName = resolveTargetCategory(event.name)
    if (!targetName) continue

    const knownTargetId = idByName.get(targetName)
    if (knownTargetId && event.category_id === knownTargetId) {
      continue
    }

    plannedUpdates.push({
      id: event.id,
      name: event.name,
      fromId: event.category_id ?? null,
      toName: targetName,
    })
  }

  console.log(`[${SCRIPT_NAME}] events scanned=${events.length}`)
  console.log(`[${SCRIPT_NAME}] planned event updates=${plannedUpdates.length}`)
  if (plannedUpdates.length > 0) {
    const preview = plannedUpdates.slice(0, 10).map((u) => `${u.name} -> ${u.toName}`)
    console.log(`[${SCRIPT_NAME}] preview: ${preview.join(' | ')}`)
  }

  if (args.dryRun) {
    console.log(`[${SCRIPT_NAME}] DRY RUN ok. No mutations performed.`)
    return
  }

  if (!args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] mutation blocked: missing --confirm`)
  }
  if (args.limit === null) {
    throw new Error(`[${SCRIPT_NAME}] mutation requires --limit <n> (hard cap ${HARD_CAP})`)
  }
  if (args.limit > HARD_CAP) {
    throw new Error(`[${SCRIPT_NAME}] --limit exceeds hard cap (max ${HARD_CAP})`)
  }
  if (!isTruthyEnv(process.env[RUN_MUTATION_ENV])) {
    throw new Error(
      `[${SCRIPT_NAME}] mutation blocked by safety guard. Set ${RUN_MUTATION_ENV}=true to enable mutations.`
    )
  }

  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })

  // Ensure missing categories exist before applying any event updates.
  for (const category of missingCategories) {
    const { data, error } = await (admin.from('event_categories') as any)
      .insert(category)
      .select('id, name, slug')
      .single()

    const created = assertScriptQuerySucceeded({
      operation: `Insert event_categories(${category.slug})`,
      error,
      data: data as CategoryRow | null,
    })

    if (!created?.id || !created?.name) {
      throw new Error(`[${SCRIPT_NAME}] inserted event category did not return id/name for slug=${category.slug}`)
    }

    idByName.set(created.name, created.id)
    bySlug.set(created.slug, created)
    console.log(`[${SCRIPT_NAME}] inserted category ${created.name} (slug=${created.slug})`)
  }

  const failures: string[] = []
  const resolvedUpdates: Array<{
    id: string
    name: string
    fromId: string | null
    toName: string
    toId: string
  }> = []

  for (const planned of plannedUpdates) {
    const targetId = idByName.get(planned.toName)
    if (!targetId) {
      failures.push(`Missing category id for target="${planned.toName}" (event="${planned.name}")`)
      continue
    }
    if (planned.fromId === targetId) {
      continue
    }
    resolvedUpdates.push({
      id: planned.id,
      name: planned.name,
      fromId: planned.fromId,
      toName: planned.toName,
      toId: targetId,
    })
  }

  // Apply updates with explicit caps.
  const mutationUpdates = resolvedUpdates.slice(0, args.limit)
  console.log(`[${SCRIPT_NAME}] applying updates=${mutationUpdates.length}`)
  for (const update of mutationUpdates) {
    try {
      const { data, error } = await (admin.from('events') as any)
        .update({ category_id: update.toId })
        .eq('id', update.id)
        .select('id')

      const { updatedCount } = assertScriptMutationSucceeded({
        operation: `Update events(${update.id}) category_id`,
        error,
        updatedRows: data as Array<{ id?: string }> | null,
        allowZeroRows: false,
      })

      assertScriptExpectedRowCount({
        operation: `Update events(${update.id}) category_id`,
        expected: 1,
        actual: updatedCount,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      failures.push(`Failed updating event ${update.id}: ${message}`)
    }
  }

  assertScriptCompletedWithoutFailures({ scriptName: SCRIPT_NAME, failureCount: failures.length, failures })
  console.log(`[${SCRIPT_NAME}] MUTATION complete.`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
