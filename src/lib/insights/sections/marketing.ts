import { whenLondonClockReaches } from '@/lib/dateUtils'
import { REPORT_HOUR_LONDON } from '@/lib/manager-report/schedule'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { readCampaignDeliveryStats, type CampaignDeliveryStats } from '@/services/marketing-campaigns'
import { compare, hasMinimumHistory } from '../compare'
import { clip, formatCount, formatDateWithYear, formatDayDate, formatPercent, joinWithAnd, plural } from '../format'
import { COLLECTION_STARTS, MARKETING } from '../thresholds'
import { addDays, dateRange, daysBetween, isInRange, londonDateOf, rangeInstants } from '../windows'
import type {
  DateRange,
  InsightList,
  InsightListItem,
  InsightMetric,
  InsightSignal,
  Rag,
  SectionBuildResult,
  SectionContext,
  SectionDefinition,
} from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md, section 5.3.
//
// Campaign figures come from the same read as the campaign page (`readCampaignDeliveryStats`,
// extracted from `getCampaignStats`), so the report and the page never disagree. Messages are
// counted through each recipient's `email_message_id`, which leaves out test sends and failed
// attempts. Clicks are unique human clickers after scanner filtering, over delivered.
//
// Rates are compared only with campaigns to the same audience (customer or business), because
// a business email is clicked by a third of its readers and a guest email by one or two in a
// hundred. Campaigns still sending or first sent in the last 24 hours are shown as early figures
// and raise no signals. A campaign paused part way (and first sent more than 24 hours ago) has
// partial figures: its bounces and complaints are final for what was sent, so those two checks
// run, but the click, unsubscribe and best-campaign checks do not. Paused campaigns and
// campaigns reaching fewer than 50 people stay out of averages.
//
// Late sends: a campaign first sent on the Thursday after 06:00 is still early when the Friday
// report is built, and by the next Friday it belongs to last week. So each report also checks
// last week's campaigns that were still early at last week's report, named as such, and never
// counts them in this week's figures. Live, 18 Sep 2026: 1 of 12 sends went out then.

type Audience = 'customer' | 'business'
type RateKey = 'clickRate' | 'clickToOpen' | 'openRate' | 'bounceRate' | 'unsubscribeRate'

/** Said of a late send from last week wherever it is named. */
const LATE_SEND_PHRASE = 'too new to check last week'

interface StartedCampaignRow {
  id: string
  name: string
  status: string
  audience_type: string
  scheduled_for: string | null
  started_at: string
}

interface ScheduledCampaignRow {
  id: string
  name: string
  audience_type: string
  scheduled_for: string | null
}

interface CampaignFigures {
  id: string
  name: string
  audience: Audience
  status: string
  startDate: string
  early: boolean
  /** Paused with sends still to go, past the early window: bounce and complaint checks only. */
  pausedPartWay: boolean
  /** In averages and best-campaign claims: finished, and delivered to at least 50 people. */
  counted: boolean
  sent: number
  skipped: number
  delivered: number
  opened: number
  clickers: number
  bounced: number
  complained: number
  unsubscribed: number
  clickRate: number | null
  clickToOpen: number | null
  openRate: number | null
  bounceRate: number | null
  unsubscribeRate: number | null
}

interface Baseline {
  /** "4 weeks", as in "4 weeks 1.4%". */
  label: string
  /** "4-week", as in "the 4-week comparison". */
  adjective: string
  range: DateRange
}

interface NextSend {
  name: string
  audience: Audience
  date: string
}

