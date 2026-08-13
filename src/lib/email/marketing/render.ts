import { renderShellFoot, renderShellHead } from './blocks/shell'
import { toPlainText } from './escape'
import {
  BLOCK_REGISTRY,
  needsPreviewWrapperStrip,
  stripPreviewWrapper,
  type MarketingContent,
} from './registry'

/**
 * Rendering happens in two stages, and keeping them apart is what makes the design contract
 * testable.
 *
 * Stage one, `renderCampaignHtml`, is pure. Same content in, same bytes out, no database, no
 * network, no clock. It leaves the designer's `%%unsubscribe%%` token exactly where it is
 * and does not touch any link. That is what the fidelity test compares against the handover
 * file, byte for byte.
 *
 * Stage two, `applyDeliveryTransforms`, makes the same document sendable: it swaps in this
 * recipient's unsubscribe URL and rewrites campaign links. Those changes are asserted
 * separately as an allow-listed diff.
 *
 * Trying to do both in one pass is what makes a fidelity test impossible: the test would
 * demand unchanged bytes from a function whose job is to change them.
 */

/** Gmail clips around 100KB and hides everything after the cut, unsubscribe link included. */
const MAX_HTML_BYTES = 80 * 1024

export const UNSUBSCRIBE_TOKEN = '%%unsubscribe%%'

/** Pure stage. No I/O, no substitutions. */
export function renderCampaignHtml(content: MarketingContent): string {
  const body = content.blocks
    .map((entry) => {
      const block = BLOCK_REGISTRY[entry.type]
      if (!block) {
        throw new Error(`Unknown block type "${entry.type}"`)
      }

      const data = block.schema.parse(entry.data)
      const html = block.render(data)
      return needsPreviewWrapperStrip(block) ? stripPreviewWrapper(html) : html
    })
    .join('')

  return `${renderShellHead({ title: content.title, preheader: content.preheader })}${body}${renderShellFoot()}`
}

/** Plain-text alternative, built from the same block list. */
export function renderCampaignText(content: MarketingContent): string {
  const body = content.blocks
    .map((entry) => {
      const block = BLOCK_REGISTRY[entry.type]
      if (!block) return ''
      return block.text(block.schema.parse(entry.data))
    })
    .join('')

  return toPlainText(body).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export interface DeliveryContext {
  /** This recipient's working unsubscribe URL. Required: no marketing email ships without one. */
  unsubscribeUrl: string
  /** Original destination URL to campaign short link, provisioned when the campaign was scheduled. */
  linkMap?: Record<string, string>
  utm?: { source: string; medium: string; campaign: string }
}

/** Absolute URLs in href attributes, ignoring mailto and tel. */
const HREF_PATTERN = /href="(https?:\/\/[^"]+)"/g

function applyUtm(url: string, utm: DeliveryContext['utm']): string {
  if (!utm) return url

  // Only our own site gets tagged. Rewriting a social or third-party link is both rude and
  // useless, since we cannot read the other end's analytics anyway.
  if (!/^https?:\/\/(www\.)?the-anchor\.pub/i.test(url)) return url

  const [base, fragment] = url.split('#')
  const separator = base.includes('?') ? '&' : '?'
  const params = `utm_source=${encodeURIComponent(utm.source)}&utm_medium=${encodeURIComponent(utm.medium)}&utm_campaign=${encodeURIComponent(utm.campaign)}`

  // Already tagged, so leave it alone and stay idempotent.
  if (/[?&]utm_source=/.test(base)) return url

  const tagged = `${base}${separator}${params}`
  return fragment ? `${tagged}#${fragment}` : tagged
}

/** Delivery stage. Substitutes the unsubscribe URL and rewrites campaign links. */
export function applyDeliveryTransforms(html: string, context: DeliveryContext): string {
  if (!context.unsubscribeUrl) {
    throw new Error('A marketing email cannot be rendered without an unsubscribe URL')
  }

  let out = html.split(UNSUBSCRIBE_TOKEN).join(context.unsubscribeUrl)

  out = out.replace(HREF_PATTERN, (match, rawUrl: string) => {
    // The unsubscribe link is never shortened or tagged. It has to keep working for years
    // and must not depend on the redirector still existing.
    if (rawUrl === context.unsubscribeUrl) return match

    const decoded = rawUrl.replace(/&amp;/g, '&')
    const mapped = context.linkMap?.[decoded]
    if (mapped) return `href="${mapped.replace(/&/g, '&amp;')}"`

    const tagged = applyUtm(decoded, context.utm)
    return `href="${tagged.replace(/&/g, '&amp;')}"`
  })

  return out
}

export interface RenderedMarketingEmail {
  html: string
  text: string
  sizeBytes: number
}

/** Both stages, plus the size guard. This is what the sender calls. */
export function renderMarketingEmail(
  content: MarketingContent,
  context: DeliveryContext,
): RenderedMarketingEmail {
  const html = applyDeliveryTransforms(renderCampaignHtml(content), context)

  if (html.includes(UNSUBSCRIBE_TOKEN)) {
    throw new Error('The unsubscribe placeholder survived rendering')
  }

  const sizeBytes = Buffer.byteLength(html, 'utf8')
  if (sizeBytes > MAX_HTML_BYTES) {
    throw new Error(
      `Rendered email is ${Math.round(sizeBytes / 1024)}KB, over the ${MAX_HTML_BYTES / 1024}KB limit. ` +
        'Cut blocks rather than minifying: Gmail clips long messages and hides the unsubscribe link.',
    )
  }

  const text = renderCampaignText(content).replace(UNSUBSCRIBE_TOKEN, context.unsubscribeUrl)

  return { html, text, sizeBytes }
}

/**
 * Every distinct destination a campaign links to.
 *
 * Used at schedule time to provision one short link per destination, so rendering itself
 * stays pure and never has to reach the database mid-send.
 */
export function collectDestinationUrls(content: MarketingContent): string[] {
  const html = renderCampaignHtml(content)
  const urls = new Set<string>()

  for (const match of html.matchAll(HREF_PATTERN)) {
    const url = match[1].replace(/&amp;/g, '&')
    if (url.includes(UNSUBSCRIBE_TOKEN)) continue
    if (/^https?:\/\/(www\.)?the-anchor\.pub/i.test(url)) urls.add(url)
  }

  return [...urls].sort()
}
