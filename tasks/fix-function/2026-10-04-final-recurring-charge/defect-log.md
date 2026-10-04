# Findings

FF-001 | UX gap | High | High confidence | ClientsClient Disable and recurring-charges discardUnbilledInstancesForCharge | Cannot close with final invoice | No end date or proration | Fix: additive End charge, preview and atomic RPC | Authorised local implementation | Acceptance: preserves arrears, final prorated line, no future periods.

FF-002 | Data risk | High | High confidence | Billing cron/reissue synthesise full period charges | Final invoice would overcharge | No shared final coverage | Fix: shared calendar-day helper across live and preview | Authorised local implementation | Acceptance: monthly/quarterly/annual/leap/DST tests.

FF-003 | Data risk | High | High confidence | Disable removes all unbilled charge instances | Closure would lose carried-forward amounts | Destructive disable differs from ending service | Fix: retain Disable separately, never reuse it for closure | Acceptance: outstanding periods preserved and shown.


FF-004 | Data risk | High | High confidence | Verified live reissue_oj_invoice_transaction omits coverage columns | Reissues lose final service dates | Older virtual insert list | Fix: service-only wrapper materialises coverage, validates versions, delegates unchanged transaction | Authorised local implementation, production approval pending | Acceptance: actual transaction attaches final prorated line and annual coverage in isolated smoke test.

FF-005 | Data risk | High | High confidence | Cron reserves instances before invoice link | Concurrent reissue can take reserved rows | No shared definition reservation | Fix: processing-run gate, definition locks, unbilled-only virtual resolution | Authorised local implementation, production approval pending | Acceptance: concurrent closure/billing sessions wait and refuse conflicting changes without partial writes.

Two focused follow-up reviews completed. The final review found no further issue after applying the coverage and reservation safeguards. Remaining production work is approval, application, deployment and signed-in browser verification.


Final status: FF-001 through FF-005 implemented and verified locally. All await production migration and deployment approval. Two focused follow-up reviews found the coverage and reservation issues; the final review found no further blocker. Lint, app types, test types, all London and UTC tests, isolated SQL/concurrency/reissue checks, rollback and production build passed.