function audienceOf(value: string): Audience {
  return value === 'customer' ? 'customer' : 'business'
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

function pct(value: number): string {
  return formatPercent(value, 1)
}

function campaignName(name: string): string {
  return clip(name, 60)
}

async function startedCampaigns(ctx: SectionContext, span: DateRange): Promise<StartedCampaignRow[]> {
  const { from, toExclusive } = rangeInstants(span)
  return fetchAllRows<StartedCampaignRow>(
    (start, end) =>
      ctx.db
        .from('marketing_campaigns')
        .select('id, name, status, audience_type, scheduled_for, started_at')
        .gte('started_at', from)
        .lt('started_at', toExclusive)
        .order('id')
        .range(start, end),
    { label: 'insights marketing campaigns' },
  )
}

async function scheduledCampaigns(ctx: SectionContext): Promise<ScheduledCampaignRow[]> {
  return fetchAllRows<ScheduledCampaignRow>(
    (start, end) =>
      ctx.db
        .from('marketing_campaigns')
        .select('id, name, audience_type, scheduled_for')
        .eq('status', 'scheduled')
        .order('id')
        .range(start, end),
    { label: 'insights marketing scheduled campaigns' },
  )
}

function toFigures(ctx: SectionContext, row: StartedCampaignRow, stats: CampaignDeliveryStats): CampaignFigures {
  const hoursSinceStart = (ctx.now.getTime() - Date.parse(row.started_at)) / 3_600_000
  const paused = row.status === 'paused'
  // A paused campaign keeps its pending rows until someone resumes or cancels it, so pending
  // work alone does not make it early: only the 24-hour window does.
  const early = row.status === 'sending'
    || (!paused && stats.pending + stats.sendingNow > 0)
    || hoursSinceStart < MARKETING.earlyFiguresHours
  const pausedPartWay = paused && !early
  const clickers = stats.engagement.uniqueClickers
  return {
    id: row.id,
    name: row.name,
    audience: audienceOf(row.audience_type),
    status: row.status,
    startDate: londonDateOf(row.started_at),
    early,
    pausedPartWay,
    counted: !early && !pausedPartWay && stats.delivered >= MARKETING.minDeliveredForAverages,
    sent: stats.sent,
    skipped: stats.skipped,
    delivered: stats.delivered,
    opened: stats.opened,
    clickers,
    bounced: stats.bounced,
    complained: stats.complained,
    unsubscribed: stats.unsubscribed,
    clickRate: ratio(clickers, stats.delivered),
    clickToOpen: ratio(clickers, stats.opened),
    openRate: ratio(stats.opened, stats.delivered),
    bounceRate: ratio(stats.bounced, stats.sent),
    unsubscribeRate: ratio(stats.unsubscribed, stats.delivered),
  }
}

/**
 * Last week's report was built at the report hour on the first day of this week (Friday 06:00
 * London for the Friday email). A campaign first sent less than 24 hours before that was still
 * early then, so no check ran on it; this is the instant after which that is true. The fixed
 * report hour is used, not this build's clock time, so a retried build (07:00 to 09:00) never
 * skips a campaign sent early on the Thursday. Built on the London clock, so it holds across a
 * clock change.
 */
function lateSendCutoffMs(ctx: SectionContext): number {
  const instant = whenLondonClockReaches(ctx.windows.thisWeek.start, `${String(REPORT_HOUR_LONDON).padStart(2, '0')}:00`)
  if (!instant) throw new Error('Could not place last week\'s report on the clock')
  return instant.getTime() - MARKETING.earlyFiguresHours * 3_600_000
}

/** Earliest scheduled send per audience and overall. */
function nextSends(rows: ScheduledCampaignRow[]): { overall: NextSend | null; byAudience: Map<Audience, NextSend> } {
  const sorted = rows
    .filter((row): row is ScheduledCampaignRow & { scheduled_for: string } => Boolean(row.scheduled_for))
    .sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for) || a.id.localeCompare(b.id))
  const byAudience = new Map<Audience, NextSend>()
  let overall: NextSend | null = null
  for (const row of sorted) {
    const send: NextSend = { name: row.name, audience: audienceOf(row.audience_type), date: londonDateOf(row.scheduled_for) }
    overall ??= send
    if (!byAudience.has(send.audience)) byAudience.set(send.audience, send)
  }
  return { overall, byAudience }
}

