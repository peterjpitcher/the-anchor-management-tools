# /receipts review, 14 Aug 2026

Full read of all 21 files under `src/app/(authenticated)/receipts/`, plus the
receipts services, rule matching and live production data.

## Fixed in this pass

| # | Problem | Where |
|---|---------|-------|
| 1 | No summary stats at all below 768px: the whole Stat grid was `hidden md:grid` | `_components/ui/ReceiptStats.tsx` |
| 2 | Sort control vanished between 640px and 1024px. Card list ran to `lg:hidden`, the sort select stopped at `sm:hidden`, so iPad portrait had cards and no way to sort | `_components/ui/ReceiptList.tsx` |
| 3 | Desktop table could not sort by amount, though In/Out/total are valid sorts and are offered on mobile. Worse, the default sort with no month selected *is* `amount_total`, which no header indicated | `_components/ui/ReceiptList.tsx` |
| 4 | Mobile could not skip or mark-missing unless the row was `pending`; desktop gated on "not already this status". A completed row could be skipped on desktop but not on mobile | `_components/ui/ReceiptMobileCard.tsx` |
| 5 | Note "Edit" button was `invisible group-hover:visible`. There is no hover on an iPad, so editing an existing note was unreachable | `_components/ui/ReceiptTableRow.tsx` |
| 6 | Empty-string vendor/expense rendered as a blank clickable gap: `??` does not catch `''`. Those are exactly the rows the "Missing vendor" filter surfaces | `_components/ui/ReceiptTableRow.tsx` |
| 7 | "Bulk" nav tab was shown to everyone, but the page requires `receipts:manage` and redirects to `/unauthorized` | `receiptsNavItems.ts`, `_components/ReceiptsPageChrome.tsx` |
| 8 | Vendors page ran `getReceiptVendorSummary(12)` and used it only for a length check. All displayed data is fetched again client-side | `vendors/page.tsx`, `vendors/_components/VendorSummaryGrid.tsx` |
| 9 | Native `confirm()` for rule deactivation while the rest of the app uses `ConfirmDialog` | `_components/ui/ReceiptRules.tsx` |
| 10 | Nav said "P&L", page title said "Business Health". Nav had both "Needs expense" and "Missing expense" | `receiptsNavItems.ts` |
| 11 | Dead code: unused `useMemo`/`toast`/`canManageReceipts` imports, `md:col-span-3` on a card inside a 2-column grid | `ReceiptsClient.tsx`, `ReceiptUpload.tsx` |
| 12 | Design tokens were used in 2 files out of 21. See the sweep section below | 9 files |

## Design token sweep (done)

This was the root cause of "the UI isn't consistent". Raw Tailwind palette
classes versus design-token classes, before and after:

| File | before | after |
|------|--------|-------|
| `vendors/_components/VendorSummaryGrid.tsx` | 137 raw / 0 tokens | 2 / 142 |
| `monthly/page.tsx` | 71 / 0 | 12 / 60 |
| `_components/PnlClient.tsx` | 53 / 0 | 0 / 55 |
| `_components/ui/ReceiptRules.tsx` | 47 / 0 | 0 / 47 |
| `_components/ui/ReceiptMobileCard.tsx` | 36 / 0 | 0 / 36 |
| `_components/ReceiptBulkReviewClient.tsx` | 34 / 0 | 0 / 34 |
| `missing-expense/page.tsx` | 30 / 0 | 0 / 30 |
| `_components/ui/ReceiptTableRow.tsx` | 24 / 21 | 3 / 42 |
| `monthly/MonthlyCharts.tsx` | 19 / 0 | 4 / 16 |

431 replacements in two scripted passes plus hand fixes. Neutrals went to
`text-text*` / `bg-surface*` / `border-border*`; tone pairs went to
`success` / `warning` / `danger` / `info`; the interactive green went to
`primary`, so the section no longer runs two different greens. The mobile card
no longer paints `backgroundColor: 'white'` inline, so it follows the surface
token.

The 21 raw classes left are deliberate:

- `SPENDING_PALETTE` and `INCOME_PALETTE` in `monthly/page.tsx`, and the bar
  and legend colours in `MonthlyCharts.tsx`. The shade itself is the data.
- The diverging movement bars in `VendorSummaryGrid.tsx` (up is rose, down is
  emerald).
- The purple "Rule" classification badge in `ReceiptTableRow.tsx`. There is no
  purple token, and it has to stay distinguishable from the blue "AI" badge.

## Still open, needs a decision

### Three Card APIs and two Alert APIs in one section

- `<CardHeader title subtitle/>` in the workspace and P&L
- `<Card header={<h2/>}>` in monthly and the charts
- bare `<Card>` with a hand-rolled `<h2>` inside in bulk review, vendors, rules
- `<Alert tone="warning">{children}</Alert>` vs `<Alert variant="error" title description/>`

All render, because the deprecated compat props still work. They just look
subtly different from each other.

### Bespoke controls where a design-system component already exists

- `SegmentedControl` in `VendorSummaryGrid` duplicates the DS `Segmented`
- raw `<select>` at `VendorSummaryGrid.tsx:642` and `:691`
- raw `<input type="checkbox">` at `ReceiptRules.tsx:530, 581, 712, 916`
- raw `<input>` for the desktop note editor with a hardcoded `border-gray-300`
- raw `<details>` at `PnlClient.tsx:494` instead of `Accordion`

### Touch targets below 44px

The delete-file `x` button is about 14px in both the table row and the mobile
card. Receipts is used on an iPad.

### Duplication

`ReceiptTableRow` and `ReceiptMobileCard` carry roughly 200 lines of identical
logic (status update, upload, delete, save classification, save note). They have
already drifted once, which is what caused finding 4 above. A shared
`useReceiptRowActions` hook would stop them drifting again.

`formatDate` is reimplemented 5 times and `statusLabels` 4 times. Note
timestamps use `new Date().toLocaleString('en-GB')`, which is the browser's
timezone rather than Europe/London.

### Mobile commitment is inconsistent

The workspace is carefully mobile-optimised. The rules panel is
`hidden md:block` and the P&L page is unusable on a phone.
