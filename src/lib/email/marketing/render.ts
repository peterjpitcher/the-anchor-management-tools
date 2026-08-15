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
  /**
   * This send's recipient row id, added to short links as `utm_content`.
   *
   * One short link serves the whole audience, so without this a click tells us the campaign
   * and nothing else. The redirect route forwards the parameter to the destination and
   * records it on the click, which is what makes a click attributable to a person.
   */
  recipientRef?: string
}

/** Absolute URLs in href attributes, ignoring mailto and tel. */
const HREF_PATTERN = /href="(https?:\/\/[^"]+)"/g

/**
 * Hosts a campaign link may be routed through our own redirector.
 *
 * The venue's own site plus the places it actually publishes, so the WhatsApp and social
 * buttons are measured rather than being the only untracked calls to action in a campaign.
 * It deliberately does not include arbitrary third parties: the redirector's allowlist is an
 * open-redirect guard and this has to stay inside it.
 *
 * `tel:` is absent on purpose. Routing a phone number through an HTTP redirect puts a browser
 * hop in front of tapping to call and breaks it outright on some clients, so those clicks are
 * measured from the provider's own click event instead.
 */
const TRACKABLE_HOST = /^https?:\/\/((www\.)?the-anchor\.pub|wa\.me|(www\.)?facebook\.com|(www\.)?instagram\.com)(\/|$|\?)/i

/**
 * Links that must never be routed through the redirector, beyond the unsubscribe URL.
 *
 * The privacy notice is a standing transparency obligation rather than a campaign link. It
 * has to keep resolving long after the redirector has been forgotten about, and counting who
 * reads it would mean tracking somebody exercising a data right, which is not a number worth
 * having.
 */
const NEVER_SHORTENED = /\/privacy-policy(\/|$|\?)/i

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

/**
 * Stamps the recipient onto a campaign short link.
 *
 * Only ever applied to a URL that came out of the link map. An unmapped destination goes to
 * the venue site directly, where a recipient id in the query string would leak into the
 * site's own analytics without buying us anything, and a third-party link is not ours to
 * rewrite at all.
 *
 * Built with `URL` so it composes with a short link that already carries a query string, and
 * skipped when `utm_content` is already present so a second pass over the same HTML cannot
 * stack a duplicate.
 */
function withRecipientRef(url: string, recipientRef: string | undefined): string {
  if (!recipientRef) return url

  try {
    const parsed = new URL(url)
    if (parsed.searchParams.has('utm_content')) return url
    parsed.searchParams.set('utm_content', recipientRef)
    return parsed.toString()
  } catch {
    // An unparseable short URL is still a working link, so send it as it is rather than lose
    // the click over an attribution nicety.
    return url
  }
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
    if (mapped) {
      const tracked = withRecipientRef(mapped, context.recipientRef)
      return `href="${tracked.replace(/&/g, '&amp;')}"`
    }

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
    if (NEVER_SHORTENED.test(url)) continue
    if (TRACKABLE_HOST.test(url)) urls.add(url)
  }

  return [...urls].sort()
}