export async function buildMarketingSection(ctx: SectionContext): Promise<SectionBuildResult> {
  const w = ctx.windows
  const twoWeeks = dateRange(addDays(w.lastWeek.start, -7), w.lastWeek.end)
  const baselines: Baseline[] = [
    { label: '2 weeks', adjective: '2-week', range: twoWeeks },
    { label: '4 weeks', adjective: '4-week', range: w.previous4Weeks },
    { label: '13 weeks', adjective: '13-week', range: w.previous13Weeks },
  ]
  const thirteenWeeks = baselines[2]

  const [startedRows, scheduledRows] = await Promise.all([
    startedCampaigns(ctx, dateRange(w.previous13Weeks.start, w.thisWeek.end)),
    scheduledCampaigns(ctx),
  ])
  const next = nextSends(scheduledRows)

  const byStart = (a: StartedCampaignRow, b: StartedCampaignRow): number =>
    Date.parse(a.started_at) - Date.parse(b.started_at) || a.id.localeCompare(b.id)
  const thisWeekRows = startedRows.filter((row) => isInRange(londonDateOf(row.started_at), w.thisWeek)).sort(byStart)
  // Last week's late sends: still early when last week's report was built, so checked here.
  const lateCutoffMs = lateSendCutoffMs(ctx)
  const lateRows = startedRows
    .filter((row) => isInRange(londonDateOf(row.started_at), w.lastWeek) && Date.parse(row.started_at) > lateCutoffMs)
    .sort(byStart)

  if (thisWeekRows.length === 0 && lateRows.length === 0) return noCampaignResult(next.overall)

  // Only the audiences sent to this week, or checked late from last week, need a baseline.
  const audiences = new Set([...thisWeekRows, ...lateRows].map((row) => audienceOf(row.audience_type)))
  const rows = startedRows.filter((row) => audiences.has(audienceOf(row.audience_type))).sort(byStart)
  const stats = await readCampaignDeliveryStats(
    ctx.db,
    rows.map((row) => ({ id: row.id, audienceType: audienceOf(row.audience_type), scheduledFor: row.scheduled_for })),
  )
  const figures = rows.map((row) => {
    const read = stats.get(row.id)
    if (!read) throw new Error('Campaign statistics missing from the read')
    return toFigures(ctx, row, read)
  })
  const current = figures.filter((campaign) => isInRange(campaign.startDate, w.thisWeek))
  const lateIds = new Set(lateRows.map((row) => row.id))
  const late = figures.filter((campaign) => lateIds.has(campaign.id))
  const earlier = figures.filter((campaign) => isInRange(campaign.startDate, w.previous13Weeks))

  const historyFor = (baseline: Baseline): boolean => hasMinimumHistory(COLLECTION_STARTS.marketing, baseline.range.start)
  /** Counted campaigns to one audience in the baseline, never the campaign being judged (a late send is in last week). */
  const baselineCampaigns = (audience: Audience, baseline: Baseline, exceptId?: string): CampaignFigures[] =>
    earlier.filter((campaign) => campaign.counted && campaign.audience === audience && campaign.id !== exceptId && isInRange(campaign.startDate, baseline.range))
  /** Mean of the campaigns' rates; null with no history or no counted campaign. */
  const average = (audience: Audience, baseline: Baseline, key: RateKey, exceptId?: string): number | null => {
    if (!historyFor(baseline)) return null
    const values = baselineCampaigns(audience, baseline, exceptId)
      .map((campaign) => campaign[key])
      .filter((value): value is number => value !== null)
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }
  const describeAverages = (campaign: CampaignFigures, key: RateKey): string => {
    const parts = baselines.map((baseline) => {
      if (!historyFor(baseline)) return `${baseline.label} not enough history yet`
      const value = average(campaign.audience, baseline, key, campaign.id)
      return value === null ? `${baseline.label} none to compare` : `${baseline.label} ${pct(value)}`
    })
    return `${campaign.audience === 'customer' ? 'Customer' : 'Business'} average: ${parts.join(', ')}.`
  }

  const signals: InsightSignal[] = []
  const itemRag = new Map<string, Rag>()
  const flag = (campaignId: string, key: RateKey | 'complaints', rag: Rag): void => {
    const id = `${campaignId}:${key}`
    if (rag === 'red' || !itemRag.has(id)) itemRag.set(id, rag)
  }

  /**
   * Every check on one campaign. `peers` are the campaigns judged alongside it for the best
   * click rate. A late send from last week names its day, so nobody takes it for one of this
   * week's campaigns.
   */
  const judge = (campaign: CampaignFigures, peers: CampaignFigures[], lateSend: boolean): void => {
    if (campaign.early) return
    const sentOn = formatDayDate(campaign.startDate)
    const name = lateSend ? `${campaignName(campaign.name)} (sent ${sentOn}, ${LATE_SEND_PHRASE})` : campaignName(campaign.name)
    const actionName = lateSend ? `${campaignName(campaign.name)} (sent ${sentOn})` : name
    const entity = `marketing_campaign:${campaign.id}`
    const href = ctx.link(`/marketing/campaigns/${campaign.id}`)
    const dueDate = next.byAudience.get(campaign.audience)?.date
    const bounceChecked = campaign.bounceRate !== null && campaign.bounced >= MARKETING.bounceMinimumCount
    const bounceRed = bounceChecked && (campaign.bounceRate ?? 0) >= MARKETING.bounceRed
    const bounceAmber = bounceChecked && !bounceRed && (campaign.bounceRate ?? 0) >= MARKETING.bounceAmber
    const bounceFact = `bounce rate ${pct(campaign.bounceRate ?? 0)} (${formatCount(campaign.bounced)} of ${formatCount(campaign.sent)} sent)`

    if (bounceRed) {
      flag(campaign.id, 'bounceRate', 'red')
      signals.push({
        key: `marketing.bounce_high.${campaign.id}`,
        entity,
        rag: 'red',
        kind: 'issue',
        text: `${name}: ${bounceFact}.`,
        emailSafe: true,
        action: {
          text: `Check list quality before the next ${campaign.audience} send: ${actionName} had a ${bounceFact}`,
          href,
          target: 'record',
          ...(dueDate ? { dueDate } : {}),
          impact: 'customer',
        },
      })
    }

    if (bounceAmber || campaign.complained > 0) {
      const facts: string[] = []
      if (bounceAmber) {
        flag(campaign.id, 'bounceRate', 'amber')
        facts.push(bounceFact)
      }
      if (campaign.complained > 0) {
        flag(campaign.id, 'complaints', 'amber')
        facts.push(plural(campaign.complained, 'spam complaint'))
      }
      signals.push({
        key: `marketing.bounce_or_complaint.${campaign.id}`,
        entity,
        rag: 'amber',
        kind: 'issue',
        text: `${name}: ${joinWithAnd(facts)}.`,
        emailSafe: true,
      })
    }

    // Paused part way: clicks and unsubscribes cover only part of the list, so stop here.
    if (campaign.pausedPartWay) return

    const unsubscribeAverage = average(campaign.audience, thirteenWeeks, 'unsubscribeRate', campaign.id)
    if (
      unsubscribeAverage !== null
      && campaign.unsubscribeRate !== null
      && campaign.unsubscribed >= MARKETING.unsubscribeMinimum
      && campaign.unsubscribeRate >= MARKETING.unsubscribeMultiple * unsubscribeAverage
    ) {
      flag(campaign.id, 'unsubscribeRate', 'amber')
      const usual = unsubscribeAverage > 0 ? `against ${pct(unsubscribeAverage)} usually` : 'against none usually'
      signals.push({
        key: `marketing.unsubscribes_high.${campaign.id}`,
        entity,
        rag: 'amber',
        kind: 'issue',
        text: `${name}: ${plural(campaign.unsubscribed, 'unsubscribe')}, ${pct(campaign.unsubscribeRate)} of delivered ${usual} for ${campaign.audience} emails over 13 weeks.`,
        emailSafe: true,
        action: {
          text: `Review frequency and content: ${actionName} lost ${plural(campaign.unsubscribed, 'subscriber')}, at least twice the usual rate`,
          href,
          target: 'record',
          ...(dueDate ? { dueDate } : {}),
          impact: 'customer',
        },
      })
    }

    const clickAverage = average(campaign.audience, thirteenWeeks, 'clickRate', campaign.id)
    if (clickAverage !== null && campaign.clickRate !== null) {
      const vsAverage = compare(campaign.clickRate, clickAverage, 0, MARKETING.clickBelowRatio)
      const shortfall = clickAverage * campaign.delivered - campaign.clickers
      if (vsAverage.kind === 'down' && shortfall >= MARKETING.clickBelowMinimumClickers) {
        flag(campaign.id, 'clickRate', 'amber')
        signals.push({
          key: `marketing.clicks_low.${campaign.id}`,
          entity,
          rag: 'amber',
          kind: 'issue',
          text: `${name}: click rate ${pct(campaign.clickRate)} against a 13-week ${campaign.audience} average of ${pct(clickAverage)}.`,
          emailSafe: true,
        })
      }
    }

    // Best click rate: counted campaigns only, with a 13-week baseline of at least 3 campaigns.
    const bestBaseline = historyFor(thirteenWeeks) ? baselineCampaigns(campaign.audience, thirteenWeeks, campaign.id) : []
    const rivals = [
      ...bestBaseline,
      ...peers.filter((other) => other.id !== campaign.id && other.counted && other.audience === campaign.audience),
    ]
    if (
      campaign.counted
      && campaign.clickRate !== null
      && campaign.clickRate > 0
      && bestBaseline.length >= MARKETING.bestMinimumBaseline
      && rivals.every((other) => (other.clickRate ?? 0) < (campaign.clickRate ?? 0))
    ) {
      signals.push({
        key: `marketing.best_clicks.${campaign.id}`,
        entity,
        rag: 'green',
        kind: 'win',
        text: `${name} had the best click rate of any ${campaign.audience} email in 13 weeks: ${pct(campaign.clickRate)}.`,
        emailSafe: true,
      })
    }
  }

  for (const campaign of current) judge(campaign, current, false)
  for (const campaign of late) judge(campaign, late, true)

  const lists: InsightList[] = [
    ...current.map((campaign) => campaignList(ctx, campaign, describeAverages, itemRag, false)),
    ...late.map((campaign) => campaignList(ctx, campaign, describeAverages, itemRag, true)),
  ]
  // This week's figures are this week's campaigns only; a late send is in its list and signals.
  const metrics = current.length === 0 ? noCampaignMetrics(next.overall) : buildMetrics(current, next.overall, (campaign) => {
    if (campaign.early) return 'early figures'
    if (campaign.pausedPartWay) return 'paused part way'
    if (!historyFor(baselines[1])) return 'not enough history yet'
    const value = average(campaign.audience, baselines[1], 'clickRate')
    return value === null ? `no earlier ${campaign.audience} campaigns to compare` : `4-week ${campaign.audience} average ${pct(value)}`
  })
  const headline = current.length === 0
    ? noCampaignHeadline(next.overall)
    : headlineFor(current, (campaign) => average(campaign.audience, baselines[1], 'clickRate'))

  return {
    headline: `${headline}${lateHeadline(late)}`,
    metrics,
    lists,
    signals,
    notes: [...lateNotes(late), ...notesFor([...current, ...late], baselines, w.today)],
  }
}

