# Handover: return-visit voucher card (email block), November 2026

Answers the brief dated 2 November 2026. Read `README.md` in the email kit first; nothing there changes.

## Files

| File | What it is |
|---|---|
| `anchor-email-blocks-voucher.html` | Production markup. Five blocks between BLOCK comments: `voucher_card` (10%, named), `voucher_card_25`, `voucher_card_expiring`, `voucher_card_no_name`, `voucher_card_logo`. Same shell as the library. |
| `Voucher Card (Email Block).html` | Design page. Every variant at 600 and 375 (and 320), fallback-font check, inverted-colour check, in-context view. |
| `png/` | Exports of the three variants at both widths. |

## Where it sits

Between the hero or intro block and the Book a table button, on cream `#faf8f3`, inside the standard 32px gutter (`class="gutter"`, 20px under 620px). Card is 536px wide at 600, 335px at 375, 280px at 320.

## Shell change (one, progressive enhancement)

Add two rules inside the existing `@media only screen and (max-width:620px)` block:

```
.vc-num{font-size:32px !important;line-height:40px !important;letter-spacing:3px !important;}
.vc-date{font-size:18px !important;line-height:26px !important;}
```

Without them the card still fits at 375px in Helvetica (number 284px wide in a 307px cell). They only exist so 320px holds.

## Anatomy, top to bottom (600px values)

Card table: `width="536"`, `background-color:#ffffff`, `border:2px dashed #a57626`. All rows `align="center"` except the conditions table. Every text cell carries `mso-line-height-rule:exactly`.

| Row | Text | Face | Size / line | Colour | Padding (t r b l) |
|---|---|---|---|---|---|
| Logo (optional) | img 112 × 56, alt "The Anchor" | | | | 26 28 0 28 |
| Kicker | Your voucher | Outfit 600, uppercase, 0.18em | 11 / 16 | `#8b6914` on white | 28 28 0 28 (16 top when logo present) |
| Headline | 10% off your food | DM Serif Display 400, -0.02em | 32 / 38 | `#005131` | 10 28 0 28 (10 28 24 28 when no name) |
| Name | For Sarah's table | Outfit 400 | 16 / 24 | `#1a1a1a` | 8 28 24 28 |
| Number label | Voucher number | Outfit 600, uppercase, 0.18em | 11 / 16 | `#f0e6c6` on `#005131` | 18 12 0 12 |
| Number | AN-2611-0042 | Outfit 700, 4px tracking (`class="vc-num"`) | 36 / 44 | `#ffffff` on `#005131` | 4 12 20 12 |
| Expiry label | Valid until | Outfit 600, uppercase, 0.18em | 11 / 16 | `#005131` on `#f5e6d3` | 16 12 0 12 |
| Expiry date | Thursday 11 December 2026 | Outfit 600 (`class="vc-date"`) | 20 / 28 | `#005131` on `#f5e6d3` | 2 12 18 12 |
| How to use | Book a table, then show this email at the bar. | Outfit 400 | 15 / 24 | `#1a1a1a` | 22 28 0 28 |
| Conditions wrapper | nested 100% table, `border-top:1px solid #e2dccf` | | | | 20 28 26 28 |
| Conditions label | Conditions (left) | Outfit 600, uppercase, 0.18em | 11 / 16 | `#8b6914` | 18 0 4 0 |
| Condition rows × 7 | bullet cell 14px wide, `&bull;` | Outfit 400 | 14 / 22 | bullet `#8b6914`, text `#6f6a61` | 4 0 0 0 |

Both band rows (number, expiry) use `bgcolor` on the `<td>` and run the full inner width of the card. The green and sand bands touch; there is no white gap between them.

**Expiring variant**: the two expiry rows change `bgcolor` and `background-color` to `#8b6914`, text to `#ffffff`, label reads "Expiring soon", date reads "Valid until Thursday 11 December 2026". Sizes and padding unchanged.

**25% variant**: headline and first condition only.

## Colours used (all from the guest palette)

| Hex | Used for | Contrast |
|---|---|---|
| `#faf8f3` | page surface behind the card | |
| `#ffffff` | card surface, number text | number on green 9.5:1 |
| `#a57626` | 2px dashed border | decorative |
| `#8b6914` | kickers, bullets, Conditions label; expiring band fill | 5.1:1 on white; white on it 5.1:1 |
| `#005131` | headline, number band fill, expiry text on sand | 9.5:1 on white, 7.7:1 on sand |
| `#f0e6c6` | "Voucher number" label on green | 7.6:1 |
| `#f5e6d3` | expiry band fill (standard) | |
| `#1a1a1a` | name line, how-to-use line | 16:1 |
| `#6f6a61` | condition text | 5.3:1 on white |
| `#e2dccf` | hairline above conditions | |

Not used: `#a57626` as text (fails at small sizes), `#c9a020` (3.9:1 on green).

## Live text slots

`kicker`, `headline` (percentage), `name` (first name, row omitted when empty), `number`, `expiry_label`, `expiry_date` (day name, day, month, year), `how_to_use`, `conditions[]` (6 to 8 strings). The only image is the optional logo.

## Checks done

- 600, 375 and 320: number stays on one line in Helvetica Bold and Arial Bold (284px at 36/4px, 246px at 32/3px; cells are 508, 307 and 252px wide).
- Georgia and Helvetica fallbacks rendered side by side with the brand faces. The number sits in the sans stack on purpose: Georgia's figures are old-style and 3, 4, 5, 7, 9 drop below the baseline, which is harder to read aloud.
- Inverted colours: every text sits on a solid `bgcolor`, no white-on-transparent anywhere.
- Headline wraps to two lines at 375 and 320, as allowed.

## Open items

1. At 320px the standard date wraps to "Thursday 11 December" / "2026" (243px in a 220px cell). It holds and reads; shorten the day name to fit one line if you prefer.
2. Name line uses the possessive ("For Sarah's table") rather than "and her table", to avoid guessing a pronoun. Final copy is yours.
3. The card carries no link; the Book a table button directly below is the tap target. If you want the card tappable, wrap the number cell text in an `<a>` with `color:#ffffff;text-decoration:none`. The cell is 68px tall.
4. Logo variant uses the hosted 400 × 200 black mark at 112 × 56. Recommended default is no logo: the masthead already carries it and an image-blocked Outlook shows an empty box with alt text.
5. Condition copy is a draft from the brief's list. No prices, no "today".
