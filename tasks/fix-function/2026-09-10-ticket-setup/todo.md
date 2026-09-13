# Ticket setup implementation plan

Goal: coherent paid ticket pricing, optional online discount deadline and named guest answers, while keeping free events simple.
Architecture: Tickets owns paid setup. Event fields mirror the first active ticket for compatibility. Atomic booking RPC validates guest answers and stores stable guest identities with question snapshots. Existing free flows stay unchanged.
Complexity: 5. Independent delivery order: schema foundation, backend and admin, website. No production application before exact migration approval.

- [x] Database: query live dependencies, draft migration and rollback, exercise actual functions on isolated PostgreSQL.
- [x] Admin: free stays default; paid Tickets tab edits prices, discount deadline and ordered optional/required questions; drawer summary only.
- [x] Backend: expiry-aware prices, explicit discount clearing, strict paid guest validation, atomic saves and consistent staff guest records.
- [x] Website: paid guest cards with stable identity, questions, deadline and current quote; free flow unchanged.
- [x] Verification: London/UTC tests, lint, typecheck, cold build, browser interaction with synthetic fixtures, independent risk review.
- [x] Delivery: list exact changed files, tests, remaining limitations and checksum-bound production approval.

Acceptance cases: £45 minus £5 gives £40 before deadline and £45 after; an in-date held booking keeps its snapshot. Blank price is invalid. Clearing discount persists. Two paid tickets require two names and their required answers; purchaser can be separate. Failed guest save rolls back booking. Quantity edits preserve the correct person's answers. Legacy/free bookings stay usable. No sensitive answers in public exports, logs or emails.

The owner approved both exact migrations and both releases. Migrations are applied and both final main commits are live. See ../../ticket-setup/production-release.md for evidence.

- [x] Apply both approved migrations and verify catalogue, permissions and rolled-back service-role smoke.
- [x] Merge both releases and verify final production deployment IDs and live screens.
- [x] Remove temporary release branches/worktrees while preserving original checkout changes.
- [x] Confirm final management GitHub CI result: success.
