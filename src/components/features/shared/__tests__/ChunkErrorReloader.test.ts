import { describe, it, expect, beforeEach } from 'vitest'
import { isChunkLoadFailure, shouldReloadForChunkError } from '../ChunkErrorReloader'

describe('isChunkLoadFailure', () => {
  it('matches the errors thrown when a build chunk is missing', () => {
    expect(isChunkLoadFailure('ChunkLoadError: Loading chunk 4277 failed.')).toBe(true)
    expect(isChunkLoadFailure('Loading chunk 8260 failed.')).toBe(true)
    expect(isChunkLoadFailure('Loading CSS chunk 12 failed')).toBe(true)
    expect(isChunkLoadFailure('Failed to fetch dynamically imported module: /_next/…')).toBe(true)
  })

  it('ignores unrelated runtime errors', () => {
    expect(isChunkLoadFailure('TypeError: x is not a function')).toBe(false)
    expect(isChunkLoadFailure('')).toBe(false)
  })
})

describe('shouldReloadForChunkError', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('permits the first reload, then a second, then stops within the window', () => {
    const t = 1_000_000
    expect(shouldReloadForChunkError(t)).toBe(true) // 1st
    expect(shouldReloadForChunkError(t + 1_000)).toBe(true) // 2nd
    expect(shouldReloadForChunkError(t + 2_000)).toBe(false) // capped
  })

  it('resets after the rolling window elapses', () => {
    const t = 2_000_000
    expect(shouldReloadForChunkError(t)).toBe(true)
    expect(shouldReloadForChunkError(t + 1_000)).toBe(true)
    expect(shouldReloadForChunkError(t + 2_000)).toBe(false)
    // > 30s later the guard resets and a reload is allowed again
    expect(shouldReloadForChunkError(t + 31_000)).toBe(true)
  })
})
