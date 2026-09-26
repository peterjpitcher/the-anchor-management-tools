import type { ReceiptTransaction } from '@/types/database'

/**
 * How receipt states look on staff screens. Pure module, safe to import from server and client
 * components. Every receipts screen reads its tones from here, never from an inline choice.
 */

type ReceiptBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export const RECEIPT_STATUS_LABEL: Record<ReceiptTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
  cant_find: "Can't find",
}

/** One map for the workspace table, the phone cards and the vendor history. */
export const RECEIPT_STATUS_TONE: Record<ReceiptTransaction['status'], ReceiptBadgeTone> = {
  pending: 'warning',
  completed: 'success',
  auto_completed: 'info',
  no_receipt_required: 'neutral',
  cant_find: 'danger',
}

/** Money in is green and money out is red wherever a list tags amounts by direction. */
export const RECEIPT_FLOW_TONE: Record<'income' | 'spend', 'success' | 'danger'> = {
  income: 'success',
  spend: 'danger',
}

/**
 * The same rule as a chart series colour (a DS chart takes a colour, not a class), for the monthly
 * income and spending bars.
 */
export const RECEIPT_FLOW_CHART_COLOUR: Record<'income' | 'spend', string> = {
  income: 'var(--color-success)',
  spend: 'var(--color-danger)',
}

/** The same rule for an amount shown as text, such as a "Total out" or "Total in" column. */
export const RECEIPT_FLOW_TEXT_CLASS: Record<'income' | 'spend', string> = {
  income: 'text-success-fg',
  spend: 'text-danger-fg',
}

/** A signed amount where more is better (net cash): below zero is red, zero and above green. */
export function netAmountTextClass(amount: number): string {
  return amount >= 0 ? 'text-success-fg' : 'text-danger-fg'
}

/** The same rule as a Stat tone, for a net cash figure. */
export function netAmountTone(amount: number): 'success' | 'danger' {
  return amount >= 0 ? 'success' : 'danger'
}

/**
 * Share of a month's transactions that rules or "no receipt needed" closed without a person:
 * 80% or more is healthy, below 60% needs attention, in between is unremarkable.
 */
export function automationCoverageTone(coverage: number): 'success' | 'default' | 'danger' {
  if (coverage >= 0.8) return 'success'
  if (coverage >= 0.6) return 'default'
  return 'danger'
}

/** The monthly overview's "what changed" feed: a saving, a cost rising, or something to watch. */
export type ReceiptInsightKind = 'positive' | 'negative' | 'neutral'

export const RECEIPT_INSIGHT_TONE: Record<ReceiptInsightKind, 'success' | 'danger' | 'neutral'> = {
  positive: 'success',
  negative: 'danger',
  neutral: 'neutral',
}

export const RECEIPT_INSIGHT_LABEL: Record<ReceiptInsightKind, string> = {
  positive: 'Opportunity',
  negative: 'Alert',
  neutral: 'Watchlist',
}

/** Where a transaction came from: a bank statement or the Amex card. */
export const RECEIPT_SOURCE_TONE: Record<'bank' | 'amex', 'neutral' | 'info'> = {
  bank: 'neutral',
  amex: 'info',
}

export const RECEIPT_SOURCE_LABEL: Record<'bank' | 'amex', string> = {
  bank: 'Bank',
  amex: 'Amex',
}

/**
 * Who filled in a vendor or expense type. AI suggestions share the info tone with the sparkle
 * icon beside them; a rule is an automation the team set up, so it takes the primary tone. A
 * manual entry shows no badge.
 */
export const RECEIPT_CLASSIFICATION_SOURCE_TONE: Partial<Record<string, 'info' | 'primary'>> = {
  ai: 'info',
  rule: 'primary',
}

export const RECEIPT_CLASSIFICATION_SOURCE_LABEL: Partial<Record<string, string>> = {
  ai: 'AI',
  rule: 'Rule',
}

/** An automation rule is either matching new transactions or switched off. */
export const RECEIPT_RULE_STATE_TONE: Record<'active' | 'disabled', 'success' | 'neutral'> = {
  active: 'success',
  disabled: 'neutral',
}

type VendorSignalLike = { severity: 'medium' | 'high'; direction: 'spike' | 'drop' | 'new' | 'resumed' }

/** A vendor cost signal: anything high priority is red, a drop is good news, the rest need a look. */
export function vendorSignalTone(signal: VendorSignalLike): 'danger' | 'success' | 'warning' {
  if (signal.severity === 'high') return 'danger'
  if (signal.direction === 'drop') return 'success'
  return 'warning'
}

/** Spend moving up is bad news (red) and down is good (green); no change is muted. */
export function spendMovementTextClass(delta: number): string {
  if (delta > 0) return 'text-danger-fg'
  if (delta < 0) return 'text-success-fg'
  return 'text-text-muted'
}

/** The same rule as a Stat tone, for a figure that is a change in spend. */
export function spendMovementTone(delta: number): 'danger' | 'success' | 'default' {
  if (delta > 0) return 'danger'
  if (delta < 0) return 'success'
  return 'default'
}

/** The bar colour for the same rule in the movement chart (a DS chart takes a colour, not a class). */
export function spendMovementBarColour(delta: number): string {
  return delta > 0 ? 'var(--color-danger)' : 'var(--color-success)'
}

/** Business health for the P&L page, from buildPnlReportViewModel's healthStatus. */
export const PNL_HEALTH_TONE: Record<'on_track' | 'watch' | 'off_track' | 'incomplete', 'success' | 'warning' | 'danger' | 'neutral'> = {
  on_track: 'success',
  watch: 'warning',
  off_track: 'danger',
  incomplete: 'neutral',
}

/**
 * A P&L variance against the Greene King target: favourable is green, unfavourable red, none
 * (or under a penny) neutral. Expenses invert it, because spending under target is the good side.
 */
export function pnlVarianceTone(value: number | null, invert = false): 'success' | 'danger' | 'neutral' {
  if (value === null || Math.abs(value) < 0.01) return 'neutral'
  const favourable = invert ? value <= 0 : value >= 0
  return favourable ? 'success' : 'danger'
}

/** Where a bulk-review suggestion came from: the AI, or vendors and categories already on file. */
export const RECEIPT_SUGGESTION_SOURCE_TONE: Record<'ai' | 'existing', 'info' | 'neutral'> = {
  ai: 'info',
  existing: 'neutral',
}

export const RECEIPT_SUGGESTION_SOURCE_LABEL: Record<'ai' | 'existing', string> = {
  ai: 'AI suggestion',
  existing: 'Based on existing data',
}
