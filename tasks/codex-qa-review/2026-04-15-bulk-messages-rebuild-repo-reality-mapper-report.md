Created [bulk-messages-rebuild-reality-map.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-15-bulk-messages-rebuild-reality-map.md).

It covers each requested area against the spec and calls out the main repo realities reviewers need to account for. The highest-risk mismatches are:

- The spec’s recipient eligibility does not match the real send pipeline. `src/lib/sms/bulk.ts` still filters on `sms_opt_in`, `marketing_sms_opt_in`, and `sms_status === 'active'`, so a spec-aligned fetch layer would otherwise surface recipients who later get skipped at send time.
- Booking semantics are more nuanced than the spec implies. In practice, “active” bookings are tied to `status IN ('pending_payment', 'confirmed')`, and reminder-only bookings are explicitly excluded from category stats.
- Permission naming in the spec does not match current patterns. The repo uses `messages:view` for page/read access and `messages:send` for sending; I did not find an established `messages:create` pattern for this flow.
- The current bulk customers API route has a real filtering bug for “without bookings” because it relies on global `total_bookings` rather than the filtered booking scope.
- `ui-v2` has solid table/search/dialog primitives, but there is no existing searchable combobox/select pattern matching the spec’s event picker.

No application code was changed beyond adding the context document. No tests were needed for this doc-only pass.