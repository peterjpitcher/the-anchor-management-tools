# Golden Barrels Limited, account reconciliation

Date: 19 August 2026
Status: numbers confirmed against the email trail; backfill hours awaiting owner confirmation

## The agreement, confirmed from the emails

Proposal sent 6 November 2025, accepted by Mihiir Patel on 8 November:

> Total Investment: 34.5 hours @ GBP 75/hour = GBP 2,587.50 + VAT

Mihiir's acceptance: "it will cover everything, including the website and social media
handling (as mentioned in your quote)." He asked to pay GBP 1,000 up front and the rest
at GBP 500 per month.

INV-003VC (GBP 1,125, the 50% deposit) was emailed on 11 December and voided on
15 December. On 16 December Peter wrote: "I've pulled a contract for the GBP 500 per
month payment schedule." That is the arrangement in force.

**So the workshop, the brand work, the website and social media handling are a FIXED
PRICE of GBP 3,105.00 inc VAT. Hours do not change it.** Everything outside that scope
(Sea & Seeds, post-launch Dukes Head work, hosting) is chargeable separately under the
GBP 500 per month cap.

## The bottom line

| | Inc VAT |
|---|---|
| Fixed price: workshop, brand, website, social | 3,105.00 |
| Sea & Seeds, 27.00 h plus the domain | 2,133.00 |
| Dukes Head post-launch, 8.00 h May to July | 600.00 |
| Hosting, January to July | 300.00 |
| **Total owed for everything** | **6,138.00** |
| Paid | 4,355.00 |
| **Outstanding** | **1,783.00** |

Of which GBP 1,000 is already invoiced (INV-003WC, INV-003W9), leaving GBP 783.00 to
raise. At GBP 500 a month: September GBP 500, October GBP 283.

The system left alone would have collected GBP 2,650.00, because it values the
fixed-price scope by the hour off an incomplete ledger. That is the GBP 867.00
difference. It is not a credit and not a refund; it is the agreed price being honoured.

## Payments, settled

Mihiir's 3 February email lists GBP 855 (1 Dec) and GBP 500 (5 Jan). INV-003VM's payment
is dated 4 February, the day after that email, so the app and his own record agree.
GBP 4,355.00 paid is correct. Earlier concern about a duplicated January payment is
closed.

## The real gap: work never tracked

Time tracking was only set up on 21 January 2026 at 09:23. Everything before that was
logged retrospectively that morning, and the December work was missed entirely. From the
email trail:

- **6 Nov 2025**: discovery call and digital proposal. INV-003VB billed 9.5 hours but only
  7.50 hours is logged, so 2.00 hours is missing here.
- **11 Dec 2025**: brand guidelines for The Dukes Head, three website style options mocked
  up, black and white logo versions delivered.
- **16 to 23 Dec 2025**: core site build. Full site structure, navigation, working admin
  area, management for menu items, bookings, events and blocked dates, supporting pages.
  First version delivered 24 December.
- **29 to 31 Dec 2025**: "I'll be working between Christmas and New Year."
- **10 Jan 2026**: all menu changes applied to the new site.

Tracked hours in the fixed-price scope are already 35.75 against 34.5 quoted, before any
of the above is added.

## Scope, settled in writing (from the Sent folder)

**Social media was explicitly excluded.** Mihiir assumed on 8 November that the quote
covered "social media handling". Peter corrected it in writing on 10 November: "the
estimate doesn't include social media content. However, it does include a set of brand
identity documents that will guide your current social media person." Two days after the
assumption, before any money changed hands. There is no exposure here.

**The project closed at the end of January and everything after is hourly.** Peter wrote
on 21 January: "My aim is to close the project off at the end of next week... After we
close it out, any further updates become chargeable by the hour." The site went live on
17 January and the last in-scope entry is 30 January. So the 8.00 hours of Dukes Head
work in May to July, and all the Sea & Seeds work, are correctly chargeable.

## Code fix (in the working tree, not committed)

The Work Record built its invoice list from the work entries, so an invoice with nothing
linked was invisible. That is why INV-003VM appeared on the statement and not the Work
Record. It now loads the whole invoice ledger, refuses to generate while any invoice has
nothing behind it, and names the offending invoice.
