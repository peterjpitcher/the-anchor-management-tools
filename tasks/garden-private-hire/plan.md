# Garden private hire

- [x] Verify live schema, booking functions and venue identifiers.
- [x] Draft shared blocking, availability and reciprocal write guards.
- [x] Exercise functions and concurrency on isolated PostgreSQL: 36 checks passed.
- [x] Prepare exact SQL, rollback and production approval packet.

Status: owner-approved migration applied to production as 20260906155336. Live rollback-only smoke and permissions checks passed. PR 131 merged; production deployment dpl_3EFhaaYQWWr2tH7Y4Az87a13wdZ6 is READY and serves the canonical management domain. No real booking records or external messages changed.

- [x] Resolve independently reproduced lock inversion and exercise normal prelocked RPCs against concurrent edits.

- [x] Apply approved SQL and verify live trigger, availability and role behaviour.
- [ ] Complete source release and record final checks.

- [x] Apply approved SQL and verify live paths and role denials.
- [x] Reconcile generated RPC type in the clean release.
- [x] Merge PR #131 after CI and preview checks passed.
