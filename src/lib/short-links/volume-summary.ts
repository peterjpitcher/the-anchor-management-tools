/**
 * The short links page shows three figures from the analytics function: clicks and unique
 * visitors over the last 30 days, and the most clicked link. The function returns one row
 * per clicked link with a bucket array each, so the page reduces it here on the server and
 * sends only these figures to the browser.
 *
 * Totals come from the function's per-link totals, which do not depend on the granularity,
 * so the page asks for month buckets to keep the rows small. Checked against production on
 * 18 November 2026: day and month gave the same row count, sums and top link for both the
 * current and the previous 30 days.
 */

export interface ShortLinkVolumeSummary {
  totalClicks: number
  uniqueVisitors: number
  /** label is what the tile shows; title is the full destination for the hint. */
  topDestination: { label: string; title: string }
}

type VolumeRow = {
  destination_url?: unknown
  name?: unknown
  short_code?: unknown
  total_clicks?: unknown
  unique_visitors?: unknown
}

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function getVolumeRows(value: unknown): VolumeRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is VolumeRow => Boolean(row) && typeof row === 'object')
}

function sumVolumeRows(rows: VolumeRow[], key: 'total_clicks' | 'unique_visitors'): number {
  return rows.reduce((sum, row) => sum + toNumber(row[key]), 0)
}

function formatDestination(value: unknown): string {
  if (typeof value !== 'string' || !value) return '-'

  try {
    const url = new URL(value)
    if (url.hostname === 'www.the-anchor.pub' || url.hostname === 'the-anchor.pub') {
      return `${url.pathname}${url.search}`
    }
    return `${url.hostname}${url.pathname}${url.search}`
  } catch {
    return value
  }
}

function getTopDestination(rows: VolumeRow[]): { label: string; title: string } {
  if (rows.length === 0) return { label: '-', title: '' }

  const top = [...rows].sort((a, b) => toNumber(b.total_clicks) - toNumber(a.total_clicks))[0]
  const name = typeof top.name === 'string' && top.name.trim() ? top.name.trim() : ''
  const destination = typeof top.destination_url === 'string' ? top.destination_url : ''
  return {
    label: name || formatDestination(destination),
    title: destination || name,
  }
}

/** A failed or missing read (anything that is not an array) gives zeros and "-". */
export function summariseShortLinkVolume(value: unknown): ShortLinkVolumeSummary {
  const rows = getVolumeRows(value)
  return {
    totalClicks: sumVolumeRows(rows, 'total_clicks'),
    uniqueVisitors: sumVolumeRows(rows, 'unique_visitors'),
    topDestination: getTopDestination(rows),
  }
}
