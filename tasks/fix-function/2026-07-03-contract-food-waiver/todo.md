# Private Booking Contract — A4 redesign + conditional self-catering waiver

Approved design: `design_handoff_private_booking_contract` (Paula Campbell reference, A4 print).

## Goal
Rebuild the private-booking contract to the approved 4-page A4 design, and append a
1-page **self-catering food release & indemnity waiver** annex **only when** the booking
includes the "Bring Your Own Food" catering package.

## Scope
- Single file: `src/lib/contract-template.ts` (`generateContractHTML`).
- No schema change, no migration, no new UI. Same browser-print pipeline; served by
  `src/app/api/private-bookings/contract/route.ts` (unchanged).

## Plan
- [x] Read current template, route, and reference HTML
- [x] Confirm data availability (all fields already used by current template) + logo `/logo-black.png`
- [x] Rewrite `generateContractHTML` to emit the handoff design (pages 1–4)
- [x] Detect BYO food package by UUID `9fdbf82b-6717-4bff-8af6-8865cb5bfe21` (name fallback) → `hasOwnFood`
- [x] Append waiver annex (page 5) + screen divider only when `hasOwnFood`
- [x] Per-document page numbering script (contract vs waiver), unchanged from handoff
- [x] Keep escaping of all interpolated booking data
- [x] Verify: lint ✓, typecheck ✓, build ✓, 6 unit tests ✓; page 1 + financial rendered in preview
- [ ] Branch + commit (awaiting user go-ahead)

## Review / result
- Single-file change: `src/lib/contract-template.ts`. New test: `src/lib/__tests__/contract-template.test.ts` (6 passing).
- Waiver appears only for BYO bookings (id match + `bring your own` name fallback), numbered independently ("Waiver page 1 of 1"); contract stays "Page N of 4".
- Verified: `npx tsc --noEmit` clean, `eslint --max-warnings=0` clean, `npm run build` clean, unit tests green; visual check of page 1 + financial summary via preview matched the handoff.
- OPEN for user: the new design drops (1) itemised booking tables, (2) special requirements / accessibility needs / contract note. Not re-added inline because A4 pages are fixed-height and would clip. Decide whether any of these need a home.

## Data mapping (per-booking)
- Ref `PB-{id[0:8].upper}`; waiver ref `{ref}/W`
- Meta: date generated = today; event date+time; event type
- Details: name, phone, email, expected guests, venue (Anchor address, constant)
- Financials: original price, subtotal, event balance due, total event cost; deposit + status
- Agreement (page 2): name, event type, date, times, total, deposit, balance-due date
- Waiver signature: event date, "{event type} · approx. N guests", organiser = customer name

## Flagged for user decision (content the new design drops vs the old contract)
1. Itemised booking tables (venue/catering/vendor line items) — gone; only summary totals remain.
2. Special requirements / accessibility needs / contract note — no slot in the new design.
   Risk: accessibility info silently absent. Recommend deciding where (if anywhere) these go.
   Not added inline because A4 pages are fixed-height (`overflow:hidden`) and would clip.
