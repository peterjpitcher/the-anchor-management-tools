/**
 * Spotting vendor names that are probably the same vendor.
 *
 * A vendor's identity is its exact key (lower case, single spaces). This module adds a looser
 * comparison used ONLY to make suggestions: "did you mean" when a new vendor is typed, and
 * "possible duplicates" on the vendor list. It never merges anything and never decides which
 * vendor a payment belongs to.
 */

const COMPANY_SUFFIXES = new Set([
  'ltd',
  'limited',
  'plc',
  'llp',
  'llc',
  'inc',
  'co',
  'company',
  'corp',
  'corporation',
  'uk',
  'gb',
  'group',
  'holdings',
  'the',
])

const WEB_SUFFIX = /\.(?:co\.uk|org\.uk|com|net|org|io|uk)\b/g

export type VendorLike = { id: string; name: string }

/**
 * The exact identity key, as the database computes it (`normalize_receipt_vendor_key`).
 */
export function vendorIdentityKey(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  const normalized = name.trim().replace(/\s+/g, ' ')
  return normalized ? normalized.toLowerCase() : null
}

/**
 * A looser key: lower case, web suffixes and punctuation removed, "&" read as "and", company
 * suffixes dropped. "Oak Farm Gas Co Ltd" and "Oak Farm Gas Co." share one; so do "Wix" and
 * "Wix.com".
 */
export function vendorMatchingKey(name: string | null | undefined): string {
  if (typeof name !== 'string') return ''
  const tokens = vendorMatchingTokens(name)
  return tokens.join(' ')
}

function vendorMatchingTokens(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(WEB_SUFFIX, ' ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (!cleaned) return []

  const tokens = cleaned.split(' ').filter((token) => token !== 'and')
  const kept = tokens.filter((token) => !COMPANY_SUFFIXES.has(token))
  // A name made only of suffix words ("The Co") keeps them, or it would match everything.
  return kept.length ? kept : tokens
}

function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    let rowMinimum = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      current.push(value)
      if (value < rowMinimum) rowMinimum = value
    }
    if (rowMinimum > limit) return limit + 1
    previous = current
  }
  return previous[b.length]
}

export type VendorSimilarity = 'same_key' | 'joined' | 'starts_with' | 'close_spelling'

/**
 * Whether two names look like one vendor, and why. Null when they do not.
 *
 * - `same_key`: equal once suffixes and punctuation are removed ("Wix" / "Wix.com").
 * - `joined`: equal once spaces are removed too ("TK Maxx" / "TKMaxx").
 * - `starts_with`: one is the other with more words on the end ("Spelthorne" /
 *   "Spelthorne Borough Council"). The shorter must be at least four letters.
 * - `close_spelling`: one or two letters apart ("Jacob William" / "Jacob Williams"). Both must be
 *   at least six letters, so short names are not paired by accident.
 */
export function compareVendorNames(a: string, b: string): VendorSimilarity | null {
  const tokensA = vendorMatchingTokens(a)
  const tokensB = vendorMatchingTokens(b)
  if (!tokensA.length || !tokensB.length) return null

  const keyA = tokensA.join(' ')
  const keyB = tokensB.join(' ')
  if (keyA === keyB) return 'same_key'

  const joinedA = tokensA.join('')
  const joinedB = tokensB.join('')
  if (joinedA === joinedB) return 'joined'

  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA]
  if (
    shorter.length < longer.length &&
    shorter.join('').length >= 4 &&
    shorter.every((token, index) => longer[index] === token)
  ) {
    return 'starts_with'
  }

  if (joinedA.length >= 6 && joinedB.length >= 6) {
    const limit = Math.min(joinedA.length, joinedB.length) >= 10 ? 2 : 1
    if (editDistance(joinedA, joinedB, limit) <= limit) return 'close_spelling'
  }

  return null
}

const SIMILARITY_ORDER: Record<VendorSimilarity, number> = {
  same_key: 0,
  joined: 1,
  starts_with: 2,
  close_spelling: 3,
}

/**
 * Existing vendors that a typed name might be, closest first. A vendor whose exact key equals
 * the typed name is not "similar", it is the same vendor, and is left out.
 */
export function findSimilarVendors<T extends VendorLike>(name: string, vendors: T[], limit = 5): Array<T & { similarity: VendorSimilarity }> {
  const identity = vendorIdentityKey(name)
  const matches: Array<T & { similarity: VendorSimilarity }> = []
  for (const vendor of vendors) {
    if (vendorIdentityKey(vendor.name) === identity) continue
    const similarity = compareVendorNames(name, vendor.name)
    if (similarity) matches.push({ ...vendor, similarity })
  }
  return matches
    .sort((left, right) => SIMILARITY_ORDER[left.similarity] - SIMILARITY_ORDER[right.similarity] || left.name.localeCompare(right.name))
    .slice(0, limit)
}

/**
 * Groups of vendors that look like one vendor. Each vendor appears in at most one group; a
 * group has two or more. Vendors are joined through each other, so "Veolia", "Veolia ES" and
 * "Veolia ES UK Ltd" come back as one group.
 */
export function groupPossibleDuplicateVendors<T extends VendorLike>(vendors: T[]): T[][] {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) as string
    parent.set(id, root)
    return root
  }
  for (const vendor of vendors) parent.set(vendor.id, vendor.id)

  for (let i = 0; i < vendors.length; i += 1) {
    for (let j = i + 1; j < vendors.length; j += 1) {
      if (compareVendorNames(vendors[i].name, vendors[j].name)) {
        const a = find(vendors[i].id)
        const b = find(vendors[j].id)
        if (a !== b) parent.set(b, a)
      }
    }
  }

  const groups = new Map<string, T[]>()
  for (const vendor of vendors) {
    const root = find(vendor.id)
    const group = groups.get(root) ?? []
    group.push(vendor)
    groups.set(root, group)
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort((left, right) => left.name.localeCompare(right.name)))
    .sort((left, right) => left[0].name.localeCompare(right[0].name))
}
