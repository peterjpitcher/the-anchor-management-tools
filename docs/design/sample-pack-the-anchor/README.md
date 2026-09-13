# The Anchor sample pack

Five PDFs showing what the system produces today for The Anchor's documents.
They go with *Design brief: The Anchor* and are what "before" looks like.

**The data is invented.** No real guest appears in any of these. Names,
bookings, dishes and the voucher terms were made up to fill the layouts. Do not
treat any of the wording as live policy.

**Everything else is real.** Each sample was printed through the same code, with
the same margins and page sizes, as the live system. They match what production
was serving on 10 September 2026.

The data sits near the top of each field's realistic range on purpose: long
names, a twelve-cover pre-order, forty dishes. That shows the layouts under
pressure rather than at their best.

## What is in the pack

| File | Document | Archetype | Note |
|---|---|---|---|
| 01 | Voucher cards, 4 cards, front and back, landscape | E1. Keepsake | Printed several to a sheet and cut by hand |
| 02 | Voucher terms sheet | E1. Keepsake | Staff print this from a web page, so this is a close stand-in for a browser print |
| 03 | Table booking sheets, 3 bookings, one with a 12-cover pre-order | E2. Working paper | |
| 04 | Dish allergen matrix, 40 dishes, landscape | E2. Working paper | |
| 05 | Ingredient allergen matrix, 40 ingredients, landscape | E2. Working paper | |

Both Anchor archetypes have at least one real example.

The voucher terms in samples 01 and 02 end with an issuer clause naming Orange
Jelly Limited. We added it to show one place the legal line could sit. It is
illustrative, not the live wording.

## Anchor documents not in the pack

Each is a close sibling of a sample above, or is described in the brief.

| Document | Nearest sample | Why there is no sample |
|---|---|---|
| Event booking sheet | 03, table booking sheet | Same style family |
| Event guest list | none | Drawn line by line in code rather than laid out as a page |
| Private booking staff event sheet | 03, table booking sheet | Plainer, with no branding today |

## One thing in the pack the design should know about

**Sample 03 loads its fonts from Google at print time.** It looks right here
because the machine that made it was online. Inside the live server that
request can fail, and the sheet then silently falls back to Georgia and a
system font. The voucher cards (01 and 02) already avoid this by embedding the
same three fonts from files. That is the pattern the brief asks for everywhere.

---

*Regenerate with `scripts/design/generate-sample-pack.ts` in the management app.*
