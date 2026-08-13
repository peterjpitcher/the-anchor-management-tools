# Handoff: The Anchor — transactional & marketing email system

## Overview

A branded, block-composable HTML email system for **The Anchor**, a village pub in
Stanwell Moor near Heathrow. It ships two things:

1. **A finished campaign email** — "Christmas bookings are open + lunch is back from
   1 September 2026". Send-ready once two photographs are hosted.
2. **A library of 18 reusable blocks** — the vocabulary an application can compose
   future emails from (menus, events, offers, reviews, FAQs, CTAs, footers).

The goal of the integration is a `renderEmail(blocks, data)` capability: your app
picks blocks, fills their slots, and emits a complete email document.

---

## About the design files — READ THIS FIRST

This handoff is **the opposite of the usual design handoff**. Do **not** re-implement
these designs in React/Vue/Tailwind components that render to the DOM.

Email HTML is its own runtime. The files here are **production artefacts**: nested
`<table>` layout, every style inlined, no external CSS, no JavaScript, no web fonts,
no flexbox or grid. That is not legacy sloppiness — it is what Outlook (Word
rendering engine), Gmail (strips `<head>` styles in some contexts, clips messages
over ~100KB) and Apple Mail all agree on.

**Your job is to turn these files into a template that your application can fill in,
preserving the markup exactly.** Concretely:

- Keep the table structure, the inline `style` attributes and the `bgcolor`
  attributes byte-for-byte. Rewriting them "more cleanly" will break clients.
- Insert your templating syntax into the **text nodes and `href` values only**.
- If you use a component-based email framework (MJML, react-email, Maizzle), port
  block by block and **diff the compiled output** against these files before
  shipping. Any structural drift is a regression.

### Fidelity

**High-fidelity.** Final colours, type, spacing and copy. Every hex value, pixel
size and string in these files is intentional and verified.

---

## Files in this bundle

| File | What it is |
| --- | --- |
| `anchor-christmas-and-lunch.html` | The finished campaign email. Complete document: doctype, preheader, MSO conditionals, media queries, 600px body. **~19KB.** |
| `anchor-email-blocks.html` | All 18 blocks in one document, each wrapped in `<!-- BLOCK: name -->` … `<!-- /BLOCK: name -->`. This is the parse source for your block catalogue. |
| `The Anchor Email Kit.dc.html` | The design-tool source both files were generated from. Reference only — do not ship or parse this one. |

Extract blocks by scanning `anchor-email-blocks.html` for the comment delimiters.
Each block is a single self-contained `<table role="presentation" width="600">`
element and can be concatenated with any other block in any order.

---

## Document shell

Every email is: **shell head → masthead block → n content blocks → footer block →
shell foot**. Take the shell verbatim from the top and bottom of
`anchor-christmas-and-lunch.html`. It contains, and all of it matters:

- `<!DOCTYPE html>` with the `xmlns:v` / `xmlns:o` namespaces (VML, Outlook).
- `<meta name="color-scheme" content="light dark">` and `supported-color-schemes`.
  The palette is warm mid-tones on purpose — no pure `#000` or `#fff` page
  backgrounds — so iOS/Outlook dark-mode inversion doesn't wreck it.
- An MSO conditional block: `PixelsPerInch 96`, plus a font override forcing
  Arial in Outlook (Outlook can't do the brand webfonts, and its fallback
  resolution is unreliable).
- A `<style>` block carrying **only** the media queries and resets. Several clients
  drop it entirely, so the email must read correctly from inline styles alone —
  it does; the `<style>` block is progressive enhancement, never load-bearing.
- A hidden **preheader** `<div>` as the first element in `<body>`: ~85 characters
  shown next to the subject line in the inbox, followed by zero-width joiners so
  body copy doesn't leak into the preview. **Always set this per send.**
- An outer 100%-width background table with the content table centred inside it.

### Responsive strategy — hybrid, not media-query-dependent

Outlook ignores media queries entirely, so responsiveness cannot depend on them:

- Outer tables carry `class="wrap"` + `width="600"` attribute + `style="width:100%;max-width:600px"`.
  Clients that respect CSS fluid down; Outlook honours the attribute and stays at 600.
- Inner content tables use `width:100%;max-width:536px` (600 minus 2 × 32px gutter).
- Multi-column rows carry `class="stack"` on each column cell. The
  `@media (max-width:620px)` rule flips them to `display:block;width:100%`.
  Blocks with stacking columns: `price_tiles` (in the campaign), `two_up_cards`,
  `media_row`, and the amenity grid.
- Images should be emitted as `width:100%;max-width:600px;height:auto`.

Every tap target — buttons, list links — is at or above 44px tall.

---

## Block catalogue

All 18 blocks, with the slots an application fills. Slot names are suggestions;
match them to your templating engine.

### Structural

| Block | Slots | Use |
| --- | --- | --- |
| `masthead_green` *(in campaign)* | — | Default header. Green `#005131` band, white wordmark, `#003d25` kicker strip reading "Stanwell Moor Village · Since 1751". |
| `masthead_cream` | — | White header with black wordmark and a 4px gold top rule. For lighter, less promotional sends. |
| `footer` *(in campaign)* | `unsubscribe_url` | Cream `#f2ede3`. Address, phone, socials, permission reminder, unsubscribe. |
| `footer_dark` | `unsubscribe_url` | Same content on `#0c1d11` with a Clicker Script "Where everyone's welcome". Pair with dark-themed sends. |
| `divider_rule` | — | 1px `#e2dccf` rule inset to the 536px content width. |

### Hero / opening

| Block | Slots | Use |
| --- | --- | --- |
| `hero_image` *(in campaign)* | `image`, `kicker`, `headline`, `body[]`, `cta_label`, `cta_url` | The default opener. Full-bleed photo, gold kicker, DM Serif headline, 1–2 paragraphs, one primary button. |
| `hero_framed` | `kicker`, `headline`, `body`, `cta_label`, `cta_url` | No photograph. Dark `#0c1d11` panel with the brand's inset gold rule-frame. Use when there is no good image — never use a weak one. |

### Content

| Block | Slots | Use |
| --- | --- | --- |
| `text_block` | `heading`, `body[]`, `list_items[]` | Workhorse. Heading, paragraphs, table-row bullet list (real `<tr>`s, not `<ul>` — Outlook mangles list indentation). |
| `fact_strip` *(in campaign)* | `rows[{label, value}]` | Label/value rows. Scannable rules and constraints: dates, group size, deposit. |
| `price_tiles` *(in campaign)* | `tiles[{label, price, note}]`, `footnote` | Three gold-top-accent cards. Stacks on mobile. |
| `menu_list` | `heading`, `items[{name, price, description, tag}]` | Dish name and price on one baseline, description under. Optional `VEGAN`/`NGCI` tag. |
| `hours_table` *(in campaign)* | `heading`, `rows[{label, time}]`, `note` | Green `#005131` panel, service times right-aligned, note row under a gold hairline. |
| `steps` | `steps[{title, body}]` | Numbered 1-2-3 in green circles. Mirrors the website's booking explainer. |
| `media_row` | `image`, `heading`, `body`, `link_label`, `link_url` | 240px image beside copy. Swap the two `<td>`s for image-right; alternate down a long email. |
| `two_up_cards` | `cards[{image, heading, body}]` | Two 260px cards side by side. Stacks on mobile. |
| `feature_card` | `image`, `heading`, `body`, `link_label`, `link_url` | One offer or dish. Gold top-accent card. |
| `event_row` | `day`, `date`, `month`, `title`, `detail`, `url` | Single event with a green date badge. |
| `whats_on_list` | `kicker`, `heading`, `events[]`, `all_events_url` | Multiple stacked event rows plus a "see everything" link. |
| `faq_rows` | `heading`, `items[{question, answer}]` | Question in green semibold, answer under, hairline between. Pre-empts the objections that stop a booking. |
| `pull_quote` | `script_line`, `body` | Clicker Script line on sand `#f5e6d3`. Brand warmth, **maximum one per email**. |
| `note_bar` | `label`, `body` | Small white strip with a 3px gold left border. Rules, deadlines, closures. |

