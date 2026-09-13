# Orange Jelly sample pack

Nine PDFs showing what the system produces today for Orange Jelly documents.
They go with *Design brief: Orange Jelly* and are what "before" looks like.

**The data is invented.** No real client, employee or candidate appears in any
of these. Names, figures, line items and terms were made up to fill the
layouts. Do not treat any of the wording as live policy.

**Everything else is real.** Each sample was printed through the same code, with
the same margins, page sizes and footers, as the live system. They match what
production was serving on 10 September 2026.

The data sits near the top of each field's realistic range on purpose: long
names, eight line items, a five-page contract. That shows the layouts under
pressure rather than at their best.

## What is in the pack

| File | Document | Archetype | Note |
|---|---|---|---|
| 01 | Invoice, overdue, 8 line items, mixed VAT | A. Financial | |
| 02 | Invoice with a deposit notice | A. Financial | |
| 03 | Credit note | A. Financial | The layout exists, but the system does not send credit notes to customers today |
| 04 | Receipt | A. Financial | |
| 05 | Quote | A. Financial | |
| 06 | Client statement with ageing | A. Financial | |
| 07 | Private booking contract, 5 pages | B. Legal | In The Anchor's style today, moving to Orange Jelly |
| 08 | Interview kit, 6 pages | C. Pack | In The Anchor's style today, moving to Orange Jelly. Has the running footer |
| 09 | Weekly cashing up, landscape | D. Report | |

Every Orange Jelly archetype has at least one real example.

## Orange Jelly documents not in the pack

Each is a close sibling of a sample above, so nothing new is being asked.

| Document | Nearest sample | Why there is no sample |
|---|---|---|
| Work record | 06, client statement | Same template family |
| Timesheet | 06, client statement | Same family. It currently has no logo at all |
| Zero-hours worker agreement | 07, contract | Same style as the contract today |
| Trial brief | 08, interview kit | Same running-footer family |
| New starter pack | 08, interview kit | Closest match |
| Rota | 09, cashing up | Its layout is built inside the page code, so it cannot be printed on its own |
| Rota hours report | 09, cashing up | Same as the rota |
| P&L report | 09, cashing up | Portrait rather than landscape |
| Quarterly claim summary | none | Drawn line by line in code rather than laid out as a page |

## Two things in the pack the design should fix

1. **The contract footer overlaps the body text** at the bottom of page 1 of
   sample 07. The footer shares space with the flowing text instead of having
   its own band. The exact overlap depends on how the text falls, but the cause
   is structural, and it is why the brief asks for a reserved running footer.

2. **Samples 07 and 08 load their fonts from Google at print time.** They look
   right here because the machine that made them was online. Inside the live
   server that request can fail, and the document then silently falls back to
   Georgia and a system font. This is why the brief asks for font files, not
   font names.

---

*Regenerate with `scripts/design/generate-sample-pack.ts` in the management app.*
