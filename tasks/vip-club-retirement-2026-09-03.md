# vip-club.uk retirement, 2026-09-03

## Why

The legacy short-link domain `vip-club.uk` is being retired. Click analytics prove which
links are still used but cannot say **where** they are published: every legacy click arrives
with no referrer and a plain mobile browser user agent, so the publication surface has to be
asked for directly.

Live position at the time of writing (since host tracking began 2026-06-13):

| Host | Clicks | Human | Bots |
|---|---|---|---|
| `l.the-anchor.pub` | 5,559 | 3,811 | 1,748 |
| `www.vip-club.uk` | 1,254 | 97 | 1,157 |

The unexplained one is `vip-club.uk/food`: 53 human clicks, 46 distinct IPs, every click
between 12:00 and 22:00 London, zero on a Monday (the one day with no kitchen). The same
code on the new domain has 5 clicks from a single IP at 08:00, so whatever carries the food
menu link was never moved to `l.the-anchor.pub`.

## What was built

A retirement interstitial served only to legacy-domain traffic, asking one question, plus
reporting on the answers.

- `supabase/migrations/20260903220000_short_link_legacy_reports.sql` - new
  `short_link_legacy_reports` table. RLS on, no anon or authenticated grants. No IP address
  and no user agent stored, so no PII lands in a new location.
- `src/lib/short-links/legacy-report.ts` - the 13 location options, the zod submission
  schema, `isLegacyShortLinkHost` and `shouldShowLegacyInterstitial`.
- `src/app/api/short-links/legacy-report/route.ts` - public POST endpoint, rate limited,
  writes with the service-role client so the table needs no anon grant.
- `src/app/legacy-link/[code]/page.tsx` and `LegacyLinkClient.tsx` - the interstitial,
  built on the existing guest design system so it carries The Anchor brand.
- `src/app/api/redirect/[code]/route.ts` - diverts eligible legacy traffic to the
  interstitial. The click is still recorded exactly once, against the legacy host.
- `vercel.json`, `src/middleware.ts`, `src/lib/short-links/routing.ts` - routing and public
  access for `/legacy-link`.
- `src/services/short-links.ts`, `src/types/short-links.ts`,
  `src/app/(authenticated)/short-links/legacy-domain/page.tsx` - two new cards on the
  retirement dashboard: a tally by place, and recent answers with free-text detail.

### Deliberately not interrupted

`shouldShowLegacyInterstitial` returns false for bots, for table payment links (mid
transaction, may carry a reissued token) and for the protected `feedback` slug (backs the
review-request funnel). Covered by tests in `tests/lib/shortLinksLegacyReport.test.ts`.

### Staff mode

Add `?staff=1` to the interstitial URL to mark answers as a staff check rather than customer
traffic. Intended use: walk the pub, scan any QR found, record the exact spot under
"Somewhere else".

## Verification

- `npx tsc --noEmit` clean
- `npm run lint` clean
- 22 tests pass across `shortLinksLegacyReport`, `shortLinksRouting`,
  `redirectTablePaymentReissue`
- `npm run build` compiled successfully; both new routes emitted
- Interstitial rendered and confirmed correct at 375px

Not yet verified end to end: the POST round trip, because the table does not exist until the
migration is applied. The dashboard handles that case (`tableReady: false`) rather than
failing.

## Cross-project audit

11 sibling repos audited, findings adversarially verified. Two real code fixes, both in
OJ-MusicBingo, neither in this repo:

1. `lib/live/content.ts:66` - `reviewQrUrl: "https://vip-club.uk/jls0mu"` is the shipped
   default for the Review Us QR on the Thank You screen shown on the pub TV every event
   night. This is the source of the `jls0mu` traffic. Set it to `""` so `ThankYou.tsx`
   falls through to brand config, and update `lib/live/content.test.ts:65`.
2. `lib/eventFeed/anchorAdapter.ts:135-139` - `resolveCustomerUrl` has no legacy-host
   rejection, so a `vip-club.uk` value typed into an AMS event `booking_url` would be
   printed onto physical bingo cards.

OJ-CheersAI2.0 needs no code change and its legacy host allowlists must **not** be stripped
yet, because they are how historic ad spend is attributed. It does need a data sweep of
stored campaign destination URLs, which are sent verbatim to Meta as ad creative links.

Nine other projects are clean.

## Open owner actions

- Apply the migration before deploying the code.
- Keep permanent redirects on `/vvjkz0` and `/jls0mu` regardless of retirement date, because
  already-printed bingo cards cannot be recalled.
- Retire on zero legacy traffic, not on the domain expiry date.
