# The Anchor — Design System

The Anchor is a friendly village pub in **Stanwell Moor, near Heathrow**.
Serving the village since **1751**, it is known for proper pub food, a
welcoming beer garden, regular live events, and a warm local atmosphere where
everyone feels welcome.

- **Primary tagline:** Where Everyone's Welcome
- **Supporting phrase:** Eat, Drink, Enjoy

This design system lets you (or an agent) produce on-brand interfaces, marketing
pages, decks and mockups for The Anchor — bold, warm, straight-talking, and
unmistakably *this* pub.

> **The brand has one rule above all: never invent facts.** Prices, hours,
> menus, heritage dates and amenities are governed by a Single Source of Truth.
> If a claim isn't verified, leave it out. See *Content Fundamentals* below.

---

## Brand direction (from the owner)

> *"Primary brand colour #005131 with secondary #a57626; black and white around
> those two. Fraunces Bold as a hero font and Feeling Passionate as a supporting
> font. Big, bold design that makes a statement and defines us as transparent,
> straight-talking, fun, engaging and charismatic."*

This system honours that brief. The typefaces have since been updated by the
owner; the current set is **DM Serif Display** (display), **Outfit** (body/UI)
and **Clicker Script** (script accent) — replacement history lives in the
*Caveats & change log* section. Note the live website ships a slightly darkened,
WCAG-AA gold (`#8b6914`) for gold-coloured *text* on light backgrounds — both are
included as tokens (`--anchor-gold` for fills, `--anchor-gold-dark` for text).

---

## Content Fundamentals — how The Anchor writes

The voice is **friendly, cheeky and inclusive**, never corporate.

- **Person:** First-person plural — *we*, *our*, *us*. Speak to the guest as *you*.
- **Spelling:** British English throughout (*favourite*, *organise*, *centre*).
- **Punctuation:** **No em dashes.** Use commas, full stops, short sentences, or
  parentheses. Keep sentences plain and confident.
- **Casing:** Sentence case for body and most headings. Reserve ALL-CAPS for
  short tracked *kickers* (eyebrow labels) like `STANWELL MOOR VILLAGE`.
- **Name:** Use **"The Anchor"** as the natural brand name. Use "The Anchor
  Pub" only where it improves search clarity or avoids confusion (Google and
  local listings, page titles, alt text, schema, third-party event listings).
- **Emoji:** Avoid in core brand materials, website copy and UI — use real
  icons (Lucide). Light, sparing use is acceptable in social and WhatsApp copy
  where it helps the message feel friendly and local.
- **Tone in practice:** warm and a little playful, but honest. We don't oversell.

**We say** (good):
- "A village pub since 1751. We stood here before Heathrow existed."
- "Proper Sunday roasts, carved fresh to order. No pre-order, no fuss."
- "Free customer parking available. Dogs always welcome, water bowls on us."
- "A beer garden with a front-row seat to Heathrow life."
- "Where Everyone's Welcome." · "Eat, Drink, Enjoy."

