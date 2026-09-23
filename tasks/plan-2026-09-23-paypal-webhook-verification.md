# Plan: PayPal webhook verification fix, spec plus developer review

Spec: `tasks/spec-2026-09-23-paypal-webhook-verification-fix.md`
Review: `docs/reviews/2026-09-23-paypal-webhook-spec-review.md`
Date: 2026-09-23

The review said "ready with specified conditions". This plan implements the spec with the
review's corrections folded in, so R01 to R08 are resolved before release and R05, R09 and R10
are recorded.

## Decisions taken (recorded, not asked)

1. **Env fallback applies only to a registry outage, never to a successful "not registered".**
   The spec said fall back whenever resolution returns null. `resolveWebhookIdForUrl` returns
   null for both a successful lookup with no match and a failed lookup. R05 says a failed lookup
   is not proof of no registration. Falling back on a successful no-match would revive the exact
   six month bug, because the production `PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID` is known stale.
   So: matched wins outright, outage may use the endpoint's own env var (logged as `env`), a
   clean no-match fails closed with `configuration_error`.
2. **Past retry age and future clock skew are separate bounds** (R08). Past: 4 days. Future:
   5 minutes. The old absolute-value check is gone.
3. **Refund convergence is in this release** (R03), not deferred, so the release can honestly
   claim refund recovery.
4. **No schema migration.** `webhook_logs.status` is unconstrained text.

## Work items

- [x] P1 R04/C2: discriminated verification result in `src/lib/paypal.ts`;
      `verifyPayPalWebhook` keeps its boolean shape for the legacy caller.
- [x] P1 C1/R08: 4 day past window, 5 minute future skew, single exported constants.
- [x] P1 C3/R05: `resolvePayPalWebhookId` with lookup outcome and cache provenance;
      bounded timeouts on token, registry and verify fetches.
- [x] P1 C2: shared request gate so all five routes map outcome to status and HTTP alike.
- [x] P1 R01: invoices persist the idempotency response with the 30 day TTL.
- [x] P1 R02: a private booking denial only clears the order id it names.
- [x] P1 R03: a completed refund converges its booking state on retry.
- [x] P1 R06/C4: health cron covering processing failures, its own failures and email outcome.
- [x] P2 R07/C5: endpoint and event matrix, `.env.example`, `vercel.json` schedule, CLAUDE.md.
- [x] P2 R10: event-bookings gets webhook logging; invoices stops storing the signature and
      gains a terminal success log.
- [x] P1 R08: real helper tests with mocked HTTP plus parameterised route contract tests.

## Out of scope, recorded

- R09 historical reconciliation: read-only comparison of six months of exhausted deliveries.
  Needs owner sign-off, not shipped here.
- C6 owner actions: register parking and event-bookings webhooks in PayPal, delete the stale
  `PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID` from Vercel.