### Conversion

These are the blocks that make an email sell. Recommendations follow the
established pattern: one dominant action per email, action-led verbs, urgency only
where it's true, and reassurance placed at the point of hesitation.

| Block | Slots | Use |
| --- | --- | --- |
| `deadline_bar` | `text`, `link_label`, `link_url` | Solid gold `#a57626` strip. **Only for a real constraint** — a genuine date, a genuine capacity limit. Never a manufactured countdown; the brand's first rule is honesty. |
| `offer_panel` | `kicker`, `headline`, `body`, `terms` | Dashed gold border, voucher-shaped. Include the terms line — it prevents disputes at the till. |
| `review` | `stars`, `quote`, `attribution` | Five ★ and a guest quote. **Paste a real review verbatim** from Google or Facebook. Never write one. |
| `reassurance_row` | `items[]` | Three green ticks directly under a CTA: "No commitment", "We reply within 24 hours", "Free customer parking". Answers the fear that stops the click. |
| `signoff_ps` | `signoff`, `signature`, `ps_body`, `ps_link_label`, `ps_link_url` | Script signature plus a P.S. The P.S. is among the most-read lines in an email — spend it on the deadline or the single strongest reason to act, with one link. |
| `buttons` | `label`, `url` | The emphasis ladder. See below. |

### Buttons

Bulletproof pattern — a padded `<td>` with `bgcolor` and inline `border-radius`,
the `<a>` filling it with `display:block`. Never an `<img>`, never a `<button>`.

- **Primary** — `#a57626` fill, `#1a1a1a` text, `border-radius:999px`, padding `15px 32px`.
  On dark backgrounds use `#c9a020`. Charcoal on gold is deliberate: white on gold
  fails contrast.
- **Outline** — transparent, `2px solid #005131`, `#005131` text.
- **Ghost** — `#8b6914` text link with a `→`.

