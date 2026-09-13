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

Image cell is 196px wide, image renders 180 wide on desktop and fills the cell when stacked (CSS width:100%; the width/height attributes stay for Outlook). For 16:9 artwork pass `width="180"
height="101"`. Both cells carry `.stack`; on mobile the picture sits above the text.
The image and the "→" link both point at `url`.

### `opening_hours_week`
Seven-day table, two columns: Day (112px, Outfit 600) and a details cell that carries one
labelled line per value. Labels are a 68px inline-block in label style (BAR, LUNCH,
DINNER, KITCHEN); times are `white-space:nowrap` so a time never breaks across lines.
Rows separated by `#efe9dd`. The brief's three-column stand-in was tried and wrapped
badly on a 360px phone, so this replaces it.

Per row: `day`, `bar`, optional `exception` (note style, last line of the cell), and
exactly one kitchen state:
- `kitchen` — one line, "KITCHEN 12pm to 5pm"
- `lunch` + `dinner` — two lines, "LUNCH …" and "DINNER …"
- `closed: true` — "KITCHEN Closed", value in muted `#6f6a61`

Slots: `heading`, `rows[7]`, `footnote` (full width, note style). No `.stack`.

### `opening_hours_dates`
Same two-column geometry. Per row: `date` ("Fri 25 Dec", nowrap), `note?`, and either
`hours` (15/22, nowrap) or `closed: true`.
A closed row is a full `#0c1d11` dark row (`bgcolor` on both cells), date in `#c9a020`,
"Closed" in `#f0e6c6` 600, note in `#f0e6c6` 13/20. Nothing else in the library uses
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
`two_up_cards` also gains `.stack` on the inner card table (see Mobile).

## Artwork ratios

| Shape | Source | 180w | 240w | 258w | 166w |
|---|---|---|---|---|---|
| 1:1 | 1254×1254 | 180×180 | 240×240 | 258×258 | 166×166 |
| 16:9 | 1672×941 | 180×101 | 240×135 | 258×145 | 166×93 |
| 2.33:1 | 1916×821 | 180×77 | 240×103 | 258×111 | 166×71 |

## Mobile (approved on a 375px frame)

One breakpoint, `max-width: 620px`, already in the shell. No new CSS was added; the
three existing classes do all the work:

- `.gutter` is now on every outer 32px cell in every block (additions, the main library
  and the composed email), so side padding drops to 20px on a phone. This is the one
  change that touches existing blocks; their content is otherwise untouched.
- `.stack` is on every image, text, card and gutter cell in the picture blocks, AND on
  the inner card `<table>` in `grid_cards_linked` and `two_up_cards` so the card lifts
  its `max-width` and fills the stacked column.
- Every picture in the picture blocks is `width:100%;max-width:100%;height:auto` in CSS
  so it fills its cell at any width; the `width`/`height` attributes remain the Outlook
  contract and set the desktop size.
- The two hours tables carry no `.stack`; they were redesigned to two columns so they fit
  a phone without stacking. Measured at 375px: every labelled line is one 22px row, a
  two-service weekday is three lines.

`Mobile Review.dc.html` at the project root shows the additions file in a 600px and a
375px frame side by side; the same file drives both.

## Content warnings

Everything in `anchor-december-roundup.html` and the library rows (event names, times,
bar hours, weekend kitchen hours, the 22 Dec to 10 Jan exceptions) is realistic stand-in
copy chosen to test wrapping. Every value must be replaced from the events database and
the opening-hours records before send. Weekend kitchen hours and the reply-to address
remain open from the previous handover.

Confirmed by the owner (8 Sept 2026): kitchen last orders are **30 minutes** before each
service ends. The footnote in both hours blocks carries this wording.

## Acceptance checklist for the build

1. Each block extracted between its BLOCK comments renders byte for byte.
2. At 600px: 32px outer padding, 536px content, in line with the existing 31 blocks.
3. At 375px: no horizontal scroll; pictures fill their column; cards stack with a 16px
   gap; hours rows never wrap a time; a closed date is a full dark row.
4. Outlook desktop: images render at their `width`/`height` attributes with no distortion
   for all three artwork ratios.
5. Composed email under 100KB (round-up is ~45KB with placeholders).
