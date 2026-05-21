const MAX_SHORT_LINK_NAME_LENGTH = 120

function titleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 1) return word.toUpperCase()
      if (/^[A-Z0-9]+$/.test(word)) return word
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
    })
    .join(' ')
}

function cleanSegment(value: string): string {
  return titleCase(
    value
      .replace(/%[0-9a-f]{2}/gi, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function isOpaqueToken(segment: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    (segment.length >= 24 && (/^[A-Za-z0-9_]+$/.test(segment) || segment.includes('_')))
  )
}

function truncateName(value: string): string {
  return value.length > MAX_SHORT_LINK_NAME_LENGTH
    ? value.slice(0, MAX_SHORT_LINK_NAME_LENGTH).trim()
    : value
}

export function deriveShortLinkName(destinationUrl: string): string {
  try {
    const url = new URL(destinationUrl)
    const segments = url.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)

    if (segments[0] === 'r') return 'Review Link'

    const usefulSegment = [...segments].reverse().find((segment) => !isOpaqueToken(segment) && !['g', 'm', 'r'].includes(segment))
    const baseName = usefulSegment
      ? cleanSegment(usefulSegment)
      : cleanSegment(url.hostname.replace(/^www\./i, '').replace(/\./g, ' '))

    return truncateName(baseName || 'Short Link')
  } catch {
    return truncateName(cleanSegment(destinationUrl) || 'Short Link')
  }
}

export function resolveShortLinkName(name: string | null | undefined, destinationUrl: string): string {
  const trimmed = name?.trim()
  return truncateName(trimmed || deriveShortLinkName(destinationUrl))
}
