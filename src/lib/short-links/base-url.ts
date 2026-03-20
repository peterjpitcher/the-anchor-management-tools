export function getShortLinkBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || 'https://l.the-anchor.pub').replace(/\/$/, '')
}

export function buildShortLinkUrl(shortCode: string): string {
  const base = getShortLinkBaseUrl()
  const normalizedCode = String(shortCode || '').replace(/^\//, '')
  return `${base}/${normalizedCode}`
}

