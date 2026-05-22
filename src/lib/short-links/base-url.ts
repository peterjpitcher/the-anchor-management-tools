export function getShortLinkBaseUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || 'https://l.the-anchor.pub').replace(/\/$/, '')
  try {
    const url = new URL(configured)
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'vip-club.uk' || hostname === 'www.vip-club.uk') {
      return 'https://l.the-anchor.pub'
    }
  } catch {
    return 'https://l.the-anchor.pub'
  }
  return configured
}

export function buildShortLinkUrl(shortCode: string): string {
  const base = getShortLinkBaseUrl()
  const normalizedCode = String(shortCode || '').replace(/^\//, '')
  return `${base}/${normalizedCode}`
}
