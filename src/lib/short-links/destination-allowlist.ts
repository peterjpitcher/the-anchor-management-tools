const DEFAULT_ALLOWED_SHORT_LINK_DESTINATION_HOSTS = [
  'the-anchor.pub',
  'www.the-anchor.pub',
  'l.the-anchor.pub',
  'management.orangejelly.co.uk',
  'orangejelly.co.uk',
  'www.orangejelly.co.uk',
  'localhost',
  '127.0.0.1',
  '::1',
  // The venue's own presence on other platforms. Listed so marketing email can route these
  // through the redirector and measure them, rather than leaving the WhatsApp and social
  // links as the only untracked calls to action in a campaign. Narrow by design: this list
  // is an open-redirect guard, so only hosts the venue actually publishes belong here.
  'wa.me',
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com',
]

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').trim().toLowerCase()
}

function getAllowedHosts(): string[] {
  const configured = process.env.SHORT_LINK_ALLOWED_DESTINATION_HOSTS
    || process.env.SHORT_LINK_ALLOWED_HOSTS
    || ''

  const configuredHosts = configured
    .split(',')
    .map((host) => normalizeHost(host))
    .filter(Boolean)

  return Array.from(new Set([...DEFAULT_ALLOWED_SHORT_LINK_DESTINATION_HOSTS, ...configuredHosts]))
}

function isAllowedShortLinkDestination(value: string): boolean {
  let parsed: URL

  try {
    parsed = new URL(value.trim())
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false
  }

  const host = normalizeHost(parsed.hostname)
  if (!host) return false

  return getAllowedHosts().some((allowedHost) => (
    host === allowedHost || host.endsWith(`.${allowedHost}`)
  ))
}

/**
 * Staff-created links (the Short links screen and its UTM variants) may point at any website
 * (owner decision, 16 November 2026). Only signed-in staff with short_links manage can reach
 * this path, so the redirector is not an open redirect for outsiders. Still refuses anything
 * that is not a plain web address: other schemes and addresses carrying a username or password.
 */
export function assertValidShortLinkDestination(value: string): string {
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Short links must point to a valid web address')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Short links must point to an http or https web address')
  }
  if (!normalizeHost(parsed.hostname)) {
    throw new Error('Short links must point to a valid web address')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Short links cannot point to an address containing a username or password')
  }
  return trimmed
}

/**
 * Automated paths (marketing email tracking, guest and SMS links, the API-key Meta ads route)
 * keep the host allowlist: their destinations are not chosen by a signed-in member of staff.
 */
export function assertAllowedShortLinkDestination(value: string): string {
  const trimmed = value.trim()
  if (!isAllowedShortLinkDestination(trimmed)) {
    throw new Error('Short links can only point to approved Anchor or Orange Jelly domains');
  }
  return trimmed
}
