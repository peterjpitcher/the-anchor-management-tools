import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildInsightsReport, type InsightsFailureLog } from '@/lib/insights/engine'
import type { InsightSignal, InsightsDb, SectionBuildResult, SectionContext, SectionDefinition, SectionKey } from '@/lib/insights/types'

const NOW = new Date('2026-09-25T05:00:00Z')
const APP_URL = 'https://management.example.test'

function result(signals: InsightSignal[] = [], extra: Partial<SectionBuildResult> = {}): SectionBuildResult {
  return { headline: 'Fixture headline', metrics: [], lists: [], signals, notes: [], ...extra }
}

function section(key: SectionKey, build: SectionDefinition['build']): SectionDefinition {
  return { key, title: key, path: `/${key}`, build }
}

function signal(overrides: Partial<InsightSignal> & Pick<InsightSignal, 'key'>): InsightSignal {
  return { rag: 'amber', kind: 'issue', text: overrides.key, emailSafe: true, ...overrides }
}

function fakeDbFactory(): { createDb: (signal: AbortSignal) => InsightsDb; signals: AbortSignal[] } {
  const signals: AbortSignal[] = []
  return {
    signals,
    createDb: (abortSignal) => {
      signals.push(abortSignal)
      return {} as InsightsDb
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('buildInsightsReport', () => {
  it('gives every section the same instant and windows, and keeps report order', async () => {
    const seen: SectionContext[] = []
    const capture: SectionDefinition['build'] = async (ctx) => {
      seen.push(ctx)
      return result()
    }
    const { createDb } = fakeDbFactory()
    const report = await buildInsightsReport({
      createDb,
      now: NOW,
      appUrl: APP_URL,
      sections: [section('events', capture), section('customers', capture), section('parking', capture)],
      logFailure: () => undefined,
    })
    expect(report.sections.map((s) => s.key)).toEqual(['events', 'customers', 'parking'])
    expect(new Set(seen.map((ctx) => ctx.now.toISOString()))).toEqual(new Set([NOW.toISOString()]))
    expect(new Set(seen.map((ctx) => ctx.windows))).toHaveProperty('size', 1)
    expect(report.generatedAt).toBe(NOW.toISOString())
    expect(report.sections[0].href).toBe('https://management.example.test/events')
    expect(seen[0].link('/events/abc')).toBe('https://management.example.test/events/abc')
    expect(() => seen[0].link('https://evil.test/x')).toThrow()
    expect(() => seen[0].link('//evil.test/x')).toThrow()
  })

  it('marks a throwing section not checked and keeps the others', async () => {
    const logs: InsightsFailureLog[] = []
    const { createDb } = fakeDbFactory()
    const report = await buildInsightsReport({
      createDb,
      now: NOW,
      appUrl: APP_URL,
      sections: [
        section('events', async () => { throw new TypeError('boom with a customer name inside') }),
        section('customers', async () => result([signal({ key: 'c.1', rag: 'red' })])),
      ],
      logFailure: (entry) => logs.push(entry),
    })
    expect(report.sections[0]).toMatchObject({ status: 'not_checked', failure: { reason: 'error' } })
    expect(report.sections[0].signals).toEqual([])
    expect(report.sections[1].status).toBe('red')
    expect(report.notChecked).toEqual(['events'])
    expect(report.summary.counts).toEqual({ red: 1, amber: 0, green: 0, not_checked: 1 })
    expect(logs).toEqual([{ section: 'events', reason: 'error', elapsedMs: expect.any(Number), errorClass: 'TypeError' }])
    expect(JSON.stringify(logs)).not.toContain('customer name')
  })

  it('treats a malformed result as a failure, never as green', async () => {
    const { createDb } = fakeDbFactory()
    const report = await buildInsightsReport({
      createDb,
      now: NOW,
      appUrl: APP_URL,
      sections: [section('events', async () => ({ headline: 'x' }) as unknown as SectionBuildResult)],
      logFailure: () => undefined,
    })
    expect(report.sections[0].status).toBe('not_checked')
  })

  it('aborts a section that never resolves at its deadline and finishes the build', async () => {
    vi.useFakeTimers()
    const { createDb, signals } = fakeDbFactory()
    let abortedSeen = false
    const hanging: SectionDefinition['build'] = (ctx) => new Promise<SectionBuildResult>((_, reject) => {
      ctx.signal.addEventListener('abort', () => {
        abortedSeen = true
        reject(new Error('aborted'))
      })
    })
    const ignoresSignal: SectionDefinition['build'] = () => new Promise<SectionBuildResult>(() => undefined)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const building = buildInsightsReport({
      createDb,
      now: NOW,
      appUrl: APP_URL,
      sections: [
        section('events', hanging),
        section('customers', ignoresSignal),
        section('parking', async () => result()),
      ],
      sectionDeadlineMs: 8_000,
      buildDeadlineMs: 25_000,
      logFailure: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(8_001)
    const report = await building
    process.off('unhandledRejection', unhandled)
    expect(report.sections.map((s) => s.status)).toEqual(['not_checked', 'not_checked', 'green'])
    expect(report.sections[0].failure?.reason).toBe('timeout')
    expect(report.sections[1].failure?.reason).toBe('timeout')
    expect(abortedSeen).toBe(true)
    expect(signals.every((s) => s.aborted)).toBe(true)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('stops the whole build at its deadline, including sections not yet started', async () => {
    vi.useFakeTimers()
    const { createDb } = fakeDbFactory()
    const slow: SectionDefinition['build'] = (ctx) => new Promise<SectionBuildResult>((resolve, reject) => {
      const timer = setTimeout(() => resolve(result()), 6_000)
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      })
    })
    const building = buildInsightsReport({
      createDb,
      now: NOW,
      appUrl: APP_URL,
      concurrency: 1,
      sectionDeadlineMs: 8_000,
      buildDeadlineMs: 10_000,
      sections: [section('events', slow), section('customers', slow), section('parking', slow)],
      logFailure: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(20_000)
    const report = await building
    expect(report.sections.map((s) => s.status)).toEqual(['green', 'not_checked', 'not_checked'])
  })

  it('never runs more sections at once than the pool allows', async () => {
    const { createDb } = fakeDbFactory()
    let running = 0
    let peak = 0
    const tracked: SectionDefinition['build'] = async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return result()
    }
    const keys: SectionKey[] = ['events', 'customers', 'marketing', 'feedback', 'table_bookings', 'private_hire', 'parking']
    await buildInsightsReport({ createDb, now: NOW, appUrl: APP_URL, concurrency: 4, sections: keys.map((key) => section(key, tracked)) })
    expect(peak).toBe(4)
  })

  it('cancels a finished section\'s leftover requests', async () => {
    const { createDb, signals } = fakeDbFactory()
    await buildInsightsReport({ createDb, now: NOW, appUrl: APP_URL, sections: [section('events', async () => result())] })
    expect(signals[0].aborted).toBe(true)
  })

  it('rejects an app URL with credentials or a bad scheme', async () => {
    const { createDb } = fakeDbFactory()
    await expect(buildInsightsReport({ createDb, now: NOW, appUrl: 'ftp://x.test', sections: [] })).rejects.toThrow()
    await expect(buildInsightsReport({ createDb, now: NOW, appUrl: 'https://u:p@x.test', sections: [] })).rejects.toThrow()
  })

  it('keeps one primary action per record and orders signals red, amber, wins, info', async () => {
    const { createDb } = fakeDbFactory()
    const action = (text: string) => ({ text, href: `${APP_URL}/events/e1`, target: 'record' as const, impact: 'customer' as const })
    const report = await buildInsightsReport({
      createDb,
      now: NOW,
      appUrl: APP_URL,
      sections: [section('events', async () => result([
        signal({ key: 'info', kind: 'info', rag: 'green' }),
        signal({ key: 'win', kind: 'win', rag: 'green', entity: 'event:e2', action: action('Keep going') }),
        signal({ key: 'zero', rag: 'amber', entity: 'event:e1', action: action('Start promoting') }),
        signal({ key: 'low', rag: 'red', entity: 'event:e1', action: action('Promote now') }),
      ]))],
    })
    const signals = report.sections[0].signals
    expect(signals.map((s) => s.key)).toEqual(['low', 'zero', 'win', 'info'])
    expect(signals.find((s) => s.key === 'low')?.action?.text).toBe('Promote now')
    expect(signals.find((s) => s.key === 'zero')?.action).toBeUndefined()
    expect(report.actions.map((a) => a.text)).toEqual(['Promote now', 'Keep going'])
  })
})
