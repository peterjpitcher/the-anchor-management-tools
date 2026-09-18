import { rankActions } from './actions'
import { buildSummary } from './summary'
import { dedupeByEntity, orderSignals, sectionStatusOf } from './signals'
import { INSIGHTS_TIMING } from './thresholds'
import { computeWindows } from './windows'
import type {
  InsightsDb,
  InsightSection,
  InsightsReport,
  InsightWindows,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from './types'

/**
 * Builds the weekly insights report (spec 4.1 and 4.2).
 *
 * - Every section gets its own AbortController and its own client from `createDb(signal)`,
 *   so a section that overruns has its requests cancelled, not merely ignored.
 * - Sections run through a small pool so a build never floods the database.
 * - A failed or timed-out section is `not_checked`; it never reads as green, and it never
 *   stops the other sections.
 * - Summary and actions come only from the finished section objects.
 */

export interface InsightsFailureLog {
  section: string
  reason: 'timeout' | 'error'
  elapsedMs: number
  errorClass?: string
}

export interface BuildInsightsOptions {
  /** Returns a client whose every request carries `signal`. Called once per section. */
  createDb: (signal: AbortSignal) => InsightsDb
  now: Date
  /** App origin for absolute links, normally NEXT_PUBLIC_APP_URL. */
  appUrl: string
  sections: readonly SectionDefinition[]
  sectionDeadlineMs?: number
  buildDeadlineMs?: number
  concurrency?: number
  /** Receives one entry per failed section. Never given report content. */
  logFailure?: (entry: InsightsFailureLog) => void
}

class DeadlineError extends Error {
  constructor(scope: string) {
    super(`${scope} deadline reached`)
    this.name = 'DeadlineError'
  }
}

export function validateAppOrigin(appUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(appUrl)
  } catch {
    throw new Error('Insights need a valid app URL')
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Insights need an HTTP or HTTPS app URL without credentials')
  }
  return parsed.origin
}

export function createSectionContext(db: InsightsDb, now: Date, windows: InsightWindows, signal: AbortSignal, origin: string): SectionContext {
  return {
    db,
    now,
    windows,
    signal,
    link(path: string): string {
      if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`Insights links must be app paths: ${path}`)
      return new URL(path, origin).href
    },
  }
}

function abortRejection(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function isValidResult(value: unknown): value is SectionBuildResult {
  if (!value || typeof value !== 'object') return false
  const result = value as SectionBuildResult
  return typeof result.headline === 'string'
    && Array.isArray(result.metrics)
    && Array.isArray(result.lists)
    && Array.isArray(result.signals)
    && Array.isArray(result.notes)
}

function notCheckedSection(definition: SectionDefinition, origin: string, reason: 'timeout' | 'error', elapsedMs: number): InsightSection {
  return {
    key: definition.key,
    title: definition.title,
    href: new URL(definition.path, origin).href,
    status: 'not_checked',
    headline: reason === 'timeout'
      ? `Not checked: ${definition.title.toLowerCase()} data took too long to load.`
      : `Not checked: ${definition.title.toLowerCase()} data could not be loaded.`,
    metrics: [],
    lists: [],
    signals: [],
    notes: ['Open the section in the app to see the current position.'],
    failure: { reason, elapsedMs },
  }
}

function finishedSection(definition: SectionDefinition, origin: string, result: SectionBuildResult): InsightSection {
  const signals = orderSignals(dedupeByEntity(result.signals))
  return {
    ...result,
    signals,
    key: definition.key,
    title: definition.title,
    href: new URL(definition.path, origin).href,
    status: sectionStatusOf(signals),
  }
}

function defaultLogFailure(entry: InsightsFailureLog): void {
  console.error('[insights] section not checked', entry)
}

export async function buildInsightsReport(options: BuildInsightsOptions): Promise<InsightsReport> {
  const origin = validateAppOrigin(options.appUrl)
  const now = new Date(options.now.getTime())
  const windows = computeWindows(now)
  const definitions = options.sections
  const sectionDeadlineMs = options.sectionDeadlineMs ?? INSIGHTS_TIMING.sectionDeadlineMs
  const buildDeadlineMs = options.buildDeadlineMs ?? INSIGHTS_TIMING.buildDeadlineMs
  const concurrency = Math.max(1, Math.min(options.concurrency ?? INSIGHTS_TIMING.concurrency, definitions.length || 1))
  const logFailure = options.logFailure ?? defaultLogFailure

  const buildController = new AbortController()
  const buildTimer = setTimeout(() => buildController.abort(new DeadlineError('build')), buildDeadlineMs)
  const sections: InsightSection[] = new Array(definitions.length)

  const runSection = async (index: number): Promise<void> => {
    const definition = definitions[index]
    if (buildController.signal.aborted) {
      logFailure({ section: definition.key, reason: 'timeout', elapsedMs: 0 })
      sections[index] = notCheckedSection(definition, origin, 'timeout', 0)
      return
    }
    const controller = new AbortController()
    const abortFromBuild = (): void => controller.abort(buildController.signal.reason)
    buildController.signal.addEventListener('abort', abortFromBuild, { once: true })
    const timer = setTimeout(() => controller.abort(new DeadlineError(definition.key)), sectionDeadlineMs)
    const started = Date.now()
    try {
      const db = options.createDb(controller.signal)
      const context = createSectionContext(db, now, windows, controller.signal, origin)
      const building = Promise.resolve().then(() => definition.build(context))
      // A builder that ignores the signal may still settle later; its result is discarded.
      building.catch(() => undefined)
      const result = await Promise.race([building, abortRejection(controller.signal)])
      if (!isValidResult(result)) throw new Error('Section returned an invalid result')
      sections[index] = finishedSection(definition, origin, result)
    } catch (error) {
      const elapsedMs = Date.now() - started
      const reason = controller.signal.aborted ? 'timeout' : 'error'
      logFailure({
        section: definition.key,
        reason,
        elapsedMs,
        errorClass: error instanceof Error ? error.name : typeof error,
      })
      sections[index] = notCheckedSection(definition, origin, reason, elapsedMs)
    } finally {
      clearTimeout(timer)
      buildController.signal.removeEventListener('abort', abortFromBuild)
      // Cancel anything still in flight once the section has an answer.
      if (!controller.signal.aborted) controller.abort(new DeadlineError(`${definition.key} finished`))
    }
  }

  let nextIndex = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (nextIndex < definitions.length) {
      const index = nextIndex
      nextIndex += 1
      await runSection(index)
    }
  })
  await Promise.all(workers)
  clearTimeout(buildTimer)

  const { actions, moreRedActions } = rankActions(sections, windows.today)
  return {
    generatedAt: now.toISOString(),
    windows,
    sections,
    summary: buildSummary(sections, actions, windows),
    actions,
    moreRedActions,
    notChecked: sections.filter((section) => section.status === 'not_checked').map((section) => section.key),
  }
}