function noCampaignHeadline(next: NextSend | null): string {
  return next
    ? `No campaigns this week. Next: ${campaignName(next.name)}, ${formatDayDate(next.date)}.`
    : 'No campaigns this week and none scheduled.'
}

function noCampaignMetrics(next: NextSend | null): InsightMetric[] {
  return [
    { label: 'Campaigns this week', value: '0' },
    nextMetric(next),
    { label: 'Bookings from email', value: 'Not measurable yet' },
  ]
}

function noCampaignResult(next: NextSend | null): SectionBuildResult {
  return {
    headline: noCampaignHeadline(next),
    metrics: noCampaignMetrics(next),
    lists: [],
    signals: [],
    notes: [],
  }
}

function lateHeadline(late: CampaignFigures[]): string {
  if (late.length === 0) return ''
  if (late.length === 1) {
    return ` Also checked: ${campaignName(late[0].name)}, first sent ${formatDayDate(late[0].startDate)}, ${LATE_SEND_PHRASE}.`
  }
  return ` Also checked: ${plural(late.length, 'campaign')} first sent late last week, too new to check then.`
}

function lateNotes(late: CampaignFigures[]): string[] {
  if (late.length === 0) return []
  const hours = plural(MARKETING.earlyFiguresHours, 'hour')
  if (late.length === 1) {
    return [`${campaignName(late[0].name)} was first sent on ${formatDayDate(late[0].startDate)}, less than ${hours} before last week's report, so it is checked in this one. It is not counted in this week's figures.`]
  }
  return [`${plural(late.length, 'campaign')} were first sent less than ${hours} before last week's report, so they are checked in this one. They are not counted in this week's figures.`]
}

