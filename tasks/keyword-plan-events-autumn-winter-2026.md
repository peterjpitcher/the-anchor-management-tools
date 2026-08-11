# Keyword Plan: Three themed events, autumn/winter 2026 (target country: UK)

Source: Google Keyword Planner, United Kingdom / English, data window July 2025 to June 2026.
Exports pulled 2026-08-11 (Round 1 and Round 2 Keyword Stats).

GKP returned rounded point values (50 / 500 / 5,000 / 50,000), not ranges. Treat every volume below
as order-of-magnitude, not precise. **Competition is a paid signal only.** No organic difficulty tool
was available, so the "Organic difficulty" column is `Unavailable` throughout and no SERP feature
(AI Overview, map pack, snippet) was observed, so none are claimed.

## Primary Page Targets

| Page | Head term | Close variants | Demand (GKP) | Paid signal | Organic difficulty | Intent | Seasonality | Source + date | Confidence | Why chosen |
|---|---|---|---|---|---|---|---|---|---|---|
| Monster Mash (31 Oct) | halloween events near me | halloween party near me, halloween things to do near me | 5,000 | Low (6) | Unavailable | Local transactional | Peaks Oct | GKP 2026-08-11 | Medium | Highest volume at the lowest paid competition in the whole set |
| Sequins & Showstoppers (13 Nov) | music quiz | music bingo, song bingo | 5,000 | Low (1) | Unavailable | Transactional | Flat | GKP 2026-08-11 | Medium | Same volume as "music bingo" at a fraction of the competition |
| Sleigh My Name (11 Dec) | christmas music bingo | music bingo, festive events near me | 500 | High (100) | Unavailable | Transactional | Peaks Nov to Dec | GKP 2026-08-11 | Medium | Exact intent match; the broader Christmas terms are the wrong buyer |

## CMS field values (paste straight into the event records)

### Monster Mash: The Anchor Halloween Party, Sat 31 Oct 2026

**primary_keywords**
`halloween events near me` (5,000, Low 6), `halloween party near me` (5,000, Low 8),
`halloween things to do near me` (5,000, Low 33), `halloween night out` (500, Low 1),
`halloween events surrey` (500, Low 2), `party events` (500, Low 13, category base)

**secondary_keywords**
`halloween party` (5,000, Medium 53, down 90% YoY), `halloween pub party` (50), `free halloween party` (50),
`fancy dress party near me` (50), `halloween party surrey` (50), `saturday halloween party` (50),
`halloween events staines` (50), `themed party nights` (50, category base),
`pub party near me` (50, category base), `free entry events near me` (50)

**local_seo_keywords**
`stanwell moor` (5,000), `staines pub` (5,000), `pubs near heathrow` (500),
`things to do in staines` (500), `things to do in surrey this weekend` (500),
`the anchor stanwell moor` (500, brand), `the anchor events` (50, brand),
`what's on staines` (50), `staines events` (50), `events in staines this weekend` (50)

### Sequins & Showstoppers: Strictly-Season Music Bingo, Fri 13 Nov 2026

**primary_keywords**
`music bingo` (5,000, High 100, category base), `music quiz` (5,000, Low 1),
`song bingo` (5,000, Low 2), `music bingo near me` (500, Low 1, up 900% YoY),
`musical bingo` (500, High 100, category base), `bingo night near me` (500, Low 6)

**secondary_keywords**
`disco bingo` (500, Medium 60), `pub music quiz` (500, Low 1), `pub bingo near me` (500, Low 1),
`rock and roll bingo` (500, Medium 56), `musical bingo near me` (50), `music quiz near me` (50),
`music quiz night` (50), `music bingo night` (50), `name that tune bingo` (50), `80s music bingo` (50)

**local_seo_keywords** (same evidenced local set as above)

### Sleigh My Name: Festive Music Bingo, Fri 11 Dec 2026

**primary_keywords**
`christmas music bingo` (500, High 100), `music bingo` (5,000, High 100, category base),
`music quiz` (5,000, Low 1), `christmas events near me` (50,000, Low 17),
`festive events near me` (500, Low 9, up 900% in three months), `music bingo near me` (500, Low 1)

**secondary_keywords**
`christmas night out near me` (500, Low 19), `christmas events surrey` (500, Low 10),
`christmas things to do near me` (5,000, High 83), `song bingo` (5,000, Low 2),
`bingo night near me` (500), `pub bingo near me` (500), `musical bingo` (500),
`christmas party pub` (50), `christmas jumper party` (50), `christmas pub events` (50)

**local_seo_keywords** (same evidenced local set as above)

## Avoid / Negative Keywords

- `christmas party night near me` (5,000) and `work christmas party near me` (500, down 90% YoY):
  corporate and office-party intent, and the SERP is owned by booking aggregators
  (BigVenueBook, ChooseYourVenue, SquareMeal). Wrong buyer for a £5 walk-up bingo night.
- `strictly music bingo`, `strictly themed night`, `ballroom music night`, `ballroom night out`,
  `themed music bingo`, `festive music bingo`, `song bingo night`, `dance music bingo`: **no data
  returned**. `strictly night` returned 50 and is down 100% YoY. There is no Strictly search demand.
  Keep the Strictly angle as on-page flavour and artwork only; do not target it.
- `sequin party` (50, High 100): retail and fashion intent, not events.
- `christmas quiz night`, `christmas bingo night`, `christmas songs bingo`: all down 100% YoY.
- `abba bingo` (down 90% YoY) and `halloween pub night` (down 100% YoY).
- `the anchor stanwell moor` and `the anchor events` are branded and already owned. Listed as local
  support, not as terms to build a page around.

## Per-cluster implementation notes

**Monster Mash.** Title and H1 should lead on "Halloween Party" plus the location, not on "Monster
Mash", because the brand name has no search demand. Cover: what's on, free entry, fancy dress,
timings, parking. Cannibalisation risk: none, no existing Halloween page.

**Sequins & Showstoppers.** Lead the title on Music Bingo, not Strictly. The theme sells the night to
people who already know you; the search traffic comes from "music quiz" and "music bingo". Cannibalisation
risk: the `/music-bingo` category page targets the same head terms. Keep the event page on the dated
long-tail and let the category page hold the head term.

**Sleigh My Name.** Same shape. `christmas music bingo` is the exact-intent term and worth owning
outright given how few people compete for it.

## Measurement plan

Baseline the following in Search Console before the pages go live, then review 4 to 8 weeks after
publication: impressions for visibility, CTR for SERP relevance, average position for ranking.

Terms to baseline: `music quiz`, `music bingo near me`, `christmas music bingo`,
`halloween events near me`, `stanwell moor`, `staines pub`.

## Open item, unrelated to these three events

The Round 1 export reported `the anchor stanwell moor` at **organic average position 57** with 40%
organic impression share. That is the venue's own brand term. GKP's organic column can be unreliable,
so verify in Search Console before acting, but if it is accurate it matters more than any of this.