**We don't say** (banned / risky):
- "Famous" / "premier" / "best" without proof; vague history ("since the
  1800s") — it's **1751**.
- Hard-coded service times ("walk in 1pm to 6pm") unless verified in the SSOT.
- "Free parking for everyone" — spaces are limited, don't overpromise; say
  "free customer parking available".
- "Under the flight path" in customer copy — it can read as noisy rather than
  characterful. Fine as internal brand language.
- Em dashes, American spelling, corporate jargon.
- The wellington as "vegetarian" (it's **vegan**); "beef-dripping" or "red wine
  gravy" (neither is true); "real ale pub" (bottled ales only).
- Sky Sports, TNT Sports, regular live sport, breakfast, delivery, accessible
  toilet or baby changing — **do not claim unless confirmed in the SSOT.** We
  may show selected free-to-air events, but we are not a sports pub.

When writing real customer copy, defer to `docs/SSOT.md` in the website repo.

---

## Visual Foundations

**The feeling:** a proper village pub — warm timber, deep green, brass-gold
glow, candlelight after dark. Two moods share one palette:

- **Light / cream** (default): bright, bold, daytime. Cream and white surfaces,
  deep-green ink, gold accents. Used for docs, decks, clean marketing.
- **Dark / cinematic** (`.theme-dark`): the pub at night. Near-black green
  surfaces (`#0c1d11`), cream text, vivid gold, a faint film-grain overlay.
  This is the live website's surface.

**Colour**
- **Rule one: build with the semantic tokens** (`--bg`, `--surface`, `--text`,
  `--text-muted`, `--accent`, `--border`…). They re-map automatically under
  `.theme-dark`. The raw `--anchor-*` palette is the system's internals; reach
  for it only when a brand colour must stay fixed across themes (e.g. the logo
  box, the gold CTA fill).
- Primary **Anchor Green `#005131`** anchors everything; deep `#0c1d11` for
  cinematic surfaces, `#006b45` for lighter/hover green.
- Secondary **Gold** — exactly three, three jobs: `#a57626` fills, `#8b6914`
  *text* on light (AA), `#c9a020` accents on dark.
- **Black & white** plus warm neutrals (cream `#faf8f3`, sand `#f5e6d3`, cream
  text `#f0e6c6`) and a single warm mid-grey (`#6f6a61`, the muted-text tone).
- Use brand colours first. If you must extend, derive harmonious tones in oklch
  from these — don't introduce unrelated hues. No bluish-purple gradients.

**Type**
- **Display / hero: DM Serif Display** — high-contrast serif, single weight
  (400; never faux-bold), tight tracking (−0.02 to −0.03em). Big and confident
  — this is the statement voice.
- **Body / UI: Outfit** — clean humanist sans, 400–600, line-height ~1.7.
- **Script accent: Clicker Script** — the brand's supporting font, for warm
  asides and the locality line, used sparingly.
- **Kicker:** Outfit 600, uppercase, `0.18em` tracking, gold. Labels sections.

**Layout & spacing**
- 8px base rhythm (`--space-*`). Generous section padding (`--section-y`).
- Container max **1280px**, fluid side padding.
- Bold, full-bleed hero imagery with a green/dark **scrim** for legible text.

**Shape, borders, elevation**
- Radii — four shapes only: crisp **3px** cards in the dark theme, **6px**
  inputs, warm **12px** content cards in light, full **pills (999px)** for
  buttons and badges. Nothing in between.
- Borders: hairline gold on dark (`--border-gold`), warm tan on light.
- Shadows: soft and warm (`--shadow-sm/md/lg`) plus a signature **gold glow**
  (`--shadow-gold`) on primary buttons.

**Buttons — one emphasis ladder**
- `primary` (gold fill) · `outline` (theme-aware: green on light, gold on dark)
  · `ghost`. For interfaces, one clear primary action per view. For marketing
  artwork, keep the hierarchy obvious so the main message lands first.

**Signature motifs** (the brand's fingerprints — **max one motif per surface**)
- **Inset rule-frame** (`.anchor-frame`) — mirrors the boxed logo wordmark; for
  hero and print moments.
- **Gold top-accent rule** (`.anchor-card--accent`) — a confident gold bar
  across the top of a card.
- **Film grain** overlay (`--grain`) — dark/cinematic backgrounds only, ~5% opacity.

**Motion & states**
- Calm and warm. Fades and short rises (`fade-up`), `--ease-out` curves,
  150–400ms. No bounces, no infinite loops on content.
- **Hover:** buttons lift 2px (+ gold glow on primary); cards lift 3px with a
  larger shadow; links shift to gold.
- **Press:** settle back to translateY(0).
- **Focus:** 3px gold outline, 2px offset. Always visible, always accessible.
- Honour `prefers-reduced-motion`.

**Imagery**
- Warm, real, lived-in. Natural light, genuine pub moments (the bar, a carved
  roast, the garden under a plane). Not stocky, not cold. Pair with the green
  scrim for text overlays. See `assets/photos/`.

---

## Iconography

The Anchor uses **[Lucide](https://lucide.dev)** — the same icon set as the
production site (`lucide-react`). Clean 2px-stroke line icons, no fills.

- **In React / HTML:** load Lucide from CDN and use `<i data-lucide="name"></i>`,
  then call `lucide.createIcons()` (see the website UI kit). Icons inherit
  `currentColor` — set the colour on the parent (usually gold on dark, green on
  light).
- **Common glyphs** (from the site's map): `square-parking`, `plane`, `dog`,
  `wifi`, `beer`, `wine`, `utensils`, `pizza`, `calendar`, `clock`, `map-pin`,
  `phone`, `mail`, `star`, `music`, `trophy`, `party-popper`, `users`.
- **Emoji:** not brand iconography — prefer Lucide in anything designed.
  (Sparing emoji in social/WhatsApp copy is fine; see Content Fundamentals.)
- **Unicode:** the only common exception is the **★** star in ratings; fine as a
  decorative inline character.
- **Logo & app icon:** `assets/logos/` (see below). The square `anchor-icon.svg`
  is a simple app/favicon mark only — the wordmark is the real brand logo.

---

## The logo

`assets/logos/anchor-logo-black.png` and `…-white.png` (934×421, transparent).
A boxed **ANCHOR** wordmark with "THE" above and a script "Stanwell Moor Village"
below.

- **Use black or white only.** Never recolour, never add effects.
- Black on light/cream; white on dark green or photos.
- Keep clear space around it; don't stretch or crop the rule-box.

---

## Index / Manifest

**Root**
- `styles.css` — the one file consumers link. Imports everything below.
- `components.css` — visual classes for the React primitives (`.anchor-*`).
- `README.md` — this guide. · `SKILL.md` — Agent Skill wrapper.

**`tokens/`** — `colors.css`, `typography.css`, `spacing.css`, `effects.css`,
`fonts.css` (webfonts), `base.css` (element defaults).

**`components/`** — reusable React primitives (`.jsx` + `.d.ts` + `.prompt.md`
+ one preview card per folder):
- `core/` — **Button**, **Badge** (the one labelling pill — Tag merged in), **Card** (+ `CardBody`)
- `forms/` — **Input**
- `marketing/` — **SectionHeading**, **EventCard**

**`ui_kits/website/`** — interactive recreation of the the-anchor.pub homepage
(dark cinematic). `index.html` + `website.jsx` + `website.css` + README.

**`guidelines/`** — foundation specimen cards shown in the Design System tab
(Colors, Type, Spacing, Brand).

**`assets/`** — `logos/` (black + white wordmark, app icon) and `photos/` (bar,
dining room, beer garden, Sunday roast, hero, Christmas table).

---

## Caveats & change log

- **DM Serif Display, Outfit & Clicker Script** are loaded from Google Fonts.
  If you need fully offline assets, supply the binaries.
- Neither DM Serif Display nor Clicker Script has a bold weight — display and
  script text always sit at 400; never faux-bold them.
- Tokens use both `--anchor-gold` (#a57626, fills) and `--anchor-gold-dark`
  (#8b6914, AA text). Pick the text one for small gold type on light surfaces.
- **Change log:** June 2026 — DM Serif Display replaced Fraunces as the display
  face, and Clicker Script replaced the planned *Feeling Passionate* as the
  supporting script (both at the owner's request).

---

## Appendix — Sources & repositories

For agents and developers; not needed to use this guide as a brand reference.
Built from the brand owner's own repositories:

- **Website codebase** — https://github.com/peterjpitcher/the-anchor.pub
  (Next.js + Tailwind. Source of the colour tokens, the `lucide-react` icon set,
  the dark cinematic theme, component patterns, and `docs/SSOT.md` — the brand's
  Single Source of Truth for every customer-facing fact.)
- **Brand assets** — https://github.com/peterjpitcher/anchor-assets
  (Logos, hero imagery, brand briefs.)
- **Logo master** — supplied by the brand owner (`PrimaryLogo-2018-Transparent-Black-Large`).

Explore these repos to go deeper on copy, components, and operational rules.
