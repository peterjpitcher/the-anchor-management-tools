const PENDING_NAVIGATION_KEY = 'pending-internal-navigation'
const PENDING_NAVIGATION_MAX_AGE_MS = 60_000

type PendingNavigation = {
  destination: string
  recordedAt: number
}

function getWindow(): Window | null {
  return typeof window === 'undefined' ? null : window
}

function normalizeInternalDestination(input: string): string | null {
  const browserWindow = getWindow()
  if (!browserWindow) return null

  try {
    const url = new URL(input, browserWindow.location.href)
    if (url.origin !== browserWindow.location.origin) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function rememberPendingNavigation(input: string, now: number = Date.now()): void {
  const browserWindow = getWindow()
  const destination = normalizeInternalDestination(input)
  if (!browserWindow || !destination) return

  try {
    const pending: PendingNavigation = { destination, recordedAt: now }
    browserWindow.sessionStorage.setItem(PENDING_NAVIGATION_KEY, JSON.stringify(pending))
  } catch {
    // Recovery is best-effort. Navigation must still work when storage is blocked.
  }
}

export function clearPendingNavigation(): void {
  const browserWindow = getWindow()
  if (!browserWindow) return

  try {
    browserWindow.sessionStorage.removeItem(PENDING_NAVIGATION_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

export function getPendingNavigation(now: number = Date.now()): string | null {
  const browserWindow = getWindow()
  if (!browserWindow) return null

  try {
    const raw = browserWindow.sessionStorage.getItem(PENDING_NAVIGATION_KEY)
    if (!raw) return null

    const pending = JSON.parse(raw) as Partial<PendingNavigation>
    if (
      typeof pending.destination !== 'string' ||
      typeof pending.recordedAt !== 'number' ||
      now - pending.recordedAt > PENDING_NAVIGATION_MAX_AGE_MS
    ) {
      clearPendingNavigation()
      return null
    }

    return normalizeInternalDestination(pending.destination)
  } catch {
    clearPendingNavigation()
    return null
  }
}

export function safePathForTelemetry(input: string | null | undefined): string | null {
  if (!input) return null

  const browserWindow = getWindow()
  if (!browserWindow) return null

  try {
    const url = new URL(input, browserWindow.location.href)
    if (url.origin !== browserWindow.location.origin) return null
    return url.pathname
  } catch {
    return null
  }
}
