# Discovery

Verified live project: the-anchor-management-tools, tfcasgxopxegwrabvwat (matches supabase/.temp/project-ref). No dependent views or application triggers on the two recurring-charge tables. Current checkout is behind origin/main, but relevant billing and client files match fetched origin/main.

Disable deletes unbilled instances. End charge must preserve arrears and remain billing-eligible with an end date. Quarterly and annual charges cover their anniversary interval upfront. Already invoiced coverage extending beyond the proposed end must block closure and require a separate correction. Cap splits must retain their existing amounts rather than regenerate full charges.

Decision: inclusive last service date; actual calendar days; round ex VAT to pennies, then existing VAT calculation. End charge previews all outstanding amounts and queues the final amount for the normal billing run. No live records changed.


Additional discovery: the live reissue transaction omits coverage fields from virtual instances. The new service-only wrapper persists these fields, checks charge definition versions and reserves definitions while reissuing. Original transaction and invoice-send paths remain unchanged. Closure includes completed cycles missing after the last recorded period, or from the creation month when there is no history. The preview exposes those amounts before confirmation. Monthly caps still apply; ending a charge does not waive earlier debt or override client billing settings.

Local SQL tests use PostgreSQL 17; production reports PostgreSQL 15. The migration uses syntax available in PostgreSQL 15. Current Supabase changelog was checked; the minor-version index/cipher changes do not affect these routines. RPC usage was checked against official documentation: https://supabase.com/docs/reference/javascript/rpc.