function nextMetric(next: NextSend | null): InsightMetric {
  return next
    ? { label: 'Next campaign', value: campaignName(next.name), comparison: `${formatDayDate(next.date)}, ${next.audience} email` }
    : { label: 'Next campaign', value: 'None scheduled' }
}

function headlineFor(current: CampaignFigures[], fourWeekClickAverage: (campaign: CampaignFigures) => number | null): string {
  if (current.length === 1) {
    const [campaign] = current
    const name = campaignName(campaign.name)
    if (campaign.early) return `${name} (early figures): ${formatCount(campaign.delivered)} delivered so far.`
    if (campaign.pausedPartWay) return `${name} (paused part way): ${formatCount(campaign.delivered)} delivered so far.`
    if (campaign.clickRate === null) return `${name}: not delivered to anyone.`
    const average = fourWeekClickAverage(campaign)
    const usual = average === null ? '' : ` (4-week ${campaign.audience} average ${pct(average)})`
    return `${name}: ${formatCount(campaign.delivered)} delivered, click rate ${pct(campaign.clickRate)}${usual}.`
  }
  const delivered = current.reduce((sum, campaign) => sum + campaign.delivered, 0)
  const early = current.filter((campaign) => campaign.early).length
  const paused = current.filter((campaign) => campaign.pausedPartWay).length
  const states = [
    early === 0 ? null : early === current.length ? 'early figures' : `${formatCount(early)} with early figures`,
    paused === 0 ? null : paused === current.length ? 'paused part way' : `${formatCount(paused)} paused part way`,
  ].filter((part): part is string => part !== null)
  const stateText = states.length === 0 ? '' : ` (${states.join(', ')})`
  return `${plural(current.length, 'campaign')} this week${stateText}, ${formatCount(delivered)} delivered.`
}

