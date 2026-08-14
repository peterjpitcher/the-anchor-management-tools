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

export function assertAllowedShortLinkDestination(value: string): string {
  const trimmed = value.trim()
  if (!isAllowedShortLinkDestination(trimmed)) {
    throw new Error('Short links can only point to approved Anchor or Orange Jelly domains');
  }
  return trimmed
}