**One primary action per email.** Repeat that same action in the closing panel if
the email is long — but do not introduce a competing one. Write CTAs as verbs the
reader is about to do ("Start your Christmas booking"), not as labels ("Christmas
info").

---

## Design tokens

From The Anchor design system. Emails cannot use CSS custom properties, so these
are the literal values to inline.

### Colour

| Token | Hex | Use |
| --- | --- | --- |
| Anchor green | `#005131` | Primary. Mastheads, headings, hours panel, outline buttons. |
| Green dark | `#003d25` | Masthead kicker strip. |
| Green deep | `#0c1d11` | Cinematic dark panels, `footer_dark`, `hero_framed`. |
| Green light | `#006b45` | Success ticks, `VEGAN` tag. |
| Sage | `#7a8b7f` | Muted text on dark. |
| Gold | `#a57626` | Fills: primary buttons, `deadline_bar`, card top-accents, stars. |
| Gold dark | `#8b6914` | **Gold as text on light** (WCAG AA). Kickers, ghost links, prices. |
| Gold bright | `#c9a020` | Gold on dark surfaces only. |
| Charcoal | `#1a1a1a` | Body text; text on gold fills. |
| Cream | `#faf8f3` | Default page surface. |
| Cream sunk | `#f2ede3` | Footer, amenity strip. |
| Sand | `#f5e6d3` | Pull-quote background, image placeholders. |
| Cream text | `#f0e6c6` | Body text on dark green. |
| Grey | `#6f6a61` | Muted text on light. |
| Border | `#e2dccf` | Hairlines and card borders. |
| Border light | `#efe9dd` | Interior row separators. |
| Page background | `#e6e0d4` | Outside the 600px content table. |

Never introduce a hue outside this set. If you need a tone that isn't here, derive
it in oklch from one of these — no blue-purple gradients, ever.

### Type

Brand faces first, email-safe fallbacks after. Recipients almost always see the
fallback; the stacks are chosen so that is fine.

```
Display  'DM Serif Display', Georgia, 'Times New Roman', serif
Body/UI  'Outfit', 'Helvetica Neue', Helvetica, Arial, sans-serif
Script   'Clicker Script', 'Segoe Script', 'Brush Script MT', cursive
```

Do **not** add `<link>`s to Google Fonts. Most clients strip them, Outlook then
picks a random fallback, and the layout shifts.

| Role | Size / line-height | Face | Colour |
| --- | --- | --- | --- |
| Hero headline | 38 / 44, `letter-spacing:-0.02em` | Display | `#005131` |
| Section heading | 26–32 / 32–38, `-0.02em` | Display | `#005131` |
| Card heading | 21–26 / 27–32 | Display | `#005131` |
| Body | 16 / 27 | Body 400 | `#1a1a1a` |
| Small body | 14–15 / 22–25 | Body 400 | `#1a1a1a` / `#6f6a61` |
| Kicker | 11 / 16, `0.18em`, uppercase, 600 | Body | `#8b6914` (`#c9a020` on dark) |
| Button | 15–16 / 20, 600 | Body | `#1a1a1a` on gold, `#005131` on outline |
| Footer legal | 12 / 19 | Body | `#8f897e` |

DM Serif Display and Clicker Script have **no bold weight**. Never faux-bold them —
keep display and script text at 400.

Add `mso-line-height-rule:exactly` alongside `line-height` on every text cell.

### Spacing, shape, motion

- 8px rhythm. Section gutter 32px; content width 536px inside it.
- Vertical: 32–40px between sections, 14–16px between a heading and its body.
- Radii: **999px** buttons and badges, **3px** dark cards, **12px** light content
  cards. Nothing in between. Most email blocks are square-cornered by design.
- No animation. No hover states — mobile clients don't have hover and desktop
  support is patchy.

---

## Assets

### Logo — already hosted, safe to reference

```
https://www.the-anchor.pub/images/branding/the-anchor-pub-logo-white-transparent.png
https://www.the-anchor.pub/images/branding/the-anchor-pub-logo-black-transparent.png
```

Natural size **400 × 200**. Rendered at `width="176" height="88"`. **Preserve the
2:1 ratio** — the brand rule is that the wordmark is never stretched, cropped,
recoloured or given effects. White on green/dark, black on cream/white.

### Photography — required before sending

Two slots in the campaign email, each marked with an `<!-- IMAGE SLOT: … -->`
comment containing the exact replacement `<tr>`. Swap the placeholder row for it.

| Slot | Supply at | Renders at | Subject |
| --- | --- | --- | --- |
| 1, hero | **1200 × 680** | 600 × 340 | A table laid for Christmas dinner — crackers, glasses, warm low light. Landscape, room at the edges so a crop doesn't lose the subject. |
| 2, lunch | **1200 × 520** | 600 × 260 | Daytime lunch on the table by a window. Natural light, must read as midday. |

Other slots in the library: `feature_card` 1072 × 460, `two_up_cards` 520 × 360
each, `media_row` 480 × 400.

Rules: JPEG, sRGB, quality ~75, **under 200KB each**. Real photographs of this pub —
no stock. Always set `alt`; roughly a third of opens have images off, so the alt
text has to carry the meaning on its own. Never put essential copy inside an image.

Host on a CDN or the website's own domain — a project-relative path will not
resolve for recipients.

---

## Content rules — non-negotiable

The Anchor's first brand rule is **never invent facts**. Prices, hours, menus,
heritage dates and amenities come from `docs/SSOT.md` in the website repo
(`github.com/peterjpitcher/the-anchor.pub`). If a claim isn't verified there, leave
it out. This applies to anything your application generates.

- **Voice**: first-person plural (we, our, us), reader as "you". Warm, a little
  playful, honest. Never corporate.
- **British English**. *Favourite*, *organise*, *centre*.
- **No em dashes.** Commas, full stops, short sentences, or parentheses.
- **Sentence case** everywhere except tracked uppercase kickers.
- **No emoji** in email.
- **Never** "famous", "premier" or "best" without proof. Founded **1751**, not
  "the 1800s". "Free customer parking available", never "free parking for
  everyone" (~20 spaces). Don't claim Sky/TNT Sports, breakfast, delivery, or
  accessible facilities — none are confirmed.
- Icons, where any are needed, are **Lucide**. The ★ in `review` is the one
  permitted Unicode exception.

### Verified facts used in the campaign email

Christmas: 10 November to 20 December 2026 · sittings Tuesday to Saturday plus
Sunday 1pm–6pm, no Mondays (kitchen closed) · 6 guests minimum · over 20 becomes
private hire · £10 per person deposit, deducted from the bill · 1 course from £23,
2 from £33.95, 3 from £36.95 · prosecco for every adult, swappable for orange juice
· pre-orders 7 days ahead · festive buffets 30+ · up to 60 seated / 200 standing.

New hours from 1 September 2026: lunch 12pm–3pm, dinner 4pm–9pm, **Tuesday to
Friday**. Kitchen closed Mondays.

Location: Horton Road, Stanwell Moor, Surrey TW19 6AQ · 01753 682707 (WhatsApp same
number) · ~20 free spaces · outside the ULEZ · 7 min from Heathrow T5, 8 min from
Staines, 2 min from M25 J14.

> **Open item:** Saturday and Sunday kitchen hours from 1 September were never
> specified and are therefore **deliberately absent** from the email. Confirm them
> before adding. Likewise, the reply-to email address was never verified — the
> campaign currently offers phone and WhatsApp only. Do not guess either.

---

## Integration notes

### Suggested shape

```
renderEmail({
  preheader: string,        // ~85 chars, required
  blocks: [{ type: 'hero_image', data: {...} }, ...],
  unsubscribeUrl: string,   // required for marketing sends
})
```

Compose: shell head → masthead → blocks in order → footer → shell foot.

### Escaping

Slot values land inside HTML. **Escape `& < > "` on every interpolated value.**
Copy in this brand contains apostrophes and `&` regularly. The existing markup uses
named entities (`&pound;`, `&middot;`, `&rsquo;`, `&mdash;`, `&rarr;`) — keep them;
some clients mishandle raw UTF-8 in older MIME configurations.

### Links

- Every `<a>` needs a real absolute `https://` href. No `#` anchors — several
  clients rewrite or break them.
- `%%unsubscribe%%` in the footer is a placeholder token. Replace it with your ESP's
  merge tag (Mailchimp `*|UNSUB|*`, Klaviyo `{% unsubscribe %}`, etc.).
- If you append UTM parameters, do it at render time across all hrefs in one pass.

### Size budget

Gmail clips messages over ~100KB of HTML and hides everything after the cut,
including the unsubscribe link. The campaign email is ~19KB. Keep composed emails
**under 80KB**; if you exceed it, cut blocks rather than minifying.

### Testing

Before any real send, render through Litmus/Email on Acid or seed accounts covering:
**Outlook 2016+ on Windows** (the one that breaks things), **Gmail web**, **Gmail
Android app**, **Apple Mail on iOS in dark mode**, and **Outlook.com**. Check:
columns stack under 620px, no horizontal scroll at 320px, gold buttons legible in
dark mode, and the preheader shows the intended text in the inbox list.

### Accessibility

`lang="en-GB"` on `<html>`. `role="presentation"` on every layout table (already
set — keep it). Meaningful `alt` on every image. Body text never below 14px, and
16px for primary reading. Don't rely on colour alone to carry meaning.

---

## Suggested subject lines

For the campaign email, in descending order of directness:

1. Christmas bookings are open, and lunch is back
2. Your table at Christmas, plus we're open from midday again
3. Christmas 2026 at The Anchor: 10 November to 20 December

Preheader currently set to: *"Christmas dinner 10 November to 20 December, and lunch
is back from midday, Tuesday to Friday."*
