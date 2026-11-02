# Handoff: The Anchor, return-visit voucher card (email block)

## Overview

One new block for The Anchor's transactional email system: a digital voucher card used in the
"come back" emails (touch 1, 10% off, about six weeks after a visit; touch 2, 25% off, about
three months after) and in the 3-day "expiring soon" reminder. The guest shows the email on a
phone at the bar; staff read the voucher number and type it into the till. The number is the
hero of the card. Every word is live text. No image is required.

Brief: 2 November 2026, owner Peter Pitcher. This bundle answers it in full.

## About the design files: READ THIS FIRST

This is **email HTML, not a web UI**. The usual handoff rule is inverted:

- `anchor-email-blocks-voucher.html` is the **production artefact**. Nested `<table>` layout,
  every style inlined, `bgcolor` attributes, no web fonts, no flexbox or grid. Keep the markup
  **byte-for-byte** and insert templating only into text nodes (and `src`/`alt` on the one
  optional image). Do not port it to React/Tailwind components that render to the DOM.
- If the app uses MJML, react-email or Maizzle, port block by block and **diff the compiled
  output** against this file. Any structural drift is a regression.
- The design page (`Voucher Card (Email Block).html`) and `png/` are references for visual
  checking only. Do not ship or parse them.

Follow the email kit's existing rules (`email-kit-README.md`, copied here): shell head,
preheader, MSO conditionals, `class="wrap"` / `class="gutter"` hybrid responsive pattern,
`mso-line-height-rule:exactly` on text cells, named entities (`&rsquo;`, `&bull;`), absolute
`https://` hrefs, under 80KB per email.

## Fidelity

**High-fidelity.** Every hex, pixel and string is final and checked (contrast, widths at 600,
375 and 320, Georgia/Helvetica fallbacks, inverted colours). Placeholder copy is marked as such
below; the words are the pub's to finalise, the structure is not.

## Files

| File | What it is |
|---|---|
| `anchor-email-blocks-voucher.html` | Production markup. Five blocks between `<!-- BLOCK: name -->` comments, same shell as the kit library. **Parse this.** |
| `HANDOVER-voucher-card-nov-2026.md` | Designer's value sheet: every row's size, line-height, colour and padding. Same numbers as this README. |
| `Voucher Card (Email Block).html` | Design page: all variants at 600/375/320, fallback-font check, inverted-colour check, in-context view. Reference only. |
| `png/` | 2x exports of the three variants at both widths. |
| `email-kit-README.md` | The kit's own integration notes (shell, tokens, block catalogue). |
| `assets/` | Black and white wordmarks, used by the design page only. Production uses the hosted URL below. |

## Blocks in the production file

| Block id | Slots filled | Use |
|---|---|---|
| `voucher_card` | 10%, named guest, no logo | Touch 1 default |
| `voucher_card_25` | 25%, named guest | Touch 2. Differs from `voucher_card` in the headline and first condition only |
| `voucher_card_expiring` | 10%, named, expiry band in dark gold | 3-day reminder |
| `voucher_card_no_name` | 10%, name row removed | When no first name is on file |
| `voucher_card_logo` | 10%, named, logo row added | Optional. Recommended default is **no logo**: the masthead already carries it, and Outlook with images off shows an empty box |

Implement one template with these parameters: `percentage`, `first_name` (nullable),
`voucher_number`, `expiry_date` (full date with day name), `expiring` (boolean),
`show_logo` (boolean, default false), `conditions[]` (6 to 8 strings).

## Where it sits

Between the hero or intro block and the "Book a table" button, on the cream page `#faf8f3`,
inside the standard 32px gutter (`class="gutter"` drops it to 20px under 620px). Card width:
536px at 600, 335px at 375, 280px at 320. The card carries no link; the button under it is the
tap target.

## Shell change (one, progressive enhancement)

Add two rules inside the existing `@media only screen and (max-width:620px)` block in the
shell head:

```
.vc-num{font-size:32px !important;line-height:40px !important;letter-spacing:3px !important;}
.vc-date{font-size:18px !important;line-height:26px !important;}
```

Not load-bearing. Without them the card still fits at 375px in Helvetica Bold (number 284px in
a 307px cell). They exist so 320px holds.

## Anatomy, top to bottom (600px values)

Outer: `<table width="600" class="wrap">` → `<td bgcolor="#faf8f3" class="gutter" padding:32px>`.
Card: `<table width="536" style="width:100%;max-width:536px;background-color:#ffffff;border:2px dashed #a57626">`.
Every row `align="center"` except the conditions table. Fonts: Display =
`'DM Serif Display',Georgia,'Times New Roman',serif`; Body =
`'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif`. Recipients almost always see Georgia
and Helvetica/Arial; the design is checked in both.

