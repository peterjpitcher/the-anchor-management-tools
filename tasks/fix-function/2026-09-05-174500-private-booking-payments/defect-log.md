# Confirmed defects and local corrections

1. Live CHECK constraints rejected the values written by the PayPal payment routine. Both constraints now allow PayPal in the draft migration.
2. Webhook recording failure was acknowledged and made unretryable. Failures now release the claim and return an error so retries remain possible.
3. Reconciliation could lose payment references or stop retrying unresolved money. References are preserved, provider capture status is checked and failures alert staff.
4. The capture writer was exported from a server-action module without its own caller authentication. It now lives in a server-only internal module, reached only through validated entry points.
5. Capture flows needed stronger invoice identity, currency, amount and individual capture-state checks. Tests exercise mismatches, pending capture, stale approved orders and already completed orders without a second capture.
6. Invoice and booking records calculated money independently. Shared reads and transactional SQL now count original payments once, mirror booking payments consistently and update status/date together.
7. Applied deposits were still shown as a separate refundable bond and excluded from the booking balance. Displays, history, reminder inputs, refund guards and future contract figures now respect the saved deposit treatment.
8. Read failures could produce an empty payment history and misleading balance. Ledger reads now fail explicitly.
9. Existing payment edits/deletes and concurrent entries could leave stale sums or duplicate credits. Trigger recalculation, consistent locks, capture immutability and association checks protect those paths.
10. Linked prices, applied deposits and invoice cancellation could change one side of the recorded agreement independently. Database guards require the linked invoice and its payments to be resolved first.
11. A real overpayment must remain recorded. The full capture is retained, with audit/log evidence and an alert rather than silently discarding money.
12. Adding contract payment figures exposed a layout overflow and an unconditional refund promise inconsistent with an applied deposit. Synthetic PDFs were rendered, inspected and corrected. Existing sent documents were not regenerated.

All corrections remain local pending exact migration and deployment approval. There is no claimed production fix yet.
