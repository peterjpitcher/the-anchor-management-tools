import { resolveShortLinkName } from '@/lib/short-links/names'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { compare, describeChange, hasMinimumHistory, trend, weeklyAverage, type Comparison, type TrendKind } from '../compare'
import { clip, formatCount, formatPercent, plural } from '../format'
import { FLOORS, SHORT_LINKS } from '../thresholds'
import { dateRange, isInRange, londonDateOf, rangeInstants } from '../windows'
import type {
  InsightList,
  InsightMetric,
  InsightSignal,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

/**
 * Short links (spec 5.14). Human clicks on marketing links: this week against the 4-week
 * and 13-week averages, the top links this week and over 13 weeks, and which links are
 * gaining or losing.
 *
 * - Bot clicks are left out, as on the short links page (`device_type` 'bot'; clicks with no
 *   device type count as human, matching `get_all_links_analytics_v2`).
 * - Links that are not marketing are left out by the SHORT_LINKS exclusion lists: marketing
 *   email links (reported under Marketing emails), guest and booking links, texts shortened
 *   automatically and review links. Each clicked link is judged on its own record.
 * - Variants roll up to their campaign: the parent chain is followed to its root (live paid
 *   media links sit two levels down), so every click on an ad, QR code or channel variant
 *   counts once, under the campaign's name.
 *
 * Reads: one paged read of the clicks in the 14 weeks the comparisons need (three columns),
 * then the clicked links and their ancestors by id. No click detail (IP, device, place) is
 * read. Link names are marketing names, so every sentence is email safe. The signals carry
 * no manager action: a fall in clicks is worth watching, not a job to do.
 */

interface ClickRow {
  id: string
  short_link_id: string | null
  clicked_at: string | null
}

interface LinkRow {
  id: string
  short_code: string
  parent_link_id: string | null
  link_type: string
  name: string | null
  destination_url: string
  metadata: unknown
}

interface Counts {
  thisWeek: number
  lastWeek: number
  previous4: number
  previous13: number
  last91: number
}

interface LinkGroup extends Counts {
  /** Root link id, or the id of a parent that could not be read. */
  id: string
  name: string
  code: string
  /** The name, with the short code added when two campaigns share a name. */
  label: string
}

const CLICK_COLUMNS = 'id, short_link_id, clicked_at'
const LINK_COLUMNS = 'id, short_code, parent_link_id, link_type, name, destination_url, metadata'
// Variant names join the campaign and channel with a long dash; report text never carries one.
const LONG_DASH = new RegExp(`\\s*${String.fromCharCode(0x2014)}\\s*`, 'g')

function emptyCounts(): Counts {
  return { thisWeek: 0, lastWeek: 0, previous4: 0, previous13: 0, last91: 0 }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)))
}