| # | Row | Copy (placeholder) | Face / weight | Size / line | Letter-spacing | Colour | Padding t r b l |
|---|---|---|---|---|---|---|---|
| 0 | Logo (optional) | img 112 × 56, `alt="The Anchor"` | | | | | 26 28 0 28 |
| 1 | Kicker | Your voucher | Body 600, uppercase | 11 / 16 | 0.18em | `#8b6914` | 28 28 0 28 (16 top if logo) |
| 2 | Headline | 10% off your food | Display 400 | 32 / 38 | -0.02em | `#005131` | 10 28 0 28 (10 28 24 28 if no name) |
| 3 | Name | For Sarah&rsquo;s table | Body 400 | 16 / 24 | | `#1a1a1a` | 8 28 24 28 |
| 4 | Number label | Voucher number | Body 600, uppercase | 11 / 16 | 0.18em | `#f0e6c6` on `bgcolor="#005131"` | 18 12 0 12 |
| 5 | Number | AN-2611-0042 | Body 700, `class="vc-num"` | 36 / 44 | 4px | `#ffffff` on `bgcolor="#005131"` | 4 12 20 12 |
| 6 | Expiry label | Valid until | Body 600, uppercase | 11 / 16 | 0.18em | `#005131` on `bgcolor="#f5e6d3"` | 16 12 0 12 |
| 7 | Expiry date | Thursday 11 December 2026 | Body 600, `class="vc-date"` | 20 / 28 | | `#005131` on `bgcolor="#f5e6d3"` | 2 12 18 12 |
| 8 | How to use | Book a table, then show this email at the bar. | Body 400 | 15 / 24 | | `#1a1a1a` | 22 28 0 28 |
| 9 | Conditions wrapper | nested `width="100%"` table, `border-top:1px solid #e2dccf` | | | | | 20 28 26 28 |
| 9a | Conditions label | Conditions (left-aligned, `colspan="2"`) | Body 600, uppercase | 11 / 16 | 0.18em | `#8b6914` | 18 0 4 0 |
| 9b | Condition rows × 7 | bullet `<td width="14">&bull;</td>` + text | Body 400 | 14 / 22 | | bullet `#8b6914`, text `#6f6a61` | 4 0 0 0 each |

Rows 4 to 7 are the two "bands". They run the full inner width of the card, use `bgcolor` on
the `<td>` plus `background-color` inline, and touch each other (no white gap between green
and sand).

**Expiring variant** (`voucher_card_expiring`): rows 6 and 7 change `bgcolor` and
`background-color` to `#8b6914`, text to `#ffffff`, label reads "Expiring soon", date reads
"Valid until Thursday 11 December 2026". Nothing else moves. On a 375px phone this line wraps
to two centred lines; that is expected.

**No name** (`voucher_card_no_name`): drop row 3; row 2 padding becomes `10px 28px 24px`.

**Logo** (`voucher_card_logo`): add row 0; row 1 top padding becomes 16px. Hosted mark:
`https://www.the-anchor.pub/images/branding/the-anchor-pub-logo-black-transparent.png`
(400 × 200, rendered 112 × 56, keep 2:1).

## Design tokens used (guest palette only, no additions)

| Hex | Role here | Contrast |
|---|---|---|
| `#faf8f3` | page surface behind the card | |
| `#ffffff` | card surface; number text | number on `#005131` 9.5:1 |
| `#a57626` | 2px dashed card border (decorative only, never text) | |
| `#8b6914` | kickers, bullets, Conditions label; expiring band fill | 5.1:1 on white; white on it 5.1:1 |
| `#005131` | headline; number band fill; expiry text on sand | 9.5:1 on white; 7.7:1 on `#f5e6d3` |
| `#f0e6c6` | "Voucher number" label on green | 7.6:1 |
| `#f5e6d3` | expiry band fill (standard) | |
| `#1a1a1a` | name line, how-to-use line | 16:1 on white |
| `#6f6a61` | condition text | 5.3:1 on white |
| `#e2dccf` | hairline above conditions | |

Deliberately not used: `#a57626` as text (fails under 18px), `#c9a020` (3.9:1 on green).

Type scale in the card: 11/16 kicker · 14/22 conditions · 15/24 how-to · 16/24 name ·
20/28 date (18/26 mobile) · 32/38 headline · 36/44 number (32/40 mobile).
Spacing is the kit's 8px rhythm with 2px and 4px nudges inside the bands. Radii: none (square,
like the offer panel). Shadows: none.

## Copy rules for the live text

British English, sentence case, first-person plural, no exclamation marks, no em dashes,
no prices, no "today" or "tonight". Date always carries the day name:
"Thursday 11 December 2026". Voucher number format as the ledger issues it, e.g. `AN-2611-0042`.
Name line uses the possessive ("For Sarah's table") so no pronoun is guessed; when
`first_name` is null the row is omitted. Conditions below are a draft from the brief; final
wording is the pub's:

1. 10% off food for the booked table, in one visit.
2. Drinks are not included.
3. Not valid with the Christmas menu or special occasion menus.
4. Book your table in advance.
5. One voucher per table.
6. Cannot be used with any other offer.
7. Show this email at the bar so we can read the voucher number.

Escape `& < > "` on every interpolated value.

## Responsive and client behaviour

- Outlook desktop: 600px, ignores media queries, forces Arial via the MSO conditional. Fits.
- iOS Mail, Gmail app, Outlook app: media query applies; `.gutter` 20px, `.vc-num` 32/40/3px,
  `.vc-date` 18/26. Headline wraps to two lines at 375 and 320, as allowed. Number stays on
  one line at 320 (246px in a 252px cell).
- 320px: the standard date wraps to "Thursday 11 December" / "2026" (243px in a 220px cell).
  Holds and reads.
- Dark mode: every text sits on a solid `bgcolor`; no white-on-transparent anywhere. Full
  inversion keeps every pairing legible (see the design page).
- Images off: with the default no-logo blocks there is nothing to block. With `voucher_card_logo`,
  the alt text "The Anchor" shows in a 112 × 56 box.

## Acceptance (from the brief)

- Renders correctly on iPhone Mail, Gmail on Android and Outlook desktop, images off, web fonts off.
- The number is the first thing the eye lands on and can be read aloud across a bar.
- Expiry date and conditions legible without zooming at 375px.
- Every colour is in the palette table above.
- Compiled output for each of the five blocks diffs clean against `anchor-email-blocks-voucher.html`
  apart from text nodes.
