# Design brief: return-visit voucher card (email)

Date: 2 November 2026. Owner: Peter Pitcher. For: the designer of The Anchor email kit.
Parent spec: `tasks/spec-2026-11-02-table-booking-return-visits.md` (sections 6, 7 and 9).
House style: `docs/design/brief-the-anchor.md`. Existing email kit: `docs/design/email-handover/The Anchor Email Kit.dc.html` and `anchor-email-blocks.html` (the "offer panel" block is the nearest relative).

## 1. What it is

One new email block: a digital voucher card. It sits inside two automatic guest emails sent to people who booked a table and have not been back:

- Touch 1, about six weeks after their visit: a 10% voucher.
- Touch 2, about three months after, if they still have not returned: a 25% voucher.

The same card appears a third time in a short "expires in 3 days" reminder email.

The voucher is a real voucher in our ledger with a number like `AN-2611-0042`. There is no printed card and no web page. The guest shows the email on their phone at the bar; a member of staff reads the number and types it into the till screen. So the number has to be legible at arm's length, across a bar, on a phone.

## 2. Deliverables

1. The card, two variants: **10% off** and **25% off**. Same layout, the percentage is the only change (an accent difference between the two is welcome but not required).
2. Each at desktop width (600px email column) and phone width (375px, must also hold at 320px).
3. An optional "expiring soon" treatment for the reminder email (for example the "valid until" line emphasised). If you skip this, the standard card is used.
4. A one-page handover note: every colour used (must come from the list in section 4), font sizes and line heights in px, spacing in px, and which text is live text.
5. Format: a page in the existing email kit file, or Figma, plus PNG exports of each variant at both widths. If you deliver HTML, follow the kit's table-based pattern.

## 3. What the card must contain (all live text, nothing in an image)

| Element | Example (placeholder copy, ours is written later) | Notes |
|---|---|---|
| Kicker | "Your voucher" | small caps style as the kit uses |
| Headline | "10% off your food" | allow two lines on a phone |
| Voucher number | `AN-2611-0042` | the hero of the card: largest text, letter-spaced, copyable; a plain sans or the kit's serif, never an image |
| Valid until | "Valid until Thursday 11 December 2026" | full date with the day name; this is the legal closing date and must be prominent, not small print |
| Who it is for | "For Sarah and her table" | first name only; allow for no name at all |
| How to use | "Book a table, then show this email at the bar." | one line |
| Conditions | 6 to 8 short lines | must be readable, not grey-on-cream mouse type; by law the conditions and expiry sit in the email itself, so allow the space |
| Logo | The Anchor mark | optional; black mark on cream from `docs/design/voucher-system/assets/anchor-logo-black.png` (same file as `public/guest/anchor-logo-black.png`) |

The conditions will read roughly: 10% off food for the booked table in one visit; drinks excluded; not valid with the Christmas menu or special-occasion menus; advance booking required; one voucher per table; not with any other offer; the voucher number must be shown and read at the bar.

## 4. Constraints

- **Colours** from the guest palette only (`src/lib/brand/palette.ts`, `GUEST`): green `#005131`, deep green `#0c1d11`, light green `#006b45`, gold `#a57626`, dark gold `#8b6914`, deep gold `#6f5410`, bright gold `#c9a020`, cream `#faf8f3`, cream text `#f0e6c6`, sand `#f5e6d3`, sunk `#f2ede3`, white surface `#ffffff`, border `#e2dccf`, strong border `#d2c9b4`, charcoal text `#1a1a1a`, muted text `#6f6a61`, accent text `#8b6914`, button `#8b6914` with white text. No new colours.
- **Contrast** 4.5:1 for all text. Gold `#a57626` on cream fails for small text; use dark gold `#8b6914` or green for anything under 18px.
- **Fonts** as the kit: DM Serif Display for headings, Outfit for body, with Georgia and Helvetica fallbacks. Many mail apps will not load the web fonts, so the card must still look right in Georgia and Helvetica. Check the number in both.
- **Email HTML reality**: single column, 600px maximum, table-based, no background images, at most one image (the logo), no gradients or shadows that need CSS3, no video, no emoji. Images are blocked by default in Outlook, so the card must make sense with the logo missing.
- **Light theme only**, but Gmail and Outlook may force dark mode: avoid pure white text on transparent and avoid relying on a cream background to make text visible. Check the design with colours inverted.
- **Tap targets** at least 44px tall where the card is tappable (it may link to the booking page).
- **Copy rules**: British English, plain, no exclamation marks, no prices, no "today" or "tonight", no em dashes. Placeholder copy is fine; final copy is ours.
- **Fit**: the card sits between the kit's hero or intro block above and the "Book a table" button below, on the cream page background, inside the standard 32px gutter. Match the kit's rhythm; the dashed gold border of the existing offer panel is a fine starting point but you may evolve it.

## 5. Not needed

A printed card, a web page, a QR code, staff screens, a Christmas variant, a dark-mode design.

## 6. Acceptance

- Reads correctly on iPhone Mail, the Gmail app on Android and Outlook desktop, with images off and with web fonts off.
- The number is the first thing the eye lands on and can be read aloud from a phone held across a bar.
- Expiry date and conditions are legible without zooming on a 375px phone.
- Every colour maps to the palette list above. The build team converts the design into a fixed email block with a pixel-exact fixture, so the handover note needs real numbers, not "about".
