import { createHash } from 'crypto'

/** Stable UUIDs make insertion atomic without resetting a previously delivered row. */
export function managerReportId(parts: string[]): string {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