function metadataOf(link: LinkRow): Record<string, unknown> {
  const value = link.metadata
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** True for a link that is not marketing: see the SHORT_LINKS exclusion lists. */
function isExcluded(link: LinkRow): boolean {
  if ((SHORT_LINKS.excludedLinkTypes as readonly string[]).includes(link.link_type)) return true
  const metadata = metadataOf(link)
  // Presence is enough: a guest link can carry a key with a null value (for example no customer).
  if (SHORT_LINKS.excludedMetadataKeys.some((key) => Object.prototype.hasOwnProperty.call(metadata, key))) return true
  for (const [key, values] of Object.entries(SHORT_LINKS.excludedMetadataValues)) {
    const value = metadata[key]
    if (typeof value === 'string' && (values as readonly string[]).includes(value)) return true
  }
  const host = hostOf(link.destination_url)
  return host !== null && (SHORT_LINKS.excludedDestinationHosts as readonly string[]).includes(host)
}

async function readLinks(ctx: SectionContext, ids: string[]): Promise<LinkRow[]> {
  const chunks: string[][] = []
  for (let start = 0; start < ids.length; start += SHORT_LINKS.linkLookupChunk) {
    chunks.push(ids.slice(start, start + SHORT_LINKS.linkLookupChunk))
  }
  const results = await Promise.all(chunks.map((chunk) => fetchAllRows<LinkRow>(
    (from, to) => ctx.db
      .from('short_links')
      .select(LINK_COLUMNS)
      .in('id', chunk)
      .order('id')
      .range(from, to),
    { label: 'insights short links' },
  )))
  return results.flat()
}

/** The clicked links plus every ancestor up their parent chains, read a level at a time. */
async function readLinksWithAncestors(ctx: SectionContext, ids: string[]): Promise<Map<string, LinkRow>> {
  const links = new Map<string, LinkRow>()
  const requested = new Set<string>()
  let pending = ids
  for (let level = 0; pending.length > 0 && level <= SHORT_LINKS.maxParentDepth; level += 1) {
    for (const id of pending) requested.add(id)
    for (const row of await readLinks(ctx, pending)) links.set(row.id, row)
    pending = unique(pending.map((id) => links.get(id)?.parent_link_id)).filter((id) => !requested.has(id))
  }
  return links
}

/** The campaign a link belongs to: the top of its parent chain. */
function rootOf(link: LinkRow, links: Map<string, LinkRow>): { key: string; row: LinkRow } {
  let current = link
  const seen = new Set<string>([link.id])
  for (let depth = 0; depth < SHORT_LINKS.maxParentDepth; depth += 1) {
    const parentId = current.parent_link_id
    if (!parentId || seen.has(parentId)) break
    const parent = links.get(parentId)
    // A parent that could not be read still keeps its variants together.
    if (!parent) return { key: parentId, row: current }
    seen.add(parentId)
    current = parent
  }
  return { key: current.id, row: current }
}

function displayName(row: LinkRow): string {
  return clip(resolveShortLinkName(row.name, row.destination_url).replace(LONG_DASH, ', '), SHORT_LINKS.nameChars)
}

/** Weekly averages: whole numbers from 10 up, one decimal place below ("0.3", "12", "197"). */
function average(value: number): string {
  return formatCount(value >= 10 ? Math.round(value) : value)
}

/** "up 24% on the 4-week average of 197 a week", "new activity (none in the previous 4 weeks)". */
function againstFourWeeks(comparison: Comparison): string {
  const label = comparison.kind === 'up' || comparison.kind === 'down' || comparison.kind === 'steady'
    ? `the 4-week average of ${average(comparison.baseline ?? 0)} a week`
    : comparison.kind === 'no_history' ? 'the 4-week average' : 'the previous 4 weeks'
  return describeChange(comparison, label)
}

function trendWord(kind: TrendKind): string {
  switch (kind) {
    case 'growing': return 'Growing'
    case 'declining': return 'Declining'
    case 'steady': return 'Steady'
    case 'no_history': return 'Not enough history yet'
  }
}

export async function buildShortLinksSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const w = ctx.windows
  const insightsHref = ctx.link('/short-links/insights')
  // Every window this section compares lies inside the 13 weeks before this week plus this week.
  const period = dateRange(w.previous13Weeks.start, w.yesterday)
  const { from: since, toExclusive: until } = rangeInstants(period)

  const clicks = await fetchAllRows<ClickRow>(
    (from, to) => ctx.db
      .from('short_link_clicks')
      .select(CLICK_COLUMNS)
      .gte('clicked_at', since)
      .lt('clicked_at', until)
      .or('device_type.is.null,device_type.neq.bot')
      .order('id')
      .range(from, to),
    { label: 'insights short link clicks' },
  )
  const links = await readLinksWithAncestors(ctx, unique(clicks.map((click) => click.short_link_id)))

  const groups = new Map<string, LinkGroup>()
  let unmatched = 0
  for (const click of clicks) {
    const link = click.short_link_id ? links.get(click.short_link_id) : undefined
    if (!link || !click.clicked_at) {
      unmatched += 1
      continue
    }
    if (isExcluded(link)) continue
    const root = rootOf(link, links)
    let group = groups.get(root.key)
    if (!group) {
      const name = displayName(root.row)
      group = { id: root.key, name, code: root.row.short_code, label: name, ...emptyCounts() }
      groups.set(root.key, group)
    }
    const date = londonDateOf(click.clicked_at)
    if (isInRange(date, w.thisWeek)) group.thisWeek += 1
    if (isInRange(date, w.lastWeek)) group.lastWeek += 1
    if (isInRange(date, w.previous4Weeks)) group.previous4 += 1
    if (isInRange(date, w.previous13Weeks)) group.previous13 += 1
    if (isInRange(date, w.last91)) group.last91 += 1
  }

  // Recurring events often reuse a name, so a shared name gets its short code.
  const nameCounts = new Map<string, number>()
  for (const group of groups.values()) {
    const key = group.name.toLowerCase()
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  for (const group of groups.values()) {
    if ((nameCounts.get(group.name.toLowerCase()) ?? 0) > 1 && group.code) group.label = `${group.name} (${group.code})`
  }

  const all = Array.from(groups.values())
  const total = all.reduce<Counts>((sum, group) => ({
    thisWeek: sum.thisWeek + group.thisWeek,
    lastWeek: sum.lastWeek + group.lastWeek,
    previous4: sum.previous4 + group.previous4,
    previous13: sum.previous13 + group.previous13,
    last91: sum.last91 + group.last91,
  }), emptyCounts())

  const scopeNote = 'Human clicks on marketing links only, grouped by campaign; email campaign, guest, booking, text and review links are left out.'
  const unmatchedNote = unmatched > 0
    ? `${plural(unmatched, 'click')} could not be matched to a link and ${unmatched === 1 ? 'is' : 'are'} left out.`
    : null

  if (total.last91 === 0) {
    return {
      headline: 'No human clicks on marketing short links in the last 13 weeks.',
      metrics: [],
      lists: [],
      signals: [],
      notes: [scopeNote, ...(unmatchedNote ? [unmatchedNote] : [])],
    }
  }

  const hasLastWeek = hasMinimumHistory(SHORT_LINKS.collectionStart, w.lastWeek.start)
  const has4 = hasMinimumHistory(SHORT_LINKS.collectionStart, w.previous4Weeks.start)
  const has13 = hasMinimumHistory(SHORT_LINKS.collectionStart, w.previous13Weeks.start)
  const average4 = has4 ? weeklyAverage(total.previous4, w.previous4Weeks) : null
  const average13 = has13 ? weeklyAverage(total.previous13, w.previous13Weeks) : null
  const vsFourWeeks = compare(total.thisWeek, average4, FLOORS.linkClicks)
  const totalDrop = compare(total.thisWeek, average4, FLOORS.linkClicks, SHORT_LINKS.totalDropAmber)
  const trendKind = trend(average4, average13, FLOORS.linkClicks)
  const ownAverage = (group: LinkGroup): number | null => (has4 ? weeklyAverage(group.previous4, w.previous4Weeks) : null)
  const shareOf = (group: LinkGroup): number => (total.thisWeek > 0 ? group.thisWeek / total.thisWeek : 0)

  const byThisWeek = (a: LinkGroup, b: LinkGroup): number =>
    b.thisWeek - a.thisWeek || b.last91 - a.last91 || compareText(a.label, b.label) || compareText(a.id, b.id)
  const byLastWeek = (a: LinkGroup, b: LinkGroup): number =>
    b.lastWeek - a.lastWeek || b.last91 - a.last91 || compareText(a.label, b.label) || compareText(a.id, b.id)
  const by13Weeks = (a: LinkGroup, b: LinkGroup): number =>
    b.last91 - a.last91 || b.thisWeek - a.thisWeek || compareText(a.label, b.label) || compareText(a.id, b.id)

  const clickedThisWeek = all.filter((group) => group.thisWeek > 0).sort(byThisWeek)
  const topThisWeek = clickedThisWeek.slice(0, SHORT_LINKS.topShown)
  const topLastWeek = all.filter((group) => group.lastWeek > 0).sort(byLastWeek).slice(0, SHORT_LINKS.topShown)
  const top13Weeks = all.filter((group) => group.last91 > 0).sort(by13Weeks).slice(0, SHORT_LINKS.top13WeeksShown)

  const signals: InsightSignal[] = []

  // Amber: total human clicks down 40% or more on the 4-week average (and by at least the floor).
  if (totalDrop.kind === 'down' && average4 !== null) {
    signals.push({
      key: 'short_links.total_drop',
      rag: 'amber',
      kind: 'issue',
      text: `Human clicks on short links fell to ${formatCount(total.thisWeek)} this week, ${againstFourWeeks(totalDrop)}.`,
      emailSafe: true,
    })
  }

  // Amber: a link in last week's top 5 down 50% or more on last week (and by at least the floor).
  const losing = new Set<string>()
  if (hasLastWeek) {
    for (const group of topLastWeek) {
      const change = compare(group.thisWeek, group.lastWeek, FLOORS.linkClicks, SHORT_LINKS.topLosingRatio)
      if (change.kind !== 'down') continue
      losing.add(group.id)
      signals.push({
        key: `short_links.top_losing.${group.id}`,
        entity: `short_link:${group.id}`,
        rag: 'amber',
        kind: 'issue',
        text: group.thisWeek === 0
          ? `${group.label} had no human clicks this week after ${formatCount(group.lastWeek)} last week.`
          : `${group.label} fell to ${plural(group.thisWeek, 'human click')} this week from ${formatCount(group.lastWeek)} last week, down ${formatPercent(Math.abs(change.change ?? 0))}.`,
        emailSafe: true,
      })
    }
  }

  // Win: a link with 30% or more of this week's clicks, or gaining 50% or more on its own
  // 4-week average. Both need at least the floor of clicks, so a quiet week cannot crown a
  // link with a handful. A link already raised as falling against last week is no win at all:
  // a big share of the week does not make a 70% fall good news, and a win beside it could
  // become the summary's biggest win. Its share still shows on its (amber) list row.
  const winners = new Set<string>()
  for (const group of clickedThisWeek) {
    if (group.thisWeek < FLOORS.linkClicks) break
    if (losing.has(group.id)) continue
    const share = shareOf(group)
    const own = ownAverage(group)
    const gain = compare(group.thisWeek, own, FLOORS.linkClicks, SHORT_LINKS.gainingRatio)
    const shareWin = share >= SHORT_LINKS.shareWin
    const gainWin = gain.kind === 'up' || (gain.kind === 'new' && gain.notable)
    if (!shareWin && !gainWin) continue
    winners.add(group.id)
    const lead = shareWin
      ? `${group.label} drew ${formatPercent(share)} of human clicks this week (${formatCount(group.thisWeek)} of ${formatCount(total.thisWeek)})`
      : `${group.label} drew ${plural(group.thisWeek, 'human click')} this week`
    const text = !gainWin
      ? `${lead}.`
      : gain.kind === 'new'
        ? `${lead}, after none in the previous 4 weeks.`
        : `${lead}, up from ${average(own ?? 0)} a week over the previous 4 weeks.`
    signals.push({
      key: `short_links.win.${group.id}`,
      entity: `short_link:${group.id}`,
      rag: 'green',
      kind: 'win',
      text,
      emailSafe: true,
    })
  }

  /** ", gaining on its 4-week average of 12 a week", ", new this week", ", 4-week average 25 a week". */
  const movement = (group: LinkGroup): string => {
    const own = ownAverage(group)
    if (own === null) return ''
    const change = compare(group.thisWeek, own, FLOORS.linkClicks)
    if (change.kind === 'new') return ', new this week'
    if (change.kind === 'up') return `, gaining on its 4-week average of ${average(own)} a week`
    if (change.kind === 'down') return `, losing against its 4-week average of ${average(own)} a week`
    return `, 4-week average ${average(own)} a week`
  }

  const lists: InsightList[] = [
    {
      title: 'Top links this week',
      items: topThisWeek.map((group) => ({
        text: `${group.label}: ${plural(group.thisWeek, 'click')}, ${formatPercent(shareOf(group))} of the total${movement(group)}`,
        href: insightsHref,
        rag: losing.has(group.id) ? 'amber' : winners.has(group.id) ? 'green' : undefined,
      })),
      emptyText: 'No human clicks this week.',
    },
    {
      title: 'Top links over the last 13 weeks',
      items: top13Weeks.map((group) => ({
        text: `${group.label}: ${plural(group.last91, 'click')}, ${formatPercent(group.last91 / total.last91)} of the 13-week total`,
        href: insightsHref,
      })),
    },
  ]

  const againstAverages = [againstFourWeeks(vsFourWeeks)]
  if (average13 !== null) againstAverages.push(`13-week average ${average(average13)} a week`)
  const top = topThisWeek[0]
  const metrics: InsightMetric[] = [
    { label: 'Human clicks this week', value: formatCount(total.thisWeek), comparison: againstAverages.join('; ') },
  ]
  if (top) {
    metrics.push({
      label: 'Top link this week',
      value: top.label,
      comparison: `${plural(top.thisWeek, 'click')}, ${formatPercent(shareOf(top))} of the total`,
    })
  }
  metrics.push(
    {
      label: 'Trend over 13 weeks',
      value: trendWord(trendKind),
      comparison: average4 !== null && average13 !== null
        ? `${average(average4)} a week over the last 4 weeks against ${average(average13)} a week over 13 weeks`
        : undefined,
    },
    {
      label: 'Links clicked this week',
      value: formatCount(clickedThisWeek.length),
      comparison: hasLastWeek ? `${formatCount(all.filter((group) => group.lastWeek > 0).length)} last week` : undefined,
    },
    { label: 'Human clicks, last 13 weeks', value: formatCount(total.last91) },
  )

  const notes: string[] = []
  if (!has4) notes.push('Not enough short link history yet to compare with the 4-week average.')
  else if (!has13) notes.push('Not enough short link history yet for the 13-week average or trend.')
  notes.push(scopeNote)
  if (unmatchedNote) notes.push(unmatchedNote)

  const headline = !top
    ? average4 !== null && average4 > 0
      ? `No human clicks on short links this week, against a 4-week average of ${average(average4)} a week.`
      : 'No human clicks on short links this week.'
    : `${plural(total.thisWeek, 'human click')} on short links this week, ${againstFourWeeks(vsFourWeeks)}. Top link: ${top.label} with ${formatPercent(shareOf(top))}.`

  return { headline, metrics, lists, signals, notes }
}

export const shortLinksSection: SectionDefinition = {
  key: 'short_links',
  title: 'Short links',
  path: '/short-links/insights',
  build: buildShortLinksSection,
}
