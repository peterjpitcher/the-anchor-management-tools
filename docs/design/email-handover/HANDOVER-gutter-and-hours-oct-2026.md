# Handover to Claude Code: gutter pass and hours tables, October 2026

Answers email design brief 2 ("Twenty-five cells to gutter"). Read `README.md` and
`HANDOVER-additions-sept-2026.md` first; nothing there changes except where this note says so.

## 1. Gutter pass: what changed, block by block

Rule applied exactly as briefed: every left-aligned cell with 32px side padding gets
`class="gutter"`; centred cells are left alone. Only `class="gutter"` was inserted. No
padding, type, width/height, indentation or media-query changes. Both files were edited,
and `send-ready/` mirrors `design_handoff_anchor_email/` byte for byte.

### `anchor-email-blocks.html` (library), 10 cells
| Block | Cell (padding) |
|---|---|
| faq_rows | `0 32px 30px` |
| menu_list | `0 32px 26px` |
| steps | `0 32px 30px` |
| text_block | `16px 32px 0` (bullet row) |
| whats_on_list | `0 32px` |
| event_row | `32px` |
| feature_card | `32px` |
| offer_panel | `32px` |
| review | `32px` |

(9 blocks, 9 cells; the library's `signoff_ps` was already fully guttered from September,
so its three listed cells are the ones in the Christmas file below.)

### `anchor-christmas-and-lunch.html`, 15 cells
| Block | Cells (padding) |
|---|---|
| hero_image | `40px 32px 8px` · `10px 32px 0` · `16px 32px 0` · `14px 32px 0` |
| fact_strip | `8px 32px 12px` |
| section_intro | `0 32px 6px` · `8px 32px 0` · `14px 32px 24px` |
| price_tiles | `34px 32px 0` · `16px 32px 0` |
| hours_table | `28px 32px 0` |
| amenity_grid | `26px 32px` |
| signoff_ps | `30px 32px 0` · `2px 32px 0` · `18px 32px 32px` |

Total 24 of the 25 on the brief. **Which file wins:** for these seven blocks,
`anchor-christmas-and-lunch.html` is the source from now on; they are not in the library.

### Not done: `note_bar` (`24px 32px`)
`note_bar` is not drawn in any file in this handover (it is listed in `README.md` but
was never added to the library). Its five uses must come from a campaign file we do not
hold. Apply the same one-attribute change there, or send us the block and we will draw it
into the library.

### Nothing deliberately un-guttered
None of the 25 is un-guttered on purpose. One observation for your list: `pull_quote`'s
body cell (`24px 32px`, left-aligned) also lacks the class and was not on the brief. We
have not touched it; add it to the next pass if you agree it fits the rule.

## 2. Hours tables: desktop layout (the one change outside the brief)

The two September hours blocks were mobile-first and left the right half of the 536px
table empty at 600px. Both now have a real desktop layout and stack to the approved
mobile layout with the existing `.stack` class. No new CSS, no fourth class.

### `opening_hours_week`
Day cell unchanged (112px). The details cell now holds a nested 100% table with two
`.stack` cells: **Bar** (176px, `BAR 12pm to 10pm`) and **Kitchen** (`LUNCH …` /
`DINNER …`, or `KITCHEN …`, or `KITCHEN Closed`). The optional `exception` note sits
after the nested table, full width of the details cell, so it reads last at both widths.

- 600px: Day | Bar | Kitchen, one row per day, two-service days are two lines tall.
- 375px: Bar line, Kitchen line(s), note, exactly the layout approved in September.

### `opening_hours_dates`
Same pattern: nested table with **Hours** (150px, 15/22 nowrap) and **Note** (13/20)
as `.stack` cells. Closed rows keep the full dark `#0c1d11` treatment; "Closed" and
the note are `#f0e6c6` as before.

- 600px: Date | Hours | Note in three columns.
- 375px: Date | Hours over Note, as approved.

Slot names and per-row schema are unchanged. Rows are in
`anchor-email-blocks-additions.html` (between the BLOCK comments) and both tables are
also updated in `anchor-december-roundup.html`.

## 3. December: the grouped row

Our recommendation is option two (a grouped range row plus the four genuinely
different dates). It needs the schema to allow `date_from` / `date_to` on a row. We will
draw the grouped-row variant once you confirm; it is a design change so it is not in this
drop.

## Acceptance
1. Diff against the 8 September files shows only `class="gutter"` insertions, except inside
   the two hours blocks (and their copies in the round-up).
2. At 375px every left-aligned cell in every block sits at a 20px edge.
3. `opening_hours_week` at 600px renders three columns; at 375px it matches the
   September approval.
