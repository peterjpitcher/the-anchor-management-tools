import { parseUserAgent } from '@/lib/user-agent-parser'
import type { SigningEvidence } from './types'

type HeaderReader = { get(name: string): string | null }

const MAX_FIELD_LENGTH = 400

function clean(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_FIELD_LENGTH)
}

/** The hosting platform URL-encodes place names ("Staines-upon-Thames" arrives with %20 and so on). */
function decodePlace(value: string | null): string | null {
  const cleaned = clean(value)
  if (!cleaned) return null
  try {
    return decodeURIComponent(cleaned)
  } catch {
    return cleaned
  }
}

/**
 * What we can say about where a signature came from, taken from the request itself. Nothing
 * here asks the signer for permission: the address and browser are sent with every request, and
 * the town, region and country are worked out from the address by the hosting platform. It is
 * an approximate location, usually the nearest town, never a street.
 */
export function readSigningEvidence(headers: HeaderReader): SigningEvidence {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]
  return {
    ip: clean(forwardedFor) ?? clean(headers.get('x-real-ip')),
    userAgent: clean(headers.get('user-agent')),
    city: decodePlace(headers.get('x-vercel-ip-city')),
    region: clean(headers.get('x-vercel-ip-country-region')),
    country: clean(headers.get('x-vercel-ip-country')),
  }
}

/** "Staines-upon-Thames, ENG, GB", or a plain statement that we could not tell. */
export function describeLocation(evidence: Pick<SigningEvidence, 'city' | 'region' | 'country'>): string {
  const parts = [evidence.city, evidence.region, evidence.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'Not available'
}

/** "Safari on iOS (mobile)", for the signing record. The raw string is stored alongside. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Not available'
  const parsed = parseUserAgent(userAgent)
  return `${parsed.browser} on ${parsed.os} (${parsed.deviceType})`
}
