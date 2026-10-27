import { toast } from '@/ds'

/** Message shown before an out-of-date FOH screen reloads itself (BK-096). */
export const STALE_PAGE_MESSAGE = 'This screen is out of date, reloading'

const RELOAD_DELAY_MS = 1_500

let reloadScheduled = false

/**
 * A server action that throws on the FOH screen almost always means the page is from an older
 * release ('Failed to find Server Action'). Tell staff and reload once, so a clock in or out is
 * never left spinning and background prompts start working again.
 */
export function reloadStalePage(): void {
  if (reloadScheduled || typeof window === 'undefined') return
  reloadScheduled = true
  toast.error(STALE_PAGE_MESSAGE)
  window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS)
}

/**
 * True when a server action failed because this page is from another release. Next.js throws an
 * UnrecognizedActionError ('Server Action ... was not found on the server') in that case.
 */
export function isStaleServerActionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'UnrecognizedActionError') return true
  return typeof message === 'string'
    && /was not found on the server|failed to find server action|older or newer deployment/i.test(message)
}

/** Test hook: lets a test schedule a second reload. */
export function resetStalePageReloadForTests(): void {
  reloadScheduled = false
}
