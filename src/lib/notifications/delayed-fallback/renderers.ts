import type { DelayedFallbackRenderer } from '@/lib/notifications/delayed-fallback/types'
import { privateBookingFallbackRenderer } from '@/lib/private-bookings/fallback-renderer'

/**
 * Renderers that rebuild a bounced email's text from the live booking, one per family of
 * template keys. A delivery whose template key no renderer matches cannot fall back, so the job
 * marks it undelivered and tells staff rather than dropping it.
 *
 * A path that sets `delayedFallbackAllowed` must add its renderer here in the same change.
 * Table booking keys have none yet.
 */
export const DELAYED_FALLBACK_RENDERERS: DelayedFallbackRenderer[] = [privateBookingFallbackRenderer]

export function findDelayedFallbackRenderer(
  templateKey: string,
  renderers: DelayedFallbackRenderer[] = DELAYED_FALLBACK_RENDERERS
): DelayedFallbackRenderer | null {
  return renderers.find((renderer) => renderer.matches(templateKey)) ?? null
}
