Reviewed the spec, repo reality mapper, and key files.

**Findings**

`SD-001` High: Marketing opt-out is not rechecked for follow-ups as specced.  
The 14d RPC requires `marketing_sms_opt_in = TRUE` for both audience pools ([RPC:44](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260612000000_cross_promo_general_audience.sql:44), [RPC:88](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260612000000_cross_promo_general_audience.sql:88)). But the proposed 7d/3d stages query `promo_sequence` directly and only call out booking exclusion + daily limit before sending ([spec:80](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:80), [spec:113](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:113)). If a customer flips `marketing_sms_opt_in` to false after the 14d touch but remains `sms_opt_in = true` and `sms_status = active`, the as-designed follow-ups can still send.

`SD-002` High: `sendSMS` is not a marketing-consent enforcement layer.  
`sendSMS` loads `sms_status`, `sms_opt_in`, and phone fields only ([twilio.ts:119](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/twilio.ts:119)). It blocks `sms_opt_in === false` ([twilio.ts:173](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/twilio.ts:173)) and non-active `sms_status` ([twilio.ts:177](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/twilio.ts:177)), but it never selects or checks `marketing_sms_opt_in`. Existing bulk marketing send code does enforce that gate separately ([bulk.ts:255](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/bulk.ts:255), [bulk.ts:259](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/bulk.ts:259)); the new follow-up path needs the same explicit gate.

`SD-003` Medium: `promo_sequence` retention is unspecified and not implemented.  
The spec defines `promo_sequence.created_at` and touch timestamps ([spec:35](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:35)), but the migration steps do not include retention cleanup ([spec:155](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:155)). Current cleanup only deletes `sms_promo_context` rows older than 30 days ([route.ts:1755](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/event-guest-engagement/route.ts:1755)). Current repo search also confirms `promo_sequence` is not implemented yet, matching the mapper’s finding ([mapper:90](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/codex-qa-review/2026-04-16-multi-touch-promo-repo-reality-mapper-report.md:90)). Add an explicit lifecycle rule, probably delete after event date plus a short audit window.

`SD-004` Medium: `promo_sequence` avoids raw phone numbers, but still stores behavioral personal data.  
Per spec, `promo_sequence` stores `customer_id`, `event_id`, `audience_type`, and touch timestamps, not phone numbers ([spec:33](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:33)). That is better than `sms_promo_context`, which stores `phone_number` ([sms_promo_context migration:4](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404000002_cross_promo_infrastructure.sql:4)). Still, `customer_id + event_id + send timestamps` is identifiable behavioral marketing history and needs retention plus service-role-only access.

`SD-005` Medium: `promo_sequence` RLS cannot be verified yet; the referenced pattern is only partially hardened.  
There is no `promo_sequence` table/migration in the current tree, so its RLS cannot be verified. The existing `sms_promo_context` pattern is RLS enabled with no anon/authenticated policies ([sms_promo_context migration:23](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404000002_cross_promo_infrastructure.sql:23)), but that migration does not explicitly `REVOKE ALL ON TABLE ... FROM PUBLIC`. The new spec does require `REVOKE ALL ON TABLE promo_sequence FROM PUBLIC` ([spec:158](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-16-multi-touch-promo-sequence-design.md:158)); keep that stronger version rather than copying the older table literally.

**Direct Answers**

Current repo: 7d/3d follow-ups do not fire because `promo_sequence` and `sendFollowUpForEvent` are not implemented. As specced, they would fire after a marketing-only opt-out unless the follow-up query or sender rechecks `marketing_sms_opt_in`.

`sendSMS` checks phone ownership, `sms_opt_in`, and `sms_status`; it does not check `marketing_sms_opt_in`.

`promo_sequence` cleanup is missing.

`promo_sequence` stores `customer_id`, not phone number, per spec.

RLS for `promo_sequence` is not yet verifiable. The desired pattern should be RLS enabled, no anon/authenticated policies, explicit public revoke, service-role access only.