function buildMetrics(
  current: CampaignFigures[],
  next: NextSend | null,
  clickComparison: (campaign: CampaignFigures) => string,
): InsightMetric[] {
  const sum = (pick: (campaign: CampaignFigures) => number): number => current.reduce((total, campaign) => total + pick(campaign), 0)
  const sent = sum((campaign) => campaign.sent)
  const delivered = sum((campaign) => campaign.delivered)
  const unsubscribed = sum((campaign) => campaign.unsubscribed)
  const bounced = sum((campaign) => campaign.bounced)
  const customer = current.filter((campaign) => campaign.audience === 'customer').length
  const split = [
    customer > 0 ? `${formatCount(customer)} customer` : null,
    current.length - customer > 0 ? `${formatCount(current.length - customer)} business` : null,
  ].filter((part): part is string => part !== null)

  const metrics: InsightMetric[] = [
    { label: 'Campaigns this week', value: formatCount(current.length), comparison: split.join(', ') },
    { label: 'Delivered', value: formatCount(delivered), comparison: `of ${formatCount(sent)} sent` },
  ]
  for (const campaign of current) {
    metrics.push({
      label: `Click rate, ${campaignName(campaign.name)}`,
      value: campaign.clickRate === null ? 'None delivered' : pct(campaign.clickRate),
      comparison: clickComparison(campaign),
    })
  }
  const unsubscribeRate = ratio(unsubscribed, delivered)
  const bounceRate = ratio(bounced, sent)
  metrics.push(
    { label: 'Unsubscribes', value: formatCount(unsubscribed), ...(unsubscribeRate === null ? {} : { comparison: `${pct(unsubscribeRate)} of delivered` }) },
    { label: 'Bounces', value: formatCount(bounced), ...(bounceRate === null ? {} : { comparison: `${pct(bounceRate)} of sent` }) },
    { label: 'Complaints', value: formatCount(sum((campaign) => campaign.complained)) },
    { label: 'Bookings from email', value: 'Not measurable yet' },
    nextMetric(next),
  )
  return metrics
}

