/**
 * The references to try for what staff typed when finding a table booking (BK-180): as typed,
 * and with 'TB-' added if it was left off. Empty when it cannot be a reference.
 */
export function referenceCandidates(raw: string): string[] {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9-]{4,20}$/.test(cleaned)) return []
  const candidates = new Set([cleaned])
  if (!cleaned.startsWith('TB-')) candidates.add(`TB-${cleaned.replace(/^TB/, '')}`)
  return Array.from(candidates).filter((candidate) => candidate.length <= 20)
}
