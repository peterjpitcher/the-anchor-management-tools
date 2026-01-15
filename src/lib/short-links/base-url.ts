export function getShortLinkBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || 'https://vip-club.uk').replace(/\/$/, '')
}

export function buildShortLinkUrl(shortCode: string): string {
  const base = getShortLinkBaseUrl()
  const normalizedCode = String(shortCode || '').replace(/^\//, '')
  return `${base}/${normalizedCode}`
}