function campaignList(
  ctx: SectionContext,
  campaign: CampaignFigures,
  describeAverages: (campaign: CampaignFigures, key: RateKey) => string,
  itemRag: Map<string, Rag>,
  lateSend: boolean,
): InsightList {
  const href = ctx.link(`/marketing/campaigns/${campaign.id}`)
  const item = (text: string, key?: RateKey | 'complaints'): InsightListItem => {
    const rag = key ? itemRag.get(`${campaign.id}:${key}`) : undefined
    return { text, href, ...(rag ? { rag } : {}) }
  }
  // Early figures get no averages. Paused part way, only the bounce rate is final enough to compare.
  const compared = (text: string, key: RateKey): string =>
    campaign.early || (campaign.pausedPartWay && key !== 'bounceRate') ? text : `${text} ${describeAverages(campaign, key)}`
  const soFar = campaign.early || campaign.pausedPartWay ? ' so far' : ''
  const skipped = campaign.skipped > 0 ? `; ${formatCount(campaign.skipped)} skipped` : ''
  const items: InsightListItem[] = [item(`Delivered ${formatCount(campaign.delivered)} of ${formatCount(campaign.sent)} sent${soFar}${skipped}.`)]

  if (campaign.delivered === 0) {
    items.push(item('Not delivered to anyone, so there are no rates.'))
  } else {
    items.push(
      item(compared(`Click rate ${pct(campaign.clickRate ?? 0)} (${plural(campaign.clickers, 'person', 'people')} clicked).`, 'clickRate'), 'clickRate'),
      item(campaign.clickToOpen === null
        ? 'Click-to-open: nobody opened it.'
        : compared(`Click-to-open ${pct(campaign.clickToOpen)}.`, 'clickToOpen'), 'clickToOpen'),
      item(compared(`Open rate ${pct(campaign.openRate ?? 0)} (indicative only).`, 'openRate'), 'openRate'),
      item(compared(`Unsubscribes ${formatCount(campaign.unsubscribed)}, ${pct(campaign.unsubscribeRate ?? 0)} of delivered.`, 'unsubscribeRate'), 'unsubscribeRate'),
    )
  }
  if (campaign.sent > 0) {
    items.push(item(compared(`Bounce rate ${pct(campaign.bounceRate ?? 0)} (${formatCount(campaign.bounced)} of ${formatCount(campaign.sent)} sent).`, 'bounceRate'), 'bounceRate'))
  }
  items.push(item(`${campaign.complained === 0 ? 'No' : formatCount(campaign.complained)} spam ${campaign.complained === 1 ? 'complaint' : 'complaints'}.`, 'complaints'))
  if (campaign.pausedPartWay) {
    items.push(item('Paused part way, so only the bounce and complaint checks are run, and it is kept out of averages and best-campaign claims.'))
  } else if (!campaign.early && !campaign.counted) {
    items.push(item(`Reached fewer than ${formatCount(MARKETING.minDeliveredForAverages)} people, so it is kept out of averages and best-campaign claims.`))
  }

  const state = campaign.early
    ? ', early figures'
    : campaign.pausedPartWay ? ', paused part way'
      : campaign.status === 'cancelled' ? ', cancelled part way' : ''
  const late = lateSend ? `, ${LATE_SEND_PHRASE}` : ''
  return {
    title: `${campaignName(campaign.name)} (${campaign.audience} email, first sent ${formatDayDate(campaign.startDate)}${late}${state})`,
    items,
  }
}

function notesFor(current: CampaignFigures[], baselines: Baseline[], today: string): string[] {
  const notes: string[] = []
  const early = current.filter((campaign) => campaign.early).length
  if (early > 0) {
    notes.push(`Early figures for ${plural(early, 'campaign')}: still sending or first sent in the last 24 hours, so no checks are run on ${early === 1 ? 'it' : 'them'} yet.`)
  }
  const paused = current.filter((campaign) => campaign.pausedPartWay).length
  if (paused > 0) {
    notes.push(`${plural(paused, 'campaign')} paused part way: only the bounce and complaint checks are run on ${paused === 1 ? 'it' : 'them'}, and ${paused === 1 ? 'it is' : 'they are'} kept out of averages and best-campaign claims.`)
  }
  const small = current.filter((campaign) => !campaign.early && !campaign.pausedPartWay && !campaign.counted).length
  if (small > 0) {
    notes.push(`${plural(small, 'campaign')} reached fewer than ${formatCount(MARKETING.minDeliveredForAverages)} people, so ${small === 1 ? 'it is' : 'they are'} kept out of averages and best-campaign claims.`)
  }
  // The history note is about the average-based checks, which only fully checked campaigns get.
  if (current.some((campaign) => !campaign.early && !campaign.pausedPartWay)) {
    const missing = baselines.filter((baseline) => !hasMinimumHistory(COLLECTION_STARTS.marketing, baseline.range.start))
    if (missing.length > 0) {
      const longest = missing[missing.length - 1]
      const startsOn = addDays(COLLECTION_STARTS.marketing, daysBetween(longest.range.start, today))
      const which = joinWithAnd(missing.map((baseline) => baseline.adjective))
      notes.push(`Marketing emails began on ${formatDateWithYear(COLLECTION_STARTS.marketing)}, so there is not enough history yet for the ${which} comparison${missing.length === 1 ? '' : 's'}. The unsubscribe, click-rate and best-campaign checks start on ${formatDateWithYear(startsOn)}.`)
    }
  }
  return notes
}

export const marketingSection: SectionDefinition = {
  key: 'marketing',
  title: 'Marketing emails',
  path: '/marketing',
  build: buildMarketingSection,
}
