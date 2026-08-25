import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingNavigation,
  getPendingNavigation,
  rememberPendingNavigation,
  safePathForTelemetry,
} from './navigation-recovery'

describe('navigation recovery', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState({}, '', '/dashboard')
  })

  it('remembers a recent same-origin destination', () => {
    rememberPendingNavigation('/oj-projects?client=abc', 1_000)
    expect(getPendingNavigation(2_000)).toBe('/oj-projects?client=abc')
  })

  it('rejects external and expired destinations', () => {
    rememberPendingNavigation('https://example.com/private', 1_000)
    expect(getPendingNavigation(1_001)).toBeNull()

    rememberPendingNavigation('/events/123', 1_000)
    expect(getPendingNavigation(61_001)).toBeNull()
  })

  it('clears a destination', () => {
    rememberPendingNavigation('/events/123')
    clearPendingNavigation()
    expect(getPendingNavigation()).toBeNull()
  })

  it('removes query strings from telemetry paths', () => {
    expect(safePathForTelemetry('/oj-projects?client=private')).toBe('/oj-projects')
    expect(safePathForTelemetry('https://example.com/private')).toBeNull()
  })
})
