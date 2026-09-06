# Garden private hire

- [x] Verify live schema, booking functions and venue identifiers.
- [x] Draft shared blocking, availability and reciprocal write guards.
- [x] Exercise functions and concurrency on isolated PostgreSQL: 36 checks passed.
- [x] Prepare exact SQL, rollback and production approval packet.

Status: production migration applied as 20260906155336 after exact approval. Rolled-back live smoke passed with no persisted synthetic records or external messages.

- [x] Resolve independently reproduced lock inversion and exercise normal prelocked RPCs against concurrent edits.

- [x] Apply exact approved SQL and verify live guards, availability, privileges and rollback cleanup.
- [x] Reconcile the new RPC type from live generated TypeScript.
- [ ] Merge the release record after CI passes.
