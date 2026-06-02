# Task Tracker

## Current Task: Email-equivalent comms + Resend migration — Discovery & Spec

**Goal:** Cut Twilio SMS cost by sending email to customers who have an email on file. Produce a thorough, critical spec covering:
1. Every communication that needs an email equivalent
2. The channel-selection logic to prefer email when available (with safe SMS fallback)
3. Migration of email sends from `peter@orangejelly.co.uk` (Microsoft Graph) → **Resend**

### Brainstorming checklist (superpowers)
- [x] 1. Explore project context (discovery via agent team) — DONE, 6 findings files
- [~] 2. Visual companion — N/A (non-visual topic)
- [x] 3. Clarifying questions — DONE (4 decisions answered)
- [x] 4. Propose approaches — DONE (logging model, rollout, transport scope choices in spec)
- [x] 5. Present design — DONE, approved ("proceed as detailed")
- [x] 6. Write design doc / spec — docs/superpowers/specs/2026-05-31-email-comms-channel-and-resend-migration-design.md
- [x] 7. Spec self-review — DONE (fixed urgency/policy contradiction)
- [~] 8. User reviews spec — AWAITING REVIEW
- [ ] 9. Transition to writing-plans (only after spec approved)

### Discovery agent team (parallel) → findings/ — ALL COMPLETE
- [x] A1 SMS communications inventory (35 SMS, single sendSMS chokepoint)
- [x] A2 Email communications inventory (47 emails, 2 Graph transports)
- [x] A3 Customer contactability & channel-preference model (NO email consent model)
- [x] A4 Email infra & Resend migration surface (greenfield, 2 transports)
- [x] A5 Orchestration: crons/jobs/webhooks + dual-channel hook points
- [x] A6 SMS cost model & savings (18% email coverage; cost_usd is an estimate)

### Key discovery facts
- SMS chokepoint: `src/lib/twilio.ts:207` sendSMS (25 callers); only messages.create
- Email: `src/lib/email/emailService.ts` sendEmail + `src/lib/microsoft-graph.ts` (invoicing) — BOTH need migration
- 758 customers, 138 (18.2%) have email; 90d SMS ~1,060 (halved YoY)
- cost_usd = hardcoded $0.04×segments estimate, never backfilled from Twilio
- Email consent/bounce/suppression/unsubscribe: ABSENT — must be built
- Resend: not installed; returns {error} (no throw); needs verified domain + webhook

## Completed

## Review Notes
