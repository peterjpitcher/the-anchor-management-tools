import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { marketingContentSchema } from '../registry'
import { renderMarketingEmail, collectDestinationUrls } from '../render'
const HERE = path.dirname(fileURLToPath(import.meta.url))
describe('privacy notice link', () => {
  it('goes out plain: never shortened, never tagged', () => {
    const c = marketingContentSchema.parse(JSON.parse(readFileSync(path.join(HERE, '..', 'campaigns', 'christmas-2026-business.json'), 'utf8')))
    const dests = collectDestinationUrls(c)
    const linkMap = Object.fromEntries(dests.map((d, i) => [d, `https://l.the-anchor.pub/x${i}`]))
    const { html } = renderMarketingEmail(c, { unsubscribeUrl: 'https://m.test/api/unsubscribe?t=T', linkMap, recipientRef: 'rid', utm: { source: 'marketing_email', medium: 'email', campaign: 'x' } })
    const privacy = /href="([^"]*privacy-policy[^"]*)"/.exec(html)
    expect(privacy?.[1]).toBe('https://www.the-anchor.pub/privacy-policy')
  })
})
