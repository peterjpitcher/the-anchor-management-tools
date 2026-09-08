# Handover to Claude Code: September 2026 email block additions

Read `README.md` in this folder first. Everything there still applies (600px shell,
32px outer padding, 536px content, inline styles, `bgcolor` on fills, three classes only,
never invent facts). This note covers only what is new.

## Files

| File | What it is |
|---|---|
| `anchor-email-blocks-additions.html` | The new and corrected blocks, each wrapped in `<!-- BLOCK: name -->` … `<!-- /BLOCK: name -->` inside its own 600px preview table. Strip the wrapper when composing, as before. |
| `anchor-email-blocks.html` | Main library, with `media_row` and `two_up_cards` replaced by the corrected versions. |
| `anchor-december-roundup.html` | Composed monthly round-up using the new blocks beside masthead, hero, sign-off and footer. Use it to check vertical rhythm and as the reference render. |
| `img/slot-16x9.png`, `img/slot-1x1.png`, `img/slot-band.png` | Local placeholder images at the three artwork ratios. Replace `src` with hosted URLs at send time; keep the `width`/`height` attributes. |

The HTML is the artefact. Register each block byte for byte from between its BLOCK comments.

## New blocks

### `whats_on_media`
Event list with artwork and a booking link per row. One white bordered table, hairline
`#efe9dd` between rows, so eight rows still read as one list.

Slots: `kicker`, `heading`, `events[]` (up to 8), `all_events_url`.
Per event: `date` (label style), `name` (DM Serif 19/25 green), `detail` (note style, about
90 chars), `image{src,width,height,alt}`, `cta_label`, `url`.

Image cell is 196px wide, image renders 180 wide. For 16:9 artwork pass `width="180"
height="101"`. Both cells carry `.stack`; on mobile the picture sits above the text.
The image and the "→" link both point at `url`.

### `opening_hours_week`
Seven-day table. Columns 150 / 160 / 226 (Day, Bar, Kitchen), header row in label style
with a `#e2dccf` rule, body rows separated by `#efe9dd`.

Per row: `day`, `bar`, optional `exception` (note style, under the bar time), and exactly one
kitchen state:
- `kitchen` — single time, body style
- `lunch` + `dinner` — two lines, each with a 56px inline label (LUNCH, DINNER) in label style
- `closed: true` — "Kitchen closed", 15/22 in muted `#6f6a61`

Slots: `heading`, `rows[7]`, `footnote` (full width, note style).
No `.stack`: the three columns fit a 320px screen and stacking would break the row reading.

### `opening_hours_dates`
Dated exceptions for festive runs. Same three-column geometry as the week table.

Per row: `date` ("Fri 25 Dec"), `note?`, and either `hours` or `closed: true`.
A closed row is a full `#0c1d11` dark row (`bgcolor` on all three cells), date in
`#c9a020`, "Closed" in `#f0e6c6`, note in `#f0e6c6` 13/20. Nothing else in the library uses
this treatment; it exists so a closed day cannot be read as a quiet one.

Slots: `heading`, `rows[]` (up to about 12), `footnote`.

### `grid_cards_linked`
Two or three bookable cards. Two variants are drawn (`grid_cards_linked`,
`grid_cards_linked_three`); register as one block with `n = cards.length`.

- 2 across: card 260px, image 258 wide, 16px padding, heading 21/27
- 3 across: card 168px, image 166 wide, 14px padding, heading 19/25
- 16px gutter cell between cards, also `.stack` so it becomes a 16px vertical gap on mobile

Per card: `image{src,width,height,alt}`, `heading`, `body` (two lines, note style),
`cta_label`, `url`. Image and link both point at `url`. Square 1:1 posters fit best
(258×258 / 166×166); pass the artwork's own ratio for anything else.

## Corrected blocks

`media_row` and `two_up_cards` no longer hardcode image dimensions. The caller sets
`width` and `height` on the `<img>` at the slot width (240 for `media_row`, 258 for
`two_up_cards`) and the artwork ratio. `media_row` now also links the image and has a
16px `.stack` gutter between image and copy for mobile. Existing slot names unchanged.

## Artwork ratios

| Shape | Source | 180w | 240w | 258w | 166w |
|---|---|---|---|---|---|
| 1:1 | 1254×1254 | 180×180 | 240×240 | 258×258 | 166×166 |
| 16:9 | 1672×941 | 180×101 | 240×135 | 258×145 | 166×93 |
| 2.33:1 | 1916×821 | 180×77 | 240×103 | 258×111 | 166×71 |

## Mobile

One breakpoint, `max-width: 620px`, already in the shell. `.stack` is applied to every
image, text, card and gutter cell in the four picture blocks. The two hours tables stay
tabular on purpose.

## Content warnings

Everything in `anchor-december-roundup.html` and the library rows (event names, times,
bar hours, weekend kitchen hours, the 22 Dec to 10 Jan exceptions) is realistic stand-in
copy chosen to test wrapping. Every value must be replaced from the events database and
the opening-hours records before send. Weekend kitchen hours and the reply-to address
remain open from the previous handover.